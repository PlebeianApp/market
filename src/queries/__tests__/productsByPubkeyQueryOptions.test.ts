import { describe, expect, test } from 'bun:test'
import { fetchProductsByPubkey, productsByPubkeyQueryOptions } from '../products'
import { safeNpubEncode } from '@/lib/utils'

const VALID_PUBKEY = 'a'.repeat(64)

describe('productsByPubkeyQueryOptions', () => {
	test('disables the query while the pubkey is empty', () => {
		const options = productsByPubkeyQueryOptions('', true)

		expect(options.enabled).toBe(false)
	})

	test('disables the query for a malformed pubkey', () => {
		const options = productsByPubkeyQueryOptions('not-a-valid-pubkey')

		expect(options.enabled).toBe(false)
	})

	test('enables the query for a valid hex pubkey', () => {
		const options = productsByPubkeyQueryOptions(VALID_PUBKEY)

		expect(options.enabled).toBe(true)
	})

	test('caller composition: options.enabled && isAuthenticated stays false for malformed truthy input', () => {
		// Simulates the dashboard products route combining the factory guard
		// with its own isAuthenticated condition. A truthy-but-malformed pubkey
		// must still disable the query even when isAuthenticated is true.
		const options = productsByPubkeyQueryOptions('not-hex-but-truthy')
		const combinedEnabled = options.enabled && true // isAuthenticated = true

		expect(combinedEnabled).toBe(false)
	})

	test('caller composition: options.enabled && isAuthenticated is true for valid pubkey + auth', () => {
		const options = productsByPubkeyQueryOptions(VALID_PUBKEY)
		const combinedEnabled = options.enabled && true

		expect(combinedEnabled).toBe(true)
	})
})

describe('fetchProductsByPubkey direct-call guard', () => {
	test('throws on malformed pubkey without touching NDK (zero relay I/O)', () => {
		// isValidHexKey check fires before ndkActions.getNDK() is called,
		// so no NDK instance is created and no relay request is issued.
		expect(() => fetchProductsByPubkey('not-hex')).toThrow('invalid seller pubkey')
	})

	test('throws on empty pubkey without touching NDK', () => {
		expect(() => fetchProductsByPubkey('')).toThrow('invalid seller pubkey')
	})

	test('throws on whitespace pubkey without touching NDK', () => {
		expect(() => fetchProductsByPubkey('   ')).toThrow('invalid seller pubkey')
	})
})

describe('safeNpubEncode', () => {
	test('returns null for empty input', () => {
		expect(safeNpubEncode('')).toBeNull()
	})

	test('returns null for whitespace input', () => {
		expect(safeNpubEncode('   ')).toBeNull()
	})

	test('returns null for truncated hex', () => {
		expect(safeNpubEncode('abc123')).toBeNull()
	})

	test('returns null for non-hex string', () => {
		expect(safeNpubEncode('not-a-valid-pubkey')).toBeNull()
	})

	test('returns npub string for valid 64-char hex pubkey', () => {
		const result = safeNpubEncode(VALID_PUBKEY)

		expect(result).not.toBeNull()
		expect(result!.startsWith('npub1')).toBe(true)
	})
})
