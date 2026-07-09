import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { resolveCvmServerPubkey } from '@/server/runtime'
import { hexToBytes } from '@noble/hashes/utils.js'

const TEST_KEY = 'a'.repeat(64)
const TEST_KEY_PUBKEY = getPublicKey(hexToBytes(TEST_KEY))

const MOCK_CVM_KEY = 'b'.repeat(64)
const MOCK_CVM_PUBKEY = getPublicKey(hexToBytes(MOCK_CVM_KEY))

// Track env keys we mutate so we can restore them cleanly.
const ENV_KEYS = [
	'CVM_CURRENCY_SERVER_PUBLIC_KEY',
	'CURRENCY_SERVER_PUBKEY',
	'CVM_SERVER_PUBLIC_KEY',
	'CVM_SERVER_PUBKEY',
	'CVM_SERVER_KEY',
] as const

function clearCvmEnv() {
	for (const key of ENV_KEYS) delete process.env[key]
}

describe('resolveCvmServerPubkey — priority ordering', () => {
	beforeEach(() => clearCvmEnv())
	afterEach(() => clearCvmEnv())

	test('tier 1 — service-specific pubkey takes highest priority', () => {
		process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY = MOCK_CVM_PUBKEY
		process.env.CVM_SERVER_PUBLIC_KEY = TEST_KEY_PUBKEY // tier 2
		process.env.CVM_SERVER_KEY = MOCK_CVM_KEY // tier 3

		const result = resolveCvmServerPubkey()
		expect(result).toBe(MOCK_CVM_PUBKEY)
	})

	test('tier 1 — CURRENCY_SERVER_PUBKEY alias works for service-specific key', () => {
		process.env.CURRENCY_SERVER_PUBKEY = MOCK_CVM_PUBKEY
		process.env.CVM_SERVER_PUBLIC_KEY = TEST_KEY_PUBKEY

		const result = resolveCvmServerPubkey()
		expect(result).toBe(MOCK_CVM_PUBKEY)
	})

	test('tier 2 — general CVM pubkey used when service-specific is absent', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = MOCK_CVM_PUBKEY
		process.env.CVM_SERVER_KEY = MOCK_CVM_KEY // should be ignored

		const result = resolveCvmServerPubkey()
		expect(result).toBe(MOCK_CVM_PUBKEY)
	})

	test('tier 2 — CVM_SERVER_PUBKEY alias works for general pubkey', () => {
		process.env.CVM_SERVER_PUBKEY = MOCK_CVM_PUBKEY
		process.env.CVM_SERVER_KEY = MOCK_CVM_KEY

		const result = resolveCvmServerPubkey()
		expect(result).toBe(MOCK_CVM_PUBKEY)
	})

	test('tier 3 — derives pubkey from CVM_SERVER_KEY when no explicit pubkeys are set', () => {
		process.env.CVM_SERVER_KEY = MOCK_CVM_KEY

		const result = resolveCvmServerPubkey()
		expect(result).toBe(MOCK_CVM_PUBKEY)
	})

	test('tier 3 — derived key can match app key (no self-detection enforcement)', () => {
		// The old code rejected keys matching APP_PRIVATE_KEY.
		// The new code allows it — there's no comparison anymore.
		process.env.CVM_SERVER_KEY = TEST_KEY

		const result = resolveCvmServerPubkey()
		expect(result).toBe(TEST_KEY_PUBKEY)
	})
})

describe('resolveCvmServerPubkey — validation and error handling', () => {
	beforeEach(() => clearCvmEnv())
	afterEach(() => clearCvmEnv())

	test('ignores invalid service-specific pubkey and falls through', () => {
		process.env.CVM_CURRENCY_SERVER_PUBLIC_KEY = 'not-a-valid-key'
		process.env.CVM_SERVER_PUBLIC_KEY = MOCK_CVM_PUBKEY

		const result = resolveCvmServerPubkey()
		expect(result).toBe(MOCK_CVM_PUBKEY)
	})

	test('ignores invalid general pubkey and falls through to key derivation', () => {
		process.env.CVM_SERVER_PUBLIC_KEY = 'deadbeef'
		process.env.CVM_SERVER_KEY = MOCK_CVM_KEY

		const result = resolveCvmServerPubkey()
		expect(result).toBe(MOCK_CVM_PUBKEY)
	})

	test('ignores invalid CVM_SERVER_KEY format and falls through to throw', () => {
		process.env.CVM_SERVER_KEY = 'not-a-valid-key'

		expect(() => resolveCvmServerPubkey()).toThrow(/No CVM server pubkey available/)
	})

	test('throws when no CVM environment variables are configured', () => {
		expect(() => resolveCvmServerPubkey()).toThrow(/No CVM server pubkey available/)
	})
})
