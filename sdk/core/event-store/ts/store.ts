/**
 * store.ts — `createEventStore`: the module's contract surface, which is the **local read/write
 * endpoint** a caller routes through (`#e472d3`), satisfied in **one shape** a relay and this store
 * satisfy alike (`#5dcce6`, D-O16).
 *
 * **The five caller-facing verbs and the envelope are gone from here**, because the spec moved them to
 * `event-access/event-access.md` on 2026-09-29 (`#f54c68`) while the code still held them; this is the
 * shrink's code half. What is left is exactly the endpoint the composition declares (D-O12) and this
 * store adopts: `tier`, `read`, `write`, `count`, `remove` and the local change notification. There is
 * **no completeness claim** on any of it: a local read answers with a set of raw events, and with no
 * network phase there is nothing that could be incomplete (`#4f4cc6` as amended).
 *
 * The library's `EventStore` is the **store of record**, and it is opened retaining everything so that
 * every policy decision belongs to the contract and is taken **on read**. That is what makes a per-read
 * `keepDeleted: true` expressible at all: the library acts on the three `keep*` names at write time
 * (`applesauce-core` 6.2.0 `dist/event-store/event-store.js:157-160`, `:148-186`, READ), so a store that
 * honoured the read options by configuration alone would apply the *store's* defaults and could never
 * un-delete for one read.
 *
 * Nothing in this file opens a socket: the relay port is accepted, never called (M5), and no read answers
 * from a network (M14). The relay set and the network phase are not this module's at all any more — they
 * left with the operations (`#9f5778`).
 */
import { EventStore as ApplesauceEventStore } from 'applesauce-core/event-store'
import { markFromCache, matchFilter, verifyEvent } from 'applesauce-core/helpers'

import { createDeletionIndex } from './deletions'
import { StoreError } from './errors'
import { FILTER_SUPPORT, assertIdentityFilters, matchesNothing, toFilterArray } from './filters'
import { collapseToHeads, compareVersions } from './heads'
import type {
	ClockPort,
	CountResult,
	DeleteOutcome,
	DeleteRef,
	EndpointReadOptions,
	EndpointWriteOutcome,
	Event,
	EventStore,
	EventStoreOptions,
	EvictionPolicy,
	FilterIn,
} from './types'

/** An event id, as `remove` accepts it: exactly 64 lower-case hex characters. */
const EVENT_ID = /^[0-9a-f]{64}$/

/** A NIP-40 `expiration` value: base-10 seconds, and nothing else parses. */
const EXPIRATION = /^[0-9]+$/

/** The default clock: seconds since the epoch, never milliseconds. */
const SYSTEM_CLOCK: ClockPort = { now: () => Math.floor(Date.now() / 1000) }

/** Q6/Q7's leans, declared as a value a host — and a test — can read (M10). */
const DEFAULT_EVICTION: EvictionPolicy = { survivesReload: false, prune: 'host', quota: 'host', tabs: 'single-tab' }

/** An event's NIP-40 expiration in seconds, or `null` when it carries none it can parse. */
function expirationSeconds(event: Event): number | null {
	const value = event.tags.find((tag) => tag[0] === 'expiration')?.[1]
	if (value === undefined || !EXPIRATION.test(value)) return null
	return Number(value)
}

/**
 * The filters an index lookup is given.
 *
 * **E3's declaration has a consequence here, and this is it.** This implementation declares
 * `nip50: false`, and the library's index treats a `search` filter as matching **nothing**
 * (`dist/event-store/event-memory.js:383-386`, READ) while the predicate it is filtered by ignores the
 * field — so passing it through would make "declared, not supported" mean "matches nothing" instead of
 * "does not filter". The caller's filter object is never mutated, no other key is touched, and the moment
 * the declaration flips to `true` this function is the identity.
 */
