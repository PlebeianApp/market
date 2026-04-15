import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

export const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const AUCTION_SETTLEMENT_KIND = 1024 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const ACTIVE_AUCTION_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

export type AuctionSettlementPublishStatus = 'settled' | 'reserve_not_met'

export type AuctionBidChainGroup = {
	bidderPubkey: string
	latestBid: NDKEvent
	chain: NDKEvent[]
}

export interface AuctionSettlementWinnerToken {
	bidEventId: string
	bidderPubkey: string
	derivationPath: string
	childPubkey: string
	mintUrl: string
	amount: number
	totalBidAmount: number
	commitment: string
	locktime: number
	refundPubkey: string
	token: string
}

export interface AuctionSettlementPlanResponse {
	auctionEventId: string
	auctionCoordinates?: string
	status: AuctionSettlementPublishStatus
	closeAt: number
	reserve: number
	winningBidEventId?: string
	winnerPubkey?: string
	finalAmount: number
	winnerTokens: AuctionSettlementWinnerToken[]
}

export const getAuctionTagValue = (event: NDKEvent, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''

export const parseAuctionNonNegativeInt = (value?: string, fallback: number = 0): number => {
	const parsed = value ? parseInt(value, 10) : NaN
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const getAuctionBidAmount = (bidEvent: NDKEvent): number => {
	const amountTag = getAuctionTagValue(bidEvent, 'amount')
	if (amountTag) return parseAuctionNonNegativeInt(amountTag, 0)

	try {
		const parsedContent = JSON.parse(bidEvent.content || '{}')
		return parseAuctionNonNegativeInt(String(parsedContent?.amount || '0'), 0)
	} catch {
		return 0
	}
}

export const getAuctionBidStatus = (bidEvent: NDKEvent): string => getAuctionTagValue(bidEvent, 'status') || 'unknown'

export const getAuctionReserveAmount = (auctionEvent: NDKEvent): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'reserve'), 0)

export const getAuctionEndAt = (auctionEvent: NDKEvent): number => parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'end_at'), 0)

export const collectAuctionBidChain = (latestBid: NDKEvent, bidById: Map<string, NDKEvent>): NDKEvent[] => {
	const chain: NDKEvent[] = []
	const seen = new Set<string>()
	let current: NDKEvent | undefined = latestBid

	while (current && !seen.has(current.id)) {
		chain.unshift(current)
		seen.add(current.id)
		const previousBidId = getAuctionTagValue(current, 'prev_bid')
		if (!previousBidId) break
		const previousBid = bidById.get(previousBidId)
		if (!previousBid) {
			throw new Error(`Missing previous bid event ${previousBidId} for bid ${latestBid.id}`)
		}
		current = previousBid
	}

	return chain
}

export const buildActiveAuctionBidChains = (bids: NDKEvent[]): AuctionBidChainGroup[] => {
	const latestByBidder = new Map<string, NDKEvent>()

	for (const bid of bids) {
		if (!ACTIVE_AUCTION_BID_STATUSES.has(getAuctionBidStatus(bid))) continue
		const existing = latestByBidder.get(bid.pubkey)
		if (!existing) {
			latestByBidder.set(bid.pubkey, bid)
			continue
		}

		const amountDelta = getAuctionBidAmount(bid) - getAuctionBidAmount(existing)
		if (amountDelta > 0) {
			latestByBidder.set(bid.pubkey, bid)
			continue
		}
		if (amountDelta === 0) {
			const createdAtDelta = (bid.created_at || 0) - (existing.created_at || 0)
			if (createdAtDelta > 0 || (createdAtDelta === 0 && bid.id.localeCompare(existing.id) > 0)) {
				latestByBidder.set(bid.pubkey, bid)
			}
		}
	}

	const bidById = new Map(bids.map((bid) => [bid.id, bid]))
	return Array.from(latestByBidder.entries()).map(([bidderPubkey, latestBid]) => ({
		bidderPubkey,
		latestBid,
		chain: collectAuctionBidChain(latestBid, bidById),
	}))
}

export const compareAuctionBidChainPriority = (left: AuctionBidChainGroup, right: AuctionBidChainGroup): number => {
	const amountDelta = getAuctionBidAmount(right.latestBid) - getAuctionBidAmount(left.latestBid)
	if (amountDelta !== 0) return amountDelta

	const createdAtDelta = (right.latestBid.created_at || 0) - (left.latestBid.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta

	return right.latestBid.id.localeCompare(left.latestBid.id)
}
