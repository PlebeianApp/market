/**
 * relay-adapter.ts — **the first implementation**: `applesauce-relay` 6.2.1's pool
 * behind the transport port.
 *
 * The vendor supplies the sockets; this file supplies the contract (`#bbfa5c`).
 * It is the only place in the module that names the library, and it maps the
 * vendor's own messages to the seam's nouns — the wire's EOSE, a relay's reason,
 * one ack per relay, NIP-45's approximation flag.
 *
 * **No store is bound here.** The adapter drives the pool's raw `req`, which does
 * not deduplicate, rather than the vendor's dedup-by-default `request`: the
 * vendor's `request`/`subscription` accept an optional store and default to a
 * throwaway in-memory one (`runs/2026-09-29-event-store/research/05-applesauce-precedent.md`:563-567),
 * and passing it through would make the store-free property a convention instead
 * of a fact (`#d700bc`). Dedup is the composition's, not the seam's.
 *
 * **A relay's own refusal text is carried, not flattened.** The vendor's relay
 * layer throws a typed error for a NIP-01 *prefixed* `CLOSED` reason and its group
 * layer turns that throw into an `ERROR` message — so `rate-limited:` and
 * `auth-required:` reach this adapter as the vendor error's own text, and the
 * adapter reads it through `mapClosedReason` rather than answering `'rejected'`
 * for every relay (`#5ecac1`). Read in the installed copy: `applesauce-relay`
 * 6.2.1 `dist/relay.js` (`CLOSED_ERROR_PREFIXES`, `parseClosedError`, the `tap`
 * that throws) and `dist/group.js` (the `catchError` that emits `ERROR`).
 *
 * It opens no socket on construction and none until an observable is subscribed:
 * the vendor pools lazily, so a seam may be built — and its `status` read —
 * without a connection.
 */
import { RelayPool } from 'applesauce-relay'
import type { GroupReqMessage, PublishResponse, RelayCountResponse } from 'applesauce-relay'
import { NEVER, Observable, Subject, filter, firstValueFrom, map, share, takeUntil, takeWhile, tap } from 'rxjs'

import { RelaySeamError } from './errors'
import { mapClosedReason, normalizeRelayUrl } from './pool'
import type { CountResult, Event, FilterIn, PoolPort, PoolSubscription, RelayAck, RelayFailure, RelayStatus, RelayUrl } from './types'

/** The vendor's per-relay EVENT message, narrowed without a cast. */
type EventMessage = Extract<GroupReqMessage, { type: 'EVENT' }>

function isEventMessage(message: GroupReqMessage): message is EventMessage {
	return message.type === 'EVENT'
}

/**
 * NIP-45 permits a relay to answer `COUNT` approximately. The vendor's declared
 * `RelayCountResponse` carries only `count` and drops the flag, but the raw NIP-45
 * payload keeps it at run time, so the adapter reads it through a widening
 * assignment — no cast, no `any` — and the contract's flag is carried rather than
 * fabricated (`#752c02`).
 */
function isApproximate(response: RelayCountResponse): boolean {
	const widened: { count: number; approximate?: unknown } = response
	return widened.approximate === true
}

/**
 * The refusal text a wire error carries: the vendor's own `reason` when the error
 * has one (`RelayClosedError.reason` is the relay's raw `CLOSED` text), else the
 * error's message. Anything else is not a refusal with words in it.
 */
function refusalText(error: unknown): string {
	if (typeof error === 'string') return error
	if (error instanceof Error) {
		const widened: { message?: unknown; reason?: unknown } = error
		return typeof widened.reason === 'string' ? widened.reason : error.message
	}
	return ''
}

/**
 * A wire error as the contract's refusal, through the module's one mapping
 * (`#5ecac1`): `rate-limited: …` is `rate-limited`, `auth-required: …` is
 * `auth-required`, and an error with no words in it is the generic refusal rather
 * than a silent absence.
 */
function refusalFrom(error: unknown): RelaySeamError {
	const text = refusalText(error)
	if (text.trim() === '') return new RelaySeamError('rejected', 'the relay reported an error')
	return new RelaySeamError(mapClosedReason(text), text)
}

/** An observable that emits once when the caller's signal aborts, or never. */
function abortSignal(signal?: AbortSignal): Observable<void> {
	if (!signal) return NEVER
	return new Observable<void>((subscriber) => {
		if (signal.aborted) {
			subscriber.next()
			subscriber.complete()
			return undefined
		}
		const onAbort = (): void => {
			subscriber.next()
			subscriber.complete()
		}
		signal.addEventListener('abort', onAbort, { once: true })
		return (): void => {
			signal.removeEventListener('abort', onAbort)
		}
	})
}

class RelayPoolTransport implements PoolPort {
	private readonly pool: RelayPool

	constructor(pool: RelayPool) {
		this.pool = pool
	}

