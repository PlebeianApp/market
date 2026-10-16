import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter } from '@/lib/nostr/ndk-events'
import { createMemoryEventStore, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'

// The browser host is one market instance, so module scope is the instance boundary for its store.
const ndkEventStore = createMemoryEventStore<NDKEvent>()

export function getNdkEventStore(): EventStorePort<NDKEvent> {
	return ndkEventStore
}

/** Platform adapter: SDK read workflows fetch through the host's NDK relay policy and merge into the shared store. */
export function createNdkReadContext(timeoutMs = 8000): EventReadContext<NDKEvent> {
	return {
		store: ndkEventStore,
		fetch: async (filters) => {
			const ndkFilters = filters as NDKFilter[]
			return Array.from(await ndkActions.fetchEventsWithTimeout(ndkFilters.length === 1 ? ndkFilters[0] : ndkFilters, { timeoutMs }))
		},
	}
}
