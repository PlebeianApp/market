import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { configKeys } from './queryKeyFactory'

export interface Nip05Entry {
	username: string
	pubkey: string
	validUntil: number
	isUnified?: boolean
}

export interface Nip05Settings {
	entries: Nip05Entry[]
	lastUpdated: number
	event: NDKEvent | null
}

/**
 * Fetches NIP-05 registry (kind 30000 with d=nip05-names) for the app
 */
export const fetchNip05Settings = async (appPubkey?: string, handlerId?: string): Promise<Nip05Settings | null> => {
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
	const unifiedDTag = `${handlerId || 'plebeian-market-handler'}-storefront-names`
	const unifiedFilter: NDKFilter = { ...nip05Filter, '#d': [unifiedDTag] }

	const [legacyEvents, unifiedEvents] = await Promise.all([ndk.fetchEvents(nip05Filter), ndk.fetchEvents(unifiedFilter)])
	const eventArray = [...legacyEvents, ...unifiedEvents].sort(
		(a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id),
	)

	if (eventArray.length === 0) {
		return {
			entries: [],
			lastUpdated: 0,
			event: null,
		}
	}

	const entriesByName = new Map<string, Nip05Entry>()
	const now = Math.floor(Date.now() / 1000)
	for (const event of [...eventArray].reverse()) {
		const isUnified = event.tags.some((tag) => tag[0] === 'd' && tag[1] === unifiedDTag)
		const entries = isUnified
			? event.tags
					.filter((tag) => tag[0] === 'name' && tag[1] && tag[2] && tag[3])
					.map((tag) => ({
						username: tag[1].toLowerCase(),
						pubkey: tag[2],
						validUntil: Number.parseInt(tag[3], 10) || 0,
						isUnified: true,
					}))
			: event.tags
					.filter((tag) => tag[0] === 'nip05' && tag[1] && tag[2] && tag[3])
					.map((tag) => ({
						username: tag[1].toLowerCase(),
						pubkey: tag[2],
						validUntil: Number.parseInt(tag[3], 10) || 0,
						isUnified: false,
					}))
		for (const entry of entries) {
			const current = entriesByName.get(entry.username)
			if (!current || (entry.isUnified && (entry.validUntil > now || current.validUntil <= now))) {
				entriesByName.set(entry.username, entry)
			}
		}
	}

	return {
		entries: Array.from(entriesByName.values()),
		lastUpdated: eventArray[0].created_at ?? 0,
		event: eventArray[0],
	}
}

/**
 * Hook to fetch NIP-05 settings for the app
 */
export const useNip05Settings = (appPubkey?: string, handlerId?: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor nip05 changes
	useEffect(() => {
		if (!appPubkey || !ndk) return

		const nip05Filter = {
			kinds: [30000],
			authors: [appPubkey],
			'#d': ['nip05-names', `${handlerId || 'plebeian-market-handler'}-storefront-names`],
		}

		const subscription = ndk.subscribe(nip05Filter, {
			closeOnEose: false,
		})

		subscription.on('event', () => {
			queryClient.invalidateQueries({ queryKey: configKeys.nip05(appPubkey, handlerId) })
		})

		return () => {
			subscription.stop()
		}
	}, [appPubkey, handlerId, ndk, queryClient])

	return useQuery({
		queryKey: configKeys.nip05(appPubkey || '', handlerId),
		queryFn: () => fetchNip05Settings(appPubkey, handlerId),
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