function forIndex(filters: FilterIn[]): FilterIn[] {
	// M7: a filter that matches nothing contributes nothing, so it is dropped from the index lookup rather
	// than handed to an index that answers it with the whole store (an empty `#`-key leaves the library's
	// index with no condition at all).
	const usable = filters.filter((filter) => !matchesNothing(filter))
	if (FILTER_SUPPORT.nip50) return usable
	return usable.map((filter) => {
		if (filter.search === undefined) return filter
		const copy: FilterIn = { ...filter }
		delete copy.search
		return copy
	})
}

/** The three `keep*` answers for one read: the read's own, else the store-level default, else `false`. */
function kept(options: EventStoreOptions, per: EndpointReadOptions | undefined): Required<EndpointReadOptions> {
	return {
		keepDeleted: per?.keepDeleted ?? options.keepDeleted ?? false,
		keepExpired: per?.keepExpired ?? options.keepExpired ?? false,
		keepOldVersions: per?.keepOldVersions ?? options.keepOldVersions ?? false,
	}
}

/** #e472d3 — createEventStore: the local read/write endpoint a caller routes through. */
export function createEventStore(options: EventStoreOptions = {}): EventStore {
	const clock = options.clock ?? SYSTEM_CLOCK
	const baseVerification = options.verifyEvent ?? verifyEvent
	// Cached events were verified when they were written, so re-verifying every one of them on every open would
	// cost more as the cache grows (measured: ~0.5s at 600 events, and climbing — a warm load slower than a
	// cold one). The flag skips verification **only** for the hydrate below; every wire event is still verified
	// at the boundary in `write`.
	let hydrating = false
	const verification = (event: Event): boolean => hydrating || baseVerification(event)
	const deletions = createDeletionIndex()

	// The store of record: opened retaining everything, so that the three `keep*` policies are the
	// contract's and are applied on read (below).
	const sa = new ApplesauceEventStore({
		keepDeleted: true,
		keepExpired: true,
		keepOldVersions: true,
		verifyEvent: verification,
		database: options.database,
	})

	// The injected durable medium (`#9b7257`). When present the store hydrates from it once, and every write
	// persists through it, so a reload starts warm and `localFirst` answers from the cache before the wire.
	// Absent (a test, the server) the store is exactly the in-memory endpoint it was.
	const persistence = options.persistence
	const ready: Promise<void> = (async () => {
		if (!persistence) return
		let cached: Event[] = []
		try {
			cached = await persistence.load()
		} catch {
			return // a medium that cannot be read is an empty cache, not a failed open
		}
		hydrating = true
		for (const event of cached) {
			try {
				if (!verification(event)) continue
				if (event.kind === 5) {
					sa.database.add(event)
					deletions.add(event)
				} else {
					sa.add(event)
				}
			} catch {
				/* a malformed cached event is skipped, never fatal */
			}
		}
		hydrating = false
	})()

	// M5 · the relay port is gone from this contract with the operations (`#9f5778`). Nothing here speaks
	// to a network, and nothing here accepts an edge it cannot use.

	/**
	 * The local read — one implementation, used by `read` and by `count`, so both answer with exactly the
	 * same set at the same instant (M11's case).
	 */
	const localRead = (input: FilterIn | FilterIn[], per: EndpointReadOptions | undefined): Event[] => {
		// (1) M7 before anything reaches the store or the index.
		const filters = toFilterArray(input)
		assertIdentityFilters(filters)

		// (2) The library's index: a set, so already id-unique, and it honours the caller's
		// `since`/`until`.
		const candidates = sa.getByFilters(forIndex(filters))

		// (3) Exclusions model pruning: this half answers *without* the events a host would have pruned
		// and never mutates the store. A locally removed event is already absent, so only two predicates
		// remain — and NIP-40's boundary is `>=`: an event whose expiration equals now **is** expired.
		const keep = kept(options, per)
		const retained = candidates.filter((event) => {
			if (!keep.keepDeleted && deletions.isDeleted(event)) return false
			if (!keep.keepExpired) {
				const expiration = expirationSeconds(event)
				if (expiration !== null && expiration <= clock.now()) return false
			}
			return true
		})

		// (4) The collapse comes **after** the filters, never before them: a `until`-bounded backfill asks
		// for the older version, and collapsing first would return nothing for every pagination window the
		// market builds.
		const set = keep.keepOldVersions ? retained : collapseToHeads(retained)

		// (5)+(6) Per filter: the contract's predicate, the read's own order (the same comparator the
		// collapse uses, so the two cannot disagree), the filter's own limit — NIP-01's limit is per filter
		// — and then an id-unique union, in the same order.
		const seen = new Set<string>()
		const out: Event[] = []
		for (const filter of filters) {
			// M7: an empty identity list matches nothing. The filter is skipped, not dropped — the key
			// stays in the caller's object and the answer is `[]`.
			if (matchesNothing(filter)) continue
			const slice = set
				.filter((event) => matchFilter(filter, event))
				.sort(compareVersions)
				.slice(0, filter.limit ?? undefined)
			for (const event of slice) {
				if (seen.has(event.id)) continue
				seen.add(event.id)
				out.push(event)
			}
		}
		out.sort(compareVersions)

		// M12: every event this read answers with is a local answer, and says so — the price of the
		// ordering being observable at all.
		for (const event of out) markFromCache(event)
		return out
	}

	const store: EventStore = {
		// The declared tier: this is the local tier, and it is **declared** rather than guessed by the consumer.
		tier: 'local',

		// M10 · the declared policy, read without driving a call.
		eviction: options.eviction ?? DEFAULT_EVICTION,

		/**
		 * The local read (`#e472d3`). Answers with a set of raw events and makes **no** completeness
		 * claim (`#4f4cc6` as amended). The three read options override the store-level defaults for this
		 * read only, which is what makes a per-read `keepDeleted: true` expressible.
		 */
		async read(input: FilterIn | FilterIn[], per?: EndpointReadOptions): Promise<Event[]> {
			await ready
			return localRead(input, per)
		},

		/**
		 * The local write (`#b6c13c` as amended: the store-first rule survives exactly, and the relay half
		 * of it is no longer here at all). Each event is verified first and a failed verification is a
		 * **refusal**, counted — never a silent drop. A kind-5 event is written straight to the store's
		 * database: `EventStore.add` would register the library's own delete manager, which is the second
		 * implementation of M9's predicate this module refuses to have. It is stored so it is readable, and
		 * it is indexed here.
		 */
		async write(events: Event[]): Promise<EndpointWriteOutcome> {
			await ready
			let stored = 0
			let refused = 0
			const persisted: Event[] = []
			for (const event of events) {
				// A verifier that **throws** on a malformed event is a failed verification, which the
				// contract already makes a refusal, counted — never a silent drop and never a failure of
				// the whole write. The default verifier (`nostr-tools`' `verifyEvent` through
				// `applesauce-core`) throws when a tag carries a non-string value: a real public kind-30402
				// listing on the relays ships `["shipping","Added Cost",2,"GBP"]` (the `2` is a number), and
				// before this guard that one event aborted an entire read's write-back. Relays may serve
				// such events; the store must refuse them, not throw.
				let verified: boolean
				try {
					verified = verification(event)
				} catch {
					verified = false
				}
				if (!verified) {
					refused += 1
					continue
				}
				if (event.kind === 5) {
					sa.database.add(event)
					deletions.add(event)
					persisted.push(event)
					stored += 1
					continue
				}
				if (sa.add(event) === null) refused += 1
				else {
					persisted.push(event)
					stored += 1
				}
			}
			// Persist through the injected medium, so the cache the next read hydrates from is what this write
			// actually stored. A medium that fails to save never fails the write: the local store already holds
			// the events, and persistence is a cache, not the record.
			if (persistence && persisted.length > 0) {
				try {
					await persistence.save(persisted)
				} catch {
					/* the write stands; the cache simply did not take it */
				}
			}
			return { stored, refused }
		},

		/**
		 * NIP-45 COUNT, answered from the store's own index and **never** answered by fetching (M14,
		 * `#d62f7c`): it is the same set `read` would answer with at the same instant, and an in-memory
		 * index is exact, so `approximate: false` is honest rather than optimistic.
		 */
		async count(input: FilterIn | FilterIn[]): Promise<CountResult> {
			await ready
			const events = localRead(input, undefined)
			return { count: events.length, approximate: false }
		},

		/**
		 * A **local removal** (§4.6, M9): by id, or by filter. It is temporary and it is recorded nowhere —
		 * the moment the same id is written again the event is back, and it is never a NIP-09 deletion. A
		 * string that is not an id is a typed rejection rather than a silent `{removed: 0}` (M7).
		 */
		async remove(refs: DeleteRef[]): Promise<DeleteOutcome> {
			await ready
			let removed = 0
			const forgotten: string[] = []
			for (const ref of refs) {
				if (typeof ref === 'string') {
					if (!EVENT_ID.test(ref)) {
						throw new StoreError('rejected', 'remove: an event id must be 64 lower-case hex characters')
					}
					if (sa.remove(ref)) {
						forgotten.push(ref)
						removed += 1
					}
					continue
				}
				const filters = toFilterArray(ref)
				assertIdentityFilters(filters)
				// M7: a filter whose identity list is empty matches nothing, so it removes nothing — it must
				// never reach `removeByFilters`, where the library's index would answer it with the whole
				// store.
				const removable = filters.filter((filter) => !matchesNothing(filter))
				if (removable.length === 0) continue
				// Enumerate the ids first, so the cache forgets exactly what the store drops.
				const going = new Set<string>()
				for (const filter of removable) for (const event of sa.getByFilters([filter])) going.add(event.id)
				removed += sa.removeByFilters(removable)
				for (const id of going) forgotten.push(id)
			}
			if (persistence && forgotten.length > 0) {
				try {
					await persistence.forget(forgotten)
				} catch {
					/* the removal stands */
				}
			}
			return { removed }
		},

		/**
		 * The endpoint's **local change notification** (`#4757d0` as amended): what stays here is the local
		 * half a caller needs to see its own writes. The subscription that spans two tiers, and the
		 * removal-notification gap the statement names, are `event-access`'s — this module **invents
		 * nothing**.
		 *
		 * Each access returns its own stream, fed by the store of record's insert stream and read on
		 * demand, so a consumer that never iterates it subscribes to nothing. Every write arrives **in
		 * order, at most once**, and stopping is idempotent (`#4757d0`).
		 */
		get changes(): AsyncIterable<Event> {
			const seen = new Set<string>()
			const queue: Event[] = []
			let wake: (() => void) | null = null
			let closed = false
			let live: { unsubscribe(): void } | null = null

			/** Stop emitting. */
			const finish = (): void => {
				if (closed) return
				closed = true
				queue.length = 0
				live?.unsubscribe()
				live = null
				if (wake) {
					const resume = wake
					wake = null
					resume()
				}
			}

			/** One emission per id, and never twice. */
			const emit = (event: Event): void => {
				if (closed || seen.has(event.id)) return
				seen.add(event.id)
				queue.push(event)
				if (wake) {
					const resume = wake
					wake = null
					resume()
				}
			}

			return {
				[Symbol.asyncIterator](): AsyncIterator<Event> {
					// LF-1's local half: the stream subscribes **when it is first read**, so it can never
					// precede the caller's own local read by existing too early.
					if (live === null && !closed) live = sa.insert$.subscribe((event) => emit(event))
					return {
						async next(): Promise<IteratorResult<Event>> {
							for (;;) {
								const event = queue.shift()
								if (event !== undefined) return { value: event, done: false }
								if (closed) return { value: undefined, done: true }
								await new Promise<void>((resolve) => {
									wake = resolve
								})
							}
						},
						async return(): Promise<IteratorResult<Event>> {
							finish()
							return { value: undefined, done: true }
						},
					}
				},
			}
		},
	}

	return store
}
