import { applesauceIo, type NostrFilter } from '@/lib/nostr/io'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { createMemoryEventStore, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'

// Raw-event reads (the applesauce seam used by auctions) get their own store; NDKEvent reads use ndkReadContext.
const rawEventStore = createMemoryEventStore<NostrEventLike>()

export function getRawEventStore(): EventStorePort<NostrEventLike> {
	return rawEventStore
}

export function createApplesauceReadContext(): EventReadContext<NostrEventLike> {
	return {
		store: rawEventStore,
		fetch: (filters) => applesauceIo.fetchEvents(filters.length === 1 ? (filters[0] as NostrFilter) : (filters as NostrFilter[])),
	}
}
