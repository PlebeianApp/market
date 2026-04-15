import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { auctionKeys } from './queryKeyFactory'
import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'
import { naddrFromAddress } from '@/lib/nostr/naddr'

export type AuctionBidStats = {
	count: number
	currentPrice: number
}

export type AuctionSettlementStatus = 'settled' | 'reserve_not_met' | 'cancelled' | 'unknown'

const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_SETTLEMENT_KIND = 1024 as unknown as NonNullable<NDKFilter['kinds']>[number]

const DELETED_AUCTIONS_STORAGE_KEY = 'plebeian_deleted_auction_ids'

const loadDeletedAuctionIds = (): Map<string, number> => {
	try {
		const stored = localStorage.getItem(DELETED_AUCTIONS_STORAGE_KEY)
		if (stored) {
			const parsed = JSON.parse(stored)
			if (Array.isArray(parsed)) {
				const now = Math.floor(Date.now() / 1000)
				return new Map(parsed.map((dTag: string) => [dTag, now]))
			}
			if (typeof parsed === 'object' && parsed !== null) {
				return new Map(Object.entries(parsed))
			}
		}
	} catch (e) {
		console.error('Failed to load deleted auction IDs from localStorage:', e)
	}
	return new Map()
}

const saveDeletedAuctionIds = (ids: Map<string, number>) => {
	try {
		localStorage.setItem(DELETED_AUCTIONS_STORAGE_KEY, JSON.stringify(Object.fromEntries(ids)))
	} catch (e) {
		console.error('Failed to save deleted auction IDs to localStorage:', e)
	}
}

const deletedAuctionIds = loadDeletedAuctionIds()

export const markAuctionAsDeleted = (dTag: string, deletionTimestamp?: number) => {
	const timestamp = deletionTimestamp ?? Math.floor(Date.now() / 1000)
	deletedAuctionIds.set(dTag, timestamp)
	saveDeletedAuctionIds(deletedAuctionIds)
}

export const isAuctionDeleted = (dTag: string, eventCreatedAt?: number) => {
	const deletionTimestamp = deletedAuctionIds.get(dTag)
	if (deletionTimestamp === undefined) return false
	if (eventCreatedAt === undefined) return true
	return eventCreatedAt < deletionTimestamp
}

const filterDeletedAuctions = (events: NDKEvent[]): NDKEvent[] => {
	return events.filter((event) => {
		const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
		if (!dTag) return true
		return !isAuctionDeleted(dTag, event.created_at)
	})
}

export const fetchAuctions = async (limit: number = 200) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, returning empty auction list')
		return []
	}

	const filter: NDKFilter = {
		kinds: [AUCTION_KIND],
		limit,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	return filterDeletedAuctions(filterBlacklistedEvents(Array.from(events))).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuction = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, cannot fetch auction')
		return null
	}
	if (!id) return null

	const filter: NDKFilter = {
		kinds: [AUCTION_KIND],
		ids: [id],
		limit: 1,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	const event = Array.from(events)[0] ?? null
	if (!event) return null
	const dTag = getAuctionId(event)
	if (dTag && isAuctionDeleted(dTag, event.created_at)) return null
	return filterBlacklistedEvents([event])[0] || null
}

