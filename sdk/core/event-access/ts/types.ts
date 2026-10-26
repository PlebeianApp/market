/**
 * types.ts — the vocabulary of the `event-access` contract.
 *
 * The spec is `../event-access.md`; this file is one implementation's spelling of it.
 * Three rules from the spec are visible in the names below:
 *
 * - **the nouns are NIP-01's**, and the event view is a raw `nostr-tools` event
 *   (E2) — no wrapper, no library class. `FilterIn` is that library's filter.
 * - **the two ports are declared here, by the consumer** (D-O12, D-O16). The
 *   composition is the consumer, so the endpoint shape it consumes is its to
 *   declare; `event-store` adopts that shape at I3 and this file cites no sibling.
 * - **the second port is the seam's own contract, consumed structurally**
 *   (D-O13, D-O19) — this file declares the members of `NostrIo` this module
 *   consumes, traced by `path:line` to `nostr-io/ts/types.ts` (`query` at :224,
 *   `subscribe` at :225, `publish` at :226, each inside the interface at :222-229).
 *   TypeScript's structural typing is the conformance mechanism, so the seam
 *   satisfies this shape without a specifier leaving this module's directory.
 *
 * **This module keeps no store and opens no socket** (`#f775fb`, `#e6aa61`): nothing
 * here names a store, a cache, a database, the app, or a relay handle. The endpoint
 * is reached through `StoreEndpoint` and the wire through `NostrIo` — and this module
 * never learns what implements either.
 *
 * **Increment 3 adds the bounded fill's three shapes and no vendor type** — the pool the
 * loader family drives (`UpstreamPool`: the union the seam already declares at
 * `nostr-io/ts/types.ts:54`), the loader's first step (`CacheRequest`: structurally the very
 * read the store endpoint's `read` already answers) and the fill itself (`FillRequest`),
 * **supplied as a function** rather than named as a type. The vendor's own
 * `createEventLoader(pool, …)` takes that pool **by construction**: a value of the seam's
 * `PoolPort` type satisfies `UpstreamPool` with no adapter and no cast, which is a compile
 * gate here and not a claim (`composition.test.ts`, the loader-pool case), and **no vendor
 * type appears in any call signature this module presents**.
 *
 * E1 is visible here: rxjs' `Observable` appears on the caller-facing `Subscription`,
 * where a stream is the answer.
 */
import type { Observable } from 'rxjs'
import type { Filter as NostrFilter, NostrEvent } from 'nostr-tools'

import type { EventAccessError } from './errors'

/** #c843e4 — Event: E2's raw `nostr-tools` event, no wrapper and no library type. */
export type Event = NostrEvent
/** #c843e4 — FilterIn: NIP-01's filter, as both tiers take it. */
export type FilterIn = NostrFilter
/** #239d01 — Unsub: a cancellation, idempotent where the contract says so. */
export type Unsub = () => void

/**
 * #3aa514 — Reason: the seam's six error conditions restated as a string union rather than one
 * error class per condition. It is the seam's vocabulary restated structurally (`nostr-io/ts/types.ts:44`,
 * D-O7), imported and never re-spelled side by side with a sibling: the module declares it, the seam
 * satisfies it structurally. A refusal is a value from this set, never a bare string and never a silent absence.
 */
export type Reason = 'auth-required' | 'rate-limited' | 'timeout' | 'not-found' | 'closed' | 'rejected'

/** #bec31a — EndpointTier: the endpoint declares its own tier; the merge never guesses (E4). */
export type EndpointTier = 'local' | 'remote'

/** #8cd1d6 — EndpointReadOptions: the endpoint's own `keep*` read options, beside this module's `QueryOptions` (E8). */
export interface EndpointReadOptions {
	keepDeleted?: boolean
	keepExpired?: boolean
	keepOldVersions?: boolean
}

/**
 * #d0e7d5 — EndpointWriteOutcome: the local write's outcome, the two counts, so the policy's `onReject`
 * has something to read. `refused` here is a **count of events the endpoint declined to store** — it
 * is a different noun from the refusing *relays* in `PublishOutcome.refused` (`#9b7257`).
 */
export interface EndpointWriteOutcome {
	stored: number
	refused: number
}

