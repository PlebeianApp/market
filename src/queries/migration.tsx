import { ndkActions } from '@/lib/stores/ndk'
import { configStore } from '@/lib/stores/config'
import { migrationKeys } from '@/queries/queryKeyFactory'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'

export { migrationKeys }

/**
 * Fetches user's relay list (kind 10002)
 */
export const fetchUserRelayList = async (userPubkey: string): Promise<string[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents({
		kinds: [10002],
		authors: [userPubkey],
		limit: 1,
	})

	if (events.size === 0) {
		return []
	}

	// Get the most recent relay list event
	let mostRecentEvent: NDKEvent | undefined
	let mostRecentTimestamp = 0
	events.forEach((event) => {
		if (event.created_at && event.created_at > mostRecentTimestamp) {
			mostRecentEvent = event
			mostRecentTimestamp = event.created_at
		}
	})

	if (!mostRecentEvent) {
		return []
	}

	// Extract relay URLs from 'r' tags
	const relayUrls: string[] = []
	mostRecentEvent.tags.forEach((tag) => {
		if (tag[0] === 'r' && tag[1]) {
			relayUrls.push(tag[1])
		}
	})

	return relayUrls
}

/**
 * Fetches NIP-15 product events (kind 30018) from user's relay list
 */
export const fetchNip15Products = async (userPubkey: string): Promise<NDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Get user's relay list
	const userRelays = await fetchUserRelayList(userPubkey)

	// If no relay list, use default relays
	const relaysToUse = userRelays.length > 0 ? userRelays : ndk.explicitRelayUrls || []

	// Temporarily add user's relays to NDK
	if (userRelays.length > 0) {
		try {
			ndkActions.addExplicitRelay(userRelays)
		} catch (error) {
			console.error('Failed to add user relays:', error)
		}
	}

	const filter: NDKFilter = {
		kinds: [30018], // NIP-15 product kind
		authors: [userPubkey],
		limit: 100,
	}

	try {
		const events = await ndk.fetchEvents(filter)
		return Array.from(events)
	} catch (error) {
		console.error('Failed to fetch NIP-15 products:', error)
		return []
	}
}

/**
 * Fetches already migrated events (NIP-99 events with "migrated" tag)
 */
export const fetchMigratedEvents = async (userPubkey: string): Promise<Set<string>> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const appRelay = configStore.state.config.appRelay
	if (!appRelay) {
		console.warn('No app relay configured, cannot check migrated events')
		return new Set()
	}

	// Ensure app relay is added
	try {
		ndkActions.addExplicitRelay([appRelay])
	} catch (error) {
		console.error('Failed to add app relay:', error)
	}

	const filter: NDKFilter = {
		kinds: [30402], // NIP-99 product kind
		authors: [userPubkey],
		'#migrated': [], // Events with "migrated" tag
		limit: 1000,
	}

	try {
		const events = await ndk.fetchEvents(filter)
		const migratedOriginalIds = new Set<string>()

		events.forEach((event) => {
			// Find the "migrated" tag which should contain the original NIP-15 event ID
			const migratedTag = event.tags.find((tag) => tag[0] === 'migrated')
			if (migratedTag && migratedTag[1]) {
				migratedOriginalIds.add(migratedTag[1])
			}
		})

		return migratedOriginalIds
	} catch (error) {
		console.error('Failed to fetch migrated events:', error)
		return new Set()
	}
}

/**
 * React Query options for fetching NIP-15 products
 */
export const nip15ProductsQueryOptions = (userPubkey: string) => {
	return queryOptions({
		queryKey: migrationKeys.nip15Products(userPubkey),
		queryFn: () => fetchNip15Products(userPubkey),
		enabled: !!userPubkey,
	})
}

/**
 * React Query options for fetching migrated events
 */
export const migratedEventsQueryOptions = (userPubkey: string) => {
	return queryOptions({
		queryKey: migrationKeys.migratedEvents(userPubkey),
		queryFn: () => fetchMigratedEvents(userPubkey),
		enabled: !!userPubkey,
	})
}
