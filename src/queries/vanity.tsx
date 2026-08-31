import { ndkActions } from '@/lib/stores/ndk'
import { applesauceIo } from '@/lib/nostr/io'
import { fetchLatestNdkEvent, type NDKEvent, type NDKFilter } from '@/lib/nostr/ndk-events'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { configKeys } from './queryKeyFactory'

export interface VanityEntry {
	vanityName: string
	pubkey: string
	validUntil: number
}

export interface VanitySettings {
	entries: VanityEntry[]
	lastUpdated: number
	event: NDKEvent | null
}

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

	const vanityFilter: NDKFilter = {
		kinds: [30000],
		authors: [targetPubkey],
		'#d': ['vanity-urls'],
		limit: 1,
	}

	// Relay reads go through the applesauceIo seam (ADR-0002); raw events are
	// verified and rehydrated into NDKEvents so consumer shapes stay identical.
	// Conflicting replaceable versions resolve deterministically to the newest
	// created_at (fetchLatestNdkEvent — NDK dedup-key parity, relay-arrival
	// order must not decide which copy wins).
	const latestEvent = await fetchLatestNdkEvent(applesauceIo, ndk, vanityFilter)

	if (!latestEvent) {
		console.log(`No vanity registry found for app pubkey: ${targetPubkey}`)
		// Return empty registry
		return {
			entries: [],
			lastUpdated: 0,
			event: null,
		}
	}

	// Extract vanity entries from 'vanity' tags
	// Format: ["vanity", vanityName, pubkey, validUntil]
	const entries = latestEvent.tags
		.filter((tag) => tag[0] === 'vanity' && tag[1] && tag[2] && tag[3])
		.map((tag) => ({
			vanityName: tag[1].toLowerCase(),
			pubkey: tag[2],
			validUntil: parseInt(tag[3]) || 0,
		}))

	return {
		entries,
		lastUpdated: latestEvent.created_at ?? 0,
		event: latestEvent,
	}
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

		const vanityFilter = {
			kinds: [30000],
			authors: [appPubkey],
			'#d': ['vanity-urls'],
		}

		// Live subscription goes through the applesauceIo seam (ADR-0002).
		// Unpinned, like the previous NDK pool subscription.
		const stop = applesauceIo.subscribe(
			vanityFilter,
			() => {
				// Event handler for vanity updates
				queryClient.invalidateQueries({ queryKey: configKeys.vanity(appPubkey) })
			},
			{ closeOnEose: false },
		)

		// Clean up subscription when unmounting
		return stop
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

/**
 * Check if a vanity name is available (client-side check)
 */
export const isVanityAvailable = (vanitySettings: VanitySettings | null | undefined, vanityName: string): boolean => {
	if (!vanityName) return false

	const now = Math.floor(Date.now() / 1000)
	const normalized = vanityName.toLowerCase()

	if (!vanitySettings || !vanitySettings.entries) return true

	const existing = vanitySettings.entries.find((e) => e.vanityName === normalized)

	if (!existing) return true

	// Available if expired
	return existing.validUntil < now
}

/**
 * Resolve a vanity name to a pubkey
 */
export const resolveVanity = (vanitySettings: VanitySettings | null | undefined, vanityName: string): VanityEntry | null => {
	if (!vanitySettings || !vanitySettings.entries || !vanityName) return null

	const now = Math.floor(Date.now() / 1000)
	const normalized = vanityName.toLowerCase()

	const entry = vanitySettings.entries.find((e) => e.vanityName === normalized)

	if (!entry) return null

	// Check if expired
	if (entry.validUntil < now) return null

	return entry
}

/**
 * Get vanity entry for a pubkey
 */
export const getVanityForPubkey = (vanitySettings: VanitySettings | null | undefined, pubkey: string): VanityEntry | null => {
	if (!vanitySettings || !vanitySettings.entries || !pubkey) return null

	const now = Math.floor(Date.now() / 1000)

	const entry = vanitySettings.entries.find((e) => e.pubkey === pubkey && e.validUntil > now)

	return entry || null
}

/**
 * Get expired vanity entries for a pubkey (for renewal)
 */
export const getExpiredVanityForPubkey = (vanitySettings: VanitySettings | null | undefined, pubkey: string): VanityEntry[] => {
	if (!vanitySettings || !vanitySettings.entries || !pubkey) return []

	const now = Math.floor(Date.now() / 1000)

	return vanitySettings.entries.filter((e) => e.pubkey === pubkey && e.validUntil <= now)
}
