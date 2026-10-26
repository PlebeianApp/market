/**
 * index.ts — the contract entry: the seam itself, and exactly the symbols the
 * module MD's `contract.exports` and `contract.types` name.
 *
 * **What is genuinely ours** (`#bbfa5c`): the specified contract, the store-free
 * guarantee, the reason and outcome mapping, the injected relay policy, and the
 * multi-backend proof. The vendor supplies sockets, not the contract.
 *
 * The seam owns the wire and nothing else. It keeps **no store and no cache**,
 * `#010fc8` (provenance): every read is a wire read, `#3a5789` (provenance), `query` reports the wire's
 * EOSE and stops there (`#10b5ac`), `publish` reports one ack per targeted relay
 * and writes nothing locally (`#ae22a4`), and the relay set is the injected policy's
 * answer on every call — never added to, preferred, reordered or blacklisted
 * (`#06200d`). Two composers may run two seams in one process without sharing a
 * socket, a subscription or a relay set (`#3820a9`): the seam holds no global
 * state and no singleton pool.
 *
 * **Every failure path is typed** (`#5ecac1`, `#15aa73`). A refusal is a value from
 * the contract's own vocabulary on whatever channel the operation has: the live
 * channels of a subscription, and the `failures` list of a read. A bare library
 * `Error` from an injected pool reaches the caller on no channel at all, and a
 * relay that refuses mid-read does not throw away the events that already arrived.
 *
 * Nothing here reads this repository, the app or a host global. The specifier
 * allow-list is `./<module file>`, `applesauce-relay[/…]`, `nostr-tools[/…]`,
 * `rxjs` and `bun:test` (tests only); `evidence/run.sh` diffs it.
 */
import { EMPTY, Observable, ReplaySubject, Subject, catchError, map, merge, of, share, takeUntil, tap, timer } from 'rxjs'

import { RelaySeamError } from './errors'
import { mapClosedReason, normalizeRelayUrl, toFilterArray, uniqueRelays } from './pool'
import { relayPoolAdapter } from './relay-adapter'
import type {
	CountResult,
	Event,
	FilterIn,
	NostrIo,
	NostrIoOptions,
	PoolPort,
	PoolSubscription,
	PublishOutcome,
	QueryOptions,
	RelayAck,
	RelayPolicy,
	RelayStatus,
	RelayUrl,
	SubscribeOptions,
	Subscription,
	WireResult,
} from './types'

/**
 * #751387 — MAX_EVENTS_PER_READ: the **stated ceiling on one read**. A read retains at most this many events. At
 * the ceiling the seam stops reading — it unsubscribes the source and resolves with
 * `eose: false`, because the wire's boundary was not reached — instead of growing
 * one array for as long as a relay keeps talking. It is a declared value rather
 * than a number buried in a branch, and it is the module's own bound: the caller's
 * deadline bounds the *wait*, this bounds the *buffer*.
 */
const MAX_EVENTS_PER_READ = 10_000

/**
 * A wire failure as the contract's own error. A pool may raise anything; the seam
 * raises one typed refusal whose `reason` is a value from the vocabulary
 * (`#5ecac1`), and the mapping runs through the same pure function the adapter uses.
 */
function asRelaySeamError(error: unknown): RelaySeamError {
	if (error instanceof RelaySeamError) return error
	const message = error instanceof Error ? error.message : 'the wire failed'
	return new RelaySeamError(mapClosedReason(message), message)
}

/**
 * The identity a pool files a relay under, for the comparisons the seam makes
 * (D12): the module's own normalising predicate — `pool.ts:normalizeRelayUrl`, the
 * one `status()` already uses. A URL that cannot be normalised is a **typed
 * refusal**, never an invented answer about a relay nobody can ask about.
 */
function relayIdentity(url: RelayUrl): string {
	try {
		return normalizeRelayUrl(url)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'not a relay URL'
		throw new RelaySeamError('rejected', `${url} is not a relay URL: ${message}`)
	}
}

/**
 * A transport that throws instead of answering is a refusal like any other: a
 * bare `Error` from an injected pool never reaches the caller, because the
 * contract's reasons are the seam's own types (`#5ecac1`). A rejection is for the
 * caller's own errors — a malformed filter, a policy that cannot answer, a relay
 * set the transport cannot open — never for a relay that refuses mid-read, which
 * is a value on the read's failure channel instead.
 */
function refuse(error: unknown): never {
	throw asRelaySeamError(error)
}