export const fetchAuctionsByPubkey = async (pubkey: string, limit: number = 100) => {
	if (!pubkey) return []
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filter: NDKFilter = {
		kinds: [AUCTION_KIND],
		authors: [pubkey],
		limit,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	return filterDeletedAuctions(filterBlacklistedEvents(Array.from(events))).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuctionByATag = async (pubkey: string, dTag: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!pubkey || !dTag) return null

	const naddr = naddrFromAddress(30408, pubkey, dTag)
	const event = await ndk.fetchEvent(naddr)
	if (!event) return null
	if (isAuctionDeleted(dTag, event.created_at)) return null
	return filterBlacklistedEvents([event])[0] || null
}

export const fetchAuctionBids = async (auctionEventId: string, limit: number = 500, auctionCoordinates?: string) => {
	if (!auctionEventId && !auctionCoordinates) return []
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filters: NDKFilter[] = []
	if (auctionEventId) {
		filters.push({
			kinds: [AUCTION_BID_KIND],
			'#e': [auctionEventId],
			limit,
		})
	}
	if (auctionCoordinates) {
		filters.push({
			kinds: [AUCTION_BID_KIND],
			'#a': [auctionCoordinates],
			limit,
		})
	}

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return filterBlacklistedEvents(Array.from(events)).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
}

export const fetchAuctionBidsByBidder = async (pubkey: string, limit: number = 500) => {
	if (!pubkey) return []
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const events = await ndkActions.fetchEventsWithTimeout(
		{
			kinds: [AUCTION_BID_KIND],
			authors: [pubkey],
			limit,
		},
		{ timeoutMs: 8000 },
	)
	return filterBlacklistedEvents(Array.from(events)).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuctionSettlements = async (auctionEventId: string, limit: number = 100, auctionCoordinates?: string) => {
	if (!auctionEventId && !auctionCoordinates) return []
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filters: NDKFilter[] = []
	if (auctionEventId) {
		filters.push({
			kinds: [AUCTION_SETTLEMENT_KIND],
			'#e': [auctionEventId],
			limit,
		})
	}
	if (auctionCoordinates) {
		filters.push({
			kinds: [AUCTION_SETTLEMENT_KIND],
			'#a': [auctionCoordinates],
			limit,
		})
	}

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return filterBlacklistedEvents(Array.from(events)).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuctionBidStats = async (
	auctionEventId: string,
	startingBid: number = 0,
	auctionCoordinates?: string,
): Promise<AuctionBidStats> => {
	const bids = await fetchAuctionBids(auctionEventId, 500, auctionCoordinates)
	let currentPrice = startingBid

	for (const bid of bids) {
		const amountTag = bid.tags.find((t) => t[0] === 'amount')
		const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : NaN
		if (!isNaN(amount) && amount > currentPrice) {
			currentPrice = amount
		}
	}

	return {
		count: bids.length,
		currentPrice,
	}
}

export const auctionsQueryOptions = (limit: number = 200) =>
	queryOptions({
		queryKey: auctionKeys.all,
		queryFn: () => fetchAuctions(limit),
		staleTime: 30000,
		refetchOnMount: 'always',
	})

export const auctionsByPubkeyQueryOptions = (pubkey: string, limit: number = 100) =>
	queryOptions({
		queryKey: auctionKeys.byPubkey(pubkey),
		queryFn: () => fetchAuctionsByPubkey(pubkey, limit),
		enabled: !!pubkey,
	})

export const auctionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: auctionKeys.details(id),
		queryFn: () => fetchAuction(id),
		staleTime: 300000,
		enabled: !!id,
	})

export const auctionByATagQueryOptions = (pubkey: string, dTag: string) =>
	queryOptions({
		queryKey: auctionKeys.byATag(pubkey, dTag),
		queryFn: () => fetchAuctionByATag(pubkey, dTag),
		staleTime: 300000,
		enabled: !!(pubkey && dTag),
	})

export const auctionBidsQueryOptions = (auctionEventId: string, limit: number = 500, auctionCoordinates?: string) =>
	queryOptions({
		queryKey: [...auctionKeys.bids(auctionEventId || auctionCoordinates || ''), auctionCoordinates || ''],
		queryFn: () => fetchAuctionBids(auctionEventId, limit, auctionCoordinates),
		enabled: !!(auctionEventId || auctionCoordinates),
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const auctionBidsByBidderQueryOptions = (pubkey: string, limit: number = 500) =>
	queryOptions({
		queryKey: auctionKeys.byBidder(pubkey),
		queryFn: () => fetchAuctionBidsByBidder(pubkey, limit),
		enabled: !!pubkey,
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const auctionBidStatsQueryOptions = (auctionEventId: string, startingBid: number = 0, auctionCoordinates?: string) =>
	queryOptions({
		queryKey: [...auctionKeys.bidStats(auctionEventId || auctionCoordinates || ''), startingBid, auctionCoordinates || ''],
		queryFn: () => fetchAuctionBidStats(auctionEventId, startingBid, auctionCoordinates),
		enabled: !!(auctionEventId || auctionCoordinates),
		staleTime: 10000,
		refetchInterval: 10000,
	})

export const auctionSettlementsQueryOptions = (auctionEventId: string, limit: number = 100, auctionCoordinates?: string) =>
	queryOptions({
		queryKey: [...auctionKeys.settlements(auctionEventId || auctionCoordinates || ''), auctionCoordinates || ''],
		queryFn: () => fetchAuctionSettlements(auctionEventId, limit, auctionCoordinates),
		enabled: !!(auctionEventId || auctionCoordinates),
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const getAuctionId = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'd')?.[1] || ''

export const getAuctionTitle = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Auction'

export const getAuctionSummary = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'summary')?.[1] || ''

export const getAuctionCategories = (event: NDKEvent | null): string[] => {
	if (!event) return []
	return event.tags.filter((tag) => tag[0] === 't' && !!tag[1]).map((tag) => tag[1])
}

export const getAuctionImages = (event: NDKEvent | null): Array<string[]> => {
	if (!event) return []
	return event.tags
		.filter((t) => t[0] === 'image')
		.sort((a, b) => {
			const aOrder = a[3] ? parseInt(a[3], 10) : 0
			const bOrder = b[3] ? parseInt(b[3], 10) : 0
			return aOrder - bOrder
		})
}

export const getAuctionEndAt = (event: NDKEvent | null): number => {
	if (!event) return 0
	const tag = event.tags.find((t) => t[0] === 'end_at')
	return tag?.[1] ? parseInt(tag[1], 10) || 0 : 0
}

export const getAuctionStartAt = (event: NDKEvent | null): number => {
	if (!event) return 0
	const tag = event.tags.find((t) => t[0] === 'start_at')
	return tag?.[1] ? parseInt(tag[1], 10) || 0 : 0
}

export const getAuctionStartingBid = (event: NDKEvent | null): number => {
	if (!event) return 0

	const startingBidTag = event.tags.find((t) => t[0] === 'starting_bid')
	if (startingBidTag?.[1]) {
		const parsed = parseInt(startingBidTag[1], 10)
		if (!isNaN(parsed)) return parsed
	}

	const priceTag = event.tags.find((t) => t[0] === 'price')
	if (priceTag?.[1]) {
		const parsed = parseInt(priceTag[1], 10)
		if (!isNaN(parsed)) return parsed
	}

	return 0
}

export const getAuctionBidIncrement = (event: NDKEvent | null): number => {
	if (!event) return 1
	const tag = event.tags.find((t) => t[0] === 'bid_increment')
	const parsed = tag?.[1] ? parseInt(tag[1], 10) : NaN
	return !isNaN(parsed) && parsed > 0 ? parsed : 1
}

export const getAuctionReserve = (event: NDKEvent | null): number => {
	if (!event) return 0
	const tag = event.tags.find((t) => t[0] === 'reserve')
	const parsed = tag?.[1] ? parseInt(tag[1], 10) : NaN
	return !isNaN(parsed) ? parsed : 0
}

export const getAuctionType = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'auction_type')?.[1] || 'english'

export const getAuctionCurrency = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'currency')?.[1] || 'SAT'

export const getAuctionMints = (event: NDKEvent | null): string[] => {
	if (!event) return []
	return event.tags.filter((tag) => tag[0] === 'mint' && !!tag[1]).map((tag) => tag[1])
}

export const getAuctionKeyScheme = (event: NDKEvent | null): 'hd_p2pk' => {
	if (!event) return 'hd_p2pk'
	return 'hd_p2pk'
}

export const getAuctionP2pkXpub = (event: NDKEvent | null): string => event?.tags.find((tag) => tag[0] === 'p2pk_xpub')?.[1] || ''

export const getAuctionEscrowPubkey = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'escrow_pubkey')?.[1] || ''

export const getAuctionEscrowIdentityPubkey = (event: NDKEvent | null): string =>
	event?.tags.find((t) => t[0] === 'escrow_identity')?.[1] || ''

export const getAuctionSettlementPolicy = (event: NDKEvent | null): string =>
	event?.tags.find((t) => t[0] === 'settlement_policy')?.[1] || ''

export const getAuctionSchema = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'schema')?.[1] || ''

export const getAuctionShippingOptions = (event: NDKEvent | null): Array<{ shippingRef: string; extraCost: string }> => {
	if (!event) return []
	return event.tags
		.filter((tag) => tag[0] === 'shipping_option' && !!tag[1])
		.map((tag) => ({
			shippingRef: tag[1],
			extraCost: typeof tag[2] === 'string' ? tag[2] : '',
		}))
}

export const getAuctionSpecs = (event: NDKEvent | null): Array<{ key: string; value: string }> => {
	if (!event) return []
	return event.tags
		.filter((tag) => tag[0] === 'spec' && !!tag[1])
		.map((tag) => ({
			key: tag[1],
			value: typeof tag[2] === 'string' ? tag[2] : '',
		}))
}

export const getBidAmount = (bidEvent: NDKEvent | null): number => {
	if (!bidEvent) return 0
	const amountTag = bidEvent.tags.find((tag) => tag[0] === 'amount')?.[1]
	const parsed = amountTag ? parseInt(amountTag, 10) : NaN
	if (!isNaN(parsed)) return parsed

	try {
		const parsedContent = JSON.parse(bidEvent.content || '{}')
		const contentAmount = parseInt(parsedContent?.amount || '0', 10)
		return !isNaN(contentAmount) ? contentAmount : 0
	} catch {
		return 0
	}
}

export const getBidAuctionEventId = (bidEvent: NDKEvent | null): string => bidEvent?.tags.find((tag) => tag[0] === 'e')?.[1] || ''

export const getBidAuctionCoordinates = (bidEvent: NDKEvent | null): string => bidEvent?.tags.find((tag) => tag[0] === 'a')?.[1] || ''

export const getBidSellerPubkey = (bidEvent: NDKEvent | null): string => bidEvent?.tags.find((tag) => tag[0] === 'p')?.[1] || ''

export const getBidMint = (bidEvent: NDKEvent | null): string => {
	if (!bidEvent) return ''
	const tagMint = bidEvent.tags.find((tag) => tag[0] === 'mint')?.[1]
	if (tagMint) return tagMint
	try {
		const parsedContent = JSON.parse(bidEvent.content || '{}')
		return parsedContent?.mint || ''
	} catch {
		return ''
	}
}

export const getBidStatus = (bidEvent: NDKEvent | null): string => {
	if (!bidEvent) return 'unknown'
	return bidEvent.tags.find((tag) => tag[0] === 'status')?.[1] || 'unknown'
}

export const getBidLocktime = (bidEvent: NDKEvent | null): number => {
	if (!bidEvent) return 0
	const parsed = parseInt(bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1] || '0', 10)
	return Number.isFinite(parsed) ? parsed : 0
}

