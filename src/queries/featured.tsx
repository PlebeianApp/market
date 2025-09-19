import { ndkActions } from '@/lib/stores/ndk'
import { FEATURED_ITEMS_CONFIG } from '@/lib/schemas/featured'
import type { FeaturedProducts, FeaturedCollections, FeaturedUsers } from '@/lib/schemas/featured'
import { configKeys } from '@/queries/queryKeyFactory'
import type { NDKFilter, NDKKind } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches featured products settings (kind 30405)
 * @param appPubkey The app's pubkey
 * @returns Featured products data or null
 */
export const fetchFeaturedProducts = async (appPubkey: string): Promise<FeaturedProducts | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [FEATURED_ITEMS_CONFIG.PRODUCTS.kind as NDKKind],
		authors: [appPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.PRODUCTS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const event = Array.from(events)[0]

	if (!event) return null

	// Extract product coordinates from 'a' tags
	const featuredProducts = event.tags.filter((tag) => tag[0] === 'a' && tag[1]?.startsWith('30402:')).map((tag) => tag[1])

	return {
		featuredProducts,
		lastUpdated: event.created_at || Date.now() / 1000,
	}
}

/**
 * Fetches featured collections settings (kind 30003)
 * @param appPubkey The app's pubkey
 * @returns Featured collections data or null
 */
export const fetchFeaturedCollections = async (appPubkey: string): Promise<FeaturedCollections | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [FEATURED_ITEMS_CONFIG.COLLECTIONS.kind as NDKKind],
		authors: [appPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.COLLECTIONS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const event = Array.from(events)[0]

	if (!event) return null

	// Extract collection coordinates from 'a' tags
	const featuredCollections = event.tags.filter((tag) => tag[0] === 'a' && tag[1]?.startsWith('30405:')).map((tag) => tag[1])

	return {
		featuredCollections,
		lastUpdated: event.created_at || Date.now() / 1000,
	}
}

/**
 * Fetches featured users settings (kind 30000)
 * @param appPubkey The app's pubkey
 * @returns Featured users data or null
 */
export const fetchFeaturedUsers = async (appPubkey: string): Promise<FeaturedUsers | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [FEATURED_ITEMS_CONFIG.USERS.kind as NDKKind],
		authors: [appPubkey],
		'#d': [FEATURED_ITEMS_CONFIG.USERS.dTag],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	const event = Array.from(events)[0]

	if (!event) return null

	// Extract user pubkeys from 'p' tags
	const featuredUsers = event.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])

	return {
		featuredUsers,
		lastUpdated: event.created_at || Date.now() / 1000,
	}
}

// --- REACT QUERY HOOKS ---

/**
 * Hook to fetch featured products
 */
export const useFeaturedProducts = (appPubkey: string) => {
	return useQuery({
		queryKey: configKeys.featuredProducts(appPubkey),
		queryFn: () => fetchFeaturedProducts(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured collections
 */
export const useFeaturedCollections = (appPubkey: string) => {
	return useQuery({
		queryKey: configKeys.featuredCollections(appPubkey),
		queryFn: () => fetchFeaturedCollections(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured users
 */
export const useFeaturedUsers = (appPubkey: string) => {
	return useQuery({
		queryKey: configKeys.featuredUsers(appPubkey),
		queryFn: () => fetchFeaturedUsers(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}
