/**
 * invariants.test.ts — the seam's own invariants, one named case each.
 *
 * These are the cases that are not a wire path: the store-free proof
 * (`#d700bc`), the reason vocabulary (`#5ecac1`), the injected policy that is
 * read on every call (`#06200d`), and the absence of any global state
 * (`#3820a9`). Every read is typed against the contract's own types, and every
 * case names the careless implementation it fails on — a seam that reached for
 * the wire when it was asked for nothing, or that owned a relay of its own.
 *
 * Two of them are about the boundary `#5ecac1` draws: **every failure path is
 * typed**. A pool whose own `events`, `eose` or `failures` stream errors, and a
 * host policy that cannot answer, must both reach the caller as a value from the
 * reason vocabulary — a bare library `Error`, on any channel, is the type lie the
 * declared channels would otherwise be.
 */
import { describe, expect, test } from 'bun:test'
import { NEVER, Observable, firstValueFrom, timeout } from 'rxjs'

import { RelaySeamError, createNostrIo } from './index'
import type { Event, FilterIn, NostrIo, RelayReason, Subscription } from './index'
import { mapClosedReason, toFilterArray } from './pool'
import { RELAY_A, RELAY_B, fakePool, isRefusal, recordingPolicy, refusingPolicy, rejection, signedEvent, workingPool } from './harness'

/** The stated vocabulary (`#5ecac1`, `#6a5bcb` (provenance)): every refusal's reason is one of these. */
const VOCABULARY: RelayReason[] = ['auth-required', 'rate-limited', 'timeout', 'not-found', 'closed', 'rejected']

describe('M5 · the store-free case', () => {
	test('M5 · the store-free case: a recording pool that throws is reached only by the wire verbs, and not at all when the seam is asked for nothing', async () => {
		const fake = fakePool()
		const policy = recordingPolicy([RELAY_A])
		const seam: NostrIo = createNostrIo({ pool: fake.port, policy: policy.policy })

		// the seam was built and asked for nothing: it opened no socket, built no store,
		// and made no pool call at all. A seam that constructs a store, opens a cache or
		// binds the library's optional store here is caught by the next line.
		expect(fake.calls).toEqual([])

		const failedQuery = await seam.query({ kinds: [1] }).catch((error: unknown) => error)
		expect(failedQuery).toBeInstanceOf(RelaySeamError)
		expect(fake.calls).toEqual(['request'])

		const failedPublish = await seam.publish(signedEvent({ kind: 1, created_at: 1000 })).catch((error: unknown) => error)
		expect(failedPublish).toBeInstanceOf(RelaySeamError)
		expect(fake.calls).toEqual(['request', 'publish'])

		const failedCount = await seam.count({ kinds: [1] }).catch((error: unknown) => error)
		expect(failedCount).toBeInstanceOf(RelaySeamError)
		expect(fake.calls).toEqual(['request', 'publish', 'count'])

		// a subscription the pool refuses is a refusal on the error channel,
		// never a synchronous throw at the caller (`#15aa73`)
		const subscription: Subscription = seam.subscribe({ kinds: [1] })
		const refusal = await firstValueFrom(subscription.errors.pipe(timeout(500)))
		expect(refusal).toBeInstanceOf(RelaySeamError)
		expect(fake.calls).toEqual(['request', 'publish', 'count', 'subscribe'])
	})
})

describe('#5ecac1 · the reason vocabulary', () => {
	test("#5ecac1 · the reason vocabulary maps a relay's own refusal text, and a refusal is never a bare string", () => {
		const vocabulary: RelayReason[] = ['auth-required', 'rate-limited', 'timeout', 'not-found', 'closed', 'rejected']

		expect(mapClosedReason('auth-required: we need a nip-42 handshake')).toBe('auth-required')
		expect(mapClosedReason('rate-limited: too many requests')).toBe('rate-limited')
		expect(mapClosedReason('the request timed out')).toBe('timeout')
		expect(mapClosedReason('event not found')).toBe('not-found')
		expect(mapClosedReason('')).toBe('closed')
		expect(mapClosedReason('closed: unsubscribed')).toBe('closed')
		// anything unrecognised is a refusal, never a silent absence
		expect(mapClosedReason('something else entirely')).toBe('rejected')

		// every value the mapping can return is a member of the stated vocabulary
		for (const text of ['', 'rate-limited', 'nonsense', 'auth required', 'not found']) {
			expect(vocabulary).toContain(mapClosedReason(text))
		}
	})
})

