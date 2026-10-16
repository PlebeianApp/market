/**
 * harness.ts — **the host side** of the module's ports, for the tests.
 *
 * This file is test support, not module code: nothing in the implementation
 * imports it and `index.ts` does not export it. It is where a host's answers are
 * spelled — signed events, the relay policy, and the hand-written pools — which
 * is the point: the module reads no global of its own, opens no socket and holds
 * no timer, so every host edge is written here.
 *
 * **No key, seed or literal identity material lives anywhere in this tree.** Keys
 * are generated at run time, so every id is a real hash of a real signature.
 *
 * The two pools are the two halves of the store-free proof (`#d700bc`):
 * `fakePool()` records every call **before it throws from every method**, so any
 * call at all is recorded and fatal; `workingPool()` records too, and answers, so
 * the same seam shape resolves against a pool that is not the vendor's.
 *
 * The **conformance suite** (`#7bf6f6`) runs over two backends built here: the
 * vendor adapter over a stubbed `RelayPool` (its transport is scripted, the
 * adapter under test is the real one) and the hand-written pool. Both answer from
 * one `WireScript`, so a case can drive either and expect the same contract. The
 * vendor behaviours the stub **models** are the ones the real vendor performs before
 * the adapter sees a message, all read in the installed 6.2.1 bytes:
 * a NIP-01-prefixed `CLOSED` reason is thrown by the relay layer
 * (`dist/relay.js`: `CLOSED_ERROR_PREFIXES`, `parseClosedError`) and converted by
 * the group layer into an `ERROR` message (`dist/group.js`); a relay named twice in
 * the target list appears once per occurrence in the merged group (`dist/pool.js`
 * keys the map by URL; `dist/group.js` merges one stream per occurrence); every
 * frame and every publish response carries the relay's **own normalised identity**
 * (`relay.js:653`, `:674`, `group.js:8-10`), never the host's spelling; and the
 * group's request and COUNT streams are rooted in a `BehaviorSubject`
 * (`group.js:12`, `:21`) that **never completes**, so the adapter's own `takeWhile`
 * is what ends a read and `count` must take the first emission (D13, D1).
 */
import { AuthRequiredError, RelayClosedError, RelayPool } from 'applesauce-relay'
import type { GroupReqMessage, RelayCountResponse } from 'applesauce-relay'
import { EMPTY, NEVER, Observable, Subject, concat, firstValueFrom, of, take, throwError, timeout, toArray } from 'rxjs'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import { RelaySeamError } from './errors'
import { normalizeRelayUrl } from './pool'
import { relayPoolAdapter } from './relay-adapter'
import type {
	CountResult,
	Event,
	FilterIn,
	PoolPort,
	PoolSubscription,
	RelayAck,
	RelayFailure,
	RelayPolicy,
	RelayReason,
	RelayStatus,
	RelayUrl,
} from './types'

/** The author the tests sign as, generated at run time. */
export const KEY = generateSecretKey()
export const PUBKEY = getPublicKey(KEY)

export interface EventFields {
	kind: number
	created_at: number
	content?: string
	tags?: string[][]
}

/** A real signed event; no fixture identity is stored anywhere. */
export function signedEvent(fields: EventFields): Event {
	return finalizeEvent({ kind: fields.kind, created_at: fields.created_at, tags: fields.tags ?? [], content: fields.content ?? '' }, KEY)
}

/** One recorded pool call, with the exact arguments the seam sent. */
export interface PoolCall {
	method: string
	relays: RelayUrl[]
	filters?: FilterIn[]
	event?: Event
}

export interface FakePool {
	port: PoolPort
	calls: string[]
}

/**
 * A pool that **records every call and throws from every method** (`#d700bc`).
 * A seam that constructs a store, opens a cache or reaches for the wire when it
 * was asked for nothing is caught here, because the fake is wired in.
 */
export function fakePool(): FakePool {
	const calls: string[] = []
	const refuse = (method: string): never => {
		calls.push(method)
		throw new Error(`the fake pool was called: ${method} — the seam was asked a store-free structure for the wire`)
	}
	return {
		calls,
		port: {
			request(): Observable<Event> {
				return refuse('request')
			},
			subscribe(): PoolSubscription {
				return refuse('subscribe')
			},
			async publish(): Promise<RelayAck[]> {
				return refuse('publish')
			},
			async count(): Promise<CountResult> {
				return refuse('count')
			},
			status(): RelayStatus[] {
				return refuse('status')
			},
			close(): void {
				refuse('close')
			},
		},
	}
}

