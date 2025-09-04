// queries for kind 1 feeds

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { noteKeys } from '@/queries/queryKeyFactory'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'

// Wrapper type to include the timestamp of when the event was first fetched
export type FetchedNDKEvent = {
	event: NDKEvent
	fetchedAt: number // ms since epoch
}

// Keep a module-level cache to preserve the first-fetched timestamp per event id
const firstFetchTimestamps = new Map<string, number>()

function withFirstFetchedAt(e: NDKEvent): FetchedNDKEvent {
	const id = e.id as string
	const existing = id ? firstFetchTimestamps.get(id) : undefined
	const now = Date.now()
	const ts = existing ?? now
	if (id && existing === undefined) {
		firstFetchTimestamps.set(id, ts)
	}
	return { event: e, fetchedAt: ts }
}

export const fetchNotes = async (): Promise<FetchedNDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [1, 1111], // kind 1 is text notes, kind 1111 is replies
		limit: 20,
	}

	// Ensure we query using the default relay URLs
	const relaySet = NDKRelaySet.fromRelayUrls(defaultRelaysUrls, ndk)
	const events = await ndk.fetchEvents(filter, undefined, relaySet)
	const notes = Array.from(events)
	// Filter out any falsy events or events without an id to avoid downstream crashes
	const validNotes = notes.filter((e) => !!e && !!(e as any).id)
	// Map to include first-fetched timestamps and then sort by fetchedAt desc
	const wrapped = validNotes.map(withFirstFetchedAt)
	wrapped.sort((a, b) => b.fetchedAt - a.fetchedAt)
	return wrapped
}

export const fetchNote = async (id: string): Promise<FetchedNDKEvent> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const event = await ndk.fetchEvent(id)
	if (!event) {
		throw new Error('Post not found')
	}
	return withFirstFetchedAt(event)
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