describe('#5ecac1 · a malformed filter is refused, never coerced', () => {
	test('toFilterArray · a non-object is a typed refusal, the same decision the two sibling arms make', () => {
		// before this rule the wire arm was `Array.isArray(f) ? [...f] : [f]`, so a
		// string, number, null or undefined became `['x']` / `[undefined]` onward —
		// the fail-open divergence from `event-store` and `event-access` (P4 F2).
		for (const malformed of [undefined, null, 'kinds:1', 7, true] as unknown[]) {
			expect(() => toFilterArray(malformed as FilterIn)).toThrow(RelaySeamError)
		}
		let refusal: unknown
		try {
			toFilterArray(undefined as unknown as FilterIn)
		} catch (error) {
			refusal = error
		}
		expect(isRefusal(refusal)).toBe(true)
		if (!isRefusal(refusal)) throw new Error('a malformed filter was coerced instead of refused')
		expect(refusal.reason).toBe('rejected')
	})

	test('toFilterArray · the valid paths are unchanged: one element, a shallow copy in order, no de-duplication', () => {
		const one: FilterIn = { kinds: [1] }
		const single = toFilterArray(one)
		expect(single).toEqual([one])
		expect(single[0]).toBe(one)

		const shared: FilterIn = { kinds: [1] }
		const many: FilterIn[] = [shared, shared]
		const copy = toFilterArray(many)
		// a shallow copy: same order and same element references, a new array
		expect(copy).toEqual(many)
		expect(copy).not.toBe(many)
		expect(copy[0]).toBe(shared)
		expect(copy[1]).toBe(shared)
		// a duplicate is kept here — `uniqueRelays` is the rule that drops repeats, and that is a different rule
		expect(copy.length).toBe(2)
	})

	test('query · a malformed filter is refused before it reaches the wire', async () => {
		const pool = workingPool()
		const seam: NostrIo = createNostrIo({ pool: pool.port, policy: recordingPolicy([RELAY_A]).policy })
		const refused = await rejection(seam.query(undefined as unknown as FilterIn))
		expect(isRefusal(refused)).toBe(true)
		if (!isRefusal(refused)) throw new Error('a malformed filter reached the pool instead of being refused')
		expect(refused.reason).toBe('rejected')
		// the wire was never touched: the refusal is the seam's own, not the pool's
		expect(pool.calls).toEqual([])
	})
})

describe('#5ecac1 · every live channel is typed', () => {
	test('#5ecac1 · a pool whose own streams error reaches the caller as a typed refusal, on no channel as a bare Error', async () => {
		const FIRST: Event = signedEvent({ kind: 1, content: 'first', created_at: 1000 })
		const policy = recordingPolicy([RELAY_A])

		// 1 · the pool's own event transport dies mid-flight, after one event. A seam
		// that passes that stream through hands the caller the library's Error and ends
		// a live read with nothing on the typed channel.
		const dying = workingPool({
			subscribe: () => ({
				events: new Observable<Event>((subscriber) => {
					subscriber.next(FIRST)
					subscriber.error(new Error('the socket died'))
				}),
				failures: NEVER,
				eose: NEVER,
				unsubscribe: () => undefined,
			}),
		})
		const seam = createNostrIo({ pool: dying.port, policy: policy.policy })
		const subscription: Subscription = seam.subscribe({ kinds: [1] })

		const arrived: string[] = []
		let ended = 'still open'
		await new Promise<void>((resolve) => {
			subscription.events.subscribe({
				next: (event) => arrived.push(event.id),
				error: (error: unknown) => {
					ended = `errored on ${String(error)}`
					resolve()
				},
				complete: () => {
					ended = 'completed'
					resolve()
				},
			})
		})
		// what arrived was delivered, and the channel **completed** — it did not end on a bare Error
		expect(arrived).toEqual([FIRST.id])
		expect(ended).toBe('completed')

		// and the failure is a value from the vocabulary on the typed channel
		const refusal = await firstValueFrom(subscription.errors.pipe(timeout(500)))
		expect(isRefusal(refusal)).toBe(true)
		if (!isRefusal(refusal)) throw new Error('the events channel died on a bare Error instead of a typed refusal')
		expect(VOCABULARY).toContain(refusal.reason)

		// 2 · the channel the module itself types as `Observable<RelaySeamError>` dies:
		// it must deliver the refusal as a value, not end on the library's Error
		const deadFailures = workingPool({
			subscribe: () => ({
				events: NEVER,
				failures: new Observable<never>((subscriber) => {
					subscriber.error(new Error('the failure channel died'))
				}),
				eose: NEVER,
				unsubscribe: () => undefined,
			}),
		})
		const typed = createNostrIo({ pool: deadFailures.port, policy: policy.policy }).subscribe({ kinds: [1] })
		const carried = await firstValueFrom(typed.errors.pipe(timeout(500)))
		expect(isRefusal(carried)).toBe(true)
		if (!isRefusal(carried)) throw new Error('the typed error channel ended on a bare Error')
		expect(VOCABULARY).toContain(carried.reason)

		// 3 · the `eose` stream dies under `closeOnEose`: the same typed refusal, and
		// the caller's stream ends without an untyped error
		const deadEose = workingPool({
			subscribe: () => ({
				events: NEVER,
				failures: NEVER,
				eose: new Observable<void>((subscriber) => {
					subscriber.error(new Error('the eose stream died'))
				}),
				unsubscribe: () => undefined,
			}),
		})
		const closing = createNostrIo({ pool: deadEose.port, policy: policy.policy }).subscribe({ kinds: [1] }, { closeOnEose: true })
		let closedEnded = 'still open'
		await new Promise<void>((resolve) => {
			closing.events.subscribe({
				error: (error: unknown) => {
					closedEnded = `errored on ${String(error)}`
					resolve()
				},
				complete: () => {
					closedEnded = 'completed'
					resolve()
				},
			})
		})
		expect(closedEnded).toBe('completed')
		const fromEose = await firstValueFrom(closing.errors.pipe(timeout(500)))
		expect(isRefusal(fromEose)).toBe(true)
		if (!isRefusal(fromEose)) throw new Error('a dead eose stream ended the typed channel')
		expect(VOCABULARY).toContain(fromEose.reason)
	})

	test('#5ecac1 · a policy that cannot answer is a typed refusal on every operation, and never reaches the wire', async () => {
		const pool = workingPool()
		const seam: NostrIo = createNostrIo({ pool: pool.port, policy: refusingPolicy() })

		const operations: readonly (readonly [string, () => Promise<unknown>])[] = [
			['connect', () => seam.connect()],
			['query', () => seam.query({ kinds: [1] })],
			['publish', () => seam.publish(signedEvent({ kind: 1, created_at: 1000 }))],
			['count', () => seam.count({ kinds: [1] })],
		]
		for (const [operation, run] of operations) {
			const refused = await rejection(run())
			expect(isRefusal(refused)).toBe(true)
			if (!isRefusal(refused)) throw new Error(`${operation} handed the caller a bare Error from the host policy`)
			expect(VOCABULARY).toContain(refused.reason)
		}

		// subscribe does not throw at the caller: it opens with the refusal on the error channel
		let opened: Subscription | undefined
		expect(() => {
			opened = seam.subscribe({ kinds: [1] })
		}).not.toThrow()
		if (!opened) throw new Error('subscribe threw at the caller instead of opening with a refusal')
		const refusal = await firstValueFrom(opened.errors.pipe(timeout(500)))
		expect(isRefusal(refusal)).toBe(true)
		if (!isRefusal(refusal)) throw new Error('a subscription opened with a bare Error on its channel')
		expect(VOCABULARY).toContain(refusal.reason)

		// a policy the host cannot answer with never reaches the wire at all
		expect(pool.calls).toEqual([])
	})
})

