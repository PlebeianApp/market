import { nip19 } from 'nostr-tools'
import { BECH32_REGEX } from 'nostr-tools/nip19'
import { isValidHexKey } from '../utils'
import { npubToHex } from '@/routes/setup'

/**
 * Validates if a string is a valid Nostr user identifier.
 * Supports: Hex pubkey, npub, nprofile, and NIP-05 identifiers.
 *
 * @param input - The string to validate
 * @returns true if valid format, false otherwise
 */
export function isValidUserProfile(input: string): boolean {
	if (!input || typeof input !== 'string') return false

	const trimmed = input.trim()
	if (!trimmed) return false

	// 1. Hex Public Key (64 lowercase hex chars)
	if (/^[0-9a-f]{64}$/.test(trimmed)) {
		return true
	}

	// 2. NIP-19 npub
	if (trimmed.startsWith('npub1') && BECH32_REGEX.test(trimmed)) {
		const result = nip19.decode(trimmed)
		return result.type === 'npub'
	}

	// 3. NIP-19 nprofile
	if (trimmed.startsWith('nprofile') && BECH32_REGEX.test(trimmed)) {
		const result = nip19.decode(trimmed)
		return result.type === 'nprofile'
	}

	// 4. NIP-05 Identifier (user@domain.com or domain.com)
	// Regex: (optional local-part)@domain.tld OR just domain.tld
	const nip05Regex = /^([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$|^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/
	return nip05Regex.test(trimmed)
}

/**
 * Convert an array of author identifiers to hex pubkeys
 */
export const convertAuthorsToHexKeys = async (authors: string[]): Promise<string[]> => {
	const convertedAuthors: string[] = []

	for (const author of authors) {
		// Skip empty strings
		if (!author.trim()) continue

		// If it's already a valid hex key, use it as-is
		if (isValidHexKey(author)) {
			convertedAuthors.push(author)
			continue
		}

		// Try to convert the identifier to a hex pubkey
		try {
			const hexPubkey = npubToHex(author)
			if (hexPubkey) {
				convertedAuthors.push(hexPubkey)
			} else {
				console.warn(`Could not convert author identifier to hex pubkey: ${author}`)
			}
		} catch (error) {
			console.warn(`Error converting author identifier: ${author}`, error)
		}
	}

	return convertedAuthors
}
