/**
 * types.ts — the vocabulary of the `nostr-io` contract.
 *
 * The spec is `../nostr-io.md`; this file is one implementation's spelling of it.
 * Three rules from the spec are visible in the names below:
 *
 * - **the nouns are NIP-01's** (`#fbfce3`) — `RelayUrl`, `FilterIn`, `Event`,
 *   `RelayAck`, `RelayReason` — and the operations are `connect`, `query`,
 *   `subscribe`, `publish`, `count` and `close`.
 * - **the pool request shape is adopted, not invented** (`#fa487d`): `NostrRequest`
 *   and `UpstreamPool` are the vendor's published contract, copied in shape. That
 *   shape is what makes the seam library-free as well as store-free — the vendor
 *   documents it as satisfied by four independent backends (`#c6ae9c`).
 * - **N1** (`#ba52de`) — the one remaining library type is rxjs' `Observable`, the
 *   vendor contract's own stream shape. It appears in a caller-facing signature
 *   only where a stream is the answer, and a second implementation types its
 *   stream as its own equivalent and adapts at its boundary.
 *
 * **This module keeps no store and no cache** — `#010fc8` (provenance) — nothing in
 * this file, or anywhere else in `ts/`, names a store, a cache, a database or the
 * app. The pool a host injects carries the wire's own verbs and nothing else (`#d700bc`).
 */
import type { Observable } from 'rxjs'
import type { Filter as NostrFilter, NostrEvent } from 'nostr-tools'

import type { RelaySeamError } from './errors'

/** #8899c6 — Event: N2, the event view is a raw `nostr-tools` event, no wrapper and no library type. */
export type Event = NostrEvent
/** #fbfce3 — FilterIn: NIP-01's filter, as the wire takes it. */
export type FilterIn = NostrFilter
/** #8899c6 — RelayUrl: N4, a relay is a plain URL string, never a library's relay handle. */
export type RelayUrl = string
/** #06200d — RelaySet: the host's answer to "which relays", for one call. Order is theirs, not ours. */
export type RelaySet = readonly RelayUrl[]
/** #15aa73 — Unsub: a cancellation, idempotent where the contract says so. */
export type Unsub = () => void

/**
 * #5ecac1 — RelayReason: the reason vocabulary, a string union rather than one
 * error class per condition. A refusal is a value from this set, never a bare
 * string and never a silent absence (N3; the exact members are the maintainer's
 * to rename, `#6a5bcb` (provenance)).
 */
export type RelayReason = 'auth-required' | 'rate-limited' | 'timeout' | 'not-found' | 'closed' | 'rejected'

/**
 * #fa487d — NostrRequest: the adopted vendor request shape — relays and filters
 * in, a stream of raw events out. Adopted so a TypeScript host is wired the
 * standard way and a Go relay host is not excluded (`#c6ae9c`).
 */
export type NostrRequest = (relays: RelayUrl[], filters: FilterIn[]) => Observable<Event>
/** #fa487d — UpstreamPool: the adopted union — a bare request function, or anything carrying one. */
export type UpstreamPool = NostrRequest | { request: NostrRequest }

/**
 * #b14090 — RelayStatus: the connection health the seam reports from the wire,
 * observed and never invented. `ready` is the pool's own application-layer
 * readiness for the relay it holds under that URL, so a relay the pool knows and
 * has never dialled is reported as it is rather than as an invented "not connected".
 */
export interface RelayStatus {
	url: RelayUrl
	connected: boolean
	ready: boolean
	authenticated: boolean
}

/** #ae22a4 — RelayAck: one relay's own answer to one publish. */
export interface RelayAck {
	url: RelayUrl
	accepted: boolean
	reason?: RelayReason
	message?: string
}

/**
 * #ae22a4 — PublishOutcome: `publish` reports one ack per targeted relay and
 * performs no local write. There is no `stored` flag here on purpose: what gets
 * stored is the composition's policy and not the seam's.
 */
export interface PublishOutcome {
	id: string
	acks: RelayAck[]
}

/**
 * #752c02 — CountResult: NIP-45 permits approximation, so the contract requires
 * the flag rather than the accuracy.
 */
export interface CountResult {
	count: number
	approximate: boolean
}

/**
 * #10b5ac — WireResult: `query` resolves with what arrived and whether the wire's
 * boundary was reached. It never invents completeness: `complete` is a fact about
 * local-plus-relay and belongs to the module that holds both tiers.
 *
 * `failures` is the read's **failure channel**, the same value the live channels
 * carry: a relay refusal that arrives mid-read is a value on this list, never a
 * rejection of the read and never a silent absence (`#5ecac1`). Events that
 * already arrived are never discarded because a later relay refused — and
 * `eose: false` is the fact that the boundary was not reached.
 */
export interface WireResult {
	events: Event[]
	eose: boolean
	failures: RelaySeamError[]
}

/**
 * #e5dbdb — QueryOptions: a read's options. `deadlineMs` is a **wall-clock budget
 * on the whole read** — it fires whether or not the wire is still emitting, so a
 * stalled-but-dripping relay cannot unbind the caller's wait — and `signal`
 * cancels the read.
 */
