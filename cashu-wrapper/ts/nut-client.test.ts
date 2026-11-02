/**
 * cashu-wrapper/ts/nut-client.test.ts — the unit-level suite for the NUT client.
 *
 * Test support, out of contract: it mints no statement. It covers the parts that can be proved
 * without a mint in the loop — hash-to-curve determinism, the blind/unblind round trip against a
 * locally held key, the exact bytes of a P2PK locked secret, and the witness signature verifying
 * against the locking key. The live mint round trip is a separate script and is not run here.
 */
import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
	CASHU_DOMAIN_SEPARATOR,
	CashuMintClient,
	CashuMintError,
	blindMessage,
	buildBlindedOutputs,
	buildP2PKSecret,
	buildP2PKWitness,
	bytesToNumberBE,
	generateSchnorrKeypair,
	hashToCurve,
	inputFee,
	keysetPublicKey,
	numberToBytesBE,
	numberToBytesLE,
	parseP2PKSecret,
	randomScalar,
	randomSecretHex,
	compressedPublicKeyHex,
	signLockedSecret,
	splitAmount,
	unblindSignature,
	verifyLockedSecret,
} from './nut-client'

const FIXED_SECRET = 'a'.repeat(64)

function innerDigest(secret: string): Uint8Array {
	// NUT-00, as the reference wallets and cdk implement it: the domain separator and the secret are
	// hashed to an inner digest, and the little-endian counter is hashed with it, not appended raw.
	return sha256(concatBytes(CASHU_DOMAIN_SEPARATOR, utf8ToBytes(secret)))
}

function counterDigest(secret: string, counter: number): Uint8Array {
	return sha256(concatBytes(innerDigest(secret), numberToBytesLE(BigInt(counter), 4)))
}

/** The first counter whose counter-digest lifts to a valid even-prefix point, computed independently. */
function firstValidCounter(secret: string): number {
	for (let counter = 0; counter < 1024; counter += 1) {
		const candidate = new Uint8Array(33)
		candidate[0] = 0x02
		candidate.set(counterDigest(secret, counter), 1)
		try {
			secp256k1.Point.fromHex(bytesToHex(candidate)).assertValidity()
			return counter
		} catch {
			continue
		}
	}
	throw new Error('no valid counter in the probe range')
}

describe('hash_to_curve', () => {
	test('is deterministic for a fixed secret', () => {
		const first = bytesToHex(hashToCurve(FIXED_SECRET).toBytes(true))
		for (let i = 0; i < 8; i += 1) {
			expect(bytesToHex(hashToCurve(FIXED_SECRET).toBytes(true))).toBe(first)
		}
		expect(first.startsWith('02')).toBe(true)
		expect(first.length).toBe(66)
	})

	test('the point is valid and carries an even prefix', () => {
		const point = hashToCurve(FIXED_SECRET)
		point.assertValidity()
		expect(point.toBytes(true)[0]).toBe(0x02)
		expect(point.equals(secp256k1.Point.ZERO)).toBe(false)
	})

	test('matches the reference wallets byte for byte on a known secret', () => {
		// Cross-implementation known-answer vector: cashu-ts 4.11.0 (and the live mint, see the round
		// trip) produces this compressed point for secret 'a' repeated 64 times.
		expect(bytesToHex(hashToCurve(FIXED_SECRET).toBytes(true))).toBe(
			'02d7cb9a4d22e00ba91cd4fe31d2894bb896ccb8550f7bbdb60a25f96d1654eaea',
		)
	})

	test('the x coordinate is the counter-digest at the first valid counter', () => {
		const point = hashToCurve(FIXED_SECRET)
		const x = bytesToHex(numberToBytesBE(point.x, 32))
		const counter = firstValidCounter(FIXED_SECRET)
		expect(bytesToHex(counterDigest(FIXED_SECRET, counter))).toBe(x)
		for (let earlier = 0; earlier < counter; earlier += 1) {
			expect(bytesToHex(counterDigest(FIXED_SECRET, earlier))).not.toBe(x)
		}
	})

	test('agrees with an independent first-valid-counter search, including counters above zero', () => {
		let sawNonZeroCounter = false
		for (let i = 0; i < 16; i += 1) {
			const secret = randomSecretHex()
			const counter = firstValidCounter(secret)
			if (counter > 0) sawNonZeroCounter = true
			const x = bytesToHex(numberToBytesBE(hashToCurve(secret).x, 32))
			expect(x).toBe(bytesToHex(counterDigest(secret, counter)))
		}
		expect(sawNonZeroCounter).toBe(true)
	})

	test('the domain separator and secret are hashed before the counter is mixed in', () => {
		// A single-hash construction sha256(domain || secret || LE32(counter)) is a different point:
		// the reference construction hashes domain||secret first. This pins the difference.
		const singleHash = sha256(concatBytes(CASHU_DOMAIN_SEPARATOR, utf8ToBytes(FIXED_SECRET), numberToBytesLE(0n, 4)))
		const counterZero = counterDigest(FIXED_SECRET, 0)
		expect(bytesToHex(counterZero)).not.toBe(bytesToHex(singleHash))
	})

	test('the counter is little-endian, unlike the big-endian form', () => {
		expect(numberToBytesLE(1n, 4)).toEqual(new Uint8Array([1, 0, 0, 0]))
		expect(numberToBytesBE(1n, 4)).toEqual(new Uint8Array([0, 0, 0, 1]))
		expect(Array.from(numberToBytesLE(0x12345678n, 4))).toEqual([0x78, 0x56, 0x34, 0x12])
	})

	test('a different secret maps to a different point', () => {
		const a = bytesToHex(hashToCurve(FIXED_SECRET).toBytes(true))
		const b = bytesToHex(hashToCurve('b'.repeat(64)).toBytes(true))
		expect(a).not.toBe(b)
	})

	test('randomSecretHex is 32 bytes of hex', () => {
		const secret = randomSecretHex()
		expect(secret).toMatch(/^[0-9a-f]{64}$/)
		expect(randomSecretHex()).not.toBe(secret)
	})
})

