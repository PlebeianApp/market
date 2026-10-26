/**
 * harness.ts — **the host side** of the module's two ports, for the tests.
 *
 * This file is test support, not module code: nothing in the implementation imports it and
 * `index.ts` does not export it. Everything a host would provide — a store endpoint, a
 * seam, signing — is provided here, which is the point: the module reads no global of its
 * own, opens no socket and holds no store.
 *
 * **No key, seed or literal identity material lives anywhere in this tree.** The keys below
 * are generated at run time, so every id is a real hash of a real signature.
 *
 * ---
 *
 * **The endpoint model, and what it is.** `modelEndpoint` applies a **model** of the store's
 * fail-closed predicate, in **both** its branches, and it is **named as a model** here and in
 * the spec (D-O18, `adjudication-w2d.md` finding 1): a malformed identity value is rejected
 * with the typed refusal this module surfaces, traced to `event-store/ts/filters.ts:51`
 * (`assertIdentityFilters`); and a present-but-empty `#`-key list is answered as nothing,
 * traced to `event-store/ts/filters.ts:98` (`matchesNothing`). It is a model because the
 * store **exports the predicate nowhere** (`event-store/ts/index.ts` → 0 hits) and this
 * module's own M6 statement forbids a specifier that leaves its directory — so the predicate
 * cannot be imported and must not be copied into the module. The **differential** against the
 * real predicate replaces the model at I3, and **no criterion here claims the composition was
 * tested against the real predicate.**
 *
 * The model **never echoes the caller's filter or its order**: it validates, applies the
 * match-nothing rule, matches each filter, de-duplicates by id, and returns events in
 * `compareVersions` order (descending `created_at`, ties by ascending `id`) — so a fixture
 * that recorded nothing, or that returned its input unchanged, cannot satisfy a case.
 */
import { Subject, of } from 'rxjs'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Observable, Subscription as RxSubscription } from 'rxjs'

import { EventAccessError } from './errors'
import type {
	CountResult,
	DeleteRef,
	Event,
	FilterIn,
	NostrIo,
	Reason,
	StoreEndpoint,
	Subscription,
	UpstreamAck,
	UpstreamPool,
	UpstreamPublishOutcome,
	WireResult,
} from './types'

/** The authors the tests sign as, generated at run time. */
export const KEY = generateSecretKey()
export const PUBKEY = getPublicKey(KEY)
export const OTHER_KEY = generateSecretKey()
export const OTHER_PUBKEY = getPublicKey(OTHER_KEY)

/**
 * Two relay-shaped strings, on the reserved `.invalid` TLD and **never dialled**: they exist
 * so the seam fixture's publish acks carry the relay URLs the contract's `accepted`/`refused`
 * nouns name. Nothing in this tree constructs a socket (see `evidence/run.sh`, section 9).
 */
export const RELAY_A = 'wss://relay-a.invalid/'
export const RELAY_B = 'wss://relay-b.invalid/'

export interface EventFields {
	kind: number
	created_at: number
	content?: string
	tags?: string[][]
}

/** A signed event. */
export function signedEvent(fields: EventFields, sk: Uint8Array = KEY): Event {
	return finalizeEvent({ kind: fields.kind, created_at: fields.created_at, tags: fields.tags ?? [], content: fields.content ?? '' }, sk)
}

/** What a change feed must offer the fixture: a push, and iteration for the module. */
export interface ChangeSink extends AsyncIterable<Event> {
	push(event: Event): void
}

/**
 * An endless async queue behind `StoreEndpoint.changes`. Insertions are delivered to a live
 * iterator immediately, or queued until one arrives — so a test can assert a *later* write
 * reaching an open subscription, and not a replay.
 *
 * **It is deliberately single-consumer**: one queue, one wake, so a second iterator over the
 * same object competes with the first rather than sharing. That is the shape the sibling
 * store's own local change notification has, and it is why the composition iterates
 * `changes` **once** and fans out — the suite must hold over this feed *and* over a
 * broadcast one.
 */
export class ChangeFeed implements ChangeSink {
	private readonly queued: Event[] = []
	private readonly waiting: Array<(result: IteratorResult<Event>) => void> = []
	private finished = false

	push(event: Event): void {
		if (this.finished) return
		const waiter = this.waiting.shift()
		if (waiter) waiter({ value: event, done: false })
		else this.queued.push(event)
	}

