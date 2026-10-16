/**
 * conformance.test.ts — the wire paths, as one conformance suite over two backends.
 *
 * The contract's evidence obligation (`#7bf6f6`) is that the **same** suite runs
 * over the vendor adapter **and** over a hand-written pool, so the seam is proved
 * adapter-shaped rather than library-shaped: `relayPoolAdapter` is the first
 * backend, `harness.ts`'s hand-written pool is the second, and both are driven
 * through `createNostrIo` with no branch anywhere in the seam.
 *
 * **One case per path**, and each case drives **both** backends from one
 * `WireScript`, so a capability is claimed only for the paths that case
 * exercised. No case opens a socket: the vendor backend is the real adapter over
 * a `RelayPool` whose transport is scripted, and both backends record the wire
 * verbs they reached, so ordering claims are read off the record rather than timed.
 *
 * The cases that are about a **refusal** assert the *same outcome object* from
 * both backends — a script that changes its answer when the backend changes is
 * not a conformance case but two behaviours with one name — and the seam's own
 * bounds (the stated ceiling, the wall-clock deadline) are asserted where they
 * live: on the seam, not on a backend.
 *
 * Every case is typed against the contract's own types (`WireResult`,
 * `Subscription`, `PublishOutcome`, `CountResult`, `RelayStatus`) — which is what
 * keeps `tsc --noEmit` the case for M1: a library type in a caller-facing
 * signature fails the typecheck, not this file.
 */
import { describe, expect, test } from 'bun:test'
import { Subject, firstValueFrom, map, range, take, timeout, toArray } from 'rxjs'

import { RelaySeamError, createNostrIo } from './index'
import type { CountResult, Event, PublishOutcome, RelayReason, RelayStatus, Subscription, WireResult } from './index'
import {
	RELAY_A,
	RELAY_B,
	collect,
	handBackend,
	isRefusal,
	recordingPolicy,
	rejection,
	scriptedSubscription,
	signedEvent,
	vendorBackend,
	vendorPoolHolding,
	wireScript,
	within,
	workingPool,
} from './harness'
import type { WireBackend, WireScript } from './harness'

const FIRST: Event = signedEvent({ kind: 1, content: 'first', created_at: 1000 })
const SECOND: Event = signedEvent({ kind: 1, content: 'second', created_at: 2000 })

interface Built {
	backend: WireBackend
	suffix: string
	/** the wire verbs each path records — the vendor adapter reaches the pool's raw `req`, the hand-written pool its own members */
	verbs: Record<'query' | 'subscribe' | 'publish' | 'count' | 'connect', string[]>
}

/** The two backends of the conformance suite, answering from one script. */
function backends(script: WireScript): Built[] {
	return [
		{
			backend: vendorBackend(script),
			suffix: 'the vendor adapter',
			verbs: { query: ['req'], subscribe: ['req'], publish: ['publish'], count: ['count'], connect: [] },
		},
		{
			backend: handBackend(script),
			suffix: 'a hand-written pool',
			verbs: { query: ['request'], subscribe: ['subscribe'], publish: ['publish'], count: ['count'], connect: ['status'] },
		},
	]
}

/** What a read resolved with, in the shape both backends must agree on. */
function readShape(read: WireResult): unknown {
	return {
		events: read.events.map((event) => event.id),
		eose: read.eose,
		failures: read.failures.map((failure) => ({ reason: failure.reason, message: failure.message })),
	}
}

