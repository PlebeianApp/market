import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk'
import {
	AUCTION_SETTLEMENT_POLICY,
	getAuctionTagValue,
	resolveAuctionVersionSet,
} from '../../lib/auctionSettlement'
import { ensureInvoiceNdkConnected } from '../ndk'

/**
 * Load an auction event and resolve it through the immutable-fields filter.
 *
 * AUCTIONS.md §4.1 / §9.3: the listing kind 30408 is addressable
 * (replaceable), so a seller can publish many versions of the same
 * `(pubkey, d)` coordinate. The protocol pins immutable fields after the
 * first publish; a shadow update that changes `start_at` / `end_at` / mint
 * allowlist / `p2pk_xpub` / etc. MUST be rejected. We fetch the entire
 * version set, run it through `resolveAuctionVersionSet`, and refuse to
 * issue any path / settlement against an event that violates the rule.
 *
 * Callers MUST pass the root event id (per spec §4.1: "Bids MUST reference
 * `auction_root_event_id`"). Passing a non-root id is rejected.
 */
export async function loadAuctionEvent(auctionEventId: string): Promise<NDKEvent> {
	const ndk = await ensureInvoiceNdkConnected()
	const initialEvent = await ndk.fetchEvent({
		kinds: [30408 as NDKKind],
		ids: [auctionEventId],
	})
	if (!initialEvent) {
		throw new Error('Auction not found')
	}

	const dTag = getAuctionTagValue(initialEvent, 'd')
	let candidateEvents: NDKEvent[] = [initialEvent]
	if (dTag) {
		const versionSet = await ndk.fetchEvents({
			kinds: [30408 as NDKKind],
			authors: [initialEvent.pubkey],
			'#d': [dTag],
			limit: 50,
		})
		candidateEvents = Array.from(versionSet)
		if (!candidateEvents.some((event) => event.id === initialEvent.id)) {
			candidateEvents.push(initialEvent)
		}
	}

	const resolved = resolveAuctionVersionSet(candidateEvents)
	if (!resolved) {
		throw new Error('Auction not found')
	}
	if (resolved.rootEventId !== auctionEventId) {
		throw new Error('auctionEventId must reference the root event for this auction')
	}
	if (resolved.rejectedEventIds.length > 0) {
		// We tolerate this — the canonical (root + compatible) chain still
		// wins — but log so operators can spot a misbehaving seller.
		console.warn('[auction] Discarded auction updates that violate immutable fields:', {
			auctionEventId,
			rejected: resolved.rejectedEventIds,
		})
	}

	const auctionEvent = resolved.displayEvent
	const policy = getAuctionTagValue(auctionEvent, 'settlement_policy')
	if (policy && policy !== AUCTION_SETTLEMENT_POLICY) {
		throw new Error(`Auction settlement policy ${policy} is not supported`)
	}
	return auctionEvent
}

/** Resolve the path-issuer pubkey for an auction (`path_issuer` tag, falls back to seller). */
export function getAuctionPathIssuerFromEvent(auctionEvent: NDKEvent): string {
	return getAuctionTagValue(auctionEvent, 'path_issuer') || auctionEvent.pubkey
}
