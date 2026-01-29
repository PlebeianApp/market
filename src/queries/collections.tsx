import { CollectionImageTagSchema, CollectionSummaryTagSchema, CollectionTitleTagSchema } from '@/lib/schemas/productCollection.ts'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter, NDKKind } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { collectionKeys, collectionsKeys } from './queryKeyFactory'
import { filterBlacklistedEvents } from '@/lib/utils/blacklistFilters'
import { FEATURED_ITEMS_CONFIG } from '@/lib/schemas/featured'
import { naddrFromAddress } from '@/lib/nostr/naddr'

// --- DELETED COLLECTIONS TRACKING ---
// Track deleted collection d-tags with deletion timestamps to filter them from relay responses.
// Per NIP-09, deletions only apply to events older than the deletion event.
// If a new event with the same d-tag is published after the deletion, it should be visible.
// Persisted to localStorage so deletions survive page reloads.

const DELETED_COLLECTIONS_STORAGE_KEY = 'plebeian_deleted_collection_ids'

// Map of d-tag -> deletion timestamp (unix seconds)
const loadDeletedCollectionIds = (): Map<string, number> => {
	try {
		const stored = localStorage.getItem(DELETED_COLLECTIONS_STORAGE_KEY)
		if (stored) {
			const parsed = JSON.parse(stored)
			// Handle legacy format (array of strings) - migrate to new format
			if (Array.isArray(parsed)) {
				const now = Math.floor(Date.now() / 1000)
				return new Map(parsed.map((dTag: string) => [dTag, now]))
			}
			// New format: object with d-tag keys and timestamp values
			if (typeof parsed === 'object' && parsed !== null) {
				return new Map(Object.entries(parsed))
			}
		}
	} catch (e) {
		console.error('Failed to load deleted collection IDs from localStorage:', e)
	}
	return new Map()
}

const saveDeletedCollectionIds = (ids: Map<string, number>) => {
	try {
		localStorage.setItem(DELETED_COLLECTIONS_STORAGE_KEY, JSON.stringify(Object.fromEntries(ids)))
	} catch (e) {
		console.error('Failed to save deleted collection IDs to localStorage:', e)
	}
}

const deletedCollectionIds = loadDeletedCollectionIds()

export const markCollectionAsDeleted = (dTag: string, deletionTimestamp?: number) => {
	// Use provided timestamp or current time
	const timestamp = deletionTimestamp ?? Math.floor(Date.now() / 1000)
	deletedCollectionIds.set(dTag, timestamp)
	saveDeletedCollectionIds(deletedCollectionIds)
}

export const isCollectionDeleted = (dTag: string, eventCreatedAt?: number) => {
	const deletionTimestamp = deletedCollectionIds.get(dTag)
	if (deletionTimestamp === undefined) return false
	// If no event timestamp provided, assume deleted
	if (eventCreatedAt === undefined) return true
	// Per NIP-09: deletion only applies to events older than the deletion
	return eventCreatedAt < deletionTimestamp
}

const filterDeletedCollections = (events: NDKEvent[]): NDKEvent[] => {
	return events.filter((event) => {
		const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
		if (!dTag) return true
		return !isCollectionDeleted(dTag, event.created_at)
	})
}

// --- DATA FETCHING FUNCTIONS ---
/**
 * Fetches all collections
 * @returns Array of collection events sorted by creation date (blacklist filtered)
 */
export const fetchCollections = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, returning empty collections list')
		return []
	}

	const filter: NDKFilter = {
		kinds: [30405 as NDKKind], // Product listings in Nostr
		limit: 50,
	}

	// Use timeout helper to prevent hanging if relays don't respond
	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 10000 })
	const allEvents = Array.from(events)

	// Filter out blacklisted collections and authors, then filter out locally-deleted collections
	const filteredEvents = filterDeletedCollections(filterBlacklistedEvents(allEvents))

	// Filter out system collections (featured products list)
	return filteredEvents.filter((event) => {
		const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
		return dTag !== FEATURED_ITEMS_CONFIG.PRODUCTS.dTag
	})
}
/**
 * Fetches all collections from a specific pubkey
 * @param pubkey The pubkey of the user
 * @returns Array of collection events sorted by creation date (blacklist filtered)
 */
export const fetchCollectionsByPubkey = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, returning empty collections by pubkey list')
		return []
	}

	const filter: NDKFilter = {
		kinds: [30405 as NDKKind], // Collections
		authors: [pubkey],
		limit: 50,
	}

	// Use timeout helper to prevent hanging if relays don't respond
	const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 10000 })
	const allEvents = Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

	// Filter out blacklisted collections (author check not needed since we're querying by author)
	// Then filter out locally-deleted collections
	const filteredEvents = filterDeletedCollections(filterBlacklistedEvents(allEvents))

	// Filter out system collections (featured products list)
	return filteredEvents.filter((event) => {
		const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
		return dTag !== FEATURED_ITEMS_CONFIG.PRODUCTS.dTag
	})
}

/**
 * Fetches a single collection listing by d-tag
 * @param dTag The d-tag identifier of the collection
 * @returns The collection listing event
 */
export const fetchCollection = async (dTag: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, cannot fetch collection')
		return null
	}
	if (!dTag) return null

	const filter: NDKFilter = {
		kinds: [30405 as NDKKind],
		'#d': [dTag],
	}

	const events = await ndk.fetchEvents(filter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		return null
	}

	return eventArray[0]
}