describe('query', () => {
	test("query · the wire's events arrive in order and EOSE resolves the read", async () => {
		const script = wireScript({ relays: [RELAY_A], events: [FIRST, SECOND], boundary: 'eose' })
		const observed: Record<string, unknown> = {}
		for (const { backend, suffix, verbs } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const result: WireResult = await seam.query({ kinds: [1] })
			expect(result.events.map((event) => event.id)).toEqual([FIRST.id, SECOND.id])
			expect(result.eose).toBe(true)
			// call order, on the record: the injected policy answered once, and one wire verb was reached
			expect(policy.calls).toEqual(['query'])
			expect(backend.verbs()).toEqual(verbs.query)
			observed[suffix] = { events: result.events.map((event) => event.id), eose: result.eose }
		}
		// both backends satisfy the same contract outcome
		expect(observed['the vendor adapter']).toEqual(observed['a hand-written pool'])
	})

	test('query · a deadline that fires reports eose:false instead of inventing completeness', async () => {
		// only the hand-written backend can be scripted to leave the wire silent;
		// the vendor adapter is never handed a request that would dial.
		const script = wireScript({ relays: [RELAY_A], hang: true })
		const backend = handBackend(script)
		const policy = recordingPolicy(script.relays)
		const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

		const result: WireResult = await seam.query({ kinds: [1] }, { deadlineMs: 20 })
		expect(result.events).toEqual([])
		// a cold answer is not a complete one: the seam reports the boundary it reached
		expect(result.eose).toBe(false)
		expect(policy.calls).toEqual(['query'])
		expect(backend.verbs()).toEqual(['request'])
	})

	test('query · a relay refusal mid-read resolves with what arrived, and both backends agree', async () => {
		// one relay replays an event and then refuses — the refusal arrives after the
		// event, which is the case a rejection would throw away (`#10b5ac`)
		const script = wireScript({
			relays: [RELAY_A],
			events: [FIRST],
			boundary: 'close',
			closeReason: 'rate-limited: slow down',
			failureReason: 'rate-limited',
		})
		for (const { backend, suffix } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const read: WireResult = await seam.query({ kinds: [1] })
			expect(policy.calls).toEqual(['query'])
			// the *same* outcome object from either backend: what arrived, the boundary
			// fact, and the refusal as a value from the vocabulary
			expect({ [suffix]: readShape(read) }).toEqual({
				[suffix]: {
					events: [FIRST.id],
					eose: false,
					failures: [{ reason: 'rate-limited', message: 'rate-limited: slow down' }],
				},
			})
		}
	})

	test('query · a relay URL the policy names twice is targeted once', async () => {
		// the host may answer with the same relay twice; the target set is the
		// **unique** one, so one relay is not asked twice and its own boundary is
		// counted once (`#10b5ac`, `#06200d`)
		const script = wireScript({ relays: [RELAY_A, RELAY_A], events: [FIRST], boundary: 'eose' })
		const observed: Record<string, unknown> = {}
		for (const { backend, suffix } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const outcome = await within(seam.query({ kinds: [1] }))
			expect(outcome.settled).toBe(true)
			if (!outcome.settled) throw new Error('the read never settled: the completion count is not the unique target set')

			// the fix site, on the record: the pool was handed the relay once
			expect(backend.targets()).toEqual([[RELAY_A]])
			observed[suffix] = readShape(outcome.value)
		}
		// one arrival, and the wire's boundary was reached — from either backend
		expect(observed).toEqual({
			'the vendor adapter': { events: [FIRST.id], eose: true, failures: [] },
			'a hand-written pool': { events: [FIRST.id], eose: true, failures: [] },
		})
	})

	test('query · a read stops at the stated ceiling', async () => {
		// the spec's stated ceiling is an inspectable value in the tree
		// (`MAX_EVENTS_PER_READ`, printed by evidence/run.sh); one event past it is
		// offered, and the read stops at the ceiling rather than growing without bound
		const CEILING = 10_000
		const pool = workingPool({ request: () => range(0, CEILING + 1).pipe(map(() => FIRST)) })
		const policy = recordingPolicy([RELAY_A])
		const seam = createNostrIo({ pool: pool.port, policy: policy.policy })

		const read: WireResult = await seam.query({ kinds: [1] })
		expect(read.events.length).toBe(CEILING)
		// the boundary was not reached: the seam stopped, the wire did not finish
		expect(read.eose).toBe(false)
		// stopping at the ceiling is not a relay's refusal
		expect(read.failures).toEqual([])
	})

	test('query · a dripping wire is bounded by the wall-clock deadline', async () => {
		// a wire that keeps emitting and never reaches EOSE: an inactivity gap never
		// fires on it, so only a wall-clock budget on the whole read can bound it
		const drip = new Subject<Event>()
		const ticks = setInterval(() => drip.next(FIRST), 5)
		const policy = recordingPolicy([RELAY_A])
		const seam = createNostrIo({
			pool: workingPool({ request: () => drip }).port,
			policy: policy.policy,
		})
		try {
			const outcome = await within(seam.query({ kinds: [1] }, { deadlineMs: 40 }), 1000)
			expect(outcome.settled).toBe(true)
			if (!outcome.settled) throw new Error('the read never resolved: the deadline is an inactivity gap, not a wall clock')
			expect(outcome.value.eose).toBe(false)
			expect(outcome.value.events.length).toBeGreaterThan(0)
			// the deadline stopped it long before the ceiling would have
			expect(outcome.value.events.length).toBeLessThan(10_000)
		} finally {
			clearInterval(ticks)
			drip.complete()
		}
	})
	test("query · a target set naming one relay in two spellings still settles, and the host's set reaches the pool unrewritten", async () => {
		// D12.2 / B2: the wire's boundary is counted **per relay**, and the pool files
		// every relay under its own normalised key (`group.js:12`, `:21`, `:8-10`) — so
		// a set naming one relay in the host's spelling *and* in the pool's must count
		// it once, or the gate below can never open and the read waits for an answer
		// that is not coming. The pool is still handed the host's array unchanged
		// (`#06200d`): what is normalised is the comparison, not the host's answer.
		const raw = RELAY_A
		const normalised = `${RELAY_A}/`
		const script = wireScript({ relays: [raw, normalised], events: [FIRST], boundary: 'eose' })
		const observed: Record<string, unknown> = {}
		for (const { backend, suffix } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const outcome = await within(seam.query({ kinds: [1] }), 500)
			expect(outcome.settled).toBe(true)
			if (!outcome.settled)
				throw new Error("the read never settled: the boundary is counted against the host's spellings instead of the pool's own identity")
			// the fix site, on the record: the host's set reached the pool as the host spelled it
			expect(backend.targets()).toEqual([[raw, normalised]])
			observed[suffix] = readShape(outcome.value)
		}
		// and both backends still agree on the read's shape
		expect(observed).toEqual({
			'the vendor adapter': { events: [FIRST.id], eose: true, failures: [] },
			'a hand-written pool': { events: [FIRST.id], eose: true, failures: [] },
		})
	})
})

