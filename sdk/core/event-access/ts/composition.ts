/**
 * composition.ts — the composition itself: the five verbs, the envelope, the local-first
 * sequence, the merge, the write-back application, the filter boundary, the local change
 * fan-out and the provenance companion read.
 *
 * **The job, in one sentence** (`#30c592`): answer a caller's event operations over **both
 * tiers** — the store's local endpoint and the injected upstream seam — merging them
 * local-first with **one declared, inspectable write-back policy** and reporting, honestly,
 * whether the answer is complete.
 *
 * The sequence is normative per named path (`#68a0c1`): P1 `query{localFirst:true}` ·
 * P2 `query{localFirst:false}` · P3 `subscribe` · P4 `publish` · P5 the pointer read (a
 * `query` whose filter carries a single id) · P6 `count` · P7 `delete`. The local answer
 * precedes any network participation (LF-1) and is never withheld (LF-5, LF-6); the
 * fill's events are written back through the endpoint unless the policy says otherwise
 * (LF-2); a later write reaches **every** open subscription exactly once (LF-3).
 *
 * **No socket, no store, no app import** (`#f775fb`, `#e6aa61`, `#0c7fe3`). Filters reach
 * neither tier before the endpoint's own read has accepted them — the fail-closed boundary
 * is reached **by calling the endpoint**, and no second predicate is grown here (D-O5).
 * Nothing in this file names a store, a cache, the app, or a relay handle, and no specifier
 * leaves this module's directory.
 *
 * **Two contract points this file is answerable for, and where each is answered.**
 *
 * 1. **The endpoint's refusal is surfaced as this module's own** (E5, D-O5): every call into
 *    the first port goes through one of the four guarded members below, so a foreign error —
 *    the store's own `StoreError`, at I3 — leaves the composition as an `EventAccessError`
 *    carrying a `Reason`. The fixture must not supply that type; a test fixture that throws
 *    the consumer's own class would certify the surface while the wrapper was absent.
 * 2. **One change pump per handle, fanned out to every open subscription** (LF-3, M13). The
 *    endpoint's `changes` is iterated **once** per composition handle, and every event is
 *    delivered to **each** open subscription — so LF-3's plural claim holds whatever the
 *    port's `changes` does for a second iterating consumer (a shared queue and a single
 *    wake would otherwise serve the first subscriber and starve the rest). The fan-out is
 *    the composition's, not the caller's, which is the same rule the id-unique union follows.
 *
 * **Increment 3 — fetch → the library, live → us.** The bounded fill (the `network()` step of
 * `query`, and only it) now takes an **injected loader-backed function** (`FillRequest`, built
 * over the one pool by `createLoaderBackedFill` below) instead of reaching the seam directly;
 * with none injected it is the seam's own read, which is what every pre-existing case here
 * exercises. The live fill stays the seam's subscription (`:457`'s `this.upstream.subscribe`,
 * unchanged), the publish path stays the seam's (`:531`), and **everything the composition owns
 * stays here**: the merge order (LF-1), the write-back policy (LF-2), the one accept gate, the
 * wall-clock deadline that bounds the fill from outside, and the failure channel — a loader that
 * cannot answer returns its refusal as a value and never unseats the local answer (LF-5, LF-6).
 */
import { ReplaySubject, Subject, firstValueFrom, timer, toArray } from 'rxjs'
import { matchFilters } from 'nostr-tools/filter'
import { createEventLoader } from 'applesauce-loaders/loaders'
import { wrapUpstreamPool } from 'applesauce-loaders/helpers'
import type { Observable } from 'rxjs'

import { EventAccessError } from './errors'
import { toFilterArray, toRefArray } from './filters'
import { Union } from './merge'
import { DEFAULT_WRITE_BACK, applyWriteBack, isExcluded } from './policy'
import type {
	AcceptContext,
	AcceptDecision,
	AnswerOrigin,
	CountResult,
	DeleteOutcome,
	DeleteRef,
	Event,
	EventAccess,
	EventAccessOptions,
	FillRequest,
	FilterIn,
	LoaderFillOptions,
	NostrIo,
	PublishOptions,
	PublishOutcome,
	QueryOptions,
	QueryResult,
	Reason,
	ReferenceResolver,
	StoreEndpoint,
	SubscribeOptions,
	Subscription,
	UpstreamPublishOutcome,
	UpstreamPool,
	WireResult,
	WriteBackPolicy,
} from './types'