/** #6de405 — CountResult: the local count from the store's own index, `approximate: false` because the index is exact. */
export interface CountResult {
	count: number
	approximate: boolean
}

/** #d80075 — DeleteRef: a removal target — an event id, one filter, or many — routing and never deciding. */
export type DeleteRef = string | FilterIn | FilterIn[]

/** #68a0c1 — DeleteOutcome: the local removal's outcome (P7). */
export interface DeleteOutcome {
	removed: number
}

/**
 * #9afce0 — StoreEndpoint: **the first port — the store endpoint** (D-O12). A signature and a return shape for
 * each member, so no member is left to the implementer's choice:
 *
 * - `tier` is E4's declared tier; the merge orders and marks without knowing which
 *   module it is talking to.
 * - `read` is the local read. A malformed identity filter is rejected **here**, with
 *   the typed refusal this module surfaces — the fail-closed filter boundary
 *   (`#f775fb`), reached by a call and not by a named member. It answers a set of raw
 *   events and makes **no completeness claim**: `complete` is this module's fact.
 * - `write` is the local write, first and independent of any relay attempt (`#2ffa85`).
 * - `count` is the local count, which never fetches (D-O4).
 * - `remove` is the local removal, where this composition's `delete` routes (P7).
 * - `changes` is the local change notification, **typed here** because the store's own
 *   spec leaves it untyped while this composition depends on it (`#8cb8af`; `#9afce0` names
 *   the requirement). That a written event, a kind-5 deletion and an expiry all arrive on it is
 *   **what this composition requires of the endpoint** — the store conforms at I3.
 */
export interface StoreEndpoint {
	readonly tier: EndpointTier
	read(filters: FilterIn | FilterIn[], options?: EndpointReadOptions): Promise<Event[]>
	write(events: Event[]): Promise<EndpointWriteOutcome>
	count(filters: FilterIn | FilterIn[]): Promise<CountResult>
	remove(refs: DeleteRef[]): Promise<DeleteOutcome>
	readonly changes: AsyncIterable<Event>
}

/**
 * #ebd41f — WireResult: the fill's result as this module consumes it — what arrived, and whether the wire's
 * boundary was reached. It is not in the front-matter `contract.types` list and is not
 * exported by `index.ts`; it is the shape the seam's own read resolves with, restated
 * structurally (`nostr-io/ts/types.ts:106-110`).
 */
export interface WireResult {
	events: Event[]
	eose: boolean
	failures: EventAccessError[]
}

/** #ebd41f — UpstreamAck: one relay's own answer to one publish, as this module consumes it (`types.ts:69-74`). */
export interface UpstreamAck {
	url: string
	accepted: boolean
	reason?: Reason
}

/** #ebd41f — UpstreamPublishOutcome: the seam's publish outcome, as this module consumes it (`types.ts:81-84`). */
export interface UpstreamPublishOutcome {
	id: string
	acks: UpstreamAck[]
}

/**
 * #24438d — NostrIo: **the second port — the seam's contract, consumed structurally** (D-O13, D-O19).
 * Only the members this module consumes are declared: the fill's read, the live
 * subscription, and the relay attempt `publish` needs. The seam's full `NostrIo`
 * (`nostr-io/ts/types.ts:222-229`, six members) satisfies this shape structurally, which
 * is why no import of a sibling is taken and none is needed.
 */
export interface NostrIo {
	query(filters: FilterIn | FilterIn[], opts?: { signal?: AbortSignal }): Promise<WireResult>
	subscribe(filters: FilterIn | FilterIn[], opts?: { signal?: AbortSignal; closeOnEose?: boolean }): Subscription
	publish(event: Event): Promise<UpstreamPublishOutcome>
}

/* ---------------------------------------------------------------------------------------
 * The loader-backed fill's shapes (Increment 3). They carry no `#`-anchor: the increment adds
 * no statement to the spec (D-O20) and none was needed — the spec's LF-7 already names the
 * three-step sequence ("local, then relay hints, then extra relays", `../event-access.md`),
 * and these are this implementation's spelling of the packet's Contract.
 * --------------------------------------------------------------------------------------- */

/**
 * NostrRequest — the pool's request shape, consumed **structurally** from the seam's own
 * declaration (`nostr-io/ts/types.ts:52`): relays and filters in, a stream of raw events out.
 * `PoolPort.request` (`nostr-io/ts/types.ts:198`) satisfies it as it stands — its optional
 * third argument is one this shape does not require — which is what lets the loader family
 * drive the one pool with no adapter.
 */
