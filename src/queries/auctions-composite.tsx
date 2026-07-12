import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { auctionKeys } from './queryKeyFactory'
import {
	fetchAuctionBids,
	fetchAuctionSettlements,
	fetchAuctionPathReleases,
	fetchAuctionVerdicts,
	fetchAuctionClaimOrders,
} from './auctions'

export interface AuctionDetails {
	bids: NDKEvent[]
	settlements: NDKEvent[]
	pathReleases: NDKEvent[]
	verdicts: NDKEvent[]
	claimOrders: NDKEvent[]
}

export interface FetchAuctionDetailOptions {
	auctionCoordinates?: string
	bidLimit?: number
	settlementLimit?: number
	pathReleaseLimit?: number
	verdictLimit?: number
}

/**
 * Fetch all auction sub-queries in parallel via Promise.all.
 * Reduces waterfall latency from sum(latencies) to max(latency).
 */
export const fetchAuctionDetails = async (auctionEventId: string, opts: FetchAuctionDetailOptions = {}): Promise<AuctionDetails> => {
	const { auctionCoordinates, bidLimit = 500, settlementLimit = 100, pathReleaseLimit = 200, verdictLimit = 500 } = opts

	const [bids, settlements, pathReleases, verdicts, claimOrders] = await Promise.all([
		fetchAuctionBids(auctionEventId, bidLimit, auctionCoordinates),
		fetchAuctionSettlements(auctionEventId, settlementLimit, auctionCoordinates),
		fetchAuctionPathReleases(auctionEventId, pathReleaseLimit, auctionCoordinates),
		fetchAuctionVerdicts(auctionEventId, verdictLimit),
		auctionCoordinates ? fetchAuctionClaimOrders(auctionCoordinates) : Promise.resolve([]),
	])

	return { bids, settlements, pathReleases, verdicts, claimOrders }
}

export const auctionDetailsQueryOptions = (auctionEventId: string, opts: FetchAuctionDetailOptions = {}) =>
	queryOptions({
		queryKey: [...auctionKeys.details(auctionEventId), 'composite'],
		queryFn: () => fetchAuctionDetails(auctionEventId, opts),
		enabled: !!auctionEventId,
		staleTime: 10_000,
		refetchInterval: 15_000,
	})

/**
 * Composite hook for fetching all auction details in a single query.
 * The route component should use this to replace individual
 * useAuctionSettlements / useAuctionClaimOrders / useAuctionPathReleases calls.
 */
export const useAuctionDetails = (auctionEventId: string, opts: FetchAuctionDetailOptions = {}) => {
	return useQuery(auctionDetailsQueryOptions(auctionEventId, opts))
}