describe('blinding and unblinding', () => {
	test('B_ = Y + r*G unblinds to k*Y with the mint key K = k*G', () => {
		const secret = randomSecretHex()
		const r = randomScalar()
		const { B_ } = blindMessage(secret, r)

		// The mint's private scalar k and its public point K = k*G. It signs B_ with k.
		const k = randomScalar()
		const K = secp256k1.Point.BASE.multiply(k)
		const C_ = bytesToHex(secp256k1.Point.fromHex(B_).multiply(k).toBytes(true))

		const C = unblindSignature(C_, r, K)
		const expected = bytesToHex(hashToCurve(secret).multiply(k).toBytes(true))

		expect(C).toBe(expected)
		expect(C).not.toBe(C_)
		// And the unblinded signature verifies against the mint's own public point.
		expect(secp256k1.Point.fromHex(C).equals(hashToCurve(secret).multiply(k))).toBe(true)
		expect(K.equals(secp256k1.Point.BASE.multiply(k))).toBe(true)
	})

	test('subtracting r*G is the special case K = G, and wrong for any other mint key', () => {
		const secret = randomSecretHex()
		const r = randomScalar()
		const { B_ } = blindMessage(secret, r)
		const Y = bytesToHex(hashToCurve(secret).toBytes(true))

		// k = 1: the mint's key IS the generator, so the generator form is exact.
		expect(unblindSignature(B_, r, secp256k1.Point.BASE)).toBe(Y)
		expect(secp256k1.Point.fromHex(B_).subtract(secp256k1.Point.BASE.multiply(r)).equals(hashToCurve(secret))).toBe(true)

		// A real mint's amount key is a random point: the generator form is then wrong, the key form right.
		const k = randomScalar()
		const K = secp256k1.Point.BASE.multiply(k)
		const C_ = bytesToHex(secp256k1.Point.fromHex(B_).multiply(k).toBytes(true))
		const generatorForm = bytesToHex(
			secp256k1.Point.fromHex(C_).subtract(secp256k1.Point.BASE.multiply(r)).toBytes(true),
		)
		expect(unblindSignature(C_, r, K)).toBe(bytesToHex(hashToCurve(secret).multiply(k).toBytes(true)))
		expect(unblindSignature(C_, r, K)).not.toBe(generatorForm)
	})

	test('keysetPublicKey reads the amount key and refuses an unknown amount', () => {
		const keyset = { keys: { '1': '02' + '11'.repeat(32), '8': '03' + '22'.repeat(32) } }
		expect(keysetPublicKey(keyset, 8)).toBe('03' + '22'.repeat(32))
		expect(() => keysetPublicKey(keyset, 4)).toThrow(/no key for amount 4/)
	})

	test('a wrong blinding factor does not open the signature', () => {
		const secret = randomSecretHex()
		const r = randomScalar()
		const { B_ } = blindMessage(secret, r)
		const k = randomScalar()
		const K = secp256k1.Point.BASE.multiply(k)
		const C_ = bytesToHex(secp256k1.Point.fromHex(B_).multiply(k).toBytes(true))
		const wrong = (r + 1n) % secp256k1.Point.Fn.ORDER
		expect(unblindSignature(C_, wrong, K)).not.toBe(
			bytesToHex(hashToCurve(secret).multiply(k).toBytes(true)),
		)
	})

	test('big-endian scalar helpers round trip', () => {
		const value = randomScalar()
		expect(bytesToNumberBE(numberToBytesBE(value, 32))).toBe(value)
		expect(numberToBytesBE(1n, 4)).toEqual(new Uint8Array([0, 0, 0, 1]))
	})

	test('splitAmount decomposes into signable powers of two', () => {
		expect(splitAmount(32)).toEqual([32])
		expect(splitAmount(13)).toEqual([1, 4, 8])
		expect(splitAmount(13).reduce((sum, part) => sum + part, 0)).toBe(13)
		expect(splitAmount(15).reduce((sum, part) => sum + part, 0)).toBe(15)
	})

	test('inputFee is the keyset ppk fee, rounded up, and a swap must balance exactly', () => {
		// The test mint advertises input_fee_ppk 100: one fee-bearing sat per input.
		expect(inputFee(100, 1)).toBe(1)
		expect(inputFee(100, 2)).toBe(1)
		expect(inputFee(100, 10)).toBe(1)
		expect(inputFee(100, 11)).toBe(2)
		expect(inputFee(0, 7)).toBe(0)
		expect(inputFee(100, 0)).toBe(0)
		// sum(inputs) == sum(outputs) + fee
		expect(17 - inputFee(100, 2)).toBe(16)
	})

	test('buildBlindedOutputs produces one output per part, each with its own secret', () => {
		const { outputs, blindings } = buildBlindedOutputs([8, 4, 2], '00aa')
		expect(outputs.map((output) => output.amount)).toEqual([8, 4, 2])
		expect(outputs.every((output) => output.id === '00aa')).toBe(true)
		expect(outputs.every((output) => /^0[23][0-9a-f]{64}$/.test(output.B_))).toBe(true)
		expect(new Set(blindings.map((blinding) => blinding.secret)).size).toBe(3)
	})
})

