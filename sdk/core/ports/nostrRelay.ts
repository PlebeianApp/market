import type { NostrEventLike } from '../nostr/eventLike'

/** Opaque Nostr filter shape; concrete clients may support additional NIPs. */
export type NostrFilter = Readonly<Record<string, unknown>>

export interface RelayPublishResult {
	/** Only relays that ACKed the event; an empty list is not publication success. */
	acceptedRelays: readonly string[]
}

/** Relay operations require explicit targets so workflows cannot silently widen network egress. */
export interface NostrRelayPort<Event extends NostrEventLike = NostrEventLike> {
	fetchEvents(filters: NostrFilter | readonly NostrFilter[], relayUrls: readonly string[]): Promise<Event[]>
	subscribe(filters: NostrFilter | readonly NostrFilter[], onEvent: (event: Event) => void, relayUrls: readonly string[]): () => void
	publish(event: Event, relayUrls: readonly string[]): Promise<RelayPublishResult>
}
