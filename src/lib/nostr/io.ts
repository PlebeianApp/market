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
 */
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools'

import { ndkIo } from './io-ndk'
import { applesauceIo } from './io-applesauce'

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
	fetchEvents(filter: NostrFilter | NostrFilter[], opts?: FetchOptions): Promise<NostrEvent[]>
	subscribe(filter: NostrFilter | NostrFilter[], onEvent: (event: NostrEvent) => void, opts?: SubscribeOptions): () => void
	publish(event: NostrEvent, opts?: PublishOptions): Promise<void>
	sign(template: EventTemplate): Promise<NostrEvent>
	getUser(): Promise<NostrUser | null>
}

/**
 * Select the active Nostr I/O adapter based on the NOSTR_BACKEND env var.
 *   - "applesauce" => applesauce RelayPool adapter (destination)
 *   - any other value or unset => NDK bridge adapter (current default)
 *
 * This env var is exported by the e2e benchmark script (`scripts/e2e-benchmark.sh`)
 * and read via `process.env` at module load time (Bun SSR runtime).
 */
const backend = (typeof process !== 'undefined' && process.env?.NOSTR_BACKEND) || 'ndk'
let active: NostrIo = backend === 'applesauce' ? applesauceIo : ndkIo

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
