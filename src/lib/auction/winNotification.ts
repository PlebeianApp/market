import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { toRawEvent } from '@/lib/nostr/eventLike'
import { parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { computeValidatedBids } from '@/lib/auction/bidValidation'
import type { Nut7ProofState } from '@/lib/auction/constants'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent } from '@/lib/auction/events'

export interface QueuedAuctionWin {
	auctionRootEventId: string
}

export const isAuctionWonModalSuppressedPath = (pathname: string): boolean =>
	/^\/auctions\/[^/]+\/?$/.test(pathname) ||
	/^\/dashboard\/products\/auctions\/[^/]+\/?$/.test(pathname) ||
	/^\/dashboard\/orders\/[^/]+\/?$/.test(pathname)

export const selectValidatedAuctionWinner = (
	auction: ParsedAuctionEvent,
	bids: ParsedBidEvent[],
	verdicts: ParsedValidatorVerdictEvent[],
	nut7States: Map<string, Nut7ProofState>,
): ParsedBidEvent | null => computeValidatedBids({ auction, bids, verdicts, nut7States, postSettlement: false }).canonicalWinner

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