describe('subscribe', () => {
	test('subscribe · live events and a relay refusal reach their channels', async () => {
		const script = wireScript({
			relays: [RELAY_A],
			events: [FIRST],
			boundary: 'close',
			closeReason: 'rate-limited: slow down',
			failureReason: 'rate-limited',
		})
		const observed: Record<string, unknown> = {}
		for (const { backend, suffix, verbs } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const subscription: Subscription = seam.subscribe({ kinds: [1] })
			const arrived = await firstValueFrom(subscription.events.pipe(take(1), toArray(), timeout(500)))
			expect(arrived.map((event) => event.id)).toEqual([FIRST.id])

			// the refusal is on the error channel, not a silent end to the event stream
			const failure = await firstValueFrom(subscription.errors.pipe(timeout(500)))
			expect(failure).toBeInstanceOf(RelaySeamError)
			expect(failure.reason).toBe('rate-limited')

			subscription.unsubscribe()
			expect(policy.calls).toEqual(['subscribe'])
			expect(backend.verbs()).toEqual(verbs.subscribe)
			observed[suffix] = { events: arrived.map((event) => event.id), reason: failure.reason }
		}
		expect(observed['the vendor adapter']).toEqual(observed['a hand-written pool'])
	})

	test("subscribe · a relay's own NIP-01 refusal prefix reaches the vocabulary on both paths", async () => {
		// NIP-01's machine-readable prefixes are the relay's own words: the vendor's
		// relay layer throws them and its group layer turns the throw into an ERROR
		// message, so the adapter has to read the error's own reason rather than
		// answering 'rejected' for every relay (`#5ecac1`)
		const prefixes: readonly (readonly [string, RelayReason])[] = [
			['rate-limited: slow down', 'rate-limited'],
			['auth-required: we need a nip-42 handshake', 'auth-required'],
		]
		for (const [closeReason, reason] of prefixes) {
			const script = wireScript({ relays: [RELAY_A], events: [FIRST], boundary: 'close', closeReason, failureReason: reason })
			const channeled: Record<string, unknown> = {}
			const read: Record<string, unknown> = {}
			for (const { backend, suffix } of backends(script)) {
				const policy = recordingPolicy(script.relays)
				const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

				const subscription: Subscription = seam.subscribe({ kinds: [1] })
				const failure = await firstValueFrom(subscription.errors.pipe(timeout(500)))
				expect(failure).toBeInstanceOf(RelaySeamError)
				expect(failure.reason).toBe(reason)
				subscription.unsubscribe()
				channeled[suffix] = failure.reason

				const live = createNostrIo({ pool: backend.port, policy: policy.policy })
				const result: WireResult = await live.query({ kinds: [1] })
				expect(result.events.map((event) => event.id)).toEqual([FIRST.id])
				read[suffix] = readShape(result)
			}
			// the same reason, from two different PoolPort implementations, on both paths
			expect(channeled['the vendor adapter']).toBe(channeled['a hand-written pool'])
			expect(read['the vendor adapter']).toEqual(read['a hand-written pool'])
			expect(channeled['the vendor adapter']).toBe(reason)
		}
	})

	test('subscribe · closeOnEose ends the stream at the boundary, after the events that preceded it', async () => {
		const script = wireScript({ relays: [RELAY_A], events: [FIRST, SECOND], boundary: 'eose' })
		const counted = scriptedSubscription(script)
		const backend = handBackend(script, counted.subscription)
		const policy = recordingPolicy(script.relays)
		const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

		const subscription: Subscription = seam.subscribe({ kinds: [1] }, { closeOnEose: true })
		// an EOSE the pool already holds must not complete the output before the events
		const arrived = await collect(subscription.events, 2)
		expect(arrived.map((event) => event.id)).toEqual([FIRST.id, SECOND.id])
		// and the option ends the pool's subscription at the boundary — once
		expect(counted.teardowns()).toBe(1)
	})

	test('subscribe · unsubscribe twice closes once and throws nothing', () => {
		const counted = scriptedSubscription(wireScript({ relays: [RELAY_A] }))
		const backend = handBackend(wireScript({ relays: [RELAY_A] }), counted.subscription)
		const policy = recordingPolicy([RELAY_A])
		const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

		const subscription: Subscription = seam.subscribe({ kinds: [1] })
		subscription.unsubscribe()
		expect(() => subscription.unsubscribe()).not.toThrow()
		// the pool's teardown ran once: the cancellation is idempotent (`#15aa73`)
		expect(counted.teardowns()).toBe(1)
	})
})

