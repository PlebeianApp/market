import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
	buildVanityRegistryFilter,
	getExpiredVanityForPubkey,
	getVanityForPubkey,
	isVanityAvailable,
	parseVanitySettings,
	resolveVanity,
	type VanitySettings as SdkVanitySettings,
} from '@sdk/commerce/curation'
import { configKeys } from './queryKeyFactory'

export { getExpiredVanityForPubkey, getVanityForPubkey, isVanityAvailable, resolveVanity }
export type { VanityEntry } from '@sdk/commerce/curation'

export type VanitySettings = SdkVanitySettings<NDKEvent>

/**
 * Fetches vanity registry (kind 30000 with d=vanity-urls) for the app
 */
export const fetchVanitySettings = async (appPubkey?: string): Promise<VanitySettings | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// If no app pubkey provided, require it
	let targetPubkey = appPubkey
	if (!targetPubkey) {
		throw new Error('App pubkey is required')
	}

	const events = await ndk.fetchEvents(buildVanityRegistryFilter(targetPubkey, 1))
	const eventArray = Array.from(events)

	if (eventArray.length === 0) console.log(`No vanity registry found for app pubkey: ${targetPubkey}`)

	return parseVanitySettings(eventArray)
}

/**
 * Hook to fetch vanity settings for the app
 */
export const useVanitySettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor vanity changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const vanityFilter = buildVanityRegistryFilter(appPubkey)

		const subscription = ndk.subscribe(vanityFilter, {
			closeOnEose: false,
		})

		// Event handler for vanity updates
		subscription.on('event', (newEvent) => {
			queryClient.invalidateQueries({ queryKey: configKeys.vanity(appPubkey) })
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.vanity(appPubkey || ''),
		queryFn: () => fetchVanitySettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}