/**
 * The seam. One instance owns one pool, one policy and no store.
 */
class Seam implements NostrIo {
	private readonly pool: PoolPort
	private readonly policy: RelayPolicy

	constructor(options: NostrIoOptions) {
		this.pool = options.pool ?? relayPoolAdapter()
		this.policy = options.policy
	}

	/**
	 * The relay set is the policy's, read here inside the operation's own guard so
	 * that a policy that cannot answer is a typed refusal rather than a bare `Error`
	 * (`#5ecac1`). Health is **reported**, from the pool's own observation of the
	 * relay it holds (`#b14090`): this is a status read, not a dial, and a relay URL
	 * the pool cannot be asked about is a refusal rather than an invented
	 * "not connected".
	 */
	async connect(): Promise<RelayStatus[]> {
		try {
			return this.pool.status(uniqueRelays(this.policy('connect')))
		} catch (error) {
			return refuse(error)
		}
	}

	/**
	 * A wire read. Resolves with what arrived and whether the wire's boundary was
	 * reached; a deadline that fires reports `eose: false` rather than inventing
	 * completeness (`#10b5ac`). A refusal that arrives **mid-read** is a value on
	 * `failures` — the events that already arrived are kept, and `eose: false` is
	 * the boundary fact — and the read stops at the stated ceiling.
	 */
	async query(filters: FilterIn | FilterIn[], opts: QueryOptions = {}): Promise<WireResult> {
		const events: Event[] = []
		const failures: RelaySeamError[] = []

		let relays: RelayUrl[]
		try {
			relays = uniqueRelays(this.policy('query'))
		} catch (error) {
			return refuse(error)
		}
		if (opts.signal?.aborted) return { events, eose: false, failures }

		let source: Observable<Event>
		try {
			source = this.pool.request(relays, toFilterArray(filters), { signal: opts.signal })
		} catch (error) {
			return refuse(error)
		}

		// The caller's deadline is a **wall-clock** budget on the whole read, not an
		// inactivity gap: a wire that keeps emitting without ever reaching EOSE is
		// stopped by it just the same.
		let timedOut = false
		let truncated = false
		const capReached = new Subject<void>()
		let bounded = source.pipe(takeUntil(capReached))
		if (opts.deadlineMs !== undefined) {
			const deadline = timer(opts.deadlineMs).pipe(
				tap(() => {
					timedOut = true
				}),
			)
			bounded = bounded.pipe(takeUntil(deadline))
		}

		await new Promise<void>((resolve) => {
			bounded.subscribe({
				next: (event) => {
					events.push(event)
					if (events.length >= MAX_EVENTS_PER_READ) {
						truncated = true
						capReached.next()
					}
				},
				// A relay refusal mid-read is a value, not a rejection, and the arrivals
				// are never discarded because a later relay refused.
				error: (error: unknown) => {
					failures.push(asRelaySeamError(error))
					resolve()
				},
				complete: () => resolve(),
			})
		})

		return { events, eose: !timedOut && !truncated && failures.length === 0, failures }
	}