describe('publish', () => {
	test('publish · one ack per targeted relay, and a silent relay is reported not dropped', async () => {
		const script = wireScript({ relays: [RELAY_A, RELAY_B], acks: [{ url: RELAY_A, accepted: true }] })
		const observed: Record<string, unknown> = {}
		for (const { backend, suffix, verbs } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const event: Event = signedEvent({ kind: 1, content: 'published', created_at: 1000 })
			const outcome: PublishOutcome = await seam.publish(event)
			expect(outcome.id).toBe(event.id)
			// one ack per targeted relay, in the policy's own order
			expect(outcome.acks.map((ack) => ack.url)).toEqual([RELAY_A, RELAY_B])
			expect(outcome.acks.find((ack) => ack.url === RELAY_A)?.accepted).toBe(true)
			expect(outcome.acks.find((ack) => ack.url === RELAY_B)?.accepted).toBe(false)
			// no local write: the only verb reached was the publish itself
			expect(policy.calls).toEqual(['publish'])
			expect(backend.verbs()).toEqual(verbs.publish)
			observed[suffix] = outcome.acks
		}
		expect(observed['the vendor adapter']).toEqual(observed['a hand-written pool'])
	})

	test("publish · an ack is matched under the pool's own identity while the caller keeps the host's spelling", async () => {
		// D12.1 / B2: the pool reports each relay's own answer under the identity it
		// files that relay by — the normalised URL (`relay.js:653`, `:674`) — so a host
		// naming `wss://relay.alpha.invalid` (the ordinary spelling, no trailing slash)
		// gets a refusal the seam **invented** for a relay that answered `ok: true`.
		// The match runs under the module's own normalising predicate (the one `status()`
		// already uses), and the ack handed back keeps the host's spelling, because that
		// is the caller's own answer (`#ae22a4`).
		const script = wireScript({ relays: [RELAY_A], acks: [{ url: RELAY_A, accepted: true }] })
		const observed: Record<string, unknown> = {}
		for (const { backend, suffix } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const event: Event = signedEvent({ kind: 1, content: 'published', created_at: 1000 })
			const outcome: PublishOutcome = await seam.publish(event)
			// the relay answered, and the seam reports it as having answered — under
			// the spelling the caller used, not the pool's
			expect(outcome.acks).toEqual([{ url: RELAY_A, accepted: true }])
			observed[suffix] = outcome.acks
		}
		expect(observed['the vendor adapter']).toEqual(observed['a hand-written pool'])
	})
})