/** `#8cd1d6` — the read's declared default deadline, in milliseconds. */
const DEFAULT_DEADLINE_MS = 8000

/**
 * The provenance record, **per answer and per id** (`#42626d`, D-O2). The envelope is not
 * widened (`#dce3ab` keeps exactly `{events, complete}`), so the record is filed against the
 * answer object itself and read back by the declared companion read — never a flag mutated
 * on a shared event instance, which is the vendor's single sticky bit this module refuses
 * (provenance) `#5015f4`.
 */
const ANSWERS = new WeakMap<QueryResult, Map<string, AnswerOrigin>>()

/** #42626d — originOf: the declared companion read, the tier that produced an id within **this** answer. */
export function originOf(answer: QueryResult, id: string): AnswerOrigin {
	const origin = ANSWERS.get(answer)?.get(id)
	if (origin === undefined) {
		throw new EventAccessError('not-found', `this answer carries no event ${id}`)
	}
	return origin
}

/**
 * A bare `Error` from an injected port never reaches the caller: the reasons are ours
 * (`#c65b19`'s shape, E5). This is the **one** place a foreign failure becomes this module's
 * own refusal, and every guarded member below runs through it.
 */
function asEventAccessError(error: unknown): EventAccessError {
	if (error instanceof EventAccessError) return error
	const message = error instanceof Error ? error.message : 'the operation failed'
	return new EventAccessError('rejected', message)
}

/** A sentinel for the deadline, so a bounded read is a value rather than a rejection. */
const DEADLINE = Symbol('event-access deadline')

/**
 * Bound a promise by a wall-clock budget. A pool that never answers resolves as the deadline
 * sentinel rather than leaving the caller's read pending (LF-5), and the budget is the
 * composition's, not the seam's. A work promise that settles **after** the deadline wins is
 * still handled here, so a late failure is never an unhandled rejection.
 */
function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T | typeof DEADLINE> {
	return new Promise<T | typeof DEADLINE>((resolve, reject) => {
		let settled = false
		const budget = timer(deadlineMs).subscribe(() => {
			settled = true
			resolve(DEADLINE)
		})
		work.then(
			(value) => {
				if (settled) return
				settled = true
				budget.unsubscribe()
				resolve(value)
			},
			(error: unknown) => {
				if (settled) return
				settled = true
				budget.unsubscribe()
				reject(error)
			},
		)
	})
}

/** One open subscription's delivery channels, as the fan-out sees them. */
interface ChangeSubscriber {
	deliver(event: Event): void
	fail(error: EventAccessError): void
}

/** The composition. One instance holds the two ports and the declared policy, and nothing else. */
class Composition implements EventAccess {
	readonly policy: WriteBackPolicy
	private readonly endpoint: StoreEndpoint
	private readonly upstream: NostrIo
	/** The injected link resolver (D-O21); absent means a reference resolves against the local set. */
	private readonly resolver: ReferenceResolver | undefined
	/**
	 * **The bounded fill's read** (Increment 3): a loader-backed function when one is wired, absent
	 * otherwise. This module never learns what a loader is made of — it is handed a function and calls
	 * it — which is how the fill moves to the library without a vendor type entering a signature.
	 */
	private readonly fill: FillRequest | undefined

	/**
	 * The change fan-out: **one** iteration of the endpoint's `changes` per handle, delivered
	 * to every open subscription. Started lazily by the first subscriber, kept for the handle's
	 * life, and never torn down by one subscription's cancellation — a subscriber that leaves
	 * removes only itself.
	 */
	private readonly subscribers = new Set<ChangeSubscriber>()
	private changesStarted = false
	private changesFailed: EventAccessError | undefined

	constructor(options: EventAccessOptions) {
		this.endpoint = options.endpoint
		this.upstream = options.upstream
		this.fill = options.fill
		this.policy = options.policy ?? DEFAULT_WRITE_BACK
		this.resolver = options.resolver
	}

	/* --- the four guarded members: every call into the first port ------------------------- */

	/** `#bec31a` — the tier the endpoint declares is what the merge marks its answers with. */
	private endpointOrigin(): AnswerOrigin {
		return this.endpoint.tier === 'local' ? 'local' : 'network'
	}

	private async readEndpoint(filters: FilterIn[]): Promise<Event[]> {
		try {
			return await this.endpoint.read(filters)
		} catch (error) {
			throw asEventAccessError(error)
		}
	}

