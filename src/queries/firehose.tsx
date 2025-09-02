// queries for kind 1 feeds

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { noteKeys } from '@/queries/queryKeyFactory'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'

export const fetchNotes = async (): Promise<NDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [1], // kind 1 is text notes
		limit: 20,
	}

	// Ensure we query using the default relay URLs
	const relaySet = NDKRelaySet.fromRelayUrls(defaultRelaysUrls, ndk)
	const events = await ndk.fetchEvents(filter, undefined, relaySet)
	const notes = Array.from(events)
	return notes.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
}

export const fetchNote = async (id: string): Promise<NDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Post not found')
	}
	return event
}

export const noteQueryOptions = (id: string) =>
	queryOptions({
		queryKey: noteKeys.details(id),
		queryFn: () => fetchNote(id),
	})

export const notesQueryOptions = () =>
	queryOptions({
		queryKey: noteKeys.all,
		queryFn: () => fetchNotes(),
	})
