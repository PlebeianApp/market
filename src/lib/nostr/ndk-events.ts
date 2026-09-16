import { NDKEvent, type NDKFilter, type NDKSigner } from '@nostr-dev-kit/ndk'
import { verifyEvent, type Event } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'

import type { FetchOptions, NostrFilter, NostrIo } from './io'

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
	opts?: FetchOptions,
): Promise<Set<NDKEvent>> {
	const rawEvents = await nostrIo.fetchEvents(filter as NostrFilter | NostrFilter[], opts)
	// Dedupe on NDK's coordinate-level identity, not the raw event id: replaceable
	// (kind 0/3/1e4-2e4 -> `kind:pubkey`) and parameterized replaceable
	// (kind 3e4-4e4 -> `kind:pubkey:d`) events are versions of one logical event,
	// so conflicting copies collected from different relays must collapse to a
	// single latest-wins winner instead of leaking in relay-arrival order.
	return rehydrateAndMergeNdkEvents(ndk, rawEvents)
}

/**
 * Merge already-rehydrated event collections under the same coordinate-level
 * latest-wins rule `fetchNdkEventSet` applies. Callers that collect results
 * from more than one relay in a single logical read (the bounded author-relay
 * path in `authorRelayRead.ts`) MUST merge through this helper so ordering
 * semantics do not fork per relay class.
 */
export function mergeNdkEventSets(...eventCollections: Array<ReadonlyArray<NDKEvent>>): Set<NDKEvent> {
	const eventsByKey = new Map<string, NDKEvent>()
	for (const collection of eventCollections) {
		for (const event of collection) {
			const key = event.deduplicationKey()
			const existing = eventsByKey.get(key)
			if (!existing || isNewerEvent(event, existing)) eventsByKey.set(key, event)
		}
	}
	return new Set(eventsByKey.values())
}

/** Signature-verify raw events, then collapse them by coordinate (latest wins). */
function rehydrateAndMergeNdkEvents(ndk: NdkEventContext, rawEvents: NostrEvent[]): Set<NDKEvent> {
	const verified: NDKEvent[] = []
	for (const event of rawEvents) {
		const ndkEvent = rehydrateVerifiedNdkEvent(ndk, event)
		if (ndkEvent) verified.push(ndkEvent)
	}
	return mergeNdkEventSets(verified)
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