	/* --- the one gate (D-O21), the three destinations and the link half ------------------- */

	/**
	 * **The decision itself** (`#c8e35c`, D-O9, D-O21; constitution §10.1). It takes a set and returns
	 * the subset it accepts; it does not know where the set came from or where it is going. It is called
	 * from **the three destination boundaries** — the consumer delivery, the store
	 * write and the wire publish — so the number of application points falls out of the structure rather
	 * than being remembered at each flow. `policy.accept` absent means accept everything.
	 *
	 * **Bounded by the destination's own wall-clock budget:** a hook that has not answered within `budgetMs`
	 * drops its candidate, and a hook that throws does the same — fail-closed, because an event the
	 * gate could not accept is not accepted. A dropped event is **not** an incomplete answer
	 * (`#87b422`): `complete` is a fact about the wire's boundary and never moves because of the gate.
	 * The rule never learns which boundary it is policing (flow was removed per the maintainer's
	 * 2026-10-02 ruling).
	 */
	private async gate(events: readonly Event[], budgetMs: number): Promise<Event[]> {
		const hook = this.policy.accept
		if (hook === undefined) return [...events]

		const context: AcceptContext = {
			tier: this.endpoint.tier === 'local' ? 'local' : 'remote',
			resolve: (reference: string) => this.resolveReference(reference),
		}

		const kept: Event[] = []
		for (const event of events) {
			let decision: AcceptDecision | typeof DEADLINE
			try {
				decision = await withDeadline(Promise.resolve(hook(event, context)), budgetMs)
			} catch {
				continue // fail-closed: an unanswerable candidate is not accepted
			}
			if (decision === DEADLINE) continue
			if (decision === 'accept') kept.push(event)
		}
		return kept
	}

	/**
	 * **The link half** (D-O21): a reference resolves through the injected resolver when one is
	 * supplied, otherwise against the endpoint's own local set — through this module's **existing**
	 * read path, so no second read path is grown for it and no second predicate is introduced.
	 * A reference the local set does not hold answers `undefined`; a reference that is held and
	 * mismatches is the gate's own comparison, which is a different fact (`#7f4e0a`).
	 */
	private async resolveReference(reference: string): Promise<Event | undefined> {
		if (this.resolver !== undefined) return this.resolver(reference)
		const held = await this.readEndpoint([{ ids: [reference] }])
		return held[0]
	}

	private async writeEndpoint(events: readonly Event[]): Promise<{ stored: number; refused: number }> {
		try {
			return await this.endpoint.write([...events])
		} catch (error) {
			throw asEventAccessError(error)
		}
	}

	private async countEndpoint(filters: FilterIn[]): Promise<CountResult> {
		try {
			return await this.endpoint.count(filters)
		} catch (error) {
			throw asEventAccessError(error)
		}
	}

	private async removeEndpoint(refs: DeleteRef[]): Promise<DeleteOutcome> {
		try {
			return await this.endpoint.remove(refs)
		} catch (error) {
			throw asEventAccessError(error)
		}
	}

	/**
	 * **The bounded fill's read** (Increment 3): the injected loader-backed function when one is
	 * wired, otherwise the seam's own read. The seam is never bypassed by accident — a host that wires
	 * no fill gets exactly the pre-increment behaviour — and the composition does not learn which of
	 * the two it called, so nothing downstream can branch on it.
	 */
	private fillRead(filters: FilterIn[]): Promise<WireResult> {
		return this.fill !== undefined ? this.fill(filters) : this.upstream.query(filters)
	}

	/* --- the change fan-out -------------------------------------------------------------- */

	private failChanges(error: EventAccessError): void {
		this.changesFailed = error
		for (const subscriber of [...this.subscribers]) subscriber.fail(error)
	}

	private pumpChanges(): void {
		if (this.changesStarted) return
		this.changesStarted = true
		const run = async (): Promise<void> => {
			let iterator: AsyncIterator<Event>
			try {
				iterator = this.endpoint.changes[Symbol.asyncIterator]()
			} catch (error) {
				this.failChanges(asEventAccessError(error))
				return
			}
			try {
				for (;;) {
					const next = await iterator.next()
					if (next.done) {
						this.changesStarted = false
						return
					}
					for (const subscriber of [...this.subscribers]) subscriber.deliver(next.value)
				}
			} catch (error) {
				this.failChanges(asEventAccessError(error))
			}
		}
		void run()
	}

