import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
	AUCTION_BID_KIND,
	getAuctionBidAmount,
	getAuctionEffectiveEndAt,
	getAuctionEndAt,
	getAuctionMaxEndAt,
	getAuctionTagValue,
	getAuctionWindowValidBids,
} from '../../../src/lib/auctionSettlement'
import type { AuctionContext } from '../../../src/server/auction/context'
import { loadAuctionEvent } from '../../../src/server/auction/loadAuction'
import { fetchAuctionPathRegistry } from '../../../src/server/auction/registry'
import { structuredErrorResult } from './shared'

interface GetAuctionStateArgs {
	auctionEventId: string
}

/**
 * MCP handler for `get_auction_state` — read-only view of an auction's
 * current floor, top bid, bid count, and registry health. Public — does
 * not require caller identity. Useful for bidder UIs that want a live
 * "min bid right now" reading without redoing the curve client-side
 * (especially once the anti-snipe escalation lands).
 */
export const createGetAuctionStateHandler = (ctx: AuctionContext) => {
	return async (args: GetAuctionStateArgs): Promise<CallToolResult> => {
		try {
			const auctionEvent = await loadAuctionEvent(ctx, args.auctionEventId)

			const now = Math.floor(Date.now() / 1000)
			const startAt = Number(getAuctionTagValue(auctionEvent, 'start_at') || 0)
			const endAt = getAuctionEndAt(auctionEvent)
			const maxEndAt = getAuctionMaxEndAt(auctionEvent) || endAt
			const startingBid = Number(getAuctionTagValue(auctionEvent, 'starting_bid') || 0)
			const bidIncrement = Number(getAuctionTagValue(auctionEvent, 'bid_increment') || 1)

			const dTag = getAuctionTagValue(auctionEvent, 'd')
			const auctionCoordinates = dTag ? `30408:${auctionEvent.pubkey}:${dTag}` : ''

			const bidFilters = [
				{ kinds: [AUCTION_BID_KIND], '#e': [args.auctionEventId], limit: 500 },
				...(auctionCoordinates ? [{ kinds: [AUCTION_BID_KIND], '#a': [auctionCoordinates], limit: 500 }] : []),
			]
			const bidEvents = Array.from(await ctx.ndk.fetchEvents(bidFilters.length === 1 ? bidFilters[0] : bidFilters))
			const validBids = getAuctionWindowValidBids(auctionEvent, bidEvents)
			const topBidAmount = validBids.reduce((max, bid) => Math.max(max, getAuctionBidAmount(bid)), 0)

			const effectiveEndAt = getAuctionEffectiveEndAt(auctionEvent, bidEvents) || endAt

			let phase: 'scheduled' | 'active' | 'closing' | 'ended' = 'active'
			if (startAt && now < startAt) phase = 'scheduled'
			else if (effectiveEndAt && now >= effectiveEndAt) phase = 'ended'
			else if (effectiveEndAt && now >= effectiveEndAt - 60) phase = 'closing'

			// Current-floor calculation. Today: starting_bid OR
			// (top_bid + bid_increment), whichever is higher. The
			// upcoming anti-snipe curve will multiply this once the
			// auction enters the escalation window.
			const baseFloor = topBidAmount > 0 ? topBidAmount + bidIncrement : startingBid
			const currentFloor = baseFloor

			const registry = await fetchAuctionPathRegistry(ctx, args.auctionEventId)
			const entries = registry?.entries ?? []
			const pathsIssued = entries.length
			const pathsLocked = entries.filter((entry) => entry.status === 'locked' || entry.status === 'released').length

			return {
				content: [],
				structuredContent: {
					phase,
					startAt,
					endAt,
					effectiveEndAt,
					maxEndAt,
					currentFloor,
					topBidAmount,
					bidCount: validBids.length,
					pathsIssued,
					pathsLocked,
				},
			}
		} catch (error) {
			console.warn('[auction] get_auction_state failed:', error)
			return structuredErrorResult(error)
		}
	}
}
