import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { auctionKeys } from './queryKeyFactory'
import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'

export type AuctionBidStats = {
	count: number
	currentPrice: number
}

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
		kinds: [30408],
		limit,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	return filterDeletedAuctions(filterBlacklistedEvents(Array.from(events))).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuctionsByPubkey = async (pubkey: string, limit: number = 100) => {
	if (!pubkey) return []
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filter: NDKFilter = {
		kinds: [30408],
		authors: [pubkey],
		limit,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	return filterDeletedAuctions(filterBlacklistedEvents(Array.from(events))).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuctionBids = async (auctionEventId: string, limit: number = 500) => {
	if (!auctionEventId) return []
	const ndk = ndkActions.getNDK()
	if (!ndk) return []

	const filter: NDKFilter = {
		kinds: [1023],
		'#e': [auctionEventId],
		limit,
	}

	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
	return filterBlacklistedEvents(Array.from(events)).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
}

export const fetchAuctionBidStats = async (auctionEventId: string, startingBid: number = 0): Promise<AuctionBidStats> => {
	const bids = await fetchAuctionBids(auctionEventId)
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
		staleTime: 15000,
		refetchOnMount: 'always',
	})

export const auctionsByPubkeyQueryOptions = (pubkey: string, limit: number = 100) =>
	queryOptions({
		queryKey: auctionKeys.byPubkey(pubkey),
		queryFn: () => fetchAuctionsByPubkey(pubkey, limit),
		enabled: !!pubkey,
	})

export const auctionBidStatsQueryOptions = (auctionEventId: string, startingBid: number = 0) =>
	queryOptions({
		queryKey: [...auctionKeys.bidStats(auctionEventId), startingBid],
		queryFn: () => fetchAuctionBidStats(auctionEventId, startingBid),
		enabled: !!auctionEventId,
		staleTime: 10000,
		refetchInterval: 10000,
	})

export const getAuctionId = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'd')?.[1] || ''

export const getAuctionTitle = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Auction'

export const getAuctionSummary = (event: NDKEvent | null): string => event?.tags.find((t) => t[0] === 'summary')?.[1] || ''

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

export const isNSFWAuction = (event: NDKEvent | null): boolean => {
	if (!event) return false
	return event.tags.find((t) => t[0] === 'content-warning')?.[1] === 'nsfw'
}

export const filterNSFWAuctions = (events: NDKEvent[], showNSFW: boolean): NDKEvent[] => {
	if (showNSFW) return events
	return events.filter((event) => !isNSFWAuction(event))
}

export const useAuctionBidStats = (auctionEventId: string, startingBid: number = 0) =>
	useQuery({
		...auctionBidStatsQueryOptions(auctionEventId, startingBid),
	})