	request(relays: RelayUrl[], filters: FilterIn[], opts?: { signal?: AbortSignal }): Observable<Event> {
		// The set a pool is handed is the **unique** one, and the seam is where that
		// happens (`#06200d`) — one relay asked for twice is one relay on the wire.
		// The pool is handed the host's set **unchanged** (`handed`), because rewriting
		// a spelling would be the module choosing a relay's name.
		//
		// What is normalised is the **comparison**: the wire's boundary is counted per
		// relay, and the pool files every relay under its own normalised key
		// (`group.js:12`, `:21`), so a set naming one relay in two spellings must count
		// it **once** or the gate below can never open and the read waits for an answer
		// that is not coming (`#10b5ac`, D12). A URL that cannot be normalised stays in
		// the comparison list as its raw string, so a bad URL still counts as one
		// target and the gate cannot silently shrink.
		const handed = [...relays]
		const target = [...new Set(handed.map((url) => this.identity(url)))]
		const seen = new Set<RelayUrl>()
		return this.pool.req(handed, [...filters]).pipe(
			// the wire's boundary is per relay; the request completes when every
			// targeted relay has reached it
			tap((message) => {
				if (message.type === 'EOSE') seen.add(message.from)
			}),
			// a relay's refusal ends *this* stream — the seam carries it as a value on
			// the read's failure channel and keeps what arrived (`#10b5ac`, `#5ecac1`)
			map((message) => {
				if (message.type === 'CLOSED') throw new RelaySeamError(mapClosedReason(message.reason), message.reason)
				if (message.type === 'ERROR') throw refusalFrom(message.error)
				return message
			}),
			takeWhile(() => seen.size < target.length, true),
			filter(isEventMessage),
			map((message) => message.event),
			takeUntil(abortSignal(opts?.signal)),
		)
	}

	subscribe(relays: RelayUrl[], filters: FilterIn[]): PoolSubscription {
		const stop = new Subject<void>()
		const messages = this.pool.req([...relays], [...filters]).pipe(takeUntil(stop), share())
		const events = messages.pipe(
			filter(isEventMessage),
			map((message) => message.event),
			share(),
		)
		const failures = messages.pipe(
			map((message): RelayFailure | null => {
				if (message.type === 'CLOSED') return { relay: message.from, reason: mapClosedReason(message.reason), message: message.reason }
				if (message.type === 'ERROR') {
					const refusal = refusalFrom(message.error)
					return { relay: message.from, reason: refusal.reason, message: refusal.message }
				}
				return null
			}),
			filter((failure): failure is RelayFailure => failure !== null),
			share(),
		)
		const eose = messages.pipe(
			filter((message) => message.type === 'EOSE'),
			map((): void => undefined),
			share(),
		)
		return {
			events,
			failures,
			eose,
			unsubscribe: () => {
				stop.next()
				stop.complete()
			},
		}
	}

	async publish(relays: RelayUrl[], event: Event): Promise<RelayAck[]> {
		const responses: PublishResponse[] = await this.pool.publish([...relays], event)
		return responses.map((response) => ({
			url: response.from,
			accepted: response.ok,
			reason: response.ok ? undefined : mapClosedReason(response.message ?? ''),
			message: response.message,
		}))
	}

	async count(relays: RelayUrl[], filters: FilterIn[]): Promise<CountResult> {
		// `#fdc27c` — a wire count over a set is the **sum** of the targeted relays' own indices, and
		// `approximate` is true whenever any one of them answered approximately; the vendor's record is
		// per relay and neither it nor this seam merges two relays holding the same event.
		// `firstValueFrom`, not `lastValueFrom`: the vendor's group COUNT stream is rooted in a
		// `BehaviorSubject` (`RelayGroup.relays$`, `group.js:12`, `:21`), so it emits the per-relay record
		// — `combineLatest` (`group.js:187-190`) emits only once every targeted relay has answered — and
		// then **never completes**. `lastValueFrom` waits for a completion that never comes and the read
		// hangs, with no deadline to escape with because `count` takes no options. The FIRST emission is
		// already the whole record.
		const record: Record<string, RelayCountResponse> = await firstValueFrom(this.pool.count([...relays], [...filters]))
		let count = 0
		let approximate = false
		for (const response of Object.values(record)) {
			count += response.count
			if (isApproximate(response)) approximate = true
		}
		return { count, approximate }
	}

	/**
	 * The identity a pool files a relay under, for the comparisons the seam makes
	 * (D12): the module's own normalising predicate (`pool.ts:normalizeRelayUrl`),
	 * the one `status()` already uses. A URL that cannot be normalised is kept as
	 * its raw string — it is still one target, so a comparison the seam makes can
	 * never silently shrink. Normalising the *comparison* is not rewriting the
	 * host's answer: the pool is still handed the host's own spelling (`#06200d`).
	 */
	private identity(url: RelayUrl): string {
		try {
			return normalizeRelayUrl(url)
		} catch {
			return url
		}
	}

	/**
	 * The pool's own observation of each relay, looked up under the key **the pool
	 * files it by** — the normalised URL — rather than under the spelling the policy
	 * happened to use, which the pool's map never holds (`#b14090`). A URL the pool
	 * cannot be asked about is a typed refusal: health is reported, never invented.
	 */
	status(relays: RelayUrl[]): RelayStatus[] {
		return [...relays].map((url) => {
			let key: string
			try {
				key = normalizeRelayUrl(url)
			} catch (error) {
				const message = error instanceof Error ? error.message : 'not a relay URL'
				throw new RelaySeamError('rejected', `${url} is not a relay URL: ${message}`)
			}
			const relay = this.pool.relays.get(key)
			if (!relay) return { url, connected: false, ready: false, authenticated: false }
			return { url, connected: relay.connected, ready: relay.ready, authenticated: relay.authenticated }
		})
	}

	close(): void {
		this.pool.close()
	}
}

/**
 * #c6ae9c — relayPoolAdapter: the adapter boundary — any `applesauce-relay` pool,
 * or a fresh one, behind the transport port. A second backend is a second
 * implementation of `PoolPort`, not a second import of the library.
 */
export function relayPoolAdapter(pool: RelayPool = new RelayPool()): PoolPort {
	return new RelayPoolTransport(pool)
}
