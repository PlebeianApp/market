import { decode } from 'nostr-tools/nip19'
import { validateProfileIdentifier } from '@/lib/utils/profileValidation'

/**
 * The pubkey behind a profile identifier, when it can be known without a network
 * round-trip.
 *
 * - `hex` → the identifier itself (the common case: the route param already *is*
 *   the pubkey),
 * - `npub` / `nprofile` → decoded synchronously (the same nip19 decode the
 *   validator already performs),
 * - `nip05` → `null`: resolving it requires the domain's `.well-known/nostr.json`,
 * - anything else → `null`.
 *
 * Only ever returns a validated hex pubkey. These values are used as `authors` in
 * relay filters, where a bech32 or NIP-05 string is not a pubkey: it would match
 * nothing at best and be sent to every relay at worst. Callers must never pass an
 * identifier straight through.
 *
 * Rationale for existing at all: the profile page used to derive its author from
 * the fetched kind-0 event, so scoping a seller's products waited on an unrelated
 * relay round-trip — and vanished with it when that read failed. For hex, npub and
 * nprofile the pubkey is already known at render time.
 */
export function profileIdentifierToPubkey(identifier: string): string | null {
	const validation = validateProfileIdentifier(identifier)
	if (!validation.isValid) return null

	try {
		switch (validation.type) {
			case 'hex':
				return identifier.toLowerCase()
			case 'npub': {
				const decoded = decode(identifier)
				return decoded.type === 'npub' && typeof decoded.data === 'string' ? decoded.data : null
			}
			case 'nprofile': {
				const decoded = decode(identifier)
				return decoded.type === 'nprofile' ? decoded.data.pubkey : null
			}
			default:
				return null
		}
	} catch {
		return null
	}
}
