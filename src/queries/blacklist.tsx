import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
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
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// If no app pubkey provided, try to get it from config
	let targetPubkey = appPubkey
	if (!targetPubkey) {
		// We could get this from config, but for now require it to be passed
		throw new Error('App pubkey is required')
	}

	const blacklistFilter: NDKFilter = {
		kinds: [10000], // NIP-51 mute list
		authors: [targetPubkey],
		limit: 1,
	}

	const events = await ndk.fetchEvents(blacklistFilter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
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

	// Get the latest blacklist event
	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]

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

		const subscription = ndk.subscribe(blacklistFilter, {
			closeOnEose: false, // Keep subscription open
		})

		// Event handler for blacklist updates
		subscription.on('event', (newEvent) => {
			queryClient.invalidateQueries({ queryKey: configKeys.blacklist(appPubkey) })
		})

		// Let NDK auto-start the subscription when handlers are set up
		// Do not call .start() explicitly to avoid initialization race conditions

		// Clean up subscription when unmounting
		return () => {
			try {
				if (subscription.stop) {
					subscription.stop()
				}
			} catch (error) {
				console.warn('useBlacklistSettings: Error stopping subscription:', error)
			}
		}
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