export type NostrRequest = (relays: string[], filters: FilterIn[]) => Observable<Event>

/**
 * UpstreamPool — the union the loader family takes, **declared here rather than imported** so
 * the specifier stays inside this directory and no vendor type reaches a signature: a bare
 * request function, or anything carrying one. The seam declares the same union
 * (`nostr-io/ts/types.ts:54`), so a host's pool is handed to the vendor's `createEventLoader`
 * unchanged and this module gains no dependency on the seam.
 */
export type UpstreamPool = NostrRequest | { request: NostrRequest }

/**
 * CacheRequest — the loader's **first step**, consumed structurally: the same read the store
 * endpoint's `read` already answers, so the cache step and the local read can be one call and
 * never two. Its arms are the vendor's own (a stream, a promise, one event, an array of them).
 */
export type CacheRequest =
	| ((filters: FilterIn[]) => Observable<Event>)
	| ((filters: FilterIn[]) => Promise<Event | Event[]>)
	| ((filters: FilterIn[]) => Event | Event[])

/**
 * FillRequest — **the bounded fill, supplied as a function**: the loader-backed upstream is
 * injected, never named, which is how this module gains no vendor type in any call signature.
 * It answers with the seam's own read shape (`WireResult`) because what the composition
 * consumes from a fill is what it consumes from the seam — what arrived, whether the march
 * reached its end, and the refusals that arrived mid-read as values rather than rejections.
 */
export type FillRequest = (filters: FilterIn[]) => Promise<WireResult>

/**
 * LoaderFillOptions — what composing a loader-backed fill over the one pool needs, all of it
 * composition-time data:
 *
 * - `cacheRequest` is the first step's read (the store endpoint's `read` is one by shape);
 * - `extraRelays` is the relay set the loader's **last** step uses — a list, or a stream of
 *   lists, which is the dynamic per-target shape and needs no relay parameter on any signature
 *   this module presents;
 * - `followRelayHints` is the middle step's switch;
 * - `bufferTime`/`bufferSize` are the batching bounds, **ours to declare** (the vendor ships
 *   defaults; it cannot decide questions about our freshness). A bounded fill is one-shot, so
 *   it defaults to no buffering: waiting to batch would spend the read's own deadline;
 * - `signal` tears the loader down.
 */
export interface LoaderFillOptions {
	cacheRequest?: CacheRequest
	extraRelays?: string[] | Observable<string[]>
	followRelayHints?: boolean
	bufferTime?: number
	bufferSize?: number
	signal?: AbortSignal
}

/**
 * #34dcaa — AnswerOrigin: the tier that produced an id within one answer; when both tiers did, the answer is
 * `'local'` — local-first is the ordering rule and the network copy is the
 * duplicate the id-unique union merges away (`#b40aaa`).
 */
export type AnswerOrigin = 'local' | 'network'

/** #8cd1d6 — QueryOptions: a read's options, beside the endpoint's own `EndpointReadOptions`. */
export interface QueryOptions {
	localFirst?: boolean
	deadlineMs?: number
	persist?: boolean
}

/** #dce3ab — QueryResult: the envelope, never a bare array, because a bare array cannot carry "the deadline fired". */
export interface QueryResult {
	events: Event[]
	complete: boolean
}

/** #8cd1d6 — SubscribeOptions: a subscription's options; `onlyNew` skips the replay and follows the local changes only. */
export interface SubscribeOptions {
	onlyNew?: boolean
	closeOnEose?: boolean
	signal?: AbortSignal
}

/**
 * #239d01 — Subscription: the subscription handle. `errors` is the stated reason a subscription ends rather than
 * being silently dropped (M13). E1 covers the `Observable`.
 */
export interface Subscription {
	events: Observable<Event>
	errors: Observable<EventAccessError>
	unsubscribe: Unsub
}

/**
 * #e38020 — PublishOptions: carries only a signal. Relay choice is the seam's injected policy (`nostr-io/ts/types.ts:152`),
 * so there is no `relayUrls` member here — the composition never chooses a relay.
 */
export interface PublishOptions {
	signal?: AbortSignal
}

