import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'

import { isValidHexKey } from '../../lib/utils'
import { getProfileIdentifierValidationError, validateProfileIdentifier } from '@/lib/utils/profileValidation'
import { getNormalizedProfileDisplayName, getNormalizedProfileNip05, normalizeOptionalPubkey } from '@/queries/profiles'
import { getUserCardTitle, isKeyboardCopyActivationKey } from '@/components/UserCard'

const VALID_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const VALID_NPUB = nip19.npubEncode(VALID_HEX)
const VALID_NPROFILE = nip19.nprofileEncode({
	pubkey: VALID_HEX,
	relays: ['wss://relay.example.com'],
})

function breakChecksum(identifier: string) {
	return `${identifier.slice(0, -1)}${identifier.endsWith('q') ? 'p' : 'q'}`
}

describe('nostr pubkey validation', () => {
	test('isValidHexKey returns true for a valid 64-char hex pubkey', () => {
		expect(isValidHexKey(VALID_HEX)).toBe(true)
	})

	test('isValidHexKey returns false for invalid input values', () => {
		expect(isValidHexKey('')).toBe(false)
		expect(isValidHexKey('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toBe(false)
		expect(isValidHexKey('01234')).toBe(false)
		expect(isValidHexKey('g'.repeat(64))).toBe(false)
	})
})

describe('profile metadata normalization', () => {
	test('falls back to a valid name when displayName is whitespace-only', () => {
		const profile = {
			displayName: '   ',
			name: 'Alice',
			picture: 123 as unknown as string,
			nip05: 456 as unknown as string,
		}

		expect(getNormalizedProfileDisplayName(profile as never)).toBe('Alice')
		expect(getNormalizedProfileNip05(profile as never)).toBeNull()
	})

	test('treats non-string kind-0 fields as absent instead of throwing', () => {
		const profile = {
			displayName: 42,
			name: 999,
			picture: false,
			nip05: 123,
		}

		expect(() => getNormalizedProfileDisplayName(profile as never)).not.toThrow()
		expect(() => getNormalizedProfileNip05(profile as never)).not.toThrow()
		expect(getNormalizedProfileDisplayName(profile as never)).toBeNull()
		expect(getNormalizedProfileNip05(profile as never)).toBeNull()
	})

	test('guards empty-string callers by normalizing optional pubkeys to undefined', () => {
		expect(normalizeOptionalPubkey('   ')).toBeUndefined()
		expect(normalizeOptionalPubkey(undefined)).toBeUndefined()
		expect(normalizeOptionalPubkey(VALID_HEX)).toBe(VALID_HEX)
	})

	test('keeps cached identity visible during background refresh', () => {
		expect(getUserCardTitle({ isProfileLoading: false, profileDisplayName: 'Alice', textDisplayNpub: 'npub1...' })).toBe('Alice')
		expect(getUserCardTitle({ isProfileLoading: false, profileDisplayName: null, textDisplayNpub: 'npub1...' })).toBe('npub1...')
	})

	test('treats Enter and Space as keyboard activation for copy mode', () => {
		const enterEvent = { key: 'Enter' } as KeyboardEvent
		const spaceEvent = { key: ' ' } as KeyboardEvent
		const otherEvent = { key: 'Tab' } as KeyboardEvent

		expect(isKeyboardCopyActivationKey(enterEvent)).toBe(true)
		expect(isKeyboardCopyActivationKey(spaceEvent)).toBe(true)
		expect(isKeyboardCopyActivationKey(otherEvent)).toBe(false)
	})
})

describe('profile route identifier validation', () => {
	test('accepts NIP-05 identifiers', () => {
		expect(validateProfileIdentifier('pablo@test.com')).toEqual({ isValid: true, type: 'nip05' })
		expect(validateProfileIdentifier('test.com')).toEqual({ isValid: true, type: 'nip05' })
		expect(validateProfileIdentifier('sub.domain.test.com')).toEqual({ isValid: true, type: 'nip05' })
	})

	test('rejects malformed NIP-05 identifiers', () => {
		expect(validateProfileIdentifier('pablo@test').isValid).toBe(false)
		expect(validateProfileIdentifier('@test.com').isValid).toBe(false)
		expect(validateProfileIdentifier('pablo@@test.com').isValid).toBe(false)
		expect(validateProfileIdentifier('test..com').isValid).toBe(false)
	})

	test('accepts npub identifiers', () => {
		expect(validateProfileIdentifier(VALID_NPUB)).toEqual({ isValid: true, type: 'npub' })
	})

	test('rejects malformed npub identifiers', () => {
		expect(validateProfileIdentifier('npub1invalid').isValid).toBe(false)
		expect(validateProfileIdentifier(breakChecksum(VALID_NPUB)).isValid).toBe(false)
	})

	test('accepts nprofile identifiers', () => {
		expect(validateProfileIdentifier(VALID_NPROFILE)).toEqual({ isValid: true, type: 'nprofile' })
	})

	test('rejects malformed nprofile identifiers', () => {
		expect(validateProfileIdentifier('nprofile1invalid').isValid).toBe(false)
		expect(validateProfileIdentifier(breakChecksum(VALID_NPROFILE)).isValid).toBe(false)
	})

	test('accepts hex public keys', () => {
		expect(validateProfileIdentifier(VALID_HEX)).toEqual({ isValid: true, type: 'hex' })
		expect(validateProfileIdentifier(VALID_HEX.toUpperCase())).toEqual({ isValid: true, type: 'hex' })
	})

	test('rejects malformed hex public keys', () => {
		expect(validateProfileIdentifier('01234').isValid).toBe(false)
		expect(validateProfileIdentifier('g'.repeat(64)).isValid).toBe(false)
		expect(validateProfileIdentifier('deadbeef').isValid).toBe(false)
	})

	test('returns a user-facing error for an invalid profile identifier', () => {
		expect(getProfileIdentifierValidationError('invalid-profile')).toBe('"invalid-profile" is not a valid profile identifier')
		expect(getProfileIdentifierValidationError(VALID_NPROFILE)).toBeNull()
	})
})
