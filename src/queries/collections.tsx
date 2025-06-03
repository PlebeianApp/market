import { ndkActions } from '@/lib/stores/ndk'
import type { NDKFilter, NDKKind } from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { collectionsKeys } from './queryKeyFactory'

// --- DATA FETCHING FUNCTIONS ---

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
 * Gets the collection title from an event
 */
export const getCollectionTitle = (event: NDKEvent): string => {
	const titleTag = event.tags.find((tag) => tag[0] === 'title')
	return titleTag?.[1] || 'Untitled Collection'
}

/**
 * Gets the collection ID from an event
 */
export const getCollectionId = (event: NDKEvent): string => {
	const dTag = event.tags.find((tag) => tag[0] === 'd')
	return dTag?.[1] || ''
}

/**
 * Creates collection coordinates string
 */
export const getCollectionCoordinates = (event: NDKEvent): string => {
	const id = getCollectionId(event)
	return `30405:${event.pubkey}:${id}`
}

// --- QUERY OPTIONS ---

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
