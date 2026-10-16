import { fetchLatestAppEvent, getAppRelaySet, ndkActions } from '@/lib/stores/ndk'
import type { FeaturedProducts, FeaturedCollections, FeaturedAuctions, FeaturedUsers } from '@/lib/schemas/featured'
import { configKeys } from '@/queries/queryKeyFactory'
import {
	buildCurationListFilter,
	parseFeaturedAuctions,
	parseFeaturedCollections,
	parseFeaturedProducts,
	parseFeaturedUsers,
	type FeaturedListKey,
} from '@sdk/commerce/curation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { filterBlacklistedProductCoords, filterBlacklistedCollectionCoords, filterBlacklistedPubkeys } from '@/lib/utils/blacklistFilters'

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches featured products settings (kind 30405)
 * @param appPubkey The app's pubkey
 * @returns Featured products data or null
 */
export const fetchFeaturedProducts = async (appPubkey: string): Promise<FeaturedProducts | null> => {
	const event = await fetchLatestAppEvent(buildCurationListFilter('featuredProducts', appPubkey))
	return event ? parseFeaturedProducts(event, filterBlacklistedProductCoords) : null
}

/**
 * Fetches featured collections settings (kind 30003)
 * @param appPubkey The app's pubkey
 * @returns Featured collections data or null
 */
export const fetchFeaturedCollections = async (appPubkey: string): Promise<FeaturedCollections | null> => {
	const event = await fetchLatestAppEvent(buildCurationListFilter('featuredCollections', appPubkey))
	return event ? parseFeaturedCollections(event, filterBlacklistedCollectionCoords) : null
}

/**
 * Fetches featured auctions settings (kind 30409)
 * @param appPubkey The app's pubkey
 * @returns Featured auctions data or null
 */
export const fetchFeaturedAuctions = async (appPubkey: string): Promise<FeaturedAuctions | null> => {
	const event = await fetchLatestAppEvent(buildCurationListFilter('featuredAuctions', appPubkey))
	return event ? parseFeaturedAuctions(event, filterBlacklistedPubkeys) : null
}

/**
 * Fetches featured users settings (kind 30000)
 * @param appPubkey The app's pubkey
 * @returns Featured users data or null
 */
export const fetchFeaturedUsers = async (appPubkey: string): Promise<FeaturedUsers | null> => {
	const event = await fetchLatestAppEvent(buildCurationListFilter('featuredUsers', appPubkey))
	return event ? parseFeaturedUsers(event, filterBlacklistedPubkeys) : null
}

// --- REACT QUERY HOOKS ---

const useFeaturedSettingsSubscription = (appPubkey: string, queryKey: readonly unknown[], list: FeaturedListKey) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	useEffect(() => {
		if (!appPubkey || !ndk) return

		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(buildCurationListFilter(list, appPubkey), {
			closeOnEose: false,
			relaySet: getAppRelaySet(),
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
		})

		subscription.on('event', (event) => {
			const eventTime = event.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				void queryClient.invalidateQueries({ queryKey })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		return () => {
			subscription.stop()
		}
	}, [appPubkey, list, ndk, queryClient, queryKey])
}

/**
 * Hook to fetch featured products
 */
export const useFeaturedProducts = (appPubkey: string) => {
	const queryKey = configKeys.featuredProducts(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredProducts')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedProducts(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured collections
 */
export const useFeaturedCollections = (appPubkey: string) => {
	const queryKey = configKeys.featuredCollections(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredCollections')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedCollections(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured auctions
 */
export const useFeaturedAuctions = (appPubkey: string) => {
	const queryKey = configKeys.featuredAuctions(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredAuctions')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedAuctions(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured users
 */
export const useFeaturedUsers = (appPubkey: string) => {
	const queryKey = configKeys.featuredUsers(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredUsers')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedUsers(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}
