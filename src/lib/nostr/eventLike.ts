export interface NostrEventLike {
	id: string
	pubkey: string
	kind: number
	created_at?: number
	content: string
	tags: string[][]
	sig?: string
}

/**
 * Normalize an event to its raw Nostr shape for schema-parse boundaries.
 *
 * `NDKEvent` instances carry the raw payload behind a `rawEvent()` method;
 * events fetched through the applesauce I/O port are already the raw shape.
 * Callers must use this helper instead of calling `rawEvent()` directly so a
 * single fetch seam swap cannot turn a valid query result into a render crash
 * (`auction.rawEvent is not a function`). Same duck-typing as
 * `isVerifiedVerdictEvent` in `src/queries/auctions.tsx`.
 */
export const toRawEvent = (event: NostrEventLike): NostrEventLike => {
	const maybeRawEvent = (event as { rawEvent?: unknown }).rawEvent
	if (typeof maybeRawEvent === 'function') return maybeRawEvent.call(event) as NostrEventLike
	return event
}