export const getAuctionSettlementStatus = (settlementEvent: NDKEvent | null): AuctionSettlementStatus => {
	if (!settlementEvent) return 'unknown'
	const status = settlementEvent.tags.find((tag) => tag[0] === 'status')?.[1]
	if (status === 'settled' || status === 'reserve_not_met' || status === 'cancelled') return status
	return 'unknown'
}

export const getAuctionSettlementWinningBid = (settlementEvent: NDKEvent | null): string =>
	settlementEvent?.tags.find((tag) => tag[0] === 'winning_bid')?.[1] || ''

export const getAuctionSettlementWinner = (settlementEvent: NDKEvent | null): string =>
	settlementEvent?.tags.find((tag) => tag[0] === 'winner')?.[1] || ''

export const getAuctionSettlementFinalAmount = (settlementEvent: NDKEvent | null): number => {
	if (!settlementEvent) return 0
	const parsed = parseInt(settlementEvent.tags.find((tag) => tag[0] === 'final_amount')?.[1] || '0', 10)
	return Number.isFinite(parsed) ? parsed : 0
}

export const isNSFWAuction = (event: NDKEvent | null): boolean => {
	if (!event) return false
	return event.tags.find((t) => t[0] === 'content-warning')?.[1] === 'nsfw'
}

export const filterNSFWAuctions = (events: NDKEvent[], showNSFW: boolean): NDKEvent[] => {
	if (showNSFW) return events
	return events.filter((event) => !isNSFWAuction(event))
}

