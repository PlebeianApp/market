import { describe, test, expect, beforeEach } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { generateTestKeyPair, resetTestKeys } from '../test-keys'

// The previously-committed (now-removed) compromised test keys. New derived
// keys must never reproduce these.
const COMPROMISED_KEYS = new Set([
	'5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0',
	'08a475839723c79f2993ad000289670eb737d34bc9d72d43128f898713fc3fb3',
	'e61ae5a4f505026e3d2b5aeba82c748b6b799346a1e98e266d7252cddb8f502b',
	'beb8f6777d4379ac60b01d91fa84456bb23a2ef6b083f557b9ede311ae1ede53',
	'ee40a2dc441238f241d1728af9507147e9b5ed18c1c61d84876d4f2502c044b3',
])

const HEX64 = /^[0-9a-fA-F]{64}$/

describe('generateTestKeyPair', () => {
	beforeEach(() => resetTestKeys())

	test('returns a valid secp256k1 keypair for a given label', () => {
		const pair = generateTestKeyPair('devUser1')
		expect(HEX64.test(pair.sk)).toBe(true)
		expect(HEX64.test(pair.pk)).toBe(true)
		// pk must be the public key derived from sk
		expect(pair.pk).toBe(getPublicKey(new Uint8Array(Buffer.from(pair.sk, 'hex'))))
	})

	test('is deterministic across cache resets (same label → same key)', () => {
		const first = generateTestKeyPair('devUser2')
		resetTestKeys()
		const second = generateTestKeyPair('devUser2')
		expect(second.sk).toBe(first.sk)
		expect(second.pk).toBe(first.pk)
	})

	test('returns the cached object on repeated calls within a process', () => {
		const first = generateTestKeyPair('devUser3')
		const second = generateTestKeyPair('devUser3')
		expect(second).toBe(first)
	})

	test('produces distinct keys for distinct labels', () => {
		const a = generateTestKeyPair('devUser1')
		const b = generateTestKeyPair('devUser2')
		const c = generateTestKeyPair('merchant-admin')
		expect(new Set([a.sk, b.sk, c.sk]).size).toBe(3)
		expect(new Set([a.pk, b.pk, c.pk]).size).toBe(3)
	})

	test('never reproduces the old compromised hardcoded keys', () => {
		for (const name of ['devUser1', 'devUser2', 'devUser3', 'devUser4', 'devUser5']) {
			const { sk } = generateTestKeyPair(name)
			expect(COMPROMISED_KEYS.has(sk)).toBe(false)
		}
	})

	test('resetTestKeys clears the cache so the next call yields a fresh object', () => {
		const first = generateTestKeyPair('devUser4')
		resetTestKeys()
		const second = generateTestKeyPair('devUser4')
		// Different object reference (cache was cleared)…
		expect(second).not.toBe(first)
		// …but equal by value, because derivation is deterministic.
		expect(second).toEqual(first)
	})
})