	close(): void {
		this.finished = true
		for (const waiter of this.waiting.splice(0)) waiter({ value: undefined, done: true })
	}

	[Symbol.asyncIterator](): AsyncIterator<Event> {
		return {
			next: (): Promise<IteratorResult<Event>> => {
				const queued = this.queued.shift()
				if (queued) return Promise.resolve({ value: queued, done: false })
				if (this.finished) return Promise.resolve({ value: undefined, done: true })
				return new Promise((resolve) => this.waiting.push(resolve))
			},
			return: (): Promise<IteratorResult<Event>> => {
				this.finished = true
				return Promise.resolve({ value: undefined, done: true })
			},
		}
	}
}

/**
 * A **broadcast** change feed: every iterator opened on it sees every event pushed afterwards,
 * each with its own queue and its own wake. It is the other consumer semantics a port may
 * declare, and the suite must hold over both — the composition may not depend on which one it
 * is handed (W4b finding, S3/S6).
 */
export class BroadcastFeed implements ChangeSink {
	private readonly listeners = new Set<(event: Event) => void>()

	push(event: Event): void {
		for (const listener of [...this.listeners]) listener(event)
	}

	[Symbol.asyncIterator](): AsyncIterator<Event> {
		const queued: Event[] = []
		let wake: (() => void) | undefined
		const listener = (event: Event): void => {
			queued.push(event)
			const resume = wake
			wake = undefined
			resume?.()
		}
		this.listeners.add(listener)
		return {
			next: async (): Promise<IteratorResult<Event>> => {
				for (;;) {
					const event = queued.shift()
					if (event !== undefined) return { value: event, done: false }
					await new Promise<void>((resolve) => {
						wake = resolve
					})
				}
			},
			return: async (): Promise<IteratorResult<Event>> => {
				this.listeners.delete(listener)
				return { value: undefined, done: true }
			},
		}
	}
}

/* ---------------------------------------------------------------------------------------
 * The model of the store's predicate — both branches, traced to event-store/ts/filters.ts.
 * --------------------------------------------------------------------------------------- */

/** The filter keys that carry an identity (`filters.ts:26`). */
const IDENTITY_KEYS = ['ids', 'authors', '#e', '#p', '#P'] as const
/** NIP-01's non-identity `#`-keys this model matches on. */
const TAG_KEYS = ['#e', '#p', '#P'] as const
const MAX_IDENTITY_LENGTH = 64
const HEX = /^[0-9a-f]+$/

/** `filters.ts:51` — a malformed identity value is rejected, never repaired. */
function assertIdentityFilters(filters: FilterIn[]): void {
	for (const filter of filters) {
		for (const key of IDENTITY_KEYS) {
			const value = filter[key]
			if (value === undefined) continue
			if (!Array.isArray(value)) {
				throw new EventAccessError('rejected', `${key} must be an array of hex identifiers`)
			}
			for (let index = 0; index < value.length; index++) {
				const element = value[index]
				if (typeof element !== 'string' || element.length === 0 || element.length > MAX_IDENTITY_LENGTH || !HEX.test(element)) {
					throw new EventAccessError(
						'rejected',
						`${key}[${index}] is not a lower-case hex identifier of at most ${MAX_IDENTITY_LENGTH} characters`,
					)
				}
			}
		}
	}
}

/** `filters.ts:98` — a present-and-empty identity **or `#`-key** list matches nothing, answered as
 * nothing. The rule is GENERAL from I3a (D-O6 / `#7f4e0a`): one pass over the filter's own keys,
 * so `#d`, `#a`, `#t` and the rest are treated exactly as `ids`/`authors` already were. A key that
 * is absent, or present with a non-empty list, is not this predicate's business. */
function matchesNothing(filter: FilterIn): boolean {
	for (const [key, value] of Object.entries(filter)) {
		if (!Array.isArray(value) || value.length !== 0) continue
		if (key === 'ids' || key === 'authors' || key.startsWith('#')) return true
	}
	return false
}

