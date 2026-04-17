import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'
import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_ROOT_EVENT_ID_TAG,
	AUCTION_SETTLEMENT_KIND,
	getAuctionCurrentPrice as computeAuctionCurrentPrice,
	getAuctionEffectiveEndAt as computeAuctionEffectiveEndAt,
	getAuctionEndAt as getAuctionEndAtValue,
	getAuctionExtensionRule as parseAuctionExtensionRule,
	getAuctionMaxEndAt as getAuctionMaxEndAtValue,
	getAuctionRootEventId as getAuctionRootEventIdValue,
	getAuctionStartAt as getAuctionStartAtValue,
	getAuctionWindowValidBids,
	resolveAuctionVersionSet,
} from '@/lib/auctionSettlement'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { auctionKeys } from './queryKeyFactory'
import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'
import { naddrFromAddress } from '@/lib/nostr/naddr'

export type AuctionSettlementStatus = 'settled' | 'reserve_not_met' | 'cancelled' | 'unknown'

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

const dedupeEventsById = (events: NDKEvent[]): NDKEvent[] => {
	const eventsById = new Map<string, NDKEvent>()
	for (const event of events) {
		eventsById.set(event.id, event)
	}
	return Array.from(eventsById.values())
}

const cloneAuctionEventWithRootId = (
	ndk: NonNullable<ReturnType<typeof ndkActions.getNDK>>,
	event: NDKEvent,
	rootEventId: string,
): NDKEvent => {
	const cloned = new NDKEvent(ndk, event.rawEvent())
	cloned.tags = [...cloned.tags.filter((tag) => tag[0] !== AUCTION_ROOT_EVENT_ID_TAG), [AUCTION_ROOT_EVENT_ID_TAG, rootEventId]]
	return cloned
}

const getAuctionGroupingKey = (event: NDKEvent): string => {
	const dTag = getAuctionId(event)
	return dTag ? `${event.pubkey}:${dTag}` : event.id
}

const resolveCanonicalAuctionEvent = (ndk: NonNullable<ReturnType<typeof ndkActions.getNDK>>, events: NDKEvent[]): NDKEvent | null => {
	const resolved = resolveAuctionVersionSet(events)
	if (!resolved) return null
	return cloneAuctionEventWithRootId(ndk, resolved.displayEvent, resolved.rootEventId)
}

const collapseAuctionVersions = (ndk: NonNullable<ReturnType<typeof ndkActions.getNDK>>, events: NDKEvent[]): NDKEvent[] => {
	const groupedEvents = new Map<string, NDKEvent[]>()
	for (const event of events) {
		const key = getAuctionGroupingKey(event)
		const group = groupedEvents.get(key)
		if (group) group.push(event)
		else groupedEvents.set(key, [event])
	}

	return Array.from(groupedEvents.values())
		.map((group) => resolveCanonicalAuctionEvent(ndk, group))
		.filter((event): event is NDKEvent => !!event)
}

const fetchAuctionVersionEvents = async (pubkey: string, dTag: string, limit: number = 50): Promise<NDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk || !pubkey || !dTag) return []

	const events = await ndkActions.fetchEventsWithTimeout(
		{
			kinds: [AUCTION_KIND],
			authors: [pubkey],
			'#d': [dTag],
			limit,
		},
		{ timeoutMs: 8000 },
	)
	return filterDeletedAuctions(filterBlacklistedEvents(Array.from(events)))
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
	return collapseAuctionVersions(ndk, filterDeletedAuctions(filterBlacklistedEvents(Array.from(events)))).sort(
		(a, b) => (b.created_at || 0) - (a.created_at || 0),
	)
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
	if (!dTag) return filterBlacklistedEvents([event])[0] || null

	const versionEvents = await fetchAuctionVersionEvents(event.pubkey, dTag)
	return resolveCanonicalAuctionEvent(ndk, dedupeEventsById([event, ...versionEvents]))
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
	return collapseAuctionVersions(ndk, filterDeletedAuctions(filterBlacklistedEvents(Array.from(events)))).sort(
		(a, b) => (b.created_at || 0) - (a.created_at || 0),
	)
}

export const fetchAuctionByATag = async (pubkey: string, dTag: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!pubkey || !dTag) return null

	const versionEvents = await fetchAuctionVersionEvents(pubkey, dTag)
	if (versionEvents.length === 0) {
		const naddr = naddrFromAddress(30408, pubkey, dTag)
		const event = await ndk.fetchEvent(naddr)
		if (!event) return null
		if (isAuctionDeleted(dTag, event.created_at)) return null
		return resolveCanonicalAuctionEvent(ndk, [event])
	}

	return resolveCanonicalAuctionEvent(ndk, versionEvents)
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

export const auctionSettlementsQueryOptions = (auctionEventId: string, limit: number = 100, auctionCoordinates?: string) =>
	queryOptions({
		queryKey: [...auctionKeys.settlements(auctionEventId || auctionCoordinates || ''), auctionCoordinates || ''],
		queryFn: () => fetchAuctionSettlements(auctionEventId, limit, auctionCoordinates),
		enabled: !!(auctionEventId || auctionCoordinates),
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const getAuctionId = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'd')?.[1] || ''
export const getAuctionRootEventId = (event: NDKEvent | null): string => (event ? getAuctionRootEventIdValue(event) : '')

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
	return event ? getAuctionEndAtValue(event) : 0
}

export const getAuctionStartAt = (event: NDKEvent | null): number => {
	return event ? getAuctionStartAtValue(event) : 0
}

export const getAuctionEffectiveEndAt = (event: NDKEvent | null, bids: NDKEvent[] = []): number => {
	if (!event) return 0
	return computeAuctionEffectiveEndAt(event, bids)
}

export const getAuctionMaxEndAt = (event: NDKEvent | null): number => (event ? getAuctionMaxEndAtValue(event) : 0)

export const getAuctionExtensionRule = (event: NDKEvent | null): string => (event ? parseAuctionExtensionRule(event).raw : 'none')

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

/** Nostr pubkey of the auction's path issuer (the app running the path oracle). */
export const getAuctionPathIssuer = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'path_issuer')?.[1] || ''

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

export const getAuctionCurrentPriceFromBids = (auction: NDKEvent | null, bids: NDKEvent[], startingBid: number = 0): number =>
	auction
		? computeAuctionCurrentPrice(auction, bids, startingBid)
		: bids.reduce((max, bid) => Math.max(max, getBidAmount(bid)), startingBid)

export const getAuctionBidCountFromBids = (auction: NDKEvent | null, bids: NDKEvent[]): number =>
	auction ? getAuctionWindowValidBids(auction, bids).length : bids.length

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
