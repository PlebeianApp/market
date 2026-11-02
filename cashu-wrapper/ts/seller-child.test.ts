/**
 * seller-child.test.ts — the derivation, proven equal to the market's own function on real vectors.
 *
 * AUCTIONS.md §4.1/§4.2 make the lock key `derive(auction.p2pk_xpub, path)`, and ADR-0003 **P3.9** is
 * "`derive(p2pk_xpub, path) == child_pubkey`". `seller-child.ts` is a hand-written, dependency-free CKDpub — so it
 * must be shown to agree with the market's own implementation, `deriveAuctionChildP2pkPubkeyFromXpub`
 * (`market/src/lib/auctionP2pk.ts:86-94`), which uses `HDKey` from `@scure/bip32`.
 *
 * Two independent proofs, both here:
 *
 *   1. **Frozen vectors** (`runs/2026-10-12-phase-2/evidence/w4-oracle-vectors.json`): (xpub, path) → child
 *      pubkey triples produced by running the market's OWN function (see `w4-oracle-vectors.sh`). Our derivation
 *      must reproduce every one.
 *   2. **A live oracle**: `@scure/bip32`'s `HDKey` — the very library the market uses — is imported HERE (tests
 *      may; it is a pure function with no network call) and run over many fresh high-entropy paths against three
 *      xpubs. Our CKDpub must agree with it on all of them.
 *
 * If either disagrees, the test fails; the derivation is never assumed correct.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HDKey } from '@scure/bip32'

import { deriveChildPublicKey, deriveSellerChildPubkey, generateBidDerivationPath, normalizeBidPath, parseExtendedPublicKey, SellerChildRefusedError, AUCTION_PATH_LEVELS } from './seller-child'

const HERE = dirname(fileURLToPath(import.meta.url))

/** BIP32 test vector 1's master xpub — a published, reproducible vector. */
const BIP32_VEC1_XPUB =
	'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'

/** The oracle: the market's own algorithm, run with the market's own library. */
function marketDerive(xpub: string, path: string): string {
	const child = HDKey.fromExtendedKey(xpub.trim()).derive(path.trim().startsWith('m/') || path.trim() === 'm' ? path.trim() : `m/${path.replace(/^\/+/, '')}`)
	if (!child.publicKey) throw new Error('no child public key')
	return Array.from(child.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Exercise the primitive CKDpub implementation on the historical general-depth vectors. */
function generalDerive(xpub: string, path: string): string {
	let current = parseExtendedPublicKey(xpub)
	const body = path.replace(/^[mM]\/?/, '')
	for (const segment of body === '' ? [] : body.split('/')) current = deriveChildPublicKey(current, Number(segment))
	return Buffer.from(current.publicKey).toString('hex')
}

interface Vector {
	readonly xpub: string
	readonly path: string
	readonly child: string
}

describe('derive(seller_p2pk_xpub, path) — our CKDpub vs the market own function', () => {
	const frozen = JSON.parse(
		readFileSync(resolve(HERE, '..', '..', 'runs', '2026-10-12-phase-2', 'evidence', 'w4-oracle-vectors.json'), 'utf8'),
	) as Vector[]

	test('the frozen oracle vectors are the shape we expect (24 vectors, real xpubs, compressed children)', () => {
		expect(frozen.length).toBe(24)
		for (const vector of frozen) {
			expect(vector.xpub.startsWith('xpub')).toBe(true)
			expect(vector.path.startsWith('m/')).toBe(true)
			expect(vector.child).toMatch(/^0[23][0-9a-f]{64}$/)
		}
	})

	test('reproduces EVERY vector the market own function produced', () => {
		for (const vector of frozen) {
			expect(generalDerive(vector.xpub, vector.path)).toBe(vector.child)
		}
	})

	test('agrees with the live @scure/bip32 oracle on fresh high-entropy paths', () => {
		const xpubs = [
			BIP32_VEC1_XPUB,
			// two fresh xpubs derived from fixed seeds, so the vectors stay reproducible
			HDKey.fromMasterSeed(new Uint8Array(32).fill(0x01)).publicExtendedKey,
			HDKey.fromMasterSeed(new Uint8Array(32).fill(0x7f)).publicExtendedKey,
		]
		for (const xpub of xpubs) {
			for (let i = 0; i < 10; i += 1) {
				const path = generateBidDerivationPath()
				expect(deriveSellerChildPubkey(xpub, path)).toBe(marketDerive(xpub, path))
			}
		}
	}, 60_000)

	test('a hardened path is refused by name — a public xpub cannot derive one', () => {
		expect(() => deriveSellerChildPubkey(BIP32_VEC1_XPUB, 'm/0h/1/2/3/4')).toThrow(SellerChildRefusedError)
		expect(() => deriveSellerChildPubkey(BIP32_VEC1_XPUB, "m/0'/1/2/3/4")).toThrow(/path_hardened/)
		expect(normalizeBidPath('m/1/2/3/4/5')).toEqual([1, 2, 3, 4, 5])
		expect(() => normalizeBidPath('m')).toThrow(SellerChildRefusedError)
		expect(() => normalizeBidPath('m//1/2/3/4')).toThrow(/path_depth_invalid/)
	})

	test('a malformed xpub is refused by name, never derived from', () => {
		expect(() => deriveSellerChildPubkey('', 'm/0')).toThrow(/xpub_missing/)
		expect(() => deriveSellerChildPubkey('not-an-xpub', 'm/0')).toThrow(SellerChildRefusedError)
		// A BIP32 test-vector xpub with one base58 character changed fails the checksum.
		const corrupted = `${BIP32_VEC1_XPUB.slice(0, -1)}${BIP32_VEC1_XPUB.slice(-1) === '8' ? '9' : '8'}`
		expect(() => deriveSellerChildPubkey(corrupted, 'm/0')).toThrow(/xpub_bad_checksum/)
		// A PRIVATE extended key is refused outright: a seller publishes an xpub, never an xprv.
		expect(() =>
			deriveSellerChildPubkey('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi', 'm/0'),
		).toThrow(/xpub_is_private/)
	})

	test('parseExtendedPublicKey reads the chain code and the compressed key it must', () => {
		const parsed = parseExtendedPublicKey(BIP32_VEC1_XPUB)
		expect(parsed.chainCode.length).toBe(32)
		expect(parsed.publicKey.length).toBe(33)
		expect(parsed.publicKey[0] === 2 || parsed.publicKey[0] === 3).toBe(true)
	})

	test('generateBidDerivationPath is five non-hardened 31-bit levels (AUCTIONS.md §5.5)', () => {
		const seen = new Set<string>()
		for (let i = 0; i < 100; i += 1) {
			const path = generateBidDerivationPath()
			expect(path).toMatch(new RegExp(`^m/([0-9]+/){${AUCTION_PATH_LEVELS - 1}}[0-9]+$`))
			const levels = path.slice(2).split('/').map((level) => Number.parseInt(level, 10))
			expect(levels.length).toBe(AUCTION_PATH_LEVELS)
			for (const level of levels) {
				expect(Number.isSafeInteger(level)).toBe(true)
				expect(level).toBeGreaterThanOrEqual(0)
				expect(level).toBeLessThanOrEqual(0x7fffffff)
			}
			seen.add(path)
		}
		// ~155 bits of entropy means collisions are not expected; a repeat would mean the generator is not random.
		expect(seen.size).toBe(100)
	})
})
