import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_SIGALL_TEST_MINT_ORIGIN,
	DemoSigAllFundingRefusedError,
	mintDemoSigAllFundingOutputs,
	prepareDemoSigAllFunding,
	requestDemoSigAllFundingQuote,
	validateDemoSigAllFundingPackage,
	type DemoSigAllFundingIntent,
	type DemoSigAllFundingPackage,
	type DemoSigAllFundingQuote,
	type DemoSigAllMintOutputPort,
	type DemoSigAllFundingProofVerifier,
} from './demo-sigall-funding'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { buildP2PKSecret, parseP2PKSecret } from './nut-client'

const key = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (privateKey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))
const oppositeParity = (compressed: string): string => `${compressed.startsWith('02') ? '03' : '02'}${compressed.slice(2)}`

const BIDDER_PUBLIC = publicKey(key(1))
const COMMITTEE_PUBLIC = publicKey(key(2))
const REFUND_PUBLIC = publicKey(key(3))
const DENOMINATION_PRIVATE_KEYS: Record<string, string> = {
	'1': key(11),
	'2': key(12),
	'4': key(13),
	'8': key(14),
	'16': key(15),
	'32': key(16),
	'64': key(17),
}
const DENOMINATION_KEYS = Object.fromEntries(
	Object.entries(DENOMINATION_PRIVATE_KEYS).map(([amount, privateKey]) => [amount, publicKey(privateKey)]),
)

function intent(overrides: Partial<DemoSigAllFundingIntent> = {}): DemoSigAllFundingIntent {
	return {
		schema: 'COCO_DEMO_SIGALL_FUNDING_INTENT_V1',
		environment: 'test-only',
		operationId: 'fund-bid-7',
		mintUrl: DEMO_SIGALL_TEST_MINT_ORIGIN,
		unit: 'sat',
		paymentMethod: 'bolt11',
		amount: 7,
		mintAdvertisedMinAmount: 1,
		mintAdvertisedMaxAmount: 1_000,
		approvedMaxAmount: 7,
		approvedMaxOutputs: 7,
		createdAt: 1_900_000_000,
		locktime: 2_000_000_000,
		bidderPublicKey: BIDDER_PUBLIC,
		committeePublicKey: COMMITTEE_PUBLIC,
		refundPublicKey: REFUND_PUBLIC,
		mintSeal: {
			mintUrl: DEMO_SIGALL_TEST_MINT_ORIGIN,
			mintPublicKey: publicKey(key(10)),
			serverVersion: 'testnut-fixture/1',
			activeSatKeysetId: 'test-keyset',
			denominationKeyDigest: demoDenominationKeyDigest(DENOMINATION_KEYS),
			denominationAmounts: [1, 2, 4, 8, 16, 32, 64],
			inputFeePpk: 0,
			nuts: [4, 7, 10, 11],
		},
		...overrides,
	}
}

function prepare(overrides: Partial<DemoSigAllFundingIntent> = {}): DemoSigAllFundingPackage {
	return prepareDemoSigAllFunding({
		intent: intent(overrides),
		denominationKeys: DENOMINATION_KEYS,
		nextNonce: (index) => (index + 1).toString(16).padStart(64, '0'),
		nextBlindingScalar: (index) => BigInt(index + 20),
	})
}

function paidQuote(prepared: DemoSigAllFundingPackage): DemoSigAllFundingQuote {
	return {
		schema: 'COCO_DEMO_SIGALL_FUNDING_QUOTE_V1',
		fundingRoot: prepared.fundingRoot,
		quoteId: 'quote-7',
		paymentRequest: 'test-only-payment-request',
		mintUrl: DEMO_SIGALL_TEST_MINT_ORIGIN,
		unit: 'sat',
		paymentMethod: 'bolt11',
		amount: prepared.intent.amount,
		state: 'PAID',
	}
}

function mintPort(onCall?: () => void): DemoSigAllMintOutputPort {
	return {
		async mintExact(request) {
			onCall?.()
			return {
				signatures: request.outputs.map((output) => {
					const amountKey = BigInt(`0x${DENOMINATION_PRIVATE_KEYS[String(output.amount)]}`)
					const blinded = secp256k1.Point.fromHex(output.B_)
					return {
						amount: output.amount,
						id: output.id,
						C_: bytesToHex(blinded.multiply(amountKey).toBytes(true)),
					}
				}),
			}
		},
	}
}

