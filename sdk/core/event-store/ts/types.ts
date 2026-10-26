/**
 * types.ts — the vocabulary of the `event-store` contract.
 *
 * The spec is `../event-store.md`; this file is one implementation's spelling of
 * it. Two rules from the spec are visible in the names below and are worth
 * stating where they are declared:
 *
 * - **E2** — the event view is a raw `nostr-tools` event. No wrapper class, and
 *   no library type in a caller-facing signature (M1).
 * - **E3** — the filter is `nostr-tools`' `Filter` **extended** with NIP-91
 *   `&`-keys and NIP-50 `search`. An implementation *declares* which of the two
 *   it honours; this one declares `{ nip91: true, nip50: false }` in
 *   `filters.ts` and the contract requires the declaration, not the support.
 *
 * **The contract surface is the endpoint** (`#e472d3`, `#5dcce6`, D-O16): `StoreEndpoint` below is the
 * one shape a relay and this store satisfy alike, declared by the consumer (D-O12) and adopted here rather
 * than reconciled. The five caller-facing verbs and the `{events, complete}` envelope that used to be
 * declared here moved to `event-access/event-access.md` on 2026-09-29 (`#f54c68`), and took their
 * vocabulary with them: `query`, `subscribe`, `publish`, `delete`, the envelope, the relay port and the
 * relay acknowledgements are **not** names of this module any more (`#9f5778`).
 */
import type { IAsyncEventDatabase, IEventDatabase, IEventStore as LibraryEventStore } from 'applesauce-core/event-store'
import type { Filter as NostrFilter, NostrEvent } from 'nostr-tools'

/** #a6d035 — Event: the raw nostr-tools event (E2). */
export type Event = NostrEvent // E2 — raw nostr-tools events
/** #a6d035 — FilterIn: the nostr-tools `Filter` extended with NIP-91 `&`-keys and NIP-50 `search` (E3). */
export type FilterIn = NostrFilter & { [key: `&${string}`]: string[] | undefined; search?: string } // E3
/** #a6d035 — Reason: the error conditions a rejection carries (E5). */
export type Reason = 'rejected' | 'auth-required' | 'not-found' | 'quota-exhausted' | 'evicted-during-read'
export interface ClockPort {
	now(): number
} // SECONDS since the epoch, never milliseconds
/** #e8d56c — FilterSupport: which of the two extended-filter halves an implementation honours. */
export interface FilterSupport {
	nip91: boolean
	nip50: boolean
}

/**
 * #5dcce6 — EndpointTier: the tier the endpoint declares, `'local'` or `'remote'`.
 *
 * A consumer reads it rather than guessing which half it is talking to — this store declares `'local'`, and a
 * relay host declares `'remote'`.
 */
export type EndpointTier = 'local' | 'remote'

/**
 * **E4's read options, as the endpoint takes them.** A one-read override of the store-level default
 * declared on `EventStoreOptions`; a `read` call may not change another read's totals.
 */
export interface EndpointReadOptions {
	keepDeleted?: boolean
	keepExpired?: boolean
	keepOldVersions?: boolean
}

/**
 * #b6c13c — EndpointWriteOutcome: what a write answered, how many events the store took and refused.
 *
 * What a write answered: how many events the store took, and how many it refused. Counts rather than a
 * flag, because a write is a batch here — and **never** a silent drop: an event the store did not take is
 * counted in `refused` (`#b6c13c` as amended).
 */
export interface EndpointWriteOutcome {
	stored: number
	refused: number
}

/**
 * #5dcce6 — StoreEndpoint: the module's contract surface, one shape a relay and this store satisfy alike.
 *
 * **The endpoint** — the module's contract surface, and one shape a relay and this store satisfy alike
 * (`#5dcce6`): a declared tier, a local read, a local write, a count from the local index, a local
 * removal, and the local change notification. It makes **no completeness claim** (`#4f4cc6` as amended):
 * with no network phase there is nothing that could be incomplete.
 *
 * The shape is the consumer's declaration (D-O12) adopted verbatim, so the composition's conformance is a
 * compile-time fact rather than a review.
 */
export interface StoreEndpoint {
	readonly tier: EndpointTier
	read(filters: FilterIn | FilterIn[], options?: EndpointReadOptions): Promise<Event[]>
	write(events: Event[]): Promise<EndpointWriteOutcome>
	count(filters: FilterIn | FilterIn[]): Promise<CountResult>
	remove(refs: DeleteRef[]): Promise<DeleteOutcome>
	readonly changes: AsyncIterable<Event>
}

