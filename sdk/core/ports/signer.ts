import type { EventTemplate } from 'nostr-tools/pure'

/** The minimal shape every signed Nostr event carries, regardless of signer implementation. */
export interface SignedEventLike {
	id: string
}

/**
 * A host-supplied signing capability. SDK workflows depend on this port, never on a
 * concrete signer (NDK, a browser extension, a raw private key) — Platform supplies
 * the adapter. Generic over the signed-event shape so callers can carry richer types
 * (e.g. an NDKEvent) through without the SDK depending on them.
 */
export interface Signer<SignedEvent extends SignedEventLike = SignedEventLike> {
	sign(template: EventTemplate): Promise<SignedEvent>
}
