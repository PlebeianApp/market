import NDK from '@nostr-dev-kit/ndk'
import {
	NDKEvent,
	NDKRelaySet,
	NDKUser,
	type NDKEncryptionScheme,
	type NDKFilter,
	type NDKKind,
	type NDKSigner,
	type NDKTag,
} from '@nostr-dev-kit/ndk'
import { verifyEvent, type Event } from 'nostr-tools'

import type { FetchOptions, NostrFilter, NostrIo } from './io'

export { NDK as default, NDKEvent, NDKRelaySet, NDKUser }
export type { NDKEncryptionScheme, NDKFilter, NDKKind, NDKSigner, NDKTag }

type NdkEventContext = ConstructorParameters<typeof NDKEvent>[0]

export function rehydrateVerifiedNdkEvent(ndk: NdkEventContext, event: Event): NDKEvent | null {
	try {
		if (!verifyEvent(event)) return null
		return new NDKEvent(ndk, event)
	} catch {
		return null
	}
}

export async function fetchNdkEventSet(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
	opts?: FetchOptions,
): Promise<Set<NDKEvent>> {
	const rawEvents = await nostrIo.fetchEvents(filter as NostrFilter | NostrFilter[], opts)
	const eventsById = new Map<string, NDKEvent>()
	for (const event of rawEvents) {
		const ndkEvent = rehydrateVerifiedNdkEvent(ndk, event)
		if (ndkEvent && !eventsById.has(ndkEvent.id)) eventsById.set(ndkEvent.id, ndkEvent)
	}
	return new Set(eventsById.values())
}

/**
 * Fetch a single event for a filter with deterministic newest-wins selection.
 *
 * NDK's `fetchEvent` resolves a coordinate/replaceable kind to its newest
 * event regardless of which relay returns first. `fetchNdkEventSet` dedupes by
 * id (first arrival wins), which would make `limit: 1` replaceable reads
 * relay-arrival-order dependent. This helper restores the newest-wins contract
 * (created_at desc, event id asc as tiebreaker) for single-event coordinate
 * fetches.
 */
export async function fetchNdkEvent(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
	opts?: FetchOptions,
): Promise<NDKEvent | null> {
	const events = await fetchNdkEventSet(nostrIo, ndk, filter, opts)
	if (events.size === 0) return null
	return Array.from(events).sort((a, b) => {
		if ((b.created_at ?? 0) !== (a.created_at ?? 0)) return (b.created_at ?? 0) - (a.created_at ?? 0)
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
	})[0]
}

export function mergeNdkEventSetsById(...eventSets: Set<NDKEvent>[]): Set<NDKEvent> {
	const eventsById = new Map<string, NDKEvent>()
	for (const eventSet of eventSets) {
		for (const event of eventSet) {
			if (!eventsById.has(event.id)) eventsById.set(event.id, event)
		}
	}
	return new Set(eventsById.values())
}