	/** Register a subscriber. A handle whose pump already refused hands the reason on at once. */
	private subscribeToChanges(subscriber: ChangeSubscriber): void {
		this.subscribers.add(subscriber)
		if (this.changesFailed) {
			subscriber.fail(this.changesFailed)
			return
		}
		this.pumpChanges()
	}

	/* --- the operations ------------------------------------------------------------------ */

	/**
	 * A read over both tiers. The sequence is local-first by default: the endpoint's read
	 * answers first (LF-1), the seam's fill follows, the fill's fresh events are written back
	 * through the endpoint (LF-2) unless the policy says otherwise, and the answer is the
	 * id-unique union (M2) with `complete` reported honestly.
	 *
	 * With `localFirst:false` the **merge order** is inverted, not the calls: the fill is attempted
	 * only after the endpoint's read has answered — never before it, because no filter may reach the
	 * wire before the predicate has answered (`#f775fb`) — and its fresh events are merged into the
	 * answer **ahead of** the local ones, so the network's freshness leads the answer's order. The local
	 * answer is **never withheld** by a slow or failed relay (LF-5, LF-6), and `complete` is false
	 * whenever the wire's boundary was not reached or a relay failed. The provenance rule does not move
	 * with the order: an id the local read carried is `'local'` on P2 as well (`#34dcaa`).
	 */
	async query(filters: FilterIn | FilterIn[], options: QueryOptions = {}): Promise<QueryResult> {
		const filterArray = toFilterArray(filters)
		const localFirst = options.localFirst ?? true
		const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
		const persist = options.persist ?? true

		const union = new Union()
		const origin = this.endpointOrigin()

		/**
		 * **The boundary first, on every read path** — the repair for the falsification the re-verification
		 * wave recorded on 2026-09-30 (RT-B, and RT-A's 0.1 independently). The endpoint's read is where the
		 * store's predicate refuses a malformed filter (D-O5, `#f775fb`), so it runs **before either tier is
		 * contacted and before anything can be written back**: a refusal therefore reaches the caller with no
		 * side effect behind it. What the two named paths differ in is the order their answers are merged —
		 * and nothing else.
		 */
		const localEvents: Event[] = await this.gate(await this.readEndpoint(filterArray), deadlineMs)

		/** The local answer, consumed at the point the path's merge order requires. */
		const local = async (): Promise<void> => {
			union.take(localEvents, origin)
		}

		/** The fill: bounded by the deadline, merged, and written back through the policy. */
		const network = async (): Promise<{ reached: boolean; failed: boolean }> => {
			let result: WireResult
			try {
				const bounded = await withDeadline(this.fillRead(filterArray), deadlineMs)
				if (bounded === DEADLINE) return { reached: false, failed: true }
				result = bounded
			} catch {
				return { reached: false, failed: true }
			}
			const fresh = union.take(await this.gate(result.events, deadlineMs), 'network')
			await applyWriteBack((batch) => this.writeEndpoint(batch), this.policy, fresh, persist)
			return { reached: result.eose, failed: result.failures.length > 0 }
		}

		const merged = localFirst ? await local().then(network) : await network().then((outcome) => local().then(() => outcome))

		const answer: QueryResult = { events: union.answer(), complete: merged.reached && !merged.failed }
		ANSWERS.set(answer, union.originsOf())
		return answer
	}