describe('P2PK locked secret', () => {
	const data = '02' + 'ab'.repeat(32)
	const nonce = 'cd'.repeat(32)

	test('is the NUT-10 two-element array, key order nonce/data/tags, string tag values', () => {
		const secret = buildP2PKSecret(data, { nonce, locktime: 1900000000 })
		const expected =
			'["P2PK",{"nonce":"' +
			nonce +
			'","data":"' +
			data +
			'","tags":[["sigflag","SIG_INPUTS"],["locktime","1900000000"]]}]'
		expect(secret).toBe(expected)
	})

	test('is not the ASCII-prefix form, which a NUT-10 mint does not recognise as a lock', () => {
		const prefixForm = 'P2PK' + JSON.stringify([{ nonce, data, tags: [['sigflag', 'SIG_INPUTS']] }])
		expect(parseP2PKSecret(prefixForm)).toBeNull()
		expect(parseP2PKSecret(buildP2PKSecret(data, { nonce }))).not.toBeNull()
	})

	test('defaults to a SIG_INPUTS flag and a fresh nonce', () => {
		const first = parseP2PKSecret(buildP2PKSecret(data)) as { nonce: string; tags: unknown }
		const second = parseP2PKSecret(buildP2PKSecret(data)) as { nonce: string }
		expect(first.tags).toEqual([['sigflag', 'SIG_INPUTS']])
		expect(first.nonce).toMatch(/^[0-9a-f]{64}$/)
		expect(first.nonce).not.toBe(second.nonce)
	})

	test('an explicit sigflag, refund key and locktime are all carried, locktime as a string', () => {
		const secret = buildP2PKSecret(data, {
			nonce,
			sigflag: 'SIG_ALL',
			refundPubkey: '02' + 'ef'.repeat(32),
			locktime: 2000000000,
		})
		expect(parseP2PKSecret(secret)?.tags).toEqual([
			['sigflag', 'SIG_ALL'],
			['pubkeys', '02' + 'ef'.repeat(32)],
			['locktime', '2000000000'],
		])
	})

	test('parseP2PKSecret round trips and rejects non-P2PK strings', () => {
		const secret = buildP2PKSecret(data, { nonce, locktime: 1900000000 })
		expect(parseP2PKSecret(secret)).toEqual({
			nonce,
			data,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', '1900000000'],
			],
		})
		expect(parseP2PKSecret('not a lock')).toBeNull()
		expect(parseP2PKSecret('P2PK not json')).toBeNull()
		expect(parseP2PKSecret('["HTLC",{}]')).toBeNull()
		expect(parseP2PKSecret('["P2PK"]')).toBeNull()
	})
})

