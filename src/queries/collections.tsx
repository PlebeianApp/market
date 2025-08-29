import { CollectionTitleTagSchema, CollectionImageTagSchema, CollectionSummaryTagSchema } from '@/lib/schemas/productCollection.ts'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter, NDKKind } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { collectionsKeys } from './queryKeyFactory'
import { collectionKeys } from './queryKeyFactory'
import { z } from 'zod'
import {
	fetchProductByATag,
	productByATagQueryOptions,
	productKeys,
	fetchProductsByCollection,
	productsByCollectionQueryOptions,
	useProductsByCollection,
} from '@/queries/products.tsx'
import { getCoordsForATag } from '@/lib/utils/coords.ts'

// --- DATA FETCHING FUNCTIONS ---
/**
 * Fetches all collections
 * @returns Array of collection events sorted by creation date
 */
export const fetchCollections = async () => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30405 as NDKKind], // Product listings in Nostr
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}
/**
 * Fetches all collections from a specific pubkey
 * @param pubkey The pubkey of the user
 * @returns Array of collection events sorted by creation date
 */
export const fetchCollectionsByPubkey = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30405 as NDKKind], // Collections
		authors: [pubkey],
		limit: 50,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

/**
 * Fetches a single collection listing
 * @param id The ID of the collection listing
 * @returns The collection listing event
 */
export const fetchCollection = async (id: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!id) return null
	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Product not found')
	}
	return event
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
 * React Query options for fetching collections
 * @param id Collection ID
 * @returns Query options object
 */
export const collectionsQueryOptions = queryOptions({
	queryKey: collectionsKeys.all,
	queryFn: fetchCollections,
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
