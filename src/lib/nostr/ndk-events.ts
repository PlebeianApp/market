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

export async function fetchNdkEventSet(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
): Promise<Set<NDKEvent>> {
	const rawEvents = await nostrIo.fetchEvents(filter as NostrFilter | NostrFilter[])
	const eventsById = new Map<string, NDKEvent>()
	for (const event of rawEvents) {
		const ndkEvent = rehydrateVerifiedNdkEvent(ndk, event)
		if (ndkEvent && !eventsById.has(ndkEvent.id)) eventsById.set(ndkEvent.id, ndkEvent)
	}
	return new Set(eventsById.values())
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
