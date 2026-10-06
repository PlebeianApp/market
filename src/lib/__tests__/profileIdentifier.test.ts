import { describe, expect, test } from 'bun:test'
import { nprofileEncode, npubEncode } from 'nostr-tools/nip19'
import { isValidHexKey } from '@/lib/utils'
import { profileIdentifierToPubkey } from '@/lib/utils/profileIdentifier'

const HEX = 'a'.repeat(64)

describe('profileIdentifierToPubkey', () => {
	test('returns a hex identifier unchanged (the route param is the pubkey)', () => {
		expect(profileIdentifierToPubkey(HEX)).toBe(HEX)
	})

	test('decodes an npub without a network round-trip', () => {
		expect(profileIdentifierToPubkey(npubEncode(HEX))).toBe(HEX)
	})

	test('decodes an nprofile without a network round-trip', () => {
		expect(profileIdentifierToPubkey(nprofileEncode({ pubkey: HEX }))).toBe(HEX)
	})

	test('returns null for a NIP-05 identifier, which needs the domain lookup', () => {
		expect(profileIdentifierToPubkey('alice@example.com')).toBeNull()
		expect(profileIdentifierToPubkey('example.com')).toBeNull()
	})

	test('returns null for a vanity name or anything else', () => {
		expect(profileIdentifierToPubkey('my-shop')).toBeNull()
		expect(profileIdentifierToPubkey('')).toBeNull()
		expect(profileIdentifierToPubkey('not-a-key')).toBeNull()
	})

	// The invariant that matters for relay filters: whatever comes back is a hex
	// pubkey, never a bech32 or NIP-05 string destined for an `authors` field.
	test('never returns a non-hex value', () => {
		const inputs = [HEX, npubEncode(HEX), nprofileEncode({ pubkey: HEX }), 'alice@example.com', 'my-shop', 'npub1broken']
		for (const input of inputs) {
			const result = profileIdentifierToPubkey(input)
			if (result !== null) expect(/^[0-9a-f]{64}$/i.test(result)).toBe(true)
		}
	})
})

describe('encoding hygiene', () => {
	test('an uppercase hex route is normalised, so the relay filter matches', () => {
		const upper = 'A'.repeat(64)
		expect(isValidHexKey(upper)).toBe(true)
		expect(profileIdentifierToPubkey(upper)).toBe(upper.toLowerCase())
	})
})