describe('P2PK witness', () => {
	test('the signature verifies against the locking public key', () => {
		const { privateKeyHex, publicKeyHex } = generateSchnorrKeypair()
		const secret = buildP2PKSecret(publicKeyHex, { locktime: 4102444800 })
		const witness = buildP2PKWitness(secret, privateKeyHex)

		const parsed = JSON.parse(witness) as { signatures: string[] }
		expect(Array.isArray(parsed.signatures)).toBe(true)
		expect(parsed.signatures.length).toBe(1)
		expect(parsed.signatures[0]).toMatch(/^[0-9a-f]{128}$/)

		expect(verifyLockedSecret(secret, parsed.signatures[0], publicKeyHex)).toBe(true)
		expect(compressedPublicKeyHex(privateKeyHex)).toBe(publicKeyHex)
		expect(publicKeyHex).toMatch(/^0[23][0-9a-f]{64}$/)
	})

	test('an x-only key is refused: the mint cannot parse a secret whose data is not a compressed key', () => {
		const { privateKeyHex, xOnlyPublicKeyHex } = generateSchnorrKeypair()
		expect(xOnlyPublicKeyHex).toMatch(/^[0-9a-f]{64}$/)
		expect(compressedPublicKeyHex(privateKeyHex).slice(2)).toBe(xOnlyPublicKeyHex)
		expect(() => buildP2PKSecret(xOnlyPublicKeyHex, { locktime: 4102444800 })).toThrow(/compressed public key/)
	})

	test('a different key does not verify', () => {
		const { privateKeyHex, publicKeyHex } = generateSchnorrKeypair()
		const other = generateSchnorrKeypair()
		const secret = buildP2PKSecret(publicKeyHex, { locktime: 4102444800 })

		const strangerSignature = signLockedSecret(secret, other.privateKeyHex)
		expect(verifyLockedSecret(secret, strangerSignature, publicKeyHex)).toBe(false)
		expect(verifyLockedSecret(secret, signLockedSecret(secret, privateKeyHex), other.publicKeyHex)).toBe(false)
	})

	test('the signature is over sha256(secret), and over the raw secret bytes it does not verify', () => {
		const { privateKeyHex, publicKeyHex } = generateSchnorrKeypair()
		const secret = buildP2PKSecret(publicKeyHex, { locktime: 4102444800 })
		const signature = signLockedSecret(secret, privateKeyHex)
		expect(verifyLockedSecret(secret, signature, publicKeyHex)).toBe(true)
		expect(verifyLockedSecret(secret + ' ', signature, publicKeyHex)).toBe(false)
		const other = generateSchnorrKeypair()
		expect(verifyLockedSecret(secret, signature, other.publicKeyHex)).toBe(false)
		// Signing the raw secret instead of its digest is the second wire bug this suite pins: that
		// signature must NOT verify, because cdk signs the digest.
		const overRawBytes = bytesToHex(schnorr.sign(utf8ToBytes(secret), hexToBytes(privateKeyHex)))
		expect(overRawBytes).not.toBe(signature)
		expect(verifyLockedSecret(secret, overRawBytes, publicKeyHex)).toBe(false)
	})

	test('the witness is a JSON string, not an object', () => {
		const { privateKeyHex, publicKeyHex } = generateSchnorrKeypair()
		const secret = buildP2PKSecret(publicKeyHex, { locktime: 4102444800 })
		const witness = buildP2PKWitness(secret, privateKeyHex)
		expect(typeof witness).toBe('string')
		expect(witness.startsWith('{')).toBe(true)
		expect(Object.keys(JSON.parse(witness))).toEqual(['signatures'])
	})
})