	/**
	 * A subscription over both tiers. Its replay is local-first (LF-1): the endpoint's read
	 * answers before the seam is asked, and the fill's fresh events are written back through
	 * the endpoint (LF-2, the subscription fill path). The endpoint's local change stream is
	 * **fanned out from one pump to every open subscription**, so a later write — from a
	 * publish, another read's fill, a deletion or an expiry — reaches each of them exactly once
	 * (LF-3). Cancellation is idempotent (`#239d01`), a signal already aborted opens nothing at
	 * all, and a subscription that cannot live ends with a typed reason on `errors` rather than
	 * being silently dropped.
	 */
	subscribe(filters: FilterIn | FilterIn[], options: SubscribeOptions = {}): Subscription {
		const filterArray = toFilterArray(filters)
		const events = new Subject<Event>()
		// Buffered one deep, so a caller who subscribes to `errors` after the reason was raised
		// still sees it: a refusal is never a silent absence.
		const errors = new ReplaySubject<EventAccessError>(1)
		const seen = new Set<string>()

		let closed = false
		let live: Subscription | undefined

		/** Deliver one event at most once **to this subscription**. Returns true iff it was fresh. */
		const emit = (event: Event): boolean => {
			if (closed || seen.has(event.id)) return false
			seen.add(event.id)
			events.next(event)
			return true
		}
		const fail = (error: unknown): void => {
			if (!closed) errors.next(asEventAccessError(error))
		}

		/**
		 * One event through **the consumer-delivery boundary** (`gate`), in arrival order,
		 * then delivered at most once (D-O21, `#8cb8af`): the chain means an event the rule has not
		 * answered for is never jumped over, while the change fan-out stays synchronous for its caller.
		 *
		 * **The subscription's own filters are applied here** (found by measurement, 2026-09-30, after the
		 * store shrink landed as I3). The endpoint's `changes` is an **unfiltered** local change notification
		 * — necessarily so, since the declared endpoint shape carries no filters — whereas the store's own
		 * live path filtered every write with `matchFilters` before the shrink. Without this line a
		 * subscription to `{kinds:[1]}` receives an unrelated local write, which is a wider answer than it
		 * asked for. `matchFilters` is NIP-01's **reference** implementation, not a predicate of this module:
		 * the fail-closed identity guard stays the endpoint's, and no second one is grown here.
		 */
		let gateChain: Promise<void> = Promise.resolve()
		const deliverGated = (event: Event): void => {
			gateChain = gateChain.then(async () => {
				if (closed) return
				if (!matchFilters(filterArray, event)) return
				if ((await this.gate([event], DEFAULT_DEADLINE_MS)).length === 0) return
				emit(event)
			})
		}

		const subscriber: ChangeSubscriber = {
			deliver: deliverGated,
			fail: (error) => fail(error),
		}

		const unsubscribe = (): void => {
			if (closed) return
			closed = true
			this.subscribers.delete(subscriber)
			live?.unsubscribe()
			events.complete()
			errors.complete()
		}

		// A signal already aborted opens **nothing**: no local read, no seam subscription, no
		// change pump — and a stated reason rather than a subscription that lives on with no way
		// to cancel what it opened.
		if (options.signal?.aborted) {
			errors.next(new EventAccessError('rejected', 'the subscription was aborted before it opened'))
			unsubscribe()
			return { events: events.asObservable(), errors: errors.asObservable(), unsubscribe }
		}

		/** The replay: the local answer first, then the seam's fill, each fresh event written back. */
		const replay = async (): Promise<void> => {
			let local: Event[]
			try {
				local = await this.readEndpoint(filterArray)
			} catch (error) {
				fail(error)
				return
			}
			for (const event of await this.gate(local, DEFAULT_DEADLINE_MS)) emit(event)

			let opened: Subscription
			try {
				opened = this.upstream.subscribe(filterArray, { signal: options.signal, closeOnEose: options.closeOnEose })
			} catch (error) {
				fail(error)
				return
			}
			if (closed) {
				opened.unsubscribe()
				return
			}
			live = opened
			opened.errors.subscribe((error) => fail(error))
			opened.events.subscribe({
				next: (event) => {
					// Through the store boundary (`gate`) before this event is delivered **or**
					// written back (D-O21) — the same one decision the replay and the change fan-out take,
					// routed once to both destinations, in arrival order.
					gateChain = gateChain
						.then(async () => {
							if (closed) return
							if ((await this.gate([event], DEFAULT_DEADLINE_MS)).length === 0) return
							if (!emit(event)) return
							const outcome = await applyWriteBack((batch) => this.writeEndpoint(batch), this.policy, [event], true)
							// `onReject: 'report'` is the one place the policy has a channel to report on:
							// the subscription's own error channel (E5, `#9b7257`). `'skip'` stays silent.
							if (outcome && outcome.refused > 0 && this.policy.onReject === 'report') {
								fail(new EventAccessError('rejected', `${outcome.refused} event(s) the store endpoint refused`))
							}
						})
						.catch((error: unknown) => fail(error))
				},
				error: (error) => fail(error),
			})
		}

		if (options.signal) options.signal.addEventListener('abort', unsubscribe, { once: true })

		this.subscribeToChanges(subscriber)
		if (!options.onlyNew) void replay()

		return { events: events.asObservable(), errors: errors.asObservable(), unsubscribe }
	}

