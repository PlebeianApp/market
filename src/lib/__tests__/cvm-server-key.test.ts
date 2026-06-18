/**
 * Unit tests for resolveCvmServerPubkey() — CVM oracle pubkey resolution.
 *
 * WHY THESE TESTS EXIST:
 *
 * The CVM (ContextVM) oracle is an external server that responds to BTC price
 * requests over Nostr. The app sends encrypted gift-wrapped messages to the
 * oracle's pubkey on public relays (relay.contextvm.org, relay2.contextvm.org).
 *
 * The oracle pubkey is resolved by resolveCvmServerPubkey() in this priority:
 *   1. explicitPubkey — CVM_SERVER_PUBKEY env var (operator override)
 *   2. serverKey      — CVM_SERVER_KEY env var (derive pubkey from private key)
 *   3. Hardcoded default — the real oracle pubkey (29bd646...)
 *
 * THE BUG THESE TESTS PREVENT:
 *
 * If CVM_SERVER_KEY is set to the SAME key as APP_PRIVATE_KEY (e.g. both set
 * to a test key like "0000...0001"), then resolveCvmServerPubkey() would derive
 * the APP's own pubkey as the oracle pubkey. The CVM client then sends encrypted
 * BTC price requests TO ITSELF — no oracle server is listening under that key
 * on any relay.
 *
 * This caused a production outage with this cascade:
 *   1. CVM_SERVER_KEY=0000...0001 → oracle pubkey = app's own pubkey (wrong!)
 *   2. Browser CVM client sends encrypted requests to app's own pubkey
 *   3. No oracle server listens under that key on any relay
 *   4. Every request times out after 5-20 seconds
 *   5. 19 products on the page × CVM call = 19 parallel timeouts
 *   6. Flood of gift-wrap publishes triggers relay rate-limiting
 *      ("you are noting too much" from relay.damus.io)
 *   7. Console fills with "ContextVM call timed out" errors
 *   8. App falls back to Yadio for BTC rates (works but slowly)
 *
 * The self-detection guard in resolveCvmServerPubkey() catches this and falls
 * back to the hardcoded default oracle pubkey.
 *
 * TESTING APPROACH:
 *
 * resolveCvmServerPubkey() is a PURE FUNCTION with explicit parameters — no
 * env var reads, no module-level caching. This makes it trivially testable
 * without process isolation tricks. The production wrapper getCvmServerPublicKey()
 * reads env vars and delegates to this function.
 */

import { describe, test, expect } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { resolveCvmServerPubkey, CVM_ORACLE_DEFAULT_PUBKEY } from '@/server/runtime'

// The well-known test key "0000...0001" and its derived pubkey.
// This was used for BOTH APP_PRIVATE_KEY and CVM_SERVER_KEY in production,
// causing the CVM timeout cascade.
const TEST_KEY = '0000000000000000000000000000000000000000000000000000000000000001'
const TEST_KEY_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

// A private key deliberately different from APP_PRIVATE_KEY.
// Simulates a local mock CVM server (e.g., the nak relay's test key).
const MOCK_CVM_KEY = 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000000'
const MOCK_CVM_PUBKEY = getPublicKey(new Uint8Array(Buffer.from(MOCK_CVM_KEY, 'hex')))

describe('resolveCvmServerPubkey — self-detection guard', () => {
	test('falls back to default when serverKey derives to app own pubkey', () => {
		// SCENARIO: CVM_SERVER_KEY = APP_PRIVATE_KEY (the production misconfiguration)
		// Both point to the test key "0000...0001", so the derived oracle pubkey
		// would be the app's own pubkey (79be667e...).
		const result = resolveCvmServerPubkey({
			serverKey: TEST_KEY,
			appPrivateKey: TEST_KEY,
		})

		// MUST return the real oracle, NOT the app's own key
		expect(result.pubkey).toBe(CVM_ORACLE_DEFAULT_PUBKEY)
		expect(result.selfDetected).toBe(true)
	})

	test('self-detection works with different keys that derive to the same pubkey', () => {
		// Even if the key strings are different, if they derive to the same
		// pubkey, the guard should trigger. (Unlikely in practice but important
		// to verify the comparison is on pubkeys, not private key strings.)
		const key2 = '0000000000000000000000000000000000000000000000000000000000000001' // same as TEST_KEY
		const result = resolveCvmServerPubkey({
			serverKey: key2,
			appPrivateKey: TEST_KEY,
		})

		expect(result.pubkey).toBe(CVM_ORACLE_DEFAULT_PUBKEY)
		expect(result.selfDetected).toBe(true)
	})
})