export interface WorkingPoolSpec {
	request?: (relays: RelayUrl[], filters: FilterIn[]) => Observable<Event>
	subscribe?: (relays: RelayUrl[], filters: FilterIn[]) => PoolSubscription
	publish?: (relays: RelayUrl[], event: Event) => Promise<RelayAck[]>
	count?: (relays: RelayUrl[], filters: FilterIn[]) => Promise<CountResult>
	status?: (relays: RelayUrl[]) => RelayStatus[]
}

export interface WorkingPool {
	port: PoolPort
	calls: PoolCall[]
	closed: () => boolean
}

/**
 * A hand-written pool that answers. It is the **second backend** of the
 * conformance suite (`#7bf6f6`, `#c6ae9c`): the same cases run over it and over
 * the vendor adapter, so the contract is proved adapter-shaped rather than
 * library-shaped. It also records every call, so call order is asserted **by
 * record**, never by timing.
 */
export function workingPool(spec: WorkingPoolSpec = {}): WorkingPool {
	const calls: PoolCall[] = []
	let closed = false
	const idleSubscription = (): PoolSubscription => ({
		events: EMPTY,
		failures: NEVER,
		eose: EMPTY,
		unsubscribe: () => undefined,
	})
	return {
		calls,
		closed: () => closed,
		port: {
			request: (relays, filters, opts) => {
				calls.push({ method: 'request', relays: [...relays], filters: [...filters] })
				void opts
				return spec.request ? spec.request(relays, filters) : EMPTY
			},
			subscribe: (relays, filters) => {
				calls.push({ method: 'subscribe', relays: [...relays], filters: [...filters] })
				return spec.subscribe ? spec.subscribe(relays, filters) : idleSubscription()
			},
			publish: (relays, event) => {
				calls.push({ method: 'publish', relays: [...relays], event })
				return spec.publish ? spec.publish(relays, event) : Promise.resolve(relays.map((url) => ({ url, accepted: true })))
			},
			count: (relays, filters) => {
				calls.push({ method: 'count', relays: [...relays], filters: [...filters] })
				return spec.count ? spec.count(relays, filters) : Promise.resolve({ count: 0, approximate: false })
			},
			status: (relays) => {
				calls.push({ method: 'status', relays: [...relays] })
				return spec.status ? spec.status(relays) : relays.map((url) => ({ url, connected: true, ready: true, authenticated: false }))
			},
			close: () => {
				calls.push({ method: 'close', relays: [] })
				closed = true
			},
		},
	}
}

export interface RecordingPolicy {
	policy: RelayPolicy
	calls: string[]
}

/** The host's answer to "which relays", recording every read (`#06200d`). */
export function recordingPolicy(relays: RelayUrl[] = []): RecordingPolicy {
	const calls: string[] = []
	return {
		calls,
		policy: (operation) => {
			calls.push(operation)
			return relays
		},
	}
}

/** A policy that cannot answer — the host's own error, not the wire's. */
export function refusingPolicy(): RelayPolicy {
	return () => {
		throw new Error('the host could not answer which relays')
	}
}

export interface LiveSubscription {
	subscription: PoolSubscription
	emit: (event: Event) => void
	fail: (failure: RelayFailure) => void
	reachEose: () => void
	unsubscribed: () => number
}

/** A live pool subscription the tests drive by hand, with a counted teardown. */
export function liveSubscription(): LiveSubscription {
	const events = new Subject<Event>()
	const failures = new Subject<RelayFailure>()
	const eose = new Subject<void>()
	let teardowns = 0
	return {
		subscription: {
			events: events.asObservable(),
			failures: failures.asObservable(),
			eose: eose.asObservable(),
			unsubscribe: () => {
				teardowns += 1
				events.complete()
				failures.complete()
				eose.complete()
			},
		},
		emit: (event) => events.next(event),
		fail: (failure) => failures.next(failure),
		reachEose: () => eose.next(),
		unsubscribed: () => teardowns,
	}
}

/**
 * Up to `n` events from a stream, and **a rejection if they do not arrive** — so a
 * stream that never emits fails a case instead of hanging it. This is the module
 * tree's only timer, and it lives here rather than in the implementation on
 * purpose.
 */
export async function collect(stream: Observable<Event>, n: number, ms = 500): Promise<Event[]> {
	return firstValueFrom(stream.pipe(take(n), toArray(), timeout(ms)))
}