describe('#06200d · relay policy is injected, never owned', () => {
	test('#06200d · the policy is read on every call and its relays are neither added to, preferred nor reordered', async () => {
		const pool = workingPool()
		// the policy answers with B before A: the seam may not reorder them into a preference
		const policy = recordingPolicy([RELAY_B, RELAY_A])
		const seam: NostrIo = createNostrIo({ pool: pool.port, policy: policy.policy })

		await seam.query({ kinds: [1] })
		seam.subscribe({ kinds: [1] }).unsubscribe()
		await seam.publish(signedEvent({ kind: 1, created_at: 1000 }))
		await seam.count({ kinds: [1] })
		await seam.connect()

		// one policy read per operation, in the operations' own order
		expect(policy.calls).toEqual(['query', 'subscribe', 'publish', 'count', 'connect'])
		// and the relay set reached the pool exactly as the policy answered it
		for (const call of pool.calls) {
			expect(call.relays).toEqual([RELAY_B, RELAY_A])
		}
	})
})

describe('#3820a9 · two seams in one process', () => {
	test('#3820a9 · two seams share no socket, no subscription and no relay set', async () => {
		const first = workingPool()
		const second = workingPool()
		const firstPolicy = recordingPolicy([RELAY_A])
		const secondPolicy = recordingPolicy([RELAY_B])
		const one: NostrIo = createNostrIo({ pool: first.port, policy: firstPolicy.policy })
		const two: NostrIo = createNostrIo({ pool: second.port, policy: secondPolicy.policy })

		await one.query({ kinds: [1] })
		await two.query({ kinds: [1] })

		// each seam reached its own pool with its own relay set, and neither pool saw the other
		expect(first.calls.map((call) => call.method)).toEqual(['request'])
		expect(second.calls.map((call) => call.method)).toEqual(['request'])
		expect(first.calls[0].relays).toEqual([RELAY_A])
		expect(second.calls[0].relays).toEqual([RELAY_B])
		expect(firstPolicy.calls).toEqual(['query'])
		expect(secondPolicy.calls).toEqual(['query'])
	})
})
