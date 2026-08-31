import { fetchLatestAppEvent, getMainRelay, ndkActions } from '@/lib/stores/ndk'
import { applesauceIo } from '@/lib/nostr/io'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { configKeys } from './queryKeyFactory'

export interface BlacklistSettings {
	blacklistedPubkeys: string[] // Array of blacklisted pubkeys in hex format
	blacklistedProducts: string[] // Array of blacklisted product coordinates
	blacklistedCollections: string[] // Array of blacklisted collection coordinates
	lastUpdated: number // Timestamp of last update
	event: NDKEvent | null // Raw blacklist event
}

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

	const latestEvent = await fetchLatestAppEvent({
		kinds: [10000], // NIP-51 mute list
		authors: [targetPubkey],
	})

	if (!latestEvent) {
		console.log(`No blacklist settings found for app pubkey: ${targetPubkey}`)
		// Return empty blacklist instead of null for consistency
		return {
			blacklistedPubkeys: [],
			blacklistedProducts: [],
			blacklistedCollections: [],
			lastUpdated: 0,
			event: null,
		}
	}

	// Extract blacklisted pubkeys from 'p' tags
	const blacklistedPubkeys = latestEvent.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1])

	// Extract blacklisted products from 'a' tags (kind 30402)
	const blacklistedProducts = latestEvent.tags.filter((tag) => tag[0] === 'a' && tag[1] && tag[1].startsWith('30402:')).map((tag) => tag[1])

	// Extract blacklisted collections from 'a' tags (kind 30405)
	const blacklistedCollections = latestEvent.tags
		.filter((tag) => tag[0] === 'a' && tag[1] && tag[1].startsWith('30405:'))
		.map((tag) => tag[1])

	return {
		blacklistedPubkeys,
		blacklistedProducts,
		blacklistedCollections,
		lastUpdated: latestEvent.created_at ?? 0,
		event: latestEvent,
	}
}

/**
 * Hook to fetch blacklist settings for the app
 */
export const useBlacklistSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor blacklist changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const blacklistFilter = {
			kinds: [10000], // NIP-51 mute list
			authors: [appPubkey],
		}

		let latestEventTime = 0
		let receivedEose = false

		// Live subscription goes through the applesauceIo seam (ADR-0002),
		// pinned to the app relay so stale copies from other relays in the
		// pool can't race the canonical answer. The latestEventTime /
		// receivedEose guards below handle any stale copies that slip through.
		const mainRelay = getMainRelay()
		if (!mainRelay) return

		const stop = applesauceIo.subscribe(
			blacklistFilter,
			(rawEvent) => {
				const eventTime = rawEvent.created_at ?? 0
				if (receivedEose && eventTime > latestEventTime) {
					queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
				}
				if (eventTime > latestEventTime) {
					latestEventTime = eventTime
				}
			},
			{
				closeOnEose: false, // Keep subscription open
				onEose: () => {
					receivedEose = true
				},
				relayUrls: [mainRelay],
			},
		)

		// Clean up subscription when unmounting
		return stop
	}, [appPubkey, ndk, queryClient])

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

/**
 * Check if a specific pubkey is blacklisted
 */
export const isBlacklisted = (blacklistSettings: BlacklistSettings | null | undefined, pubkey: string): boolean => {
	if (!blacklistSettings || !pubkey) return false
	return blacklistSettings.blacklistedPubkeys.includes(pubkey)
}

/**
 * Get formatted blacklist data for display
 */
export const getFormattedBlacklist = (blacklistSettings: BlacklistSettings | null | undefined) => {
	if (!blacklistSettings || !blacklistSettings.blacklistedPubkeys) return []

	return blacklistSettings.blacklistedPubkeys.map((pubkey) => ({
		pubkey,
		status: 'blacklisted' as const,
	}))
}