/** Let a subscription's wiring settle before the test drives it. */
export function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A stream that never answers — a deadline case's subject. */
export function quiet(): Observable<Event> {
	return NEVER
}

/** A stream that emits these events and then completes — the wire reaching EOSE. */
export function thenEose(events: Event[]): Observable<Event> {
	return of(...events)
}

/** A promise that settled inside `ms`, or the fact that it did not. */
export type Settled<T> = { settled: true; value: T } | { settled: false }

/**
 * A promise's outcome inside a wall-clock guard. A case that waits on a read must
 * **fail** rather than hang when the read never resolves — the read's own bound is
 * what such a case is about, so the guard is the case's, not the module's.
 */
export async function within<T>(promise: Promise<T>, ms = 1000): Promise<Settled<T>> {
	return Promise.race([
		promise.then((value): Settled<T> => ({ settled: true, value })),
		new Promise<Settled<T>>((resolve) => {
			setTimeout(() => resolve({ settled: false }), ms)
		}),
	])
}

/** The error a promise rejected with, or `undefined` when it resolved. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => undefined,
		(error: unknown) => error,
	)
}

/** The typed refusal in a value the case expects to be one. */
export function isRefusal(value: unknown): value is RelaySeamError {
	return value instanceof RelaySeamError
}

/**
 * The relay fixtures an injected policy answers with — plain URL strings, the
 * operators of `#06200d`. `.invalid` is reserved by RFC 2606 and never resolves:
 * these are fixture *values* (and type positions), never a dialled address. They
 * are also the whole of what a `wss?://` grep finds in this tree.
 */
export const RELAY_A: RelayUrl = 'wss://relay.alpha.invalid'
export const RELAY_B: RelayUrl = 'wss://relay.beta.invalid'

/** What one scripted wire read or write does, identically for either backend. */
export interface WireScript {
	relays: RelayUrl[]
	events: Event[]
	/** the wire's boundary: an EOSE, or a refusal with `closeReason` */
	boundary: 'eose' | 'close'
	closeReason: string
	/** the reason the seam must report for that refusal (`#5ecac1`) */
	failureReason: RelayReason
	acks: RelayAck[]
	count: CountResult
	/**
	 * Per-relay COUNT answers, keyed by the scripted spelling of the relay. A case
	 * that drives more than one relay scripts one of these per relay; with none,
	 * every scripted relay answers with `count` above.
	 */
	counts?: Record<RelayUrl, CountResult>
	/** the wire never answers; only the hand-written backend can be scripted to hang */
	hang: boolean
}

/** A filled-in script: one call site per case, and a default for everything it omits. */
export function wireScript(overrides: Partial<WireScript> = {}): WireScript {
	return {
		relays: [RELAY_A],
		events: [],
		boundary: 'eose',
		closeReason: 'closed: unsubscribed',
		failureReason: 'closed',
		acks: [],
		count: { count: 0, approximate: false },
		hang: false,
		...overrides,
	}
}

/**
 * One conforming backend: a pool behind the transport port, its recorded wire
 * verbs, and the relay sets each verb was handed.
 */
export interface WireBackend {
	label: string
	port: PoolPort
	verbs: () => string[]
	targets: () => RelayUrl[][]
}

/**
 * A pool subscription scripted from the same `WireScript`, with a **counted
 * teardown** — so idempotent cancellation (`#15aa73`) is asserted by the count,
 * never by timing.
 */
export function scriptedSubscription(script: WireScript): { subscription: PoolSubscription; teardowns: () => number } {
	let teardowns = 0
	const refusal: RelayFailure = { relay: script.relays[0], reason: script.failureReason, message: script.closeReason }
	return {
		subscription: {
			events: script.hang ? NEVER : thenEose(script.events),
			failures: script.boundary === 'close' ? of(refusal) : NEVER,
			eose: script.boundary === 'eose' ? of(undefined) : NEVER,
			unsubscribe: () => {
				teardowns += 1
			},
		},
		teardowns: () => teardowns,
	}
}

/**
 * The COUNT answer one scripted relay gives: its own entry in `counts`, or `count`
 * when the case scripts one answer for the whole set.
 */
export function perRelayCount(script: WireScript, url: RelayUrl): CountResult {
	return script.counts?.[url] ?? script.count
}

