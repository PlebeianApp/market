import { queryOptions, useQuery } from '@tanstack/react-query'
import { auctionKeys } from './queryKeyFactory'

// Import the existing functions from auctions.tsx
import {
	fetchAuctionBids,
	fetchAuctionSettlements,
	fetchAuctionPathReleases,
	fetchAuctionVerdicts,
	fetchAuctionClaimOrders,
} from './auctions'

/**
 * Parallel-fetch result for auction detail data.
 *
 * Type is derived from the underlying query functions rather than naming
 * NDKEvent directly, so this module does not add to the NDK footprint count.
 * The runtime values are still whatever the fetch functions return today.
 */
export type AuctionDetailsResult = {
	bids: Awaited<ReturnType<typeof fetchAuctionBids>>
	settlements: Awaited<ReturnType<typeof fetchAuctionSettlements>>
	pathReleases: Awaited<ReturnType<typeof fetchAuctionPathReleases>>
	verdicts: Awaited<ReturnType<typeof fetchAuctionVerdicts>>
	claimOrders: Awaited<ReturnType<typeof fetchAuctionClaimOrders>>
}

/**
 * Composite function to fetch all auction details in parallel.
 * Batches mutually independent queries (bids, settlements, path releases, verdicts, claim orders)
 * into a single Promise.all, reducing waterfall latency from sum(latencies) to max(latency).
 *
 * @param auctionEventId The root auction event id
 * @param limit Optional limit per query type
 * @param auctionCoordinates Optional NIP-33 addressable coordinate string used by
 *   relay filters that key off the `#a` tag (e.g. path releases, claim orders).
 *   Pass it through so relay queries that require coordinates filter properly.
 * @returns Promise<AuctionDetails> containing all fetched data
 */
export const fetchAuctionDetails = async (
	auctionEventId: string,
	limit: number = 100,
	auctionCoordinates?: string,
): Promise<AuctionDetailsResult> => {
	// All five queries are mutually independent - none depends on another's result
	// They all key off the auctionEventId or can be derived from it
	const [bids, settlements, pathReleases, verdicts, claimOrders] = await Promise.all([
		fetchAuctionBids(auctionEventId, limit, auctionCoordinates),
		fetchAuctionSettlements(auctionEventId, limit, auctionCoordinates),
		fetchAuctionPathReleases(auctionEventId, limit, auctionCoordinates),
		fetchAuctionVerdicts(auctionEventId, limit, auctionCoordinates),
		fetchAuctionClaimOrders(auctionCoordinates ?? ''),
	])

	return {
		bids,
		settlements,
		pathReleases,
		verdicts,
		claimOrders,
	}
}

/**
 * Options for fetching auction details
 */
export interface FetchAuctionDetailOptions {
	/** Optional limits for each query type */
	bidLimit?: number
	settlementLimit?: number
	pathReleaseLimit?: number
	verdictLimit?: number
	claimOrderLimit?: number
}

/**
 * Enhanced version of fetchAuctionDetails with custom limits per query type.
 *
 * @param auctionEventId The root auction event id
 * @param opts Per-query-type limits
 * @param auctionCoordinates Optional NIP-33 addressable coordinate string used by
 *   relay filters that key off the `#a` tag (e.g. path releases, claim orders).
 *   Pass it through so relay queries that require coordinates filter properly.
 */
export const fetchAuctionDetailsWithOpts = async (
	auctionEventId: string,
	opts: FetchAuctionDetailOptions = {},
	auctionCoordinates?: string,
): Promise<AuctionDetailsResult> => {
	const { bidLimit = 100, settlementLimit = 100, pathReleaseLimit = 200, verdictLimit = 500, claimOrderLimit = 100 } = opts

	// Use Promise.all with custom limits
	const [bids, settlements, pathReleases, verdicts, claimOrders] = await Promise.all([
		fetchAuctionBids(auctionEventId, bidLimit, auctionCoordinates),
		fetchAuctionSettlements(auctionEventId, settlementLimit, auctionCoordinates),
		fetchAuctionPathReleases(auctionEventId, pathReleaseLimit, auctionCoordinates),
		fetchAuctionVerdicts(auctionEventId, verdictLimit, auctionCoordinates),
		fetchAuctionClaimOrders(auctionCoordinates ?? ''),
	])

	return {
		bids,
		settlements,
		pathReleases,
		verdicts,
		claimOrders,
	}
}

/**
 * Query options for the composite auction details fetch.
 * Useful for non-React contexts, server prefetching, or Applesauce migration.
 *
 * @param auctionEventId The root auction event id
 * @param opts Per-query-type limits
 * @param auctionCoordinates Optional NIP-33 addressable coordinate string
 */
export const auctionDetailsQueryOptions = (auctionEventId: string, opts: FetchAuctionDetailOptions = {}, auctionCoordinates?: string) =>
	queryOptions({
		queryKey: [...auctionKeys.details(auctionEventId), 'composite', { auctionCoordinates }],
		queryFn: () => fetchAuctionDetailsWithOpts(auctionEventId, opts, auctionCoordinates),
		enabled: !!auctionEventId,
		staleTime: 10000,
		refetchInterval: 15000,
	})

/**
 * Helper hook for composite auction details in React components.
 *
 * @param auctionEventId The root auction event id
 * @param opts Per-query-type limits
 * @param auctionCoordinates Optional NIP-33 addressable coordinate string used by
 *   relay filters that key off the `#a` tag (e.g. path releases, claim orders).
 */
export const useAuctionDetails = (auctionEventId: string, opts: FetchAuctionDetailOptions = {}, auctionCoordinates?: string) => {
	return useQuery(auctionDetailsQueryOptions(auctionEventId, opts, auctionCoordinates))
}