describe('CashuMintClient', () => {
	test('a refused spend surfaces the mint body verbatim', async () => {
		const body = '{"detail":"Signature validation failed.","code":1002}'
		const fetchImpl = (async () =>
			new Response(body, { status: 400, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
		const client = new CashuMintClient({ mintUrl: 'https://mint.invalid', fetchImpl })

		let raised: unknown = null
		try {
			await client.swap(
				[{ amount: 8, id: '00aa', secret: 's', C: '02' + '11'.repeat(32) }],
				[{ amount: 8, id: '00aa', B_: '02' + '22'.repeat(32) }],
				'{"signatures":["deadbeef"]}',
			)
		} catch (error) {
			raised = error
		}
		expect(raised).toBeInstanceOf(CashuMintError)
		expect((raised as CashuMintError).status).toBe(400)
		expect((raised as CashuMintError).body).toBe(body)
		expect((raised as CashuMintError).endpoint).toBe('/v1/swap')
	})

	test('swap puts the witness on the wire as a string field', async () => {
		let seen: unknown = null
		const fetchImpl = (async (_url: string, init: RequestInit) => {
			seen = JSON.parse(String(init.body))
			return new Response('{"signatures":[]}', { status: 200 })
		}) as unknown as typeof fetch
		const client = new CashuMintClient({ mintUrl: 'https://mint.invalid/', fetchImpl })

		await client.swap([], [], '{"signatures":["aa"]}')
		expect(seen).toEqual({ inputs: [], outputs: [], witness: '{"signatures":["aa"]}' })
		expect(client.mintUrl).toBe('https://mint.invalid')
	})

	test('the active keyset is selected by unit and activity', async () => {
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify({
					keysets: [
						{ id: 'old', unit: 'sat', active: false },
						{ id: 'active', unit: 'sat', active: true },
						{ id: 'usd', unit: 'usd', active: true },
					],
				}),
				{ status: 200 },
			)) as unknown as typeof fetch
		const client = new CashuMintClient({ mintUrl: 'https://mint.invalid', fetchImpl })
		expect((await client.activeKeyset('sat'))?.id).toBe('active')
		expect(await client.activeKeyset('eur')).toBeNull()
	})

	test('awaitMintQuotePaid polls until the quote is paid', async () => {
		let reads = 0
		const fetchImpl = (async () => {
			reads += 1
			const state = reads < 3 ? 'UNPAID' : 'PAID'
			return new Response(JSON.stringify({ quote: 'q', request: 'lnbc', state }), { status: 200 })
		}) as unknown as typeof fetch
		const client = new CashuMintClient({ mintUrl: 'https://mint.invalid', fetchImpl })

		let clock = 0
		const state = await client.awaitMintQuotePaid('q', {
			intervalMs: 10,
			now: () => clock,
			sleep: async (ms) => {
				clock += ms
			},
		})
		expect(state.state).toBe('PAID')
		expect(reads).toBe(3)
	})

	test('awaitMintQuotePaid gives up on the deadline', async () => {
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ quote: 'q', request: 'lnbc', state: 'UNPAID' }), {
				status: 200,
			})) as unknown as typeof fetch
		const client = new CashuMintClient({ mintUrl: 'https://mint.invalid', fetchImpl })

		let clock = 0
		await expect(
			client.awaitMintQuotePaid('q', {
				timeoutMs: 5,
				intervalMs: 5,
				now: () => clock,
				sleep: async (ms) => {
					clock += ms
				},
			}),
		).rejects.toThrow(/still UNPAID/)
	})
})