/**
 * The record a set's relays answer NIP-45 `COUNT` with, **keyed by the identity the
 * pool files each relay by** — the normalised URL (`group.js:8-10`, `relay.js`'s
 * `from: this.url`), not the spelling the case used. The vendor's group builds
 * exactly this shape (`group.js:187-190`, `combineLatest` over
 * `[relay.url, relay.count(filters, id)]`).
 */
export function countRecord(script: WireScript): Record<string, RelayCountResponse & { approximate?: boolean }> {
	const record: Record<string, RelayCountResponse & { approximate?: boolean }> = {}
	for (const url of script.relays) {
		const answer = perRelayCount(script, url)
		record[normalizeRelayUrl(url)] = { count: answer.count, approximate: answer.approximate }
	}
	return record
}

/**
 * The **second backend**: the hand-written pool, answering from the script and
 * recording every call, so call order is read off the record rather than timed.
 *
 * `request` has no failure channel of its own, so a refusal on the scripted wire
 * is reported the way a pool reports one — by erroring the stream, **typed**, with
 * the contract's own refusal. The seam carries it as a value and keeps what
 * arrived; a pool that instead resolved as if the boundary had been reached would
 * be telling the caller a different story from the vendor adapter's.
 */
export function handBackend(script: WireScript, subscription: PoolSubscription = scriptedSubscription(script).subscription): WireBackend {
	const pool = workingPool({
		request: () => {
			if (script.hang) return NEVER
			if (script.boundary === 'close') {
				return concat(
					thenEose(script.events),
					throwError(() => new RelaySeamError(script.failureReason, script.closeReason)),
				)
			}
			return thenEose(script.events)
		},
		subscribe: () => subscription,
		publish: (relays) => Promise.resolve(script.acks.filter((ack) => relays.includes(ack.url))),
		count: () => {
			// the same sum the vendor's per-relay record reduces to, so the two
			// backends answer one count for one script (D2's reduction rule)
			const answers = script.relays.map((url) => perRelayCount(script, url))
			return Promise.resolve({
				count: answers.reduce((total, answer) => total + answer.count, 0),
				approximate: answers.some((answer) => answer.approximate),
			})
		},
	})
	return {
		label: 'a hand-written pool',
		port: pool.port,
		verbs: () => pool.calls.map((call) => call.method),
		targets: () => pool.calls.filter((call) => call.method === 'request').map((call) => call.relays),
	}
}

/** NIP-01's machine-readable `CLOSED` prefixes, as the vendor's own table lists them (`relay.js`, READ at 6.2.1). */
const CLOSED_PREFIXES = [
	'auth-required',
	'unsupported',
	'error',
	'blocked',
	'restricted',
	'rate-limited',
	'pow',
	'invalid',
	'duplicate',
	'mute',
]

/**
 * The vendor's two layers, modelled: a `CLOSED` whose reason carries one of
 * NIP-01's prefixes is turned into a thrown `AuthRequiredError`/`RelayClosedError`
 * by the relay, and the group converts that throw into an `ERROR` message. A
 * reason with no prefix closes the subscription gracefully and arrives as a
 * `CLOSED` message.
 */
function vendorClosedRefusal(reason: string): Error | null {
	const prefix = reason.split(':')[0]
	if (!CLOSED_PREFIXES.includes(prefix)) return null
	return prefix === 'auth-required' ? new AuthRequiredError(reason) : new RelayClosedError(reason)
}

/**
 * The vendor's own `RelayPool` with its transport replaced by the script. The
 * pool is *built* — which opens nothing — and `req`/`publish`/`count` never reach
 * a socket, so the adapter under test is the real one and the case still opens no
 * connection. A `RelayPool` subclass is the substitution the adapter's own
 * signature invites: `relayPoolAdapter(pool?: RelayPool)`.
 */
class ScriptedRelayPool extends RelayPool {
	readonly calls: string[] = []
	readonly targets: RelayUrl[][] = []

	constructor(private readonly script: WireScript) {
		super()
	}

