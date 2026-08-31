import { NDKEvent, NDKKind, type NDKFilter, type NDKSigner, type NDKUser } from '@nostr-dev-kit/ndk'
import { nip19, verifyEvent, type Event } from 'nostr-tools'

import type { FetchOptions, NostrFilter, NostrIo } from './io'

export { NDKEvent, NDKKind }
export type { NDKFilter, NDKSigner, NDKUser }

const NIP33_A_REGEX = /^(\d+):([0-9A-Fa-f]+)(?::(.*))?$/
const BECH32_REGEX = /^n(event|ote|profile|pub|addr)1[\d\w]+$/

/**
 * Mirrors NDK's internal `filterFromId` so `ndk.fetchEvent(id)` call sites keep
 * identical filters when routed through the seam: `kind:pubkey[:d]` NIP-33
 * coordinates, bech32 entities (nevent/note/naddr), or a bare `{ ids: [id] }`.
 */
export function ndkFilterFromId(id: string): NDKFilter {
	if (NIP33_A_REGEX.test(id)) {
		const [kind, pubkey, identifier] = id.split(':')
		const filter: NDKFilter = { authors: [pubkey], kinds: [Number.parseInt(kind)] }
		if (identifier) filter['#d'] = [identifier]
		return filter
	}
	if (BECH32_REGEX.test(id)) {
		try {
			const decoded = nip19.decode(id)
			if (decoded.type === 'nevent') {
				const filter: NDKFilter = { ids: [decoded.data.id] }
				if (decoded.data.author) filter.authors = [decoded.data.author]
				if (decoded.data.kind) filter.kinds = [decoded.data.kind]
				return filter
			}
			if (decoded.type === 'note') return { ids: [decoded.data] }
			if (decoded.type === 'naddr') {
				const filter: NDKFilter = { authors: [decoded.data.pubkey], kinds: [decoded.data.kind] }
				if (decoded.data.identifier) filter['#d'] = [decoded.data.identifier]
				return filter
			}
		} catch {
			// Fall through to the bare-ids filter, exactly like NDK does.
		}
	}
	return { ids: [id] }
}

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

/** First matching event from a seam fetch, or null when nothing matched. */
export async function fetchNdkEvent(
	nostrIo: Pick<NostrIo, 'fetchEvents'>,
	ndk: NdkEventContext,
	filter: NDKFilter | NDKFilter[],
	opts?: FetchOptions,
): Promise<NDKEvent | null> {
	const events = await fetchNdkEventSet(nostrIo, ndk, filter, opts)
	return events.size > 0 ? Array.from(events)[0] : null
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