function proofVerifier(onCall?: () => void, result = true): DemoSigAllFundingProofVerifier {
	return {
		async verifyExact(request) {
			onCall?.()
			expect(request.proof.secret).toBeTruthy()
			expect(request.proof.amount).toBe(request.output.amount)
			expect(request.proof.id).toBe(request.output.id)
			return result
		},
	}
}

describe('test-only SIG_ALL funding', () => {
	test('prepares fresh unique bidder-plus-committee SIG_ALL outputs and completes exact paid issuance', async () => {
		const prepared = prepare()
		expect(prepared.outputs.map(({ amount }) => amount)).toEqual([1, 2, 4])
		expect(new Set(prepared.openings.map(({ secret }) => secret)).size).toBe(3)
		for (const opening of prepared.openings) {
			const lock = parseP2PKSecret(opening.secret)
			expect(lock?.data).toBe(BIDDER_PUBLIC)
			expect(lock?.tags).toEqual([
				['pubkeys', COMMITTEE_PUBLIC],
				['n_sigs', '2'],
				['sigflag', 'SIG_ALL'],
				['locktime', '2000000000'],
				['refund', REFUND_PUBLIC],
			])
		}

		let quoteCalls = 0
		const quote = await requestDemoSigAllFundingQuote(prepared, {
			async createQuote(request) {
				quoteCalls += 1
				expect(request.fundingRoot).toBe(prepared.fundingRoot)
				expect(request.intent.mintSeal).toEqual(prepared.intent.mintSeal)
				expect(request.outputs).toEqual(prepared.outputs)
				const publicRequest = JSON.stringify(request)
				expect(publicRequest).not.toContain('openings')
				for (const opening of prepared.openings) expect(publicRequest).not.toContain(opening.secret)
				return { ...paidQuote(prepared), state: 'UNPAID' }
			},
		}, 1_900_000_001)
		expect(quote.state).toBe('UNPAID')
		expect(quoteCalls).toBe(1)

		let mintCalls = 0
		let verifierCalls = 0
		const funded = await mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: mintPort(() => { mintCalls += 1 }),
			proofVerifier: proofVerifier(() => { verifierCalls += 1 }),
			nowSeconds: 1_900_000_001,
		})
		expect(mintCalls).toBe(1)
		expect(verifierCalls).toBe(3)
		expect(funded.proofs.map(({ amount }) => amount)).toEqual([1, 2, 4])
		expect(funded.proofs.map(({ secret }) => secret)).toEqual(prepared.openings.map(({ secret }) => secret))
		expect(funded.proofs.every((proof) => parseP2PKSecret(proof.secret)?.tags.some(([name, value]) => name === 'sigflag' && value === 'SIG_ALL'))).toBe(true)
	})

	test('never accepts or upgrades an existing SIG_INPUTS secret', async () => {
		const prepared = prepare()
		const oldSecret = buildP2PKSecret(BIDDER_PUBLIC, {
			nonce: '44'.repeat(32),
			sigflag: 'SIG_INPUTS',
			locktime: prepared.intent.locktime,
			refundPubkey: BIDDER_PUBLIC,
		})
		prepared.openings[0] = { ...prepared.openings[0], secret: oldSecret }
		let quoteCalls = 0
		expect(() => validateDemoSigAllFundingPackage(prepared)).toThrow(/DEMO_SIGALL_FUNDING_EXISTING_LOCK/)
		await expect(requestDemoSigAllFundingQuote(prepared, {
			async createQuote() {
				quoteCalls += 1
				return paidQuote(prepared)
			},
		}, 1_900_000_001)).rejects.toThrow(DemoSigAllFundingRefusedError)
		expect(quoteCalls).toBe(0)
	})

	test('rejects duplicate secrets before either funding port is called', async () => {
		const prepared = prepare()
		prepared.openings[1] = prepared.openings[0]
		prepared.outputs[1] = { ...prepared.outputs[1], B_: prepared.outputs[0].B_ }
		let mintCalls = 0
		expect(() => validateDemoSigAllFundingPackage(prepared)).toThrow(/DEMO_SIGALL_FUNDING_DUPLICATE_SECRET/)
		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: mintPort(() => { mintCalls += 1 }),
			proofVerifier: proofVerifier(),
			nowSeconds: 1_900_000_001,
		})).rejects.toThrow(DemoSigAllFundingRefusedError)
		expect(mintCalls).toBe(0)
	})

	test('fails closed on bidder, committee, refund, locktime, keyset, and root tampering', () => {
		const mutations: Array<(value: DemoSigAllFundingPackage) => void> = [
			(value) => { value.intent.bidderPublicKey = publicKey(key(3)) },
			(value) => { value.intent.committeePublicKey = publicKey(key(4)) },
			(value) => { value.intent.refundPublicKey = publicKey(key(5)) },
			(value) => { value.intent.locktime += 1 },
			(value) => { value.intent.mintSeal.activeSatKeysetId = 'other-keyset' },
			(value) => { value.fundingRoot = '00'.repeat(32) },
		]
		for (const mutate of mutations) {
			const prepared = prepare()
			mutate(prepared)
			expect(() => validateDemoSigAllFundingPackage(prepared)).toThrow(DemoSigAllFundingRefusedError)
		}
	})

	test('enforces mint-advertised and explicit per-request caps without a fixed amount ceiling', () => {
		expect(() => prepare({ amount: 8 })).toThrow(/DEMO_SIGALL_FUNDING_CAP/)
		expect(() => prepare({ approvedMaxAmount: 1_001 })).toThrow(/DEMO_SIGALL_FUNDING_CAP/)
		expect(() => prepare({ amount: 1, mintAdvertisedMinAmount: 2 })).toThrow(/DEMO_SIGALL_FUNDING_CAP/)
		expect(() => prepare({ amount: 7, approvedMaxOutputs: 2 })).toThrow(/DEMO_SIGALL_FUNDING_CAP/)
		const largerExplicitRequest = prepare({ amount: 127, approvedMaxAmount: 127 })
		expect(largerExplicitRequest.outputs.map(({ amount }) => amount)).toEqual([1, 2, 4, 8, 16, 32, 64])
	})

	test('rejects invalid or duplicate signer points and expired quote creation before I/O', async () => {
		expect(() => prepare({ committeePublicKey: BIDDER_PUBLIC })).toThrow(/DEMO_SIGALL_FUNDING_KEYS/)
		expect(() => prepare({ committeePublicKey: oppositeParity(BIDDER_PUBLIC) })).toThrow(/DEMO_SIGALL_FUNDING_KEYS/)
		expect(() => prepare({ refundPublicKey: BIDDER_PUBLIC })).toThrow(/DEMO_SIGALL_FUNDING_REFUND/)
		expect(() => prepare({ refundPublicKey: COMMITTEE_PUBLIC })).toThrow(/DEMO_SIGALL_FUNDING_REFUND/)
		expect(() => prepare({ refundPublicKey: oppositeParity(BIDDER_PUBLIC) })).toThrow(/DEMO_SIGALL_FUNDING_REFUND/)
		expect(() => prepare({ bidderPublicKey: `02${'ff'.repeat(32)}` })).toThrow(/DEMO_SIGALL_FUNDING_KEY/)
		expect(() => prepare({ mintSeal: { ...intent().mintSeal, inputFeePpk: 101 } })).toThrow(/DEMO_SIGALL_FUNDING_MINT_SEAL/)

		const prepared = prepare()
		let quoteCalls = 0
		await expect(requestDemoSigAllFundingQuote(prepared, {
			async createQuote() {
				quoteCalls += 1
				return paidQuote(prepared)
			},
		}, prepared.intent.locktime)).rejects.toThrow(/DEMO_SIGALL_FUNDING_LOCKTIME/)
		expect(quoteCalls).toBe(0)

		const noncanonicalKeys = { ...DENOMINATION_KEYS, '01': DENOMINATION_KEYS['1'] }
		const invalidIntent = intent({
			mintSeal: {
				...intent().mintSeal,
				denominationKeyDigest: demoDenominationKeyDigest(noncanonicalKeys),
				denominationAmounts: [1, 1, 2, 4, 8, 16, 32, 64],
			},
		})
		expect(() => prepareDemoSigAllFunding({ intent: invalidIntent, denominationKeys: noncanonicalKeys })).toThrow(/DEMO_SIGALL_FUNDING_MINT_SEAL/)
		const noncanonicalPrepared = prepare()
		const { '1': oneKey, ...remainingKeys } = noncanonicalPrepared.denominationKeys
		noncanonicalPrepared.denominationKeys = { '01': oneKey, ...remainingKeys }
		noncanonicalPrepared.intent.mintSeal.denominationKeyDigest = demoDenominationKeyDigest(noncanonicalPrepared.denominationKeys)
		let noncanonicalQuoteCalls = 0
		await expect(requestDemoSigAllFundingQuote(noncanonicalPrepared, {
			async createQuote() {
				noncanonicalQuoteCalls += 1
				return paidQuote(noncanonicalPrepared)
			},
		}, 1_900_000_001)).rejects.toThrow(/DEMO_SIGALL_FUNDING_MINT_SEAL/)
		expect(noncanonicalQuoteCalls).toBe(0)
	})

	test('requires exact quote binding, PAID state, pre-locktime completion, and exact mint response', async () => {
		const prepared = prepare()
		let mintCalls = 0
		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: { ...paidQuote(prepared), amount: prepared.intent.amount + 1 },
			mintPort: mintPort(() => { mintCalls += 1 }),
			proofVerifier: proofVerifier(),
			nowSeconds: 1_900_000_001,
		})).rejects.toThrow(/DEMO_SIGALL_FUNDING_QUOTE/)
		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: { ...paidQuote(prepared), state: 'UNPAID' },
			mintPort: mintPort(() => { mintCalls += 1 }),
			proofVerifier: proofVerifier(),
			nowSeconds: 1_900_000_001,
		})).rejects.toThrow(/DEMO_SIGALL_FUNDING_QUOTE/)
		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: mintPort(() => { mintCalls += 1 }),
			proofVerifier: proofVerifier(),
			nowSeconds: prepared.intent.locktime,
		})).rejects.toThrow(/DEMO_SIGALL_FUNDING_LOCKTIME/)
		expect(mintCalls).toBe(0)

		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: {
				async mintExact(request) {
					return { signatures: request.outputs.slice(1).map((output) => ({ ...output, C_: output.B_ })) }
				},
			},
			proofVerifier: proofVerifier(),
			nowSeconds: 1_900_000_001,
		})).rejects.toThrow(/DEMO_SIGALL_FUNDING_MINT_RESPONSE/)

		let verifierCalls = 0
		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: mintPort(),
			proofVerifier: proofVerifier(() => { verifierCalls += 1 }, false),
			nowSeconds: 1_900_000_001,
		})).rejects.toThrow(/DEMO_SIGALL_FUNDING_PROOF_INVALID/)
		expect(verifierCalls).toBe(1)
	})

	test('snapshots funding values and verification ports before mint I/O', async () => {
		const prepared = prepare()
		const originalRoot = prepared.fundingRoot
		const exactMint = mintPort()
		let originalVerifierCalls = 0
		let swappedVerifierCalls = 0
		let options: Parameters<typeof mintDemoSigAllFundingOutputs>[0]
		options = {
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: {
				async mintExact(request) {
					prepared.intent.operationId = 'mutated-operation'
					options.proofVerifier = {
						async verifyExact() { swappedVerifierCalls += 1; return false },
					}
					return exactMint.mintExact(request)
				},
			},
			proofVerifier: proofVerifier(() => { originalVerifierCalls += 1 }),
			nowSeconds: 1_900_000_001,
		}
		const result = await mintDemoSigAllFundingOutputs(options)
		expect(result.proofs).toHaveLength(3)
		expect(originalVerifierCalls).toBe(3)
		expect(swappedVerifierCalls).toBe(0)
		expect(result.fundingRoot).toBe(originalRoot)
	})

	test('rechecks locktime after quote, mint, and proof-verification awaits', async () => {
		const prepared = prepare()
		let quoteCalls = 0
		let quoteClock = [prepared.intent.locktime - 1, prepared.intent.locktime]
		await expect(requestDemoSigAllFundingQuote(prepared, {
			async createQuote() { quoteCalls += 1; return paidQuote(prepared) },
		}, () => quoteClock.shift() ?? prepared.intent.locktime)).rejects.toThrow(/DEMO_SIGALL_FUNDING_LOCKTIME/)
		expect(quoteCalls).toBe(1)

		let mintCalls = 0
		let verifierCalls = 0
		let mintClock = [prepared.intent.locktime - 1, prepared.intent.locktime]
		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: mintPort(() => { mintCalls += 1 }),
			proofVerifier: proofVerifier(() => { verifierCalls += 1 }),
			nowSeconds: () => mintClock.shift() ?? prepared.intent.locktime,
		})).rejects.toThrow(/DEMO_SIGALL_FUNDING_LOCKTIME/)
		expect(mintCalls).toBe(1)
		expect(verifierCalls).toBe(0)

		let verifyClock = [prepared.intent.locktime - 1, prepared.intent.locktime - 1, prepared.intent.locktime]
		await expect(mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: paidQuote(prepared),
			mintPort: mintPort(),
			proofVerifier: proofVerifier(() => { verifierCalls += 1 }),
			nowSeconds: () => verifyClock.shift() ?? prepared.intent.locktime,
		})).rejects.toThrow(/DEMO_SIGALL_FUNDING_LOCKTIME/)
		expect(verifierCalls).toBe(1)
	})
})
