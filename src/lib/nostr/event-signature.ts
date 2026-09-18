import { verifyEvent } from 'nostr-tools'
import type { Event } from 'nostr-tools'

/**
 * Verify a Nostr event's Schnorr signature (id, pubkey, and sig must all be
 * consistent).
 *
 * Thin seam over nostr-tools so tests can control signature-verification
 * outcomes for a single consumer without replacing the nostr-tools module
 * process-wide (bun's `mock.module` would otherwise poison every other
 * nostr-tools consumer in the same test run).
 */
export function verifyNostrEventSignature(event: Event): boolean {
	return verifyEvent(event)
}
