/**
 * Library-agnostic Nostr I/O port — the "seam" of the NDK -> applesauce
 * strangler-fig migration (see `docs/ndk-to-applesauce-migration-plan.md`).
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
 *
 * Wave 0 intentionally does not promise full adapter parity. fetch/subscribe
 * callers may pass relayUrls, but callers that require strict relay targeting
 * must verify active-adapter support. publish uses the adapter's configured
 * write policy until later publish waves add an explicit relay-target contract.
 */
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools'

import { ndkIo } from './io-ndk'

export type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
export type NostrFilter = Filter

export interface NostrUser {
	pubkey: string
}

export interface FetchOptions {
	/** Abort the fetch after this many milliseconds (default: ~8s). */
	timeoutMs?: number
	/** Request these relay URLs; strict targeting depends on active-adapter support. */
	relayUrls?: string[]
}

export interface SubscribeOptions {
	/** Close the subscription once relays reach EOSE. Default: false. */
	closeOnEose?: boolean
	/** Request these relay URLs; strict targeting depends on active-adapter support. */
	relayUrls?: string[]
}

export interface PublishOptions {
	/** Reserved for later publish waves; Wave 0 uses the configured write policy. */
	readonly __reserved?: never
}

export interface NostrIo {
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
