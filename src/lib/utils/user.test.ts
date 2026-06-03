import { describe, test, expect } from 'bun:test'
import { isValidUserProfile } from './user' // Adjust path as needed

// Suppress console output for cleaner test runs (optional, mimicking your example)
const originalWarn = console.warn
const originalError = console.error
console.warn = () => {}
console.error = () => {}

describe('isValidUserProfile unit tests', () => {
	describe('Success Paths', () => {
		test('returns true for valid 64-char lowercase hex pubkey', () => {
			const validHex = '0000000000000000000000000000000000000000000000000000000000000000'
			expect(isValidUserProfile(validHex)).toBe(true)
		})

		test('returns true for valid npub (NIP-19)', () => {
			// Valid checksum npub
			const validNpub = 'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9'
			expect(isValidUserProfile(validNpub)).toBe(true)
		})

		test('returns true for valid nprofile (NIP-19)', () => {
			// Valid checksum nprofile
			const validNprofile =
				'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p'
			expect(isValidUserProfile(validNprofile)).toBe(true)
		})

		test('returns true for NIP-05 with local-part and domain', () => {
			expect(isValidUserProfile('pablo@nostr.com')).toBe(true)
			expect(isValidUserProfile('john.doe@example.org')).toBe(true)
			expect(isValidUserProfile('user_name-123@test.co.uk')).toBe(true)
		})

		test('returns true for NIP-05 with domain only (implicit underscore)', () => {
			expect(isValidUserProfile('nostr.com')).toBe(true)
			expect(isValidUserProfile('example.org')).toBe(true)
			expect(isValidUserProfile('sub.domain.co')).toBe(true)
		})
	})

	describe('Failure Paths: Hex Pubkey', () => {
		test('returns false for hex string with uppercase letters', () => {
			expect(isValidUserProfile('000000000000000000000000000000000000000000000000000000000000000A')).toBe(false)
		})

		test('returns false for hex string with invalid characters', () => {
			expect(isValidUserProfile('000000000000000000000000000000000000000000000000000000000000000g')).toBe(false)
		})

		test('returns false for hex string that is too short (63 chars)', () => {
			expect(isValidUserProfile('000000000000000000000000000000000000000000000000000000000000000')).toBe(false)
		})

		test('returns false for hex string that is too long (65 chars)', () => {
			expect(isValidUserProfile('00000000000000000000000000000000000000000000000000000000000000000')).toBe(false)
		})
	})

	describe('Failure Paths: NIP-19 (npub/nprofile)', () => {
		test('returns false for string starting with npub1 but too short', () => {
			expect(isValidUserProfile('npub1')).toBe(false)
		})

		test('returns false for string starting with npub1 but containing invalid characters', () => {
			expect(isValidUserProfile('npub1!@#$%^&*()')).toBe(false)
		})

		test('returns false for valid bech32m with wrong prefix (naddr1)', () => {
			// naddr1 is a valid bech32m prefix but not a user profile
			const naddr =
				'naddr1qqzkjurnw4ksz9thwden5te0wfjkccte9ehx7um5wghx7un8qgs2d90kkcq3nk2jry62dyf50k0h36rhpdtd594my40w9pkal876jxgrqsqqqa28pccpzu'
			expect(isValidUserProfile(naddr)).toBe(false)
		})
	})

	describe('Failure Paths: NIP-05', () => {
		test('returns false for missing @ symbol with domain-like string', () => {
			expect(isValidUserProfile('invalid-domain')).toBe(false)
		})

		test('returns false for missing TLD (no dot after @)', () => {
			expect(isValidUserProfile('user@localhost')).toBe(false)
		})

		test('returns false for empty local part', () => {
			expect(isValidUserProfile('@nostr.com')).toBe(false)
		})

		test('returns false for empty domain', () => {
			expect(isValidUserProfile('user@')).toBe(false)
		})

		test('returns false for invalid characters in local part (space)', () => {
			expect(isValidUserProfile('user name@nostr.com')).toBe(false)
		})

		test('returns false for invalid characters in local part (hash)', () => {
			expect(isValidUserProfile('user#name@nostr.com')).toBe(false)
		})

		test('returns false for domain without TLD', () => {
			expect(isValidUserProfile('nostrcom')).toBe(false)
		})

		test('returns false for domain with invalid TLD (too short)', () => {
			expect(isValidUserProfile('nostr.c')).toBe(false)
		})
	})

	describe('Edge Cases & Input Sanitization', () => {
		test('returns false for empty string', () => {
			expect(isValidUserProfile('')).toBe(false)
		})

		test('returns false for whitespace only', () => {
			expect(isValidUserProfile('   ')).toBe(false)
		})

		test('returns false for null input', () => {
			// @ts-ignore
			expect(isValidUserProfile(null)).toBe(false)
		})

		test('returns false for undefined input', () => {
			// @ts-ignore
			expect(isValidUserProfile(undefined)).toBe(false)
		})

		test('returns true for valid input with surrounding whitespace', () => {
			expect(isValidUserProfile('  nostr.com  ')).toBe(true)
			expect(isValidUserProfile('  npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9  ')).toBe(true)
		})

		test('returns false for mixed case hex', () => {
			expect(isValidUserProfile('AbCdEf000000000000000000000000000000000000000000000000000000000000')).toBe(false)
		})
	})
})
