import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { configKeys } from './queryKeyFactory'

export interface Nip05Entry {
	username: string
	pubkey: string
	validUntil: number
}

export interface Nip05Settings {
	entries: Nip05Entry[]
	lastUpdated: number
	event: NDKEvent | null
}

/**
 * Fetches NIP-05 registry (kind 30000 with d=nip05-names) for the app
 */
export const fetchNip05Settings = async (appPubkey?: string): Promise<Nip05Settings | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	let targetPubkey = appPubkey
	if (!targetPubkey) {
		throw new Error('App pubkey is required')
	}

	const nip05Filter: NDKFilter = {
		kinds: [30000],
		authors: [targetPubkey],
		'#d': ['nip05-names'],
		limit: 1,
	}

	const events = await ndk.fetchEvents(nip05Filter)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		return {
			entries: [],
			lastUpdated: 0,
			event: null,
		}
	}

	// Get the latest event
	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]

	// Extract nip05 entries from 'nip05' tags
	// Format: ["nip05", username, pubkey, validUntil]
	const entries = latestEvent.tags
		.filter((tag) => tag[0] === 'nip05' && tag[1] && tag[2] && tag[3])
		.map((tag) => ({
			username: tag[1].toLowerCase(),
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
 * Hook to fetch NIP-05 settings for the app
 */
export const useNip05Settings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor nip05 changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const nip05Filter = {
			kinds: [30000],
			authors: [appPubkey],
			'#d': ['nip05-names'],
		}

		const subscription = ndk.subscribe(nip05Filter, {
			closeOnEose: false,
		})

		subscription.on('event', () => {
			queryClient.invalidateQueries({ queryKey: configKeys.nip05(appPubkey) })
		})

		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.nip05(appPubkey || ''),
		queryFn: () => fetchNip05Settings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}

/**
 * Check if a NIP-05 username is available (client-side check)
 */
export const isNip05Available = (nip05Settings: Nip05Settings | null | undefined, username: string): boolean => {
	if (!username) return false

	const now = Math.floor(Date.now() / 1000)
	const normalized = username.toLowerCase()

	if (!nip05Settings || !nip05Settings.entries) return true

	const existing = nip05Settings.entries.find((e) => e.username === normalized)

	if (!existing) return true

	// Available if expired
	return existing.validUntil < now
}

/**
 * Get NIP-05 entry for a pubkey
 */
export const getNip05ForPubkey = (nip05Settings: Nip05Settings | null | undefined, pubkey: string): Nip05Entry | null => {
	if (!nip05Settings || !nip05Settings.entries || !pubkey) return null

	const now = Math.floor(Date.now() / 1000)

	const entry = nip05Settings.entries.find((e) => e.pubkey === pubkey && e.validUntil > now)

	return entry || null
}

/**
 * Get expired NIP-05 entries for a pubkey (for renewal)
 */
export const getExpiredNip05ForPubkey = (nip05Settings: Nip05Settings | null | undefined, pubkey: string): Nip05Entry[] => {
	if (!nip05Settings || !nip05Settings.entries || !pubkey) return []

	const now = Math.floor(Date.now() / 1000)

	return nip05Settings.entries.filter((e) => e.pubkey === pubkey && e.validUntil <= now)
}