describe('count', () => {
	test("count · NIP-45's count carries the relay's approximation flag", async () => {
		const script = wireScript({ relays: [RELAY_A], count: { count: 42, approximate: true } })
		const observed: Record<string, unknown> = {}
		for (const { backend, suffix, verbs } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const result: CountResult = await seam.count({ kinds: [1] })
			expect(result.count).toBe(42)
			expect(result.approximate).toBe(true)
			expect(policy.calls).toEqual(['count'])
			expect(backend.verbs()).toEqual(verbs.count)
			observed[suffix] = result
		}
		expect(observed['the vendor adapter']).toEqual(observed['a hand-written pool'])
	})

	test("count · the wire count settles against a pool whose COUNT stream never completes, and is the sum of the relays' own indices", async () => {
		// D1.4 / D2 / B1: the vendor's group COUNT stream is
		// `relays$.pipe(switchMap(combineLatest(…)), share())` (`group.js:187-190`),
		// rooted in a `BehaviorSubject` (`group.js:12`, `:21`) — it emits the per-relay
		// record once **every** targeted relay has answered and then **never completes**.
		// An adapter that awaits a completion (`lastValueFrom`) therefore never answers;
		// one that takes the **first** emission answers with the whole record. The rule
		// the record obeys is D2's: the count over a set is the **sum** of the relays'
		// own indices, and `approximate` whenever any relay said so.
		const summed: readonly (readonly [boolean, boolean, number])[] = [
			// [alpha approximate, beta approximate, expected total]
			[true, false, 7],
			[false, false, 7],
		]
		for (const [alphaApproximate, betaApproximate, total] of summed) {
			const script = wireScript({
				relays: [RELAY_A, RELAY_B],
				counts: {
					[RELAY_A]: { count: 3, approximate: alphaApproximate },
					[RELAY_B]: { count: 4, approximate: betaApproximate },
				},
			})
			const observed: Record<string, unknown> = {}
			for (const { backend, suffix } of backends(script)) {
				const policy = recordingPolicy(script.relays)
				const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

				const outcome = await within(seam.count({ kinds: [1] }), 500)
				expect(outcome.settled).toBe(true)
				if (!outcome.settled) throw new Error("the count never settled: the adapter awaits a completion the vendor's group never emits")
				// the sum of the relays' own indices, not one relay's answer
				expect(outcome.value.count).toBe(total)
				// approximate when **either** relay said so, false when neither did
				expect(outcome.value.approximate).toBe(alphaApproximate || betaApproximate)
				observed[suffix] = outcome.value
			}
			expect(observed['the vendor adapter']).toEqual(observed['a hand-written pool'])
		}
	})
})

