import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { toRawEvent } from '@/lib/nostr/eventLike'
import { parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'

export interface QueuedAuctionWin {
	auctionRootEventId: string
}

export const isAuctionDetailPath = (pathname: string): boolean =>
	/^\/auctions\/[^/]+\/?$/.test(pathname) || /^\/dashboard\/products\/auctions\/[^/]+\/?$/.test(pathname)

export const hasFinalSettlementForAuctionWin = (
	win: QueuedAuctionWin,
	auction: NostrEventLike,
	auctionCoordinate: string,
	settlements: NostrEventLike[],
): boolean =>
	settlements.some((event) => {
		const parsed = parseSettlementEvent(toRawEvent(event))
		return (
			parsed.ok &&
			parsed.value.sellerPubkey === auction.pubkey &&
			parsed.value.auctionRootEventId === win.auctionRootEventId &&
			parsed.value.auctionCoordinate === auctionCoordinate
		)
	})
