import { NDKEvent, type NDKFilter, type NDKSigner } from '@nostr-dev-kit/ndk'
import { verifyEvent, type Event } from 'nostr-tools'

import type { NostrFilter, NostrIo } from './io'

export { NDKEvent }
export type { NDKFilter, NDKSigner }

type NdkEventContext = ConstructorParameters<typeof NDKEvent>[0]

export function rehydrateVerifiedNdkEvent(ndk: NdkEventContext, event: Event): NDKEvent | null {
	try {
		if (!verifyEvent(event)) return null
		return new NDKEvent(ndk, event)
	} catch {
		return null
	}
}

/**
 * Latest-wins ordering for two versions of the same deduplication-key event.
 * Higher `created_at` wins; on an equal timestamp the lexicographically lower
 * id wins (NIP-01 replaceable-event tie-break), so the winner never depends on
 * relay-arrival order.
 */
function isNewerEvent(candidate: NDKEvent, existing: NDKEvent): boolean {
	const candidateTime = candidate.created_at ?? 0
	const existingTime = existing.created_at ?? 0
	if (candidateTime !== existingTime) return candidateTime > existingTime
	return candidate.id < existing.id
}

export async function fetchNdkEventSet(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
): Promise<Set<NDKEvent>> {
	const rawEvents = await nostrIo.fetchEvents(filter as NostrFilter | NostrFilter[])
	// Dedupe on NDK's coordinate-level identity, not the raw event id: replaceable
	// (kind 0/3/1e4-2e4 -> `kind:pubkey`) and parameterized replaceable
	// (kind 3e4-4e4 -> `kind:pubkey:d`) events are versions of one logical event,
	// so conflicting copies collected from different relays must collapse to a
	// single latest-wins winner instead of leaking in relay-arrival order.
	const eventsByKey = new Map<string, NDKEvent>()
	for (const event of rawEvents) {
		const ndkEvent = rehydrateVerifiedNdkEvent(ndk, event)
		if (!ndkEvent) continue
		const key = ndkEvent.deduplicationKey()
		const existing = eventsByKey.get(key)
		if (!existing || isNewerEvent(ndkEvent, existing)) eventsByKey.set(key, ndkEvent)
	}
	return new Set(eventsByKey.values())
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
