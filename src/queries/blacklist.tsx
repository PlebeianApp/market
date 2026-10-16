import { fetchLatestAppEvent, getMainRelay, ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
	buildBlacklistFilter,
	getFormattedBlacklist,
	isBlacklisted,
	parseBlacklistSettings,
	type BlacklistSettings as SdkBlacklistSettings,
} from '@sdk/commerce/curation'
import { configKeys } from './queryKeyFactory'

export { getFormattedBlacklist, isBlacklisted }

export type BlacklistSettings = SdkBlacklistSettings<NDKEvent>

/**
 * Fetches blacklist settings (kind 10000) for the app
 */
export const fetchBlacklistSettings = async (appPubkey?: string): Promise<BlacklistSettings | null> => {
	// If no app pubkey provided, try to get it from config
	let targetPubkey = appPubkey
	if (!targetPubkey) {
		// We could get this from config, but for now require it to be passed
		throw new Error('App pubkey is required')
	}

	const latestEvent = await fetchLatestAppEvent(buildBlacklistFilter(targetPubkey))

	if (!latestEvent) console.log(`No blacklist settings found for app pubkey: ${targetPubkey}`)

	return parseBlacklistSettings(latestEvent)
}

/**
 * Hook to fetch blacklist settings for the app
 */
export const useBlacklistSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const mainRelay = getMainRelay()

	// Set up a live subscription to monitor blacklist changes
	useEffect(() => {
		if (!appPubkey || !ndk || !mainRelay) return

		const blacklistFilter = buildBlacklistFilter(appPubkey)

		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(blacklistFilter, {
			closeOnEose: false, // Keep subscription open
			relayUrls: [mainRelay],
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
		})

		// Event handler for blacklist updates - only react to newer events after EOSE
		subscription.on('event', (newEvent) => {
			const eventTime = newEvent.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, mainRelay, queryClient])

	return useQuery({
		queryKey: configKeys.blacklist(appPubkey || ''),
		queryFn: () => fetchBlacklistSettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000, // Consider data stale after 30 seconds
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}