export interface QueryOptions {
	deadlineMs?: number
	signal?: AbortSignal
}

/**
 * #15aa73 — SubscribeOptions: a subscription's options. `closeOnEose` ends the
 * stream at the wire's boundary, after the events that preceded it.
 */
export interface SubscribeOptions {
	signal?: AbortSignal
	closeOnEose?: boolean
}

/**
 * #15aa73 — Subscription: the subscription handle owns the subscription's lifetime. Its
 * cancellation is idempotent (`unsubscribe()` twice closes once and throws
 * nothing), and a relay failure inside a live subscription is reported on
 * `errors` rather than ending `events` silently. Both channels are **typed**:
 * `errors` carries the contract's own refusal on every failure path, including a
 * pool whose own streams error.
 */
export interface Subscription {
	events: Observable<Event>
	errors: Observable<RelaySeamError>
	unsubscribe: Unsub
}

/**
 * #06200d — RelayPolicy: relay policy is **injected, never owned**. The host answers "which
 * relays" for each operation, and the module may not add, prefer, reorder or
 * blacklist a relay beyond the wire's own reconnect behaviour. Reading this on
 * every call is the criterion. De-duplicating the same URL is none of those four
 * things: the relay is neither added, preferred, reordered nor dropped.
 */
export type RelayPolicy = (operation: 'connect' | 'query' | 'subscribe' | 'publish' | 'count') => RelaySet

/**
 * #5ecac1 — RelayFailure: a relay failure observed inside a live subscription,
 * before the seam types it.
 */
export interface RelayFailure {
	relay: RelayUrl
	reason: RelayReason
	message?: string
}

/**
 * #5ecac1 — PoolSubscription: a pool subscription as the transport port exposes
 * it — the live event stream, the failure channel and the wire's own boundary.
 * The seam re-shapes this into the contract's `Subscription`.
 */
export interface PoolSubscription {
	events: Observable<Event>
	failures: Observable<RelayFailure>
	eose: Observable<void>
	unsubscribe: Unsub
}

/**
 * #c6ae9c — PoolPort: the transport port, the one place the wire is reached. It is implemented
 * by the first implementation's vendor adapter (`relay-adapter.ts`) and by a
 * hand-written pool in the tests, which is how the contract is proved
 * adapter-shaped rather than library-shaped (`#c6ae9c`, `#7bf6f6`). It is not a
 * store: the verbs are the wire's own.
 *
 * Two things every method may rely on, both of them the seam's (`#06200d`): the
 * relay set it is handed is the **unique** one — a URL the host named twice is
 * handed once, in the host's own order, dropped nowhere else — and a refusal is
 * never a bare `Error` at its boundary.
 */
export interface PoolPort {
	/**
	 * A single REQ that completes at the wire's boundary (EOSE). The request
	 * shape has no failure channel of its own, so a refusal that arrives
	 * **mid-read** is reported by erroring this stream (typed, where the pool can):
	 * the seam carries it as a value on the read's `failures` and resolves with
	 * what arrived and `eose: false` (`#10b5ac`).
	 */
	request(relays: RelayUrl[], filters: FilterIn[], opts?: { signal?: AbortSignal }): Observable<Event>
	/** A live REQ, open until its handle is unsubscribed. */
	subscribe(relays: RelayUrl[], filters: FilterIn[]): PoolSubscription
	/** One EVENT, with one ack per targeted relay. Performs no local write. */
	publish(relays: RelayUrl[], event: Event): Promise<RelayAck[]>
	/** NIP-45 COUNT across the target set, with the approximation flag. */
	count(relays: RelayUrl[], filters: FilterIn[]): Promise<CountResult>
	/** The connection health of the target set, as the pool observes it. */
	status(relays: RelayUrl[]): RelayStatus[]
	/** Tear the pool down. */
	close(): void
}

/**
 * #06200d — NostrIoOptions: the seam's options. `policy` is required — the module
 * owns no relay choice of its own — and `pool` is optional: with none injected,
 * the first implementation wires the vendor adapter over its own `applesauce-relay`
 * pool.
 */
export interface NostrIoOptions {
	pool?: PoolPort
	policy: RelayPolicy
}

/**
 * #fbfce3 — NostrIo: the contract's handle, six operations. `connect` reads policy
 * and reports the wire's health; `query`, `subscribe`, `publish` and `count` are
 * the wire's verbs; `close` tears the pool down. No operation takes a store, and
 * none takes a relay set — the relay set is the injected policy's answer
 * (`#06200d`).
 */
export interface NostrIo {
	connect(): Promise<RelayStatus[]>
	query(filters: FilterIn | FilterIn[], opts?: QueryOptions): Promise<WireResult>
	subscribe(filters: FilterIn | FilterIn[], opts?: SubscribeOptions): Subscription
	publish(event: Event): Promise<PublishOutcome>
	count(filters: FilterIn | FilterIn[]): Promise<CountResult>
	close(): void
}