	/**
	 * `publish` writes locally **before or independently of any relay attempt** (`#2ffa85`) and
	 * never depends on a relay accepting: `stored` is the local write's outcome, and
	 * `accepted`/`refused` are the relays' own answers. The publish path leaves through the
	 * **wire-publish boundary** (`gate`), the same one rule a read's write-back applies at
	 * the store boundary (D-O9), so there is one choke point where content can enter the store. A
	 * relay that refuses is a value in `refused`; a seam that
	 * cannot answer at all is a typed refusal — after the local write, which is never undone and
	 * is reported here as the refusals the *relays* gave, never as a silent absence.
	 */
	async publish(events: Event[], options: PublishOptions = {}): Promise<PublishOutcome> {
		// The declared exclusion first — a different rule — then the one rule at the **wire-publish**
		// boundary (`gate`), applied to the outgoing set before the local write and before any
		// relay attempt: a dropped event is neither stored nor handed to the seam, and the relay attempt
		// sees exactly the set the local write saw.
		const permitted = await this.gate(
			events.filter((event) => !isExcluded(event, this.policy.excluded)),
			DEFAULT_DEADLINE_MS,
		)

		let stored = false
		if (permitted.length > 0) {
			const outcome = await this.writeEndpoint(permitted)
			stored = outcome.stored > 0
		}

		const accepted: string[] = []
		const refused: { url: string; reason: Reason }[] = []
		for (const event of permitted) {
			if (options.signal?.aborted) break
			let outcome: UpstreamPublishOutcome
			try {
				outcome = await this.upstream.publish(event)
			} catch (error) {
				throw asEventAccessError(error)
			}
			for (const ack of outcome.acks) {
				if (ack.accepted) accepted.push(ack.url)
				else refused.push({ url: ack.url, reason: ack.reason ?? 'rejected' })
			}
		}

		return { stored, accepted, refused }
	}

	/**
	 * `count` never fetches (M14, `#6de405`): it counts through the store's endpoint and reports
	 * `approximate: false` because the local index is exact. It never consults the wire, so it
	 * has no deadline, no failure mode, and no divergence from a second path.
	 */
	async count(filters: FilterIn | FilterIn[]): Promise<CountResult> {
		const result = await this.countEndpoint(toFilterArray(filters))
		return { count: result.count, approximate: false }
	}

	/**
	 * `delete` routes through the endpoint's removal (P7). The three kinds of deletion are the
	 * store's rule and are never re-implemented here (`#d80075`); the composition decides
	 * nothing, and the resulting change reaches every open subscription on the change fan-out.
	 */
	async delete(refs: DeleteRef | DeleteRef[]): Promise<DeleteOutcome> {
		return this.removeEndpoint(toRefArray(refs))
	}

	/** The declared companion read, filed against this answer (D-O2). */
	originOf(answer: QueryResult, id: string): AnswerOrigin {
		return originOf(answer, id)
	}
}

/* ---------------------------------------------------------------------------------------
 * The loader-backed fill (Increment 3): the one place the fetch is the library's
 * --------------------------------------------------------------------------------------- */

/**
 * The unique ids a filter set names, in the order the filters name them. `P5` — the pointer read —
 * is the one-element case; a filter set that names none has no pointer for the loader to load, which
 * is the branch `createLoaderBackedFill` handles with the pool's own request.
 */
function identityPointers(filters: readonly FilterIn[]): { id: string }[] {
	const seen = new Set<string>()
	const pointers: { id: string }[] = []
	for (const filter of filters) {
		for (const id of filter.ids ?? []) {
			if (seen.has(id)) continue
			seen.add(id)
			pointers.push({ id })
		}
	}
	return pointers
}

/** The loader's last step takes a list **or a stream of lists**; a list is taken as it is, a stream at its first value. */
async function toRelayList(relays: string[] | Observable<string[]> | undefined): Promise<string[]> {
	if (relays === undefined) return []
	return Array.isArray(relays) ? relays : await firstValueFrom(relays)
}

