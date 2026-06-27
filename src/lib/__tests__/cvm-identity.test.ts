import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { resolveCvmServerPubkey, resolveCvmAuctionsServerPubkey } from '../cvm-identity'

/**
 * Unit tests for the centralized CVM key resolver.
 *
 * The resolver reads process.env at *call* time (not module-load time), so we
 * mutate the relevant env vars per test and restore the original snapshot
 * afterwards. A fixed private key is used so derived pubkeys are deterministic
 * and assertions can pin exact values.
 */

// Fixed test private key → deterministic pubkey. Test-only, never used in prod.
const TEST_PRIVATE_KEY = 'e2e0000000000000000000000000000000000000000000000000000000000007'
const TEST_DERIVED_PUBKEY = getPublicKey(new Uint8Array(Buffer.from(TEST_PRIVATE_KEY, 'hex')))

// Arbitrary but valid 64-hex pubkeys for each scenario.
const GENERAL_PUBKEY = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111'
const CURRENCY_PUBKEY = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222'
const AUCTIONS_PUBKEY = 'cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333'
const INVALID_VALUE = 'not-a-valid-key'

const CVM_ENV_VARS = [
	'CVM_SERVER_KEY',
	'CVM_SERVER_PUBLIC_KEY',
	'CVM_SERVER_PUBKEY',
	'CVM_CURRENCY_SERVER_PUBLIC_KEY',
	'CURRENCY_SERVER_PUBKEY',
	'CVM_AUCTIONS_SERVER_PUBLIC_KEY',
] as const

let envSnapshot: Record<string, string | undefined>

beforeEach(() => {
	// Snapshot then clear every CVM env var so tests are isolated.
	envSnapshot = {}
	for (const key of CVM_ENV_VARS) {
		envSnapshot[key] = process.env[key]
		delete process.env[key]
	}
})

afterEach(() => {
	// Restore the original env exactly.
	for (const key of CVM_ENV_VARS) {
		if (envSnapshot[key] === undefined) delete process.env[key]
		else process.env[key] = envSnapshot[key]
	}
})

describe('resolveCvmServerPubkey', () => {
	test('derives the pubkey from CVM_SERVER_KEY when nothing more specific is set', () => {
		process.env.CVM_SERVER_KEY = TEST_PRIVATE_KEY
		expect(resolveCvmServerPubkey()).toBe(TEST_DERIVED_PUBKEY)
	})

	test('returns CVM_SERVER_PUBLIC_KEY (preferred name) over a derivable private key', () => {
		process.env.CVM_SERVER_KEY = TEST_PRIVATE_KEY
		process.env.CVM_SERVER_PUBLIC_KEY = GENERAL_PUBKEY
		expect(resolveCvmServerPubkey()).toBe(GENERAL_PUBKEY)
	})

	test('honours the deprecated CVM_SERVER_PUBKEY alias for backward compatibility', () => {
		process.env.CVM_SERVER_PUBKEY = GENERAL_PUBKEY
		expect(resolveCvmServerPubkey()).toBe(GENERAL_PUBKEY)
	})

	test('prefers CVM_SERVER_PUBLIC_KEY over the deprecated CVM_SERVER_PUBKEY alias', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = GENERAL_PUBKEY
		process.env.CVM_SERVER_PUBKEY = 'dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444'
		expect(resolveCvmServerPubkey()).toBe(GENERAL_PUBKEY)
	})

	test('returns the currency-specific pubkey when CVM_CURRENCY_SERVER_PUBLIC_KEY is set', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = GENERAL_PUBKEY
		process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY = CURRENCY_PUBKEY
		expect(resolveCvmServerPubkey()).toBe(CURRENCY_PUBKEY)
	})

	test('honours the deprecated CURRENCY_SERVER_PUBKEY alias', () => {
		process.env.CURRENCY_SERVER_PUBKEY = CURRENCY_PUBKEY
		expect(resolveCvmServerPubkey()).toBe(CURRENCY_PUBKEY)
	})

	test('currency-specific pubkey wins over the general pubkey and private key', () => {
		process.env.CVM_SERVER_KEY = TEST_PRIVATE_KEY
		process.env.CVM_SERVER_PUBLIC_KEY = GENERAL_PUBKEY
		process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY = CURRENCY_PUBKEY
		expect(resolveCvmServerPubkey()).toBe(CURRENCY_PUBKEY)
	})

	test('ignores invalid (non-64-hex) values and falls through to the next source', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = INVALID_VALUE
		process.env.CVM_SERVER_KEY = TEST_PRIVATE_KEY
		expect(resolveCvmServerPubkey()).toBe(TEST_DERIVED_PUBKEY)
	})

	test('throws with an actionable message when no CVM key is configured', () => {
		expect(() => resolveCvmServerPubkey()).toThrow(/CVM_SERVER_PUBLIC_KEY|CVM_SERVER_KEY/)
	})

	test('throws when every configured value is invalid', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = INVALID_VALUE
		process.env.CVM_SERVER_PUBKEY = INVALID_VALUE
		process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY = INVALID_VALUE
		process.env.CVM_SERVER_KEY = INVALID_VALUE
		expect(() => resolveCvmServerPubkey()).toThrow()
	})
})

describe('resolveCvmAuctionsServerPubkey', () => {
	test('returns CVM_AUCTIONS_SERVER_PUBLIC_KEY when set', () => {
		process.env.CVM_AUCTIONS_SERVER_PUBLIC_KEY = AUCTIONS_PUBKEY
		expect(resolveCvmAuctionsServerPubkey()).toBe(AUCTIONS_PUBKEY)
	})

	test('falls back to the general CVM server pubkey derived from the private key', () => {
		process.env.CVM_SERVER_KEY = TEST_PRIVATE_KEY
		expect(resolveCvmAuctionsServerPubkey()).toBe(TEST_DERIVED_PUBKEY)
	})

	test('falls back to CVM_SERVER_PUBLIC_KEY when no auctions key is set', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = GENERAL_PUBKEY
		expect(resolveCvmAuctionsServerPubkey()).toBe(GENERAL_PUBKEY)
	})

	test('auctions-specific key takes precedence over the general currency pubkey', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = GENERAL_PUBKEY
		process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY = CURRENCY_PUBKEY
		process.env.CVM_AUCTIONS_SERVER_PUBLIC_KEY = AUCTIONS_PUBKEY
		expect(resolveCvmAuctionsServerPubkey()).toBe(AUCTIONS_PUBKEY)
	})

	test('ignores an invalid auctions value and falls back to the general resolver', () => {
		process.env.CVM_AUCTIONS_SERVER_PUBLIC_KEY = INVALID_VALUE
		process.env.CVM_SERVER_KEY = TEST_PRIVATE_KEY
		expect(resolveCvmAuctionsServerPubkey()).toBe(TEST_DERIVED_PUBKEY)
	})

	test('throws when neither an auctions key nor a general CVM key is configured', () => {
		expect(() => resolveCvmAuctionsServerPubkey()).toThrow()
	})
})