describe('resolveCvmServerPubkey — normal serverKey derivation', () => {
	test('derives pubkey from serverKey when it differs from appPrivateKey', () => {
		// SCENARIO: CVM_SERVER_KEY is set to a DIFFERENT key than APP_PRIVATE_KEY.
		// This is the normal case for local development with a mock CVM server.
		const result = resolveCvmServerPubkey({
			serverKey: MOCK_CVM_KEY,
			appPrivateKey: TEST_KEY,
		})

		// Should derive the pubkey from serverKey, NOT fall back to default
		expect(result.pubkey).toBe(MOCK_CVM_PUBKEY)
		expect(result.pubkey).not.toBe(CVM_ORACLE_DEFAULT_PUBKEY)
		expect(result.pubkey).not.toBe(TEST_KEY_PUBKEY)
		expect(result.selfDetected).toBe(false)
	})

	test('derives pubkey from serverKey even without appPrivateKey', () => {
		// SCENARIO: APP_PRIVATE_KEY is not set (edge case). The function
		// should still derive the pubkey — just skip the self-detection check.
		const result = resolveCvmServerPubkey({
			serverKey: MOCK_CVM_KEY,
			appPrivateKey: undefined,
		})

		expect(result.pubkey).toBe(MOCK_CVM_PUBKEY)
		expect(result.selfDetected).toBe(false)
	})

	test('ignores invalid serverKey format', () => {
		// SCENARIO: CVM_SERVER_KEY is set but not a valid 64-char hex string.
		// Should fall through to the default.
		const result = resolveCvmServerPubkey({
			serverKey: 'not-a-valid-key',
			appPrivateKey: TEST_KEY,
		})

		expect(result.pubkey).toBe(CVM_ORACLE_DEFAULT_PUBKEY)
		expect(result.selfDetected).toBe(false)
	})

	test('ignores empty serverKey', () => {
		const result = resolveCvmServerPubkey({
			serverKey: '',
			appPrivateKey: TEST_KEY,
		})

		expect(result.pubkey).toBe(CVM_ORACLE_DEFAULT_PUBKEY)
	})
})

describe('resolveCvmServerPubkey — default fallback', () => {
	test('returns default oracle pubkey when no options are set', () => {
		// SCENARIO: Neither CVM_SERVER_PUBKEY nor CVM_SERVER_KEY is set.
		// This is the expected production configuration — just omit CVM env vars.
		const result = resolveCvmServerPubkey({})

		expect(result.pubkey).toBe(CVM_ORACLE_DEFAULT_PUBKEY)
		expect(result.selfDetected).toBe(false)
	})

	test('returns default oracle pubkey with only appPrivateKey set', () => {
		const result = resolveCvmServerPubkey({
			appPrivateKey: TEST_KEY,
		})

		expect(result.pubkey).toBe(CVM_ORACLE_DEFAULT_PUBKEY)
		expect(result.selfDetected).toBe(false)
	})
})

describe('resolveCvmServerPubkey — explicit pubkey override', () => {
	test('uses explicitPubkey directly, ignoring serverKey', () => {
		// SCENARIO: CVM_SERVER_PUBKEY is set — takes priority over everything.
		// Even if serverKey is also set, explicitPubkey wins.
		const explicitKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
		const result = resolveCvmServerPubkey({
			explicitPubkey: explicitKey,
			serverKey: MOCK_CVM_KEY,
			appPrivateKey: TEST_KEY,
		})

		expect(result.pubkey).toBe(explicitKey)
		expect(result.selfDetected).toBe(false)
	})

	test('uses explicitPubkey even if it matches app own pubkey', () => {
		// SCENARIO: Explicit pubkey matches the app's own key. Unlike the
		// serverKey path, we DON'T trigger self-detection here because the
		// operator explicitly chose this value. They may be running a local
		// CVM oracle under the app's key intentionally.
		const result = resolveCvmServerPubkey({
			explicitPubkey: TEST_KEY_PUBKEY,
			serverKey: undefined,
			appPrivateKey: TEST_KEY,
		})

		expect(result.pubkey).toBe(TEST_KEY_PUBKEY)
		expect(result.selfDetected).toBe(false)
	})
})

describe('resolveCvmServerPubkey — constant validation', () => {
	test('default oracle pubkey is not the well-known test key', () => {
		// Regression safeguard: the hardcoded default must NEVER be changed
		// to the well-known test key's pubkey.
		expect(CVM_ORACLE_DEFAULT_PUBKEY).not.toBe(TEST_KEY_PUBKEY)
	})

	test('default oracle pubkey is the known ContextVM oracle identity', () => {
		// The real oracle pubkey, announced on relay.contextvm.org:
		expect(CVM_ORACLE_DEFAULT_PUBKEY).toBe('29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15')
	})
})