describe('connect', () => {
	test("connect · the relay set is the injected policy's answer", async () => {
		const script = wireScript({ relays: [RELAY_A, RELAY_B] })
		for (const { backend, verbs } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })

			const statuses: RelayStatus[] = await seam.connect()
			expect(statuses.map((status) => status.url)).toEqual([RELAY_A, RELAY_B])
			expect(policy.calls).toEqual(['connect'])
			expect(backend.verbs()).toEqual(verbs.connect)
		}
	})

	test('connect · a relay the pool already holds is reported by its own state, and a URL that is not a relay is refused', async () => {
		// `pool.relay(url)` is the vendor's own registration: it normalises the URL,
		// files the relay under that key and dials nothing. The seam must look the
		// relay up by **that** key, and must not invent "not connected" for a URL the
		// pool cannot be asked about (`#b14090`)
		const holding = vendorPoolHolding([RELAY_A])
		try {
			expect(holding.keys).toEqual([`${RELAY_A}/`])
			const policy = recordingPolicy([RELAY_A])
			const seam = createNostrIo({ pool: holding.port, policy: policy.policy })

			const statuses: RelayStatus[] = await seam.connect()
			expect(statuses.map((status) => status.url)).toEqual([RELAY_A])
			expect(statuses[0].ready).toBe(true)
			expect(statuses[0].connected).toBe(false)
			expect(policy.calls).toEqual(['connect'])

			const bad = createNostrIo({ pool: holding.port, policy: recordingPolicy(['not a relay url']).policy })
			const refused = await rejection(bad.connect())
			expect(isRefusal(refused)).toBe(true)
			if (!isRefusal(refused)) throw new Error('a URL that is not a relay was answered with a status instead of a refusal')
			expect(refused.reason).toBe('rejected')
		} finally {
			holding.close()
		}
	})
})

describe('the multi-backend case', () => {
	test('the multi-backend case · the same suite passes over the vendor adapter and over a hand-written pool', async () => {
		const script = wireScript({
			relays: [RELAY_A],
			events: [FIRST, SECOND],
			boundary: 'eose',
			acks: [{ url: RELAY_A, accepted: true }],
			count: { count: 3, approximate: false },
		})

		const observed: Record<string, unknown> = {}
		for (const { backend, suffix } of backends(script)) {
			const policy = recordingPolicy(script.relays)
			const seam = createNostrIo({ pool: backend.port, policy: policy.policy })
			const read: WireResult = await seam.query({ kinds: [1] })
			const outcome: PublishOutcome = await seam.publish(FIRST)
			const counted: CountResult = await seam.count({ kinds: [1] })
			observed[suffix] = {
				events: read.events.map((event) => event.id),
				eose: read.eose,
				acks: outcome.acks,
				count: counted,
				policyReads: policy.calls,
			}
		}

		// the same contract outcome from two different PoolPort implementations:
		// the seam is adapter-shaped, and nothing it reports is the vendor's idiom
		expect(observed).toEqual({
			'the vendor adapter': {
				events: [FIRST.id, SECOND.id],
				eose: true,
				acks: [{ url: RELAY_A, accepted: true }],
				count: { count: 3, approximate: false },
				policyReads: ['query', 'publish', 'count'],
			},
			'a hand-written pool': {
				events: [FIRST.id, SECOND.id],
				eose: true,
				acks: [{ url: RELAY_A, accepted: true }],
				count: { count: 3, approximate: false },
				policyReads: ['query', 'publish', 'count'],
			},
		})
	})
})