/**
 * Fetches a single collection by event ID
 * @param id The event ID of the collection
 * @returns The collection event
 */
export const fetchCollectionByEventId = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, cannot fetch collection by event ID')
		return null
	}
	if (!id) return null

	const event = await ndk.fetchEvent({
		ids: [id],
	})

	if (!event || event.kind !== 30405) {
		return null
	}

	return event
}

/**
 * Fetches a collection by addressable tag (a-tag)
 * @param pubkey The pubkey of the author
 * @param dTag The d-tag identifier
 * @returns The collection event
 */
export const fetchCollectionByATag = async (pubkey: string, dTag: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not ready, cannot fetch collection by a-tag')
		return null
	}
	if (!pubkey || !dTag) return null

	const naddr = naddrFromAddress(30405, pubkey, dTag)
	return await ndk.fetchEvent(naddr)
}

/**
 * Fetches a collection by ID (supports both d-tag and event ID)
 * Tries d-tag first, then event ID if the input is 64 characters long
 * @param id The d-tag identifier or event ID of the collection
 * @returns The collection event or null if not found
 */
export const fetchCollectionById = async (id: string): Promise<NDKEvent | null> => {
	if (!id) return null

	// First try fetching by d-tag
	let collection = await fetchCollection(id)

	// If not found and input looks like an event ID (64 chars), try fetching by event ID
	if (!collection && id.length === 64) {
		collection = await fetchCollectionByEventId(id)
	}

	return collection
}

/**
 * Gets the collection title from an event
 */
export const getCollectionTitle = (event: NDKEvent | null): z.infer<typeof CollectionTitleTagSchema>[1] =>
	event?.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Collection'

/**
 * Get the collection summary from an event
 */
export const getCollectionSummary = (event: NDKEvent | null): z.infer<typeof CollectionSummaryTagSchema>[1] =>
	event?.tags.find((t) => t[0] === 'summary')?.[1] || 'No summary available.'

/**
 * Gets the collection ID from an event
 */
export const getCollectionId = (event: NDKEvent): string => {
	const dTag = event.tags.find((tag) => tag[0] === 'd')
	return dTag?.[1] || ''
}

export const getCollectionImages = (event: NDKEvent | null): z.infer<typeof CollectionImageTagSchema>[] => {
	if (!event) return []
	return event.tags
		.filter((t) => t[0] === 'image')
		.map((t) => t as z.infer<typeof CollectionImageTagSchema>)
		.sort((a, b) => {
			return 0
		})
}

/**
 * Gets the shipping option tags from a collection event
 * @param event The collection event or null
 * @returns An array of shipping option tuples with format [tag, shipping_reference, extra_cost?]
 */
export const getCollectionShippingOptions = (event: NDKEvent | null): Array<string[]> => {
	if (!event) return []
	return event.tags.filter((t) => t[0] === 'shipping_option')
}

/**
 * Creates collection coordinates string
 */
export const getCollectionCoordinates = (event: NDKEvent): string => {
	const id = getCollectionId(event)
	return `30405:${event.pubkey}:${id}`
}

// --- REACT QUERY OPTIONS ---

export const collectionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: collectionKeys.details(id),
		queryFn: () => fetchCollection(id),
		staleTime: 300000,
	})

/**
 * React Query options for fetching a collection by ID (supports both d-tag and event ID)
 * @param id The d-tag identifier or event ID
 * @returns Query options object
 */
export const collectionByIdQueryOptions = (id: string) =>
	queryOptions({
		queryKey: collectionKeys.details(id),
		queryFn: () => fetchCollectionById(id),
		staleTime: 300000,
	})

/**
 * React Query options for fetching a collection by addressable tag (a-tag)
 * @param pubkey The pubkey of the author
 * @param dTag The d-tag identifier
 * @returns Query options object
 */
export const collectionByATagQueryOptions = (pubkey: string, dTag: string) =>
	queryOptions({
		queryKey: collectionKeys.byATag(pubkey, dTag),
		queryFn: () => fetchCollectionByATag(pubkey, dTag),
		staleTime: 300000,
	})
/**
 * React Query options for fetching collections
 * @param id Collection ID
 * @returns Query options object
 */
export const collectionsQueryOptions = queryOptions({
	queryKey: collectionsKeys.all,
	queryFn: fetchCollections,
	staleTime: 30000, // Consider fresh for 30 seconds
	refetchOnMount: 'always', // Always refetch to pick up deletions
})

/**
 * React Query options for fetching collections by pubkey
 * @param pubkey User's pubkey
 */
export const collectionsByPubkeyQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: collectionsKeys.byPubkey(pubkey),
		queryFn: () => fetchCollectionsByPubkey(pubkey),
		enabled: !!pubkey,
	})

// --- HOOKS ---

/**
 * Hook to get collections by pubkey
 * @param pubkey User's pubkey
 * @returns Query result with an array of collection events
 */
export const useCollectionsByPubkey = (pubkey: string) => {
	return useQuery({
		...collectionsByPubkeyQueryOptions(pubkey),
	})
}

export const useCollectionTitle = (id: string) => {
	return useQuery({
		...collectionQueryOptions(id),
		select: getCollectionTitle,
	})
}

export const useCollectionImages = (id: string) => {
	return useQuery({
		...collectionQueryOptions(id),
		select: getCollectionImages,
	})
}