/**
 * **createLoaderBackedFill** — the bounded fill, composed over the one pool **by the loader family**
 * and handed to the composition as a function.
 *
 * The composition is the vendor's own: `createEventLoader(pool, { cacheRequest, extraRelays })`, whose
 * internal sequence is **cache → relay hints → extra relays** (the spec's LF-7 already names it). No
 * adapter sits between the two: `UpstreamPool` is declared in `types.ts` as the seam declares it
 * (`nostr-io/ts/types.ts:54`), and a pool of the seam's own `PoolPort` type is passed straight in —
 * a value whose type is `PoolPort` satisfies this shape with no cast, which the module's compiler
 * proves in `composition.test.ts` (the loader-pool case) rather than this comment asserting it.
 *
 * **Two reads, one function**, because the vendor's event loader is *pointer-addressed* (it is asked
 * for ids and answers those ids) while `query` takes NIP-01 filters:
 *
 * - a filter set carrying ids — `P5`'s pointer read, and packet 4's fetch of a gift wrap by id — is
 *   loaded **through the loader**, so the three steps above are the whole answer;
 * - a filter set carrying none has no pointer to point at, so it is asked of the pool's own request
 *   — the same `NostrRequest` the loader wraps — over the relay set this builder was given. That
 *   branch is not a hand-built fetch grown here: it is the loader family's own request, taken from
 *   the same pool by the same module.
 *
 * **A refusal is a value here, never a rejection** (the failure channel is the composition's, LF-5,
 * LF-6): anything the loader throws is caught and returned on `failures`, so a pool that cannot
 * answer leaves the local answer intact and completeness honest. The deadline is **not** applied
 * here — `withDeadline` bounds this call from outside, because the budget is the composition's.
 *
 * **One pointer at a time, measured, and a loader per request.** Two measured facts about the
 * vendor's batching engine (6.2.0, read and run on 2026-10-14) shape this function. First, one batch
 * shares one upstream subscription and emits it once, with no replay: two loader calls made in the
 * same tick batch into a single request, and the second subscription arrives after those events were
 * emitted and receives nothing — so the pointers are driven sequentially, which keeps every pointer's
 * own answer, and a bounded fill is a one-shot read for which batching buys nothing. Second, the
 * de-duplication memory the loader installs is **per loader**, so a loader kept across requests would
 * answer a second read of the same id with nothing — hence a loader is composed per request and torn
 * down (`stop()`) when its answer has been collected.
 */
export function createLoaderBackedFill(pool: UpstreamPool, options: LoaderFillOptions = {}): FillRequest {
	const request = wrapUpstreamPool(pool)
	return async (filters: FilterIn[]): Promise<WireResult> => {
		const filterArray = toFilterArray(filters)
		const failures: EventAccessError[] = []
		const found: Event[] = []
		/** True once at least one source — the loader's cache step or its relay step — was actually consulted. */
		let consulted = false

		try {
			const relays = await toRelayList(options.extraRelays)
			const pointers = identityPointers(filterArray)
			if (pointers.length > 0) {
				consulted = options.cacheRequest !== undefined || relays.length > 0
				if (consulted) {
					const loader = createEventLoader(pool, {
						cacheRequest: options.cacheRequest,
						extraRelays: options.extraRelays,
						followRelayHints: options.followRelayHints,
						bufferTime: options.bufferTime ?? 0,
						bufferSize: options.bufferSize,
						signal: options.signal,
					})
					try {
						for (const pointer of pointers) {
							found.push(...(await firstValueFrom(loader(pointer).pipe(toArray()))))
						}
					} finally {
						loader.stop()
					}
				}
			} else if (relays.length > 0) {
				consulted = true
				found.push(...(await firstValueFrom(request(relays, filterArray).pipe(toArray()))))
			}
		} catch (error) {
			failures.push(asEventAccessError(error))
		}

		// The caller's filter is applied to what the loader answered, by NIP-01's reference matcher — the
		// same one the subscription path uses — because a pointer read answers *ids* while the filter may
		// carry more than ids. Then the id-unique union's own rule on the fill's side: one copy per id.
		const seen = new Set<string>()
		const events = found
			.filter((event) => matchFilters(filterArray, event))
			.filter((event) => {
				if (seen.has(event.id)) return false
				seen.add(event.id)
				return true
			})

		return {
			events,
			// The march reached its own end when every step ran and nothing failed — and an answer that
			// consulted neither the cache nor a relay is not a complete answer: it is one nobody was asked for.
			eose: consulted && failures.length === 0,
			failures,
		}
	}
}

/** #dc7054 — createEventAccess: the contract's factory — the two injected ports, the optional declared policy,
 *  and the optional injected resolver (D-O21). */
export function createEventAccess(options: EventAccessOptions): EventAccess {
	return new Composition(options)
}