	override req(...args: Parameters<RelayPool['req']>): ReturnType<RelayPool['req']> {
		const [relays] = args
		const asked: RelayUrl[] = Array.isArray(relays) ? relays : []
		this.calls.push('req')
		this.targets.push([...asked])

		// **Identity.** The vendor files every relay under the URL *it* normalises to
		// (`applesauce-core` 6.2.0 `dist/helpers/url.js`, `normalizeURL` — mirrored by
		// `pool.ts:normalizeRelayUrl`), and every frame it emits carries that identity:
		// `from: this.url` for an `OK` (`relay.js:653`) and for the relay's own timeout
		// response (`relay.js:674`), and the group's conversion of a thrown refusal
		// (`group.js:8-10`). A stub that echoed the host's spelling would make the ack
		// match untestable where the code depends on it — the asymmetry B2 was invisible
		// through (`review/final-blind-nostr-io.addendum.md` §B.2), closed here (D13).
		const from = normalizeRelayUrl(this.script.relays[0])
		const frames: GroupReqMessage[] = this.script.events.map((event): GroupReqMessage => ({ type: 'EVENT', from, id: 'script', event }))
		if (this.script.boundary === 'close') {
			const error = vendorClosedRefusal(this.script.closeReason)
			if (error) frames.push({ type: 'ERROR', from, error })
			else frames.push({ type: 'CLOSED', from, id: 'script', reason: this.script.closeReason })
		} else {
			frames.push({ type: 'EOSE', from, id: 'script' })
		}

		// a relay named twice answers twice: the group merges one stream per
		// occurrence of the relay in the target list (`group.js`, READ at 6.2.1).
		// The comparison is on the pool's **identity**, because that is what the
		// group keys by (`group.js:12`, `:21`) — so two spellings of one relay are
		// two occurrences of the one relay the pool holds, which is the shape the
		// boundary gate has to survive (D12).
		const occurrences = Math.max(asked.filter((url) => normalizeRelayUrl(url) === from).length, 1)
		const messages: GroupReqMessage[] = []
		for (let i = 0; i < occurrences; i += 1) messages.push(...frames)

		// **Completion.** The group's request stream is rooted in a `BehaviorSubject`
		// (`group.js:12`, `:21`) and **never completes**: it emits each frame and stays
		// open, and it is the adapter's own boundary `takeWhile` that ends it. D13 says
		// `req` "stays as it is", and this is the faithful reading of that: no
		// *additional* completion is modelled. The stub used to return `of(...messages)`,
		// which completed on its own — so the gate was not load-bearing and a read could
		// finish before its boundary was reached. Measured: with the completing stub the
		// two-spelling case fails on a **duplicated arrival** (two occurrences, two
		// `EVENT`s, the read settling anyway) instead of on the hang W4 records; with
		// this stream it fails on `settled`, which is B2's read half.
		return new Observable<GroupReqMessage>((subscriber) => {
			for (const message of messages) subscriber.next(message)
		})
	}

	override publish(...args: Parameters<RelayPool['publish']>): ReturnType<RelayPool['publish']> {
		void args
		this.calls.push('publish')
		// every publish response carries `from: this.url` — the relay's own normalised
		// identity (`relay.js:653`, `:674`), never the caller's spelling
		return Promise.resolve(this.script.acks.map((ack) => ({ ok: ack.accepted, from: normalizeRelayUrl(ack.url), message: ack.message })))
	}

	override count(...args: Parameters<RelayPool['count']>): ReturnType<RelayPool['count']> {
		void args
		this.calls.push('count')
		const record = countRecord(this.script)
		// the group's COUNT stream is `relays$.pipe(switchMap(combineLatest(…)), share())`
		// (`group.js:187-190`), rooted in a `BehaviorSubject` (`group.js:12`, `:21`): it
		// emits the per-relay record once every targeted relay has answered and **never
		// completes** — unlike `internalPublish`, which pipes its own `take(1)`
		// (`group.js:96-99`). `lastValueFrom` therefore cannot resolve against it (D1).
		return new Observable<Record<string, RelayCountResponse>>((subscriber) => {
			subscriber.next(record)
		})
	}
}

/** The **first backend**: the module's own adapter over the stubbed vendor pool. */
export function vendorBackend(script: WireScript): WireBackend {
	const stub = new ScriptedRelayPool(script)
	return { label: 'the applesauce-relay adapter', port: relayPoolAdapter(stub), verbs: () => stub.calls, targets: () => stub.targets }
}

/**
 * The **first backend** over a pool that holds real relays: `pool.relay(url)` is
 * the vendor's own registration (it normalises the URL, files the relay under
 * that key, and dials nothing), so a case can assert the health the seam reports
 * is the pool's own observation rather than an invented "not connected".
 */
export function vendorPoolHolding(relays: RelayUrl[]): { port: PoolPort; keys: string[]; close: () => void } {
	const pool = new RelayPool()
	for (const url of relays) pool.relay(url)
	return { port: relayPoolAdapter(pool), keys: [...pool.relays.keys()], close: () => pool.close() }
}
