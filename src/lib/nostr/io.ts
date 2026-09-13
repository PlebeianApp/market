/**
 * Library-agnostic Nostr I/O port — the "seam" of the NDK -> applesauce
 * strangler-fig migration (see
 * `docs/adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md`).
 *
 * Every event that flows through this port is a raw nostr-tools event
 * (applesauce has no wrapper class), so migrating a module is mostly about
 * redirecting where its subscribe/fetch/publish calls land, not about
 * changing event shapes.
 *
 * The active adapter defaults to the temporary NDK bridge (`io-ndk.ts`) and
 * is flipped to the applesauce implementation (`io-applesauce.ts`) module by
 * module, with tests gating each flip. When the last caller has flipped,
 * `io-ndk.ts` and the NDK singleton are deleted (Wave D).
 */
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools'

import { ndkIo } from './io-ndk'

export { applesauceIo } from './io-applesauce'
export { ndkIo }

export type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
export type NostrFilter = Filter

export interface NostrUser {
	pubkey: string
}

export interface FetchOptions {
	/** Abort the fetch after this many milliseconds (default: ~8s). */
	timeoutMs?: number
	/** Restrict the fetch to these relay URLs. Default: adapter's configured relays. */
	relayUrls?: string[]
}

export interface SubscribeOptions {
	/** Close the subscription once relays reach EOSE. Default: false. */
	closeOnEose?: boolean
	/** Restrict the subscription to these relay URLs. Default: adapter's configured relays. */
	relayUrls?: string[]
}

export interface PublishOptions {
	/** Restrict publishing to these relay URLs. Default: adapter's write relays. */
	relayUrls?: string[]
}

export interface NostrIo {
	/**
	 * Fetch events matching `filter` (a single filter, or several OR-ed filters).
	 *
	 * Contract — both adapters MUST honour these, and callers may rely on them:
	 *   - the result is a flat collection of raw nostr-tools events;
	 *   - **events are unique by `id`.** An event that matches more than one of
	 *     the supplied filters is returned exactly once. (NDK's event set
	 *     deduplicated by `deduplicationKey()`; the applesauce adapter must
	 *     deduplicate by `id` to match.) Downstream semantic layers treat a
	 *     repeated event as two distinct inputs — e.g. `computeValidatedBids`
	 *     flags a duplicated bid as proof reuse — so uniqueness is load-bearing,
	 *     not cosmetic.
	 */
	fetchEvents(filter: NostrFilter | NostrFilter[], opts?: FetchOptions): Promise<NostrEvent[]>
	subscribe(filter: NostrFilter | NostrFilter[], onEvent: (event: NostrEvent) => void, opts?: SubscribeOptions): () => void
	publish(event: NostrEvent, opts?: PublishOptions): Promise<void>
	sign(template: EventTemplate): Promise<NostrEvent>
	getUser(): Promise<NostrUser | null>
}

let active: NostrIo = ndkIo

/** Returns the currently active Nostr I/O adapter. */
export function getNostrIo(): NostrIo {
	return active
}

/** Swaps the active adapter. Used by the migration to flip modules off NDK. */
export function setNostrIo(io: NostrIo): void {
	active = io
}

export const fetchEvents: NostrIo['fetchEvents'] = (filter, opts) => active.fetchEvents(filter, opts)
export const subscribe: NostrIo['subscribe'] = (filter, onEvent, opts) => active.subscribe(filter, onEvent, opts)
export const publish: NostrIo['publish'] = (event, opts) => active.publish(event, opts)
export const sign: NostrIo['sign'] = (template) => active.sign(template)
export const getUser: NostrIo['getUser'] = () => active.getUser()