/** Match one event against one filter. No key is ignored, and no filter is echoed. */
function matchesEvent(event: Event, filter: FilterIn): boolean {
	if (filter.ids && !filter.ids.some((id) => event.id.startsWith(id))) return false
	if (filter.authors && !filter.authors.some((author) => event.pubkey.startsWith(author))) return false
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false
	if (filter.since !== undefined && event.created_at < filter.since) return false
	if (filter.until !== undefined && event.created_at > filter.until) return false
	for (const key of TAG_KEYS) {
		const values = filter[key]
		if (!values) continue
		// The library's own broadening, modelled on purpose: a present-but-empty `#`-key is
		// **skipped as a condition**, which is precisely why `matchesNothing` has to exist —
		// without it this filter would match everything (`filters.ts:83-88`).
		if (values.length === 0) continue
		const tag = key.slice(1)
		if (!event.tags.some((candidate) => candidate[0] === tag && values.includes(candidate[1]))) return false
	}
	return true
}

/** `compareVersions` order: descending `created_at`, ties by ascending `id`. */
function orderEvents(events: Event[]): Event[] {
	return [...events].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** One-or-many, always as an array — the fixture's own copy, so it does not import the module. */
function toFilters(filters: FilterIn | FilterIn[]): FilterIn[] {
	return Array.isArray(filters) ? [...filters] : [filters]
}

/* ---------------------------------------------------------------------------------------
 * The endpoint fakes.
 * --------------------------------------------------------------------------------------- */

export interface ModelEndpointOptions {
	events?: Event[]
	tier?: 'local' | 'remote'
	/** Refuse this many of the events offered to each `write` (P9 — `onReject` is testable). */
	refuseWrites?: number
	/** A shared call-order record, so order can be asserted **across** two fakes. */
	calls?: string[]
	/** `true` gives the endpoint a **broadcast** change feed instead of a single-consumer one. */
	broadcast?: boolean
}

export interface EndpointFixture {
	endpoint: StoreEndpoint
	/** Every method name, in call order — the record a case asserts against, never a bare zero. */
	calls: string[]
	/** Every filter list handed to `read`, in call order. */
	reads: FilterIn[][]
	/** Every event list handed to `write`, in call order. */
	writes: Event[][]
	/** The local change feed, so a case can inject a later write directly. */
	changes: ChangeSink
}

/**
 * The model endpoint: records every call, applies the store's two predicate branches, keeps
 * an id-unique set, and makes a written event observable to a later read (LF-2/P7).
 */
export function modelEndpoint(options: ModelEndpointOptions = {}): EndpointFixture {
	const store = new Map<string, Event>((options.events ?? []).map((event) => [event.id, event] as const))
	const calls = options.calls ?? []
	const reads: FilterIn[][] = []
	const writes: Event[][] = []
	const changes: ChangeSink = options.broadcast ? new BroadcastFeed() : new ChangeFeed()
	const tier = options.tier ?? 'local'
	const refuseCount = options.refuseWrites ?? 0

	const stored = (): Event[] => [...store.values()]

	return {
		calls,
		reads,
		writes,
		changes,
		endpoint: {
			tier,
			read: async (filters): Promise<Event[]> => {
				calls.push('read')
				const list = toFilters(filters)
				reads.push(list)
				assertIdentityFilters(list)
				const found: Event[] = []
				for (const filter of list) {
					if (matchesNothing(filter)) continue
					for (const event of stored()) {
						if (matchesEvent(event, filter) && !found.some((candidate) => candidate.id === event.id)) found.push(event)
					}
				}
				return orderEvents(found)
			},
			write: async (events): Promise<{ stored: number; refused: number }> => {
				calls.push('write')
				writes.push([...events])
				let refused = 0
				for (let index = 0; index < events.length; index++) {
					const event = events[index]
					if (index < refuseCount) {
						refused++
						continue
					}
					store.set(event.id, event)
					changes.push(event)
				}
				return { stored: events.length - refused, refused }
			},
			count: async (filters): Promise<CountResult> => {
				calls.push('count')
				const list = toFilters(filters)
				assertIdentityFilters(list)
				const kept = list.filter((filter) => !matchesNothing(filter))
				const found = new Map<string, Event>()
				for (const filter of kept) {
					for (const event of stored()) if (matchesEvent(event, filter)) found.set(event.id, event)
				}
				return { count: found.size, approximate: false }
			},
			remove: async (refs: DeleteRef[]): Promise<{ removed: number }> => {
				calls.push('remove')
				let removed = 0
				for (const ref of refs) {
					if (typeof ref === 'string') {
						const event = store.get(ref)
						if (event) {
							store.delete(ref)
							removed++
							changes.push(event)
						}
						continue
					}
					const list = toFilters(ref)
					for (const event of stored()) {
						if (list.some((filter) => !matchesNothing(filter) && matchesEvent(event, filter))) {
							store.delete(event.id)
							removed++
							changes.push(event)
						}
					}
				}
				return { removed }
			},
			changes,
		},
	}
}

/**
 * A second, **independently written** endpoint fake (order §3.7): different plumbing — an
 * immutable snapshot and a fresh `async function*` for the change stream — so the contract is
 * proved port-shaped rather than one-fixture-shaped. It reuses the *model* predicate helpers
 * above, because the model is the spec's subject and not a fixture's idiosyncrasy.
 */
export function secondaryEndpoint(events: Event[] = []): EndpointFixture {
	let rows = [...events]
	const calls: string[] = []
	const reads: FilterIn[][] = []
	const writes: Event[][] = []
	const changes = new ChangeFeed()

	return {
		calls,
		reads,
		writes,
		changes,
		endpoint: {
			tier: 'local',
			read: async (filters): Promise<Event[]> => {
				calls.push('read')
				const list = toFilters(filters)
				reads.push(list)
				assertIdentityFilters(list)
				const kept = list.filter((filter) => !matchesNothing(filter))
				const found = rows.filter((event) => kept.some((filter) => matchesEvent(event, filter)))
				return orderEvents([...new Map(found.map((event) => [event.id, event] as const)).values()])
			},
			write: async (events): Promise<{ stored: number; refused: number }> => {
				calls.push('write')
				writes.push([...events])
				const before = rows.length
				rows = [...rows, ...events]
				for (const event of events) changes.push(event)
				return { stored: rows.length - before, refused: 0 }
			},
			count: async (filters): Promise<CountResult> => {
				calls.push('count')
				const list = toFilters(filters)
				assertIdentityFilters(list)
				const kept = list.filter((filter) => !matchesNothing(filter))
				return { count: rows.filter((event) => kept.some((filter) => matchesEvent(event, filter))).length, approximate: false }
			},
			remove: async (refs): Promise<{ removed: number }> => {
				calls.push('remove')
				const ids = new Set<string>()
				for (const ref of refs) {
					if (typeof ref === 'string') ids.add(ref)
					else {
						const list = toFilters(ref)
						for (const event of rows) {
							if (list.some((filter) => !matchesNothing(filter) && matchesEvent(event, filter))) ids.add(event.id)
						}
					}
				}
				const kept = rows.filter((event) => !ids.has(event.id))
				const removed = rows.length - kept.length
				rows = kept
				return { removed }
			},
			changes,
		},
	}
}

/**
 * The **echoing** endpoint: it returns its whole local set for any filter and never applies
 * the predicate. It exists **only** so the filter-boundary case can be proved to fail over it
 * (`#e391d0`) — a fixture that accepts a filter the model would reject is the defect this
 * fake reproduces on purpose, never a backend.
 */
export function echoingEndpoint(events: Event[] = []): EndpointFixture {
	const store = [...events]
	const calls: string[] = []
	const reads: FilterIn[][] = []
	const writes: Event[][] = []
	const changes = new ChangeFeed()

	return {
		calls,
		reads,
		writes,
		changes,
		endpoint: {
			tier: 'local',
			read: async (filters): Promise<Event[]> => {
				calls.push('read')
				reads.push(toFilters(filters))
				return [...store]
			},
			write: async (events): Promise<{ stored: number; refused: number }> => {
				calls.push('write')
				writes.push([...events])
				store.push(...events)
				return { stored: events.length, refused: 0 }
			},
			count: async (_filters): Promise<CountResult> => {
				calls.push('count')
				return { count: store.length, approximate: false }
			},
			remove: async (_refs): Promise<{ removed: number }> => {
				calls.push('remove')
				return { removed: 0 }
			},
			changes,
		},
	}
}

/**
 * An endpoint that **records every call before it throws from every method** — the
 * structural half of M5/proof (`#e6aa61`). A composition that needed a store cannot pass by
 * simply not being wired to one: the fake is wired in, so any call at all is recorded and
 * fatal, and a refusal reaches the caller as this module's typed error rather than a bare one.
 */
export function throwingEndpoint(): { endpoint: StoreEndpoint; calls: string[] } {
	const calls: string[] = []
	const refuse = (method: string): never => {
		calls.push(method)
		throw new EventAccessError('rejected', `the fake endpoint was called: ${method} — the composition must surface this`)
	}
	return {
		calls,
		endpoint: {
			tier: 'local',
			read: async () => refuse('read'),
			write: async () => refuse('write'),
			count: async () => refuse('count'),
			remove: async () => refuse('remove'),
			changes: {
				[Symbol.asyncIterator]: () => refuse('changes'),
			},
		},
	}
}

/**
 * A **foreign** failure: `EventAccessError` is *this module's* class, and a sibling may not
 * import it (`#0c7fe3`), so this is the only kind of error a real implementer of the port can
 * throw — the store's own `StoreError` at I3. A fixture that throws the consumer's own class
 * certifies the surface while the wrapper is absent, which is why this one exists.
 */
export class ForeignError extends Error {
	readonly reason = 'rejected'

	constructor(method: string) {
		super(`a foreign endpoint refused: ${method}`)
		this.name = 'ForeignError'
	}
}

/**
 * An endpoint whose every member throws a **foreign** error. It is the fixture the W4a review
 * required: over it, every caller-facing verb must still refuse with an `EventAccessError`
 * carrying a `Reason`, because the composition surfaces a foreign refusal as its own (D-O5, E5).
 */
export function foreignEndpoint(): { endpoint: StoreEndpoint; calls: string[] } {
	const calls: string[] = []
	const refuse = (method: string): never => {
		calls.push(method)
		throw new ForeignError(method)
	}
	return {
		calls,
		endpoint: {
			tier: 'local',
			read: async () => refuse('read'),
			write: async () => refuse('write'),
			count: async () => refuse('count'),
			remove: async () => refuse('remove'),
			changes: {
				[Symbol.asyncIterator]: () => refuse('changes'),
			},
		},
	}
}

/* ---------------------------------------------------------------------------------------
 * The upstream (seam) fakes.
 * --------------------------------------------------------------------------------------- */

/** An upstream that records every call before it throws from every method (`#e6aa61`). */
export function throwingUpstream(): { upstream: NostrIo; calls: string[] } {
	const calls: string[] = []
	const refuse = (method: string): never => {
		calls.push(method)
		throw new EventAccessError('rejected', `the fake upstream was called: ${method} — the composition must surface this`)
	}
	return {
		calls,
		upstream: {
			query: async () => refuse('query'),
			subscribe: () => refuse('subscribe'),
			publish: async () => refuse('publish'),
		},
	}
}

export interface UpstreamScript {
	events?: Event[]
	eose?: boolean
	failures?: EventAccessError[]
	acks?: UpstreamAck[]
	reason?: Reason
}

/**
 * An upstream that **records every call and answers** from a script: the fill's events and
 * boundary, the live stream, and the publish acks. A refusal mid-read is a value on
 * `failures`; a seam-level failure is the `fail` configuration.
 */
export function recordingUpstream(
	script: UpstreamScript = {},
	shared: string[] = [],
): {
	upstream: NostrIo
	calls: string[]
	queries: FilterIn[][]
	live: Subject<Event>
	fail: (error: EventAccessError) => void
} {
	const calls = shared
	const queries: FilterIn[][] = []
	const live = new Subject<Event>()
	const liveErrors = new Subject<EventAccessError>()
	const liveSubscription: Subscription = {
		events: live.asObservable(),
		errors: liveErrors.asObservable(),
		unsubscribe: () => undefined,
	}
	return {
		calls,
		queries,
		live,
		fail: (error) => liveErrors.next(error),
		upstream: {
			query: async (filters): Promise<WireResult> => {
				calls.push('query')
				queries.push(toFilters(filters))
				return { events: script.events ?? [], eose: script.eose ?? true, failures: script.failures ?? [] }
			},
			subscribe: (filters): Subscription => {
				calls.push('subscribe')
				queries.push(toFilters(filters))
				return liveSubscription
			},
			publish: async (event): Promise<UpstreamPublishOutcome> => {
				calls.push('publish')
				return { id: event.id, acks: script.acks ?? [] }
			},
		},
	}
}

/** A second upstream fake, written independently: a bare request/answer function, no script. */
export function bareUpstream(answer: Event[] = []): { upstream: NostrIo; calls: string[] } {
	const calls: string[] = []
	return {
		calls,
		upstream: {
			query: async () => {
				calls.push('query')
				return { events: answer, eose: true, failures: [] }
			},
			subscribe: () => {
				calls.push('subscribe')
				const silent = new Subject<Event>()
				return { events: silent.asObservable(), errors: new Subject<EventAccessError>().asObservable(), unsubscribe: () => undefined }
			},
			publish: async () => {
				calls.push('publish')
				return { id: 'x', acks: [] }
			},
		},
	}
}

/** An upstream that records the call and then **never answers** (LF-5's deadline path). */
export function neverAnsweringUpstream(): { upstream: NostrIo; calls: string[] } {
	const calls: string[] = []
	return {
		calls,
		upstream: {
			query: async (): Promise<WireResult> => {
				calls.push('query')
				return new Promise<WireResult>(() => undefined)
			},
			subscribe: (): Subscription => {
				calls.push('subscribe')
				const silent = new Subject<Event>()
				return { events: silent.asObservable(), errors: new Subject<EventAccessError>().asObservable(), unsubscribe: () => undefined }
			},
			publish: async (): Promise<UpstreamPublishOutcome> => {
				calls.push('publish')
				return new Promise<UpstreamPublishOutcome>(() => undefined)
			},
		},
	}
}

/** An upstream whose every method fails with a stated reason (LF-6's throwing pool). */
export function failingUpstream(reason: Reason = 'timeout'): { upstream: NostrIo; calls: string[] } {
	const calls: string[] = []
	const fail = (method: string): never => {
		calls.push(method)
		throw new EventAccessError(reason, `the relay did not answer: ${method}`)
	}
	return {
		calls,
		upstream: {
			query: async () => fail('query'),
			subscribe: () => fail('subscribe'),
			publish: async () => fail('publish'),
		},
	}
}

/* ---------------------------------------------------------------------------------------
 * The pool fake: the host side of the shape the loader family drives (Increment 3).
 * --------------------------------------------------------------------------------------- */

/**
 * A **pool** fake — a hand-written `UpstreamPool`, recording every request and answering from a
 * script — so a case can prove the fill went **through the loader** (the pool is dialled with the
 * ids the loader was pointed at) and that the **live** path did not (a `Loader` is a fetch, never a
 * live REQ, so the live path must leave this pool silent). No vendor package is imported here, and
 * nothing in this file constructs a socket: `request` returns a stream, like every other fake.
 */
export function recordingPool(events: Event[] = []): {
	pool: UpstreamPool
	calls: string[]
	relays: string[][]
	requests: FilterIn[][]
} {
	const calls: string[] = []
	const relays: string[][] = []
	const requests: FilterIn[][] = []
	return {
		calls,
		relays,
		requests,
		pool: {
			request: (urls, filters) => {
				calls.push('request')
				relays.push([...urls])
				requests.push(toFilters(filters))
				return of(...events)
			},
		},
	}
}

/* ---------------------------------------------------------------------------------------
 * Bounded collection: a stream that never emits fails a case instead of hanging it.
 * --------------------------------------------------------------------------------------- */

/**
 * Up to `n` values from a stream, and **a rejection if they do not arrive** — so a case
 * waits with an explicit timeout and never hangs. This is the tree's only `setTimeout`, and
 * it lives here rather than in the implementation on purpose.
 */
export async function collect<T>(source: Observable<T>, n: number, ms = 800): Promise<T[]> {
	const out: T[] = []
	let subscription: RxSubscription | undefined
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		await new Promise<void>((resolve, reject) => {
			timeout = setTimeout(() => reject(new Error(`collect: only ${out.length} of ${n} value(s) arrived within ${ms} ms`)), ms)
			subscription = source.subscribe({
				next: (value) => {
					out.push(value)
					if (out.length >= n) resolve()
				},
				error: (error: unknown) => reject(error instanceof Error ? error : new Error('the stream failed')),
				complete: () => reject(new Error(`collect: the stream ended after ${out.length} of ${n} value(s)`)),
			})
		})
	} finally {
		clearTimeout(timeout)
		subscription?.unsubscribe()
	}
	return out
}

/** Settle after `ms`, so a case can prove a negative (nothing arrived) without hanging. */
export function quiet(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