	/**
	 * A live subscription. Its cancellation is idempotent (`#15aa73`), and a relay
	 * failure inside it reaches `errors` rather than ending `events` silently —
	 * including a failure on the pool's own `events`, `eose` or `failures` stream,
	 * which is mapped to the contract's refusal rather than passed through as the
	 * library's `Error`.
	 */
	subscribe(filters: FilterIn | FilterIn[], opts: SubscribeOptions = {}): Subscription {
		// A subscription that cannot be opened is a refusal on the error channel, not
		// a silent absence and not a synchronous throw at the caller. A policy that
		// cannot answer is the same refusal.
		const open = (): PoolSubscription | RelaySeamError => {
			try {
				return this.pool.subscribe(uniqueRelays(this.policy('subscribe')), toFilterArray(filters))
			} catch (error) {
				return asRelaySeamError(error)
			}
		}
		const opened = open()
		if (opened instanceof RelaySeamError) {
			return { events: EMPTY, errors: of(opened), unsubscribe: () => undefined }
		}
		const inner = opened

		let closed = false
		const unsubscribe = (): void => {
			if (closed) return
			closed = true
			inner.unsubscribe()
		}

		if (opts.signal) {
			if (opts.signal.aborted) unsubscribe()
			else opts.signal.addEventListener('abort', unsubscribe, { once: true })
		}

		// The refusals this seam *derives* from a channel that itself failed. Buffered
		// one deep, so a caller who subscribes to `errors` after `events` still sees
		// the refusal: the channel is typed, and nothing is a silent absence.
		const refusals = new ReplaySubject<RelaySeamError>(1)

		const carried = inner.events.pipe(
			catchError((error: unknown) => {
				refusals.next(asRelaySeamError(error))
				return EMPTY
			}),
		)

		/**
		 * `closeOnEose`: end the stream at the wire's boundary. The source is
		 * subscribed **first**, so an EOSE the pool already holds cannot complete the
		 * output before the events that preceded it — and an `eose` stream that dies
		 * is a refusal on the error channel like any other.
		 */
		const atEose = (stream: Observable<Event>): Observable<Event> =>
			new Observable<Event>((subscriber) => {
				const eventsSub = stream.subscribe(subscriber)
				const eoseSub = inner.eose.subscribe({
					next: () => {
						unsubscribe()
						subscriber.complete()
					},
					error: (error: unknown) => {
						refusals.next(asRelaySeamError(error))
						subscriber.complete()
					},
				})
				return () => {
					eoseSub.unsubscribe()
					eventsSub.unsubscribe()
				}
			})

		const events = opts.closeOnEose ? atEose(carried) : carried
		const errors = merge(
			inner.failures.pipe(
				map((failure) => new RelaySeamError(failure.reason, failure.message ?? `relay ${failure.relay} did not answer`)),
				// a pool whose own failure channel dies still reports a typed refusal
				catchError((error: unknown) => of(asRelaySeamError(error))),
			),
			refusals,
		).pipe(share())

		return { events, errors, unsubscribe }
	}

	/**
	 * One EVENT to the injected set, one ack per targeted relay, and no local write
	 * (`#ae22a4`). An ack the pool did not supply is reported as a refusal rather
	 * than dropped, so the target set and the acks line up one for one.
	 */
	async publish(event: Event): Promise<PublishOutcome> {
		let relays: RelayUrl[]
		let acks: RelayAck[]
		try {
			relays = uniqueRelays(this.policy('publish'))
			acks = await this.pool.publish(relays, event)
		} catch (error) {
			return refuse(error)
		}
		let complete: RelayAck[]
		try {
			// A relay's own answer is filed under the identity the pool holds it by — the
			// normalised URL (`relay.js:653`, `:674`; `group.js:8-10`) — while the host
			// answered with its own spelling (160 of 170 relay strings in the market omit
			// the trailing slash). The match runs under the module's own normalising
			// predicate, the one `status()` uses; the ack handed back keeps the **host's**
			// spelling, because that is the caller's own answer (`#ae22a4`, D12). A target
			// URL that cannot be normalised is a typed refusal, never an invented
			// "no acknowledgement".
			const byUrl = new Map(acks.map((ack) => [relayIdentity(ack.url), ack] as const))
			complete = relays.map((url): RelayAck => {
				const ack = byUrl.get(relayIdentity(url))
				return ack ? { ...ack, url } : { url, accepted: false, reason: 'rejected', message: 'no acknowledgement from this relay' }
			})
		} catch (error) {
			return refuse(error)
		}
		return { id: event.id, acks: complete }
	}

	/**
	 * NIP-45's COUNT (`#d433f1`), carrying the relay's own approximation flag
	 * (`#752c02`) and never fetching the events it counts.
	 */
	async count(filters: FilterIn | FilterIn[]): Promise<CountResult> {
		let result: CountResult
		try {
			result = await this.pool.count(uniqueRelays(this.policy('count')), toFilterArray(filters))
		} catch (error) {
			return refuse(error)
		}
		return { count: result.count, approximate: result.approximate }
	}

	close(): void {
		try {
			this.pool.close()
		} catch (error) {
			refuse(error)
		}
	}
}

/** #fbfce3 — createNostrIo: the contract's factory; with no pool injected, the vendor adapter is wired. */
function createNostrIo(options: NostrIoOptions): NostrIo {
	return new Seam(options)
}

export { createNostrIo, RelaySeamError, MAX_EVENTS_PER_READ }
export { toUpstreamPool } from './pool'
export type {
	Event,
	FilterIn,
	RelayUrl,
	RelaySet,
	RelayReason,
	RelayStatus,
	NostrRequest,
	UpstreamPool,
	QueryOptions,
	WireResult,
	SubscribeOptions,
	Subscription,
	Unsub,
	RelayAck,
	PublishOutcome,
	CountResult,
	RelayPolicy,
	NostrIoOptions,
	NostrIo,
} from './types'
