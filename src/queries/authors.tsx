import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { authorKeys } from './queryKeyFactory'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'
import { configActions } from '@/lib/stores/config'

export type NostrAuthor = {
	id: string
	name?: string
	about?: string
	picture?: string
	nip05?: string
}

const transformEvent = (event: NDKEvent): NostrAuthor => {
	let parsed: any = {}
	try {
		parsed = JSON.parse(event.content || '{}')
	} catch (_) {
		parsed = {}
	}
	return {
		id: event.pubkey,
		// Prefer display_name (common in Nostr metadata) over name
		name: event.tags.find((t) => t[0] === 'name')?.[1] || parsed?.display_name || parsed?.name,
		about: parsed?.about,
		picture: parsed?.picture,
		nip05: parsed?.nip05,
	}
}

export const fetchAuthor = async (pubkey: string) => {
	const filter: NDKFilter = {
		kinds: [0], // kind 0 is metadata
		authors: [pubkey],
	}

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

 // Query using the app's relays, prioritizing the configured main relay alongside defaults
	const appRelay = configActions.getAppRelay()
	const allRelays = appRelay ? [...defaultRelaysUrls, appRelay] : defaultRelaysUrls
	const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)
	const events = await ndk.fetchEvents(filter, undefined, relaySet)
	const eventArray = Array.from(events)

	if (eventArray.length === 0) {
		// Gracefully return a minimal author object if no metadata is found.
		return { id: pubkey }
	}

	// Get the most recent metadata event
	const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
	return transformEvent(latestEvent)
}

export const authorQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: authorKeys.details(pubkey),
		queryFn: () => fetchAuthor(pubkey),
	})