/** #d62f7c — CountResult: the count from the local index and its `approximate` flag (E6). */
export interface CountResult {
	count: number
	approximate: boolean
}

/** #a6d035 — DeleteRef: a deletion reference, an id, a filter, or a list of either (E4). */
export type DeleteRef = string | FilterIn | FilterIn[]
/** #337e0c — DeleteOutcome: how many events a local removal took. */
export interface DeleteOutcome {
	removed: number
}

/**
 * #e8d56c — EvictionPolicy: the declared eviction policy a host reads (M10).
 *
 * The declared eviction policy a host reads (M10). `prune` and `quota` are two
 * of the four questions the library's seam leaves unanswerable; `tabs` is Q7's
 * single-tab declaration. None of them has a mechanism in N1 — the policy is a
 * value a test can read, not prose.
 */
export interface EvictionPolicy {
	survivesReload: boolean
	prune: 'host' | 'never'
	quota: 'host'
	tabs: 'single-tab' | 'shared'
}

/**
 * **E7** — the persistence seam's types are the library's own, adopted verbatim
 * (`IEventDatabase`, `IAsyncEventDatabase`): a read interface plus three writes,
 * where `removeByFilters` is the invalidation primitive. Persistence is
 * optional and injected (M11); N1 ships the *types* and wires no medium (Q6).
 */

/** #9b7dd3 — EventDatabase: the library's `IEventDatabase`, adopted verbatim (E7). */
export type EventDatabase = IEventDatabase // E7

/** #9b7dd3 — AsyncEventDatabase: the library's `IAsyncEventDatabase`, adopted verbatim and unwired in N1 (E7). */
export type AsyncEventDatabase = IAsyncEventDatabase // E7 — declared, not wired in N1

/**
 * The store's options. `database`, `clock` and `verifyEvent` are the host's edges; `eviction` is the
 * declared policy (M10). **There is no relay member**: the port and the relay set left this contract with
 * the operations (`#9f5778`), and an option a module cannot honour is a claim it should not make.
 *
 * The `keep*` names here are the store-level default for every read, and the same names on
 * `EndpointReadOptions` override them for one read. The distinction is load-bearing: the underlying store
 * is opened retaining everything (`keepDeleted`/`keepExpired`/`keepOldVersions` all `true`) and the three
 * predicates are re-applied **on read**, because the library acts on them at *write* time and a per-read
 * `keepDeleted: true` would otherwise be unexpressible.
 */
/**
 * The persistence medium a host injects (`#9b7257`): a plain durable `load`/`save`/`forget` the store drives
 * from its own `write()`/`remove()` and hydrates from at open. It is deliberately **not** applesauce's own
 * `database` option, whose seam is synchronous and so cannot be IndexedDB; this is the medium the store
 * itself applies, which is why the seam lives here and not in the library.
 */
export interface EventPersistence {
	/** Every cached event, read once at open to warm the in-memory store. */
	load(): Promise<Event[]>
	/** Persist the events a write stored. */
	save(events: readonly Event[]): Promise<void>
	/** Forget the events a removal took out of the store. */
	forget(ids: readonly string[]): Promise<void>
}

export interface EventStoreOptions {
	database?: EventDatabase
	persistence?: EventPersistence
	clock?: ClockPort
	keepDeleted?: boolean
	keepExpired?: boolean
	keepOldVersions?: boolean
	verifyEvent?: (event: Event) => boolean
	eviction?: EvictionPolicy
}

/**
 * #e472d3 — EventStore: the contract's handle, the endpoint plus the declared eviction policy.
 *
 * The contract's handle: **the endpoint, plus the declared eviction policy a host reads without driving a
 * call** (M10). The name is kept because the previous increment's order and two of its review artifacts
 * cite it, and the type is a superset of `StoreEndpoint` — so the store satisfies the declared shape
 * **structurally**, a relay host satisfies it without the extra member, and neither needs an adapter.
 */
export interface EventStore extends StoreEndpoint {
	readonly eviction: EvictionPolicy
	/**
	 * The **live library store** the module already builds, handed out so a vendor `Model` can subscribe to it and
	 * a loader can write into it. It is the store of record itself, not a snapshot and not a second store: a model
	 * that subscribes here sees the same events `read` answers, and a loader that writes here is what `read` then
	 * answers. No relay member is added anywhere — the relay set and the network phase are not this module's
	 * (`#9f5778`), and this accessor changes only the *visibility* of a store the module already holds.
	 */
	modelStore(): LibraryEventStore
}