/**
 * #2ffa85 — PublishOutcome: `stored` is the local write's outcome; `accepted`/`refused` are the relays' own
 * answers (D-O13). `refused` here is a **list of the relays that declined
 * the event** — a different noun from the refused *count* `StoreEndpoint.write` returns.
 */
export interface PublishOutcome {
	stored: boolean
	accepted: string[]
	refused: { url: string; reason: Reason }[]
}

/**
 * #efb57a — AcceptDecision: what the gate answers (D-O21) — a value, never a silent drop (E5, `#c65b19`).
 */
export type AcceptDecision = 'accept' | 'reject'

/**
 * #c75e32 — AcceptContext: what a gate is told — the tier the endpoint declares (E4, `#bec31a`), and the one capability
 * the link half needs. `resolve` answers `undefined` for a reference the local set does not hold — a
 * **different fact** from a reference that is held and mismatches (`#7f4e0a`). The flow was
 * previously included (`operation`) and was removed per the maintainer's 2026-10-02 ruling: the rule
 * never learns which boundary it is policing, and a host that needs to decide differently per flow
 * wires two rules at two boundaries instead (provenance) `#496306`.
 */
export interface AcceptContext {
	readonly tier: 'local' | 'remote'
	resolve(reference: string): Promise<Event | undefined>
}

/**
 * #c8e35c — AcceptHook: **the one accept boundary** (D-O9; widened by D-O21). It keeps its name and its
 * place on `WriteBackPolicy`; the signature widens from one argument to two and from synchronous
 * to optionally awaited (E1). **One gate, applied at the three destinations and nowhere else** —
 * the store write, the consumer delivery and the wire publish — and never a second accept rule.
 * Absent means accept everything, which is `validation`'s pass-through default.
 */
export type AcceptHook = (event: Event, context: AcceptContext) => AcceptDecision | Promise<AcceptDecision>

/**
 * #cdeea8 — ReferenceResolver: **the link half, injected** (D-O21). Absent means a reference resolves against the endpoint's own
 * local set through this module's existing read path — no second read path is grown for it.
 */
export type ReferenceResolver = (reference: string) => Promise<Event | undefined>

/**
 * #9b7257 — WriteBackPolicy: **the write-back policy, as a value a test reads** (the precedent being the
 * store's `EvictionPolicy`) — five answers here: what a read's fill writes back, whether
 * `persist:false` suppresses this read's fill, what is declared excluded, what a rejected
 * write does, and the one optional accept hook that carries `validation`'s preset decision.
 * The wallet rule arrives as an **input** to `excluded` and is not re-decided here (`#a1e6b7`).
 */
export interface WriteBackPolicy {
	writeBack: 'network' | 'never'
	honourPersist: boolean
	excluded: readonly string[]
	onReject: 'skip' | 'report'
	accept?: AcceptHook
}

/**
 * #168225 — EventAccessOptions: the two ports, the declared policy, and the optional injected resolver (D-O21).
 * The spec's statement covers those four members; `fill` is the fifth, **added by Increment 3** and marked as
 * such: the bounded fill's read, supplied as a function (a loader-backed one is composed over the pool by
 * `createLoaderBackedFill`). Absent — the case every pre-existing case here exercises — the composition takes the
 * fill from the seam's own read; the wiring of a live pool is the composition root's (§8 gap 2 of the companion).
 */
export interface EventAccessOptions {
	endpoint: StoreEndpoint
	upstream: NostrIo
	fill?: FillRequest
	policy?: WriteBackPolicy
	resolver?: ReferenceResolver
}

/** #30c592 — EventAccess: the handle `createEventAccess` returns — the five verbs, the envelope, and the companion read. */
export interface EventAccess {
	readonly policy: WriteBackPolicy
	query(filters: FilterIn | FilterIn[], options?: QueryOptions): Promise<QueryResult>
	subscribe(filters: FilterIn | FilterIn[], options?: SubscribeOptions): Subscription
	publish(events: Event[], options?: PublishOptions): Promise<PublishOutcome>
	count(filters: FilterIn | FilterIn[]): Promise<CountResult>
	delete(refs: DeleteRef | DeleteRef[]): Promise<DeleteOutcome>
	originOf(answer: QueryResult, id: string): AnswerOrigin
}