export const useAuctionBidStats = (auctionEventId: string, startingBid: number = 0, auctionCoordinates?: string) =>
	useQuery({
		...auctionBidStatsQueryOptions(auctionEventId, startingBid, auctionCoordinates),
	})

export const useAuctionBids = (auctionEventId: string, limit: number = 500, auctionCoordinates?: string) =>
	useQuery({
		...auctionBidsQueryOptions(auctionEventId, limit, auctionCoordinates),
	})

export const useAuctionBidsByBidder = (pubkey: string, limit: number = 500) =>
	useQuery({
		...auctionBidsByBidderQueryOptions(pubkey, limit),
	})

export const useAuctionSettlements = (auctionEventId: string, limit: number = 100, auctionCoordinates?: string) =>
	useQuery({
		...auctionSettlementsQueryOptions(auctionEventId, limit, auctionCoordinates),
	})

// ---------------------------------------------------------------------------
// Auction Claim Order — Kind 16 order events linked to an auction via `a` tag
// ---------------------------------------------------------------------------

/**
 * Fetches the Kind 16 order event(s) created by the auction winner after settlement.
 * These are identified by having an `a` tag matching the auction coordinates and a
 * `type` tag of ORDER_CREATION ('1').
 */
export const fetchAuctionClaimOrders = async (auctionCoordinates: string): Promise<NDKEvent[]> => {
	if (!auctionCoordinates) return []
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND as unknown as NonNullable<NDKFilter['kinds']>[number]],
		'#a': [auctionCoordinates],
		limit: 20,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 6000 })
	return Array.from(events)
		.filter((e) => {
			const type = e.tags.find((t) => t[0] === 'type')?.[1]
			return type === ORDER_MESSAGE_TYPE.ORDER_CREATION
		})
		.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const auctionClaimOrdersQueryOptions = (auctionCoordinates: string) =>
	queryOptions({
		queryKey: [...auctionKeys.all, 'claimOrders', auctionCoordinates],
		queryFn: () => fetchAuctionClaimOrders(auctionCoordinates),
		enabled: !!auctionCoordinates,
		staleTime: 10000,
		refetchInterval: 10000,
	})

export const useAuctionClaimOrders = (auctionCoordinates: string) =>
	useQuery({
		...auctionClaimOrdersQueryOptions(auctionCoordinates),
	})
