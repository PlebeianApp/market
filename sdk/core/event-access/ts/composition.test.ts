/**
 * composition.test.ts — the named paths P1…P7 and the invariants LF-1…LF-7.
 *
 * One case per evidence obligation the spec states (`#62b9a1`), each naming the **careless
 * implementation it fails on** — the shape the red team's falsifiability table writes out
 * (`runs/2026-09-30-first-usable-version/review/red-team-a-specs.md` §3, as tightened by
 * D-O14/D-O17). No case here asserts that a call merely resolved: every one reads a recorded
 * call count, a write count, an event count, an origin, or a bounded clock.
 *
 * Every port is a hand-written fake in `harness.ts`. Nothing here opens a socket, a relay or
 * a store, and nothing waits without a timeout (`collect` rejects rather than hanging).
 *
 * The last three cases are **Increment 3's**, and they are the fill's: the bounded fill is the
 * loader-backed upstream composed over the one pool (`createLoaderBackedFill`), the live fill stays
 * the seam's own subscription, and the pool the loader drives is this module's declared shape with
 * no adapter — a compile gate, not a claim.
 */
import { expect, test } from 'bun:test'
import { firstValueFrom, toArray } from 'rxjs'
import { createEventLoader } from 'applesauce-loaders/loaders'

import { DEFAULT_WRITE_BACK, EventAccessError, createEventAccess, originOf } from './index'
import type { AcceptContext } from './index'
import { createLoaderBackedFill } from './composition'
import {
	RELAY_A,
	RELAY_B,
	bareUpstream,
	collect,
	echoingEndpoint,
	failingUpstream,
	modelEndpoint,
	neverAnsweringUpstream,
	quiet,
	recordingPool,
	recordingUpstream,
	secondaryEndpoint,
	signedEvent,
	throwingUpstream,
} from './harness'
import type { Event, UpstreamPool } from './types'

/* ---------------------------------------------------------------------------------------
 * LF-1 · the local answer precedes any network participation (P1, and the subscription path)
 * --------------------------------------------------------------------------------------- */

test('LF-1 · the local read is the first call, and the pool IS called — a fixture that recorded nothing cannot pass', async () => {
	// Careless implementation it fails on: one that reads the pool first (or that never
	// touches it, making "nothing preceded the local answer" vacuously true).
	const order: string[] = []
	const local = signedEvent({ kind: 1, created_at: 1_000, content: 'local' })
	const remote = signedEvent({ kind: 1, created_at: 2_000, content: 'remote' })
	const endpoint = modelEndpoint({ events: [local], calls: order })
	const upstream = recordingUpstream({ events: [remote] }, order)
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ kinds: [1] })

	// the shared record, in order — the pool's call is present and it is second.
	expect(order.slice(0, 2)).toEqual(['read', 'query'])
	expect(order).toContain('query')
	expect(answer.events.map((event) => event.id)).toEqual([local.id, remote.id])
	expect(answer.complete).toBe(true)
})

test('LF-1 · on the subscription path the local read precedes the seam subscription', async () => {
	// Careless implementation it fails on: one that opens the relay subscription before
	// answering locally — the replay would no longer be local-first.
	const order: string[] = []
	const endpoint = modelEndpoint({ events: [], calls: order })
	const upstream = recordingUpstream({ events: [] }, order)
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const subscription = access.subscribe({ kinds: [1] })
	await quiet(20)

	expect(order).toEqual(['read', 'subscribe'])
	subscription.unsubscribe()
})

test('LF-7 · the pointer read is the sequence with one element (P5)', async () => {
	// Careless implementation it fails on: one that skips the local read for a single-id
	// query, or that treats the pointer read as a seventh operation.
	//
	// The spec's own wording is three steps long — "local first, then relay hints, then extra
	// relays" (`#df42e2`) — but this module owns only the first of them: the declared upstream
	// port has one `query`, and relay choice is the seam's injected policy
	// (`nostr-io/ts/types.ts:152`). So this case asserts the two steps the composition owns —
	// local, then the seam — and claims nothing about relay selection, which is the spec's own
	// rule that a capability on one path is never stated as supported for another (W4a N-3).
	const order: string[] = []
	const event = signedEvent({ kind: 1, created_at: 3_000 })
	const endpoint = modelEndpoint({ events: [event], calls: order })
	const upstream = recordingUpstream({ events: [] }, order)
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ ids: [event.id] })

	expect(order).toEqual(['read', 'query'])
	expect(answer.events.map((candidate) => candidate.id)).toEqual([event.id])
})

/* ---------------------------------------------------------------------------------------
 * LF-2 · the fill's events are written back through the endpoint — with an expected count
 * --------------------------------------------------------------------------------------- */

test('LF-2 · the query fill is written back through the endpoint, counted (D-O17)', async () => {
	// Careless implementation it fails on: one that never writes anything — the write count
	// is asserted, so "a later read does not see it" cannot be satisfied by writing nothing.
	const local = signedEvent({ kind: 1, created_at: 1_000 })
	const remoteA = signedEvent({ kind: 1, created_at: 2_000 })
	const remoteB = signedEvent({ kind: 1, created_at: 3_000 })
	const endpoint = modelEndpoint({ events: [local] })
	const upstream = recordingUpstream({ events: [remoteA, remoteB] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	await access.query({ kinds: [1] })

	expect(endpoint.writes.length).toBe(1)
	expect(endpoint.writes[0].map((event) => event.id).sort()).toEqual([remoteA.id, remoteB.id].sort())
})

test('LF-2 · the subscription fill is written back through the endpoint, counted (D-O17)', async () => {
	// Careless implementation it fails on: one that fills a subscription from the seam and
	// never offers what it answered to the store.
	const remote = signedEvent({ kind: 1, created_at: 4_000 })
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const subscription = access.subscribe({ kinds: [1] })
	const arrived = collect(subscription.events, 1)
	await quiet(20)
	upstream.live.next(remote)

	expect((await arrived).map((candidate) => candidate.id)).toEqual([remote.id])
	expect(endpoint.writes.length).toBe(1)
	expect(endpoint.writes[0].map((candidate) => candidate.id)).toEqual([remote.id])
	subscription.unsubscribe()
})

/* ---------------------------------------------------------------------------------------
 * LF-3 · a later write reaches open subscriptions exactly once
 * --------------------------------------------------------------------------------------- */

test('the change fan-out honours the subscription own filters — an unrelated local write is not delivered', async () => {
	// Careless implementation it fails on: one that fans the endpoint's change notification straight
	// through, so a `{kinds:[1]}` subscription is handed a local kind-7 write. MEASURED before this fix
	// (2026-09-30, after the store shrink landed): the subscription did receive it, because the store's
	// own live path applied `matchFilters` before the shrink and the endpoint's `changes` is an
	// unfiltered local change notification — necessarily so, since the declared endpoint shape carries no
	// filters. The filter therefore belongs to the fan-out, which is where it now is.
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const subscription = access.subscribe({ kinds: [1] })
	const arrived: Event[] = []
	subscription.events.subscribe((event) => arrived.push(event))
	await quiet(30)

	endpoint.changes.push(signedEvent({ kind: 7, created_at: 30_000 })) // names a kind this subscription did not ask for
	endpoint.changes.push(signedEvent({ kind: 1, created_at: 30_500 })) // and one it did
	await quiet(80)
	subscription.unsubscribe()

	expect(arrived.map((event) => event.kind)).toEqual([1]) // the matching write only, and exactly once
})

test('LF-3 · a write reaches an open subscription exactly once — asserted as == 1, not <= 1', async () => {
	// Careless implementation it fails on: one that re-delivers on every change notification
	// (0 passes "at most once", 2 fails "exactly once").
	const event = signedEvent({ kind: 1, created_at: 5_000 })
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const subscription = access.subscribe({ kinds: [1] }, { onlyNew: true })
	await quiet(20)

	const arrived: Event[] = []
	const handle = subscription.events.subscribe((candidate) => arrived.push(candidate))
	await access.publish([event])
	await access.publish([event])
	await quiet(60)
	handle.unsubscribe()
	subscription.unsubscribe()

	expect(arrived.map((candidate) => candidate.id)).toEqual([event.id])
})

/* ---------------------------------------------------------------------------------------
 * LF-4 · on a cold cache "not local" is never "not there"
 * --------------------------------------------------------------------------------------- */

test('LF-4 · an empty local set is answered as an empty set with complete:false, not withheld', async () => {
	// Careless implementation it fails on: one that reports complete:true for an answer it
	// never actually completed, or that withholds the local answer.
	const endpoint = modelEndpoint({ events: [] })
	const upstream = neverAnsweringUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ kinds: [1] }, { localFirst: true, deadlineMs: 50 })

	expect(answer.events).toEqual([])
	expect(answer.complete).toBe(false)
	expect(endpoint.calls).toEqual(['read'])
	expect(upstream.calls).toEqual(['query'])
})

/* ---------------------------------------------------------------------------------------
 * LF-5 · a deadline resolves with what arrived and says so (P2)
 * --------------------------------------------------------------------------------------- */

test('LF-5 · a deadline resolves within the budget with the local answer and complete:false', async () => {
	// Careless implementation it fails on: one that lets a never-answering pool hold the
	// caller's read open (the case would time out), or that reports completeness anyway.
	const local = signedEvent({ kind: 1, created_at: 6_000 })
	const endpoint = modelEndpoint({ events: [local] })
	const upstream = neverAnsweringUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const started = Date.now()
	const answer = await access.query({ kinds: [1] }, { localFirst: false, deadlineMs: 50 })
	const elapsed = Date.now() - started

	// the observable: it *resolved*, within a bound, rather than hanging — and it says so.
	expect(elapsed).toBeLessThan(2_000)
	expect(answer.events.map((event) => event.id)).toEqual([local.id])
	expect(answer.complete).toBe(false)
	expect(upstream.calls).toEqual(['query'])
})

/* ---------------------------------------------------------------------------------------
 * LF-6 · a relay failure reduces completeness, never the answer
 * --------------------------------------------------------------------------------------- */

test('LF-6 · a failing pool over a NON-EMPTY local set yields the local answer and complete:false', async () => {
	// Careless implementation it fails on: one that rejects the read, or that returns an
	// empty set — with a non-empty fixture a rejecting implementation differs from a
	// resolving one, which an empty fixture could not show.
	const local = signedEvent({ kind: 1, created_at: 7_000 })
	const endpoint = modelEndpoint({ events: [local] })
	const upstream = failingUpstream('timeout')
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ kinds: [1] })

	expect(answer.events.map((event) => event.id)).toEqual([local.id])
	expect(answer.complete).toBe(false)
	expect(upstream.calls).toEqual(['query'])
})

test('LF-6 · a subscription a failing seam cannot open ends with a STATED reason, never silently', async () => {
	// Careless implementation it fails on: one that drops the subscription (no reason), or
	// that ends `events` silently.
	const endpoint = modelEndpoint({ events: [] })
	const upstream = failingUpstream('timeout')
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const subscription = access.subscribe({ kinds: [1] })
	const errors = await collect(subscription.errors, 1)

	expect(errors[0]).toBeInstanceOf(EventAccessError)
	expect(errors[0].reason).toBe('timeout')
})

/* ---------------------------------------------------------------------------------------
 * provenance · per answer, per id, with the both-tier precedence pinned
 * --------------------------------------------------------------------------------------- */

test('provenance · an id both tiers produced is local, and an id only the fill produced is network', async () => {
	// Careless implementation it fails on: one that reports the tier that answered LAST (or
	// leaves the both-tier case to whichever copy arrived second).
	const shared = signedEvent({ kind: 1, created_at: 8_000, content: 'both' })
	const onlyRemote = signedEvent({ kind: 1, created_at: 9_000, content: 'network only' })
	const endpoint = modelEndpoint({ events: [shared] })
	const upstream = recordingUpstream({ events: [shared, onlyRemote] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ kinds: [1] })

	// the union is id-unique: the duplicate the fill carried is merged away.
	expect(answer.events.map((event) => event.id)).toEqual([shared.id, onlyRemote.id])
	expect(access.originOf(answer, shared.id)).toBe('local')
	expect(access.originOf(answer, onlyRemote.id)).toBe('network')
	// the declared companion read is the same record, standalone.
	expect(originOf(answer, shared.id)).toBe('local')
	expect(originOf(answer, onlyRemote.id)).toBe('network')
})

/* ---------------------------------------------------------------------------------------
 * persist:false and its positive companion (D-O3, D-O14(f))
 * --------------------------------------------------------------------------------------- */

test('persist:false suppresses the write-back for that call only, and persist:true DOES write (D-O17)', async () => {
	// Careless implementation it fails on: one that never writes back anything — the
	// companion case is what makes "suppressed" mean something.
	const remote = signedEvent({ kind: 1, created_at: 10_000 })

	const suppressed = modelEndpoint({ events: [] })
	const suppressedUpstream = recordingUpstream({ events: [remote] })
	const accessA = createEventAccess({ endpoint: suppressed.endpoint, upstream: suppressedUpstream.upstream })
	const answerA = await accessA.query({ kinds: [1] }, { persist: false })

	expect(suppressed.writes.length).toBe(0)
	// the answer is unchanged: the fill's event is still returned, and still network-answered.
	expect(answerA.events.map((event) => event.id)).toEqual([remote.id])
	expect(accessA.originOf(answerA, remote.id)).toBe('network')

	const written = modelEndpoint({ events: [] })
	const writtenUpstream = recordingUpstream({ events: [remote] })
	const accessB = createEventAccess({ endpoint: written.endpoint, upstream: writtenUpstream.upstream })
	await accessB.query({ kinds: [1] }, { persist: true })

	expect(written.writes.length).toBe(1)
	expect(written.writes[0].map((event) => event.id)).toEqual([remote.id])
})

/* ---------------------------------------------------------------------------------------
 * P4 · publish writes locally first, and the relays' own answers reach the caller
 * --------------------------------------------------------------------------------------- */

test('P4 · publish writes locally first and reports the relays own answers, refusals included', async () => {
	// Careless implementation it fails on: one that returns two empty arrays unconditionally,
	// which would pass a criterion that never reads a relay's answer.
	const event = signedEvent({ kind: 1, created_at: 11_000 })
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({
		acks: [
			{ url: RELAY_A, accepted: true },
			{ url: RELAY_B, accepted: false, reason: 'rate-limited' },
		],
	})
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const outcome = await access.publish([event])

	expect(outcome.stored).toBe(true)
	expect(endpoint.calls).toEqual(['write'])
	expect(endpoint.writes[0].map((candidate) => candidate.id)).toEqual([event.id])
	expect(upstream.calls).toEqual(['publish'])
	expect(outcome.accepted).toEqual([RELAY_A])
	expect(outcome.refused).toEqual([{ url: RELAY_B, reason: 'rate-limited' }])
})

test('P4 · a publication no relay took is still a local write', async () => {
	// Careless implementation it fails on: one that ties `stored` to a relay accepting.
	const event = signedEvent({ kind: 1, created_at: 12_000 })
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ acks: [{ url: RELAY_A, accepted: false, reason: 'rejected' }] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const outcome = await access.publish([event])

	expect(outcome.stored).toBe(true)
	expect(outcome.accepted).toEqual([])
	expect(outcome.refused).toEqual([{ url: RELAY_A, reason: 'rejected' }])
	expect(endpoint.writes.length).toBe(1)
})

/* ---------------------------------------------------------------------------------------
 * P6 · count is local and never fetches; P7 · delete routes through the endpoint
 * --------------------------------------------------------------------------------------- */

test('P6 · count answers from the local index and never touches the wire', async () => {
	// Careless implementation it fails on: one that consults the seam. The upstream here
	// throws from every method, so a wire count cannot pass.
	const first = signedEvent({ kind: 1, created_at: 13_000 })
	const second = signedEvent({ kind: 1, created_at: 14_000 })
	const endpoint = modelEndpoint({ events: [first, second] })
	const upstream = throwingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const result = await access.count({ kinds: [1] })

	expect(result.count).toBe(2)
	expect(result.approximate).toBe(false)
	expect(endpoint.calls).toEqual(['count']) // the operation ran...
	expect(upstream.calls).toEqual([]) // ...and never reached the wire
})

test('P7 · delete routes through the endpoint removal, and the change reaches an open subscription', async () => {
	// Careless implementation it fails on: one that decides the deletion itself, or that
	// removes without the resulting change reaching a live subscription.
	const event = signedEvent({ kind: 1, created_at: 15_000 })
	const endpoint = modelEndpoint({ events: [event] })
	const upstream = throwingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const subscription = access.subscribe({ kinds: [1] }, { onlyNew: true })
	const arrived = collect(subscription.events, 1)
	await quiet(20)

	const outcome = await access.delete([event.id])

	expect(outcome.removed).toBe(1)
	expect(endpoint.calls).toEqual(['remove'])
	expect(upstream.calls).toEqual([])
	expect((await arrived).map((candidate) => candidate.id)).toEqual([event.id])
	subscription.unsubscribe()
})

/* ---------------------------------------------------------------------------------------
 * the envelope, and the one declared policy value
 * --------------------------------------------------------------------------------------- */

test('the envelope is exactly {events, complete} — never a bare array, never widened', async () => {
	// Careless implementation it fails on: one that resolves with a bare array, or that
	// widens the envelope with a third member.
	const access = createEventAccess({ endpoint: modelEndpoint().endpoint, upstream: recordingUpstream().upstream })
	const answer = await access.query({ kinds: [1] })

	expect(Array.isArray(answer)).toBe(false)
	expect(Object.keys(answer).sort()).toEqual(['complete', 'events'])
})

test('the write-back policy is one declared inspectable value, and the accept hook is its fifth answer', () => {
	// Careless implementation it fails on: one whose policy is inferred from behaviour.
	expect(DEFAULT_WRITE_BACK.writeBack).toBe('network')
	expect(DEFAULT_WRITE_BACK.honourPersist).toBe(true)
	expect(DEFAULT_WRITE_BACK.excluded).toEqual([])
	expect(DEFAULT_WRITE_BACK.onReject).toBe('skip')
	expect(DEFAULT_WRITE_BACK.accept).toBeUndefined()

	const access = createEventAccess({ endpoint: modelEndpoint().endpoint, upstream: recordingUpstream().upstream })
	expect(access.policy).toEqual(DEFAULT_WRITE_BACK)
})

test('one gate, applied at the three destinations — the answer is filtered, nothing is written back, and publish shares it', async () => {
	// Careless implementation it fails on: one with two accept boundaries (a read-side one and a
	// publish-side one), one with none, or one whose gate runs **after** the union — where the
	// rejected event is still inside the answer. That last shape is the criterion `#c90101` could
	// not assert before D-O21, which is why this case replaces the reading it used to encode.
	const remote = signedEvent({ kind: 1, created_at: 16_000 })
	const calls: string[] = []
	const endpoint = modelEndpoint({ events: [], calls })
	const upstream = recordingUpstream({ events: [remote] }, calls)
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		policy: { writeBack: 'network', honourPersist: true, excluded: [], onReject: 'report', accept: () => 'reject' },
	})

	const answer = await access.query({ kinds: [1] })
	expect(answer.events.map((event) => event.id)).toEqual([]) // the gate runs BEFORE the union: the answer is filtered
	expect(answer.complete).toBe(true) // and a dropped event is not an incomplete answer (`#87b422`)
	expect(endpoint.writes.length).toBe(0) // so the rejected event is never written back either

	const event = signedEvent({ kind: 1, created_at: 17_000 })
	const outcome = await access.publish([event])
	expect(endpoint.writes.length).toBe(0) // the publish path shares the same one gate
	expect(outcome.stored).toBe(false)
	expect(calls.filter((call) => call === 'publish').length).toBe(0) // and the relay attempt saw the same set: nothing
})

test('the gate runs before the union on BOTH named paths — a dropped id is absent from events on P2 as well', async () => {
	// Careless implementation it fails on: one that gates the answer **after** the union, or only on
	// the default path, leaving the path's merge order to decide what a validator can see (D-O21).
	const remote = signedEvent({ kind: 1, created_at: 20_000 })
	const endpoint = modelEndpoint({ events: [remote] })
	const upstream = recordingUpstream({ events: [remote] })
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		policy: {
			writeBack: 'network',
			honourPersist: true,
			excluded: [],
			onReject: 'skip',
			accept: (event) => (event.id === remote.id ? 'reject' : 'accept'),
		},
	})

	for (const localFirst of [true, false]) {
		const answer = await access.query({ kinds: [1] }, { localFirst })
		expect(answer.events.map((event) => event.id)).toEqual([]) // dropped by the gate, on this path too
		expect(answer.complete).toBe(true) // the wire's boundary was reached: not an incomplete answer
	}
	expect(endpoint.writes.length).toBe(0) // and the dropped id never reached the store on either path
})

test('publish writes nothing the gate dropped, and the relay attempt sees exactly the same permitted set', async () => {
	// Careless implementation it fails on: one that filters the set it hands the store but passes the
	// **unfiltered** set to the seam, or one that leaves the publish path ungated (`#2ffa85`, D-O21).
	const calls: string[] = []
	const dropped = signedEvent({ kind: 1, created_at: 21_000 })
	const kept = signedEvent({ kind: 1, created_at: 21_500 })
	const endpoint = modelEndpoint({ events: [], calls })
	const upstream = recordingUpstream({ events: [] }, calls)
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		policy: {
			writeBack: 'network',
			honourPersist: true,
			excluded: [],
			onReject: 'skip',
			accept: (event) => (event.id === dropped.id ? 'reject' : 'accept'),
		},
	})

	const outcome = await access.publish([dropped, kept])
	expect(endpoint.writes.flat().map((event) => event.id)).toEqual([kept.id]) // the store saw the permitted one only
	expect(calls.filter((call) => call === 'publish').length).toBe(1) // the relay attempt saw the same set, one event wide
	expect(outcome.stored).toBe(true)
})

test('the gate is wired at two boundaries, each pure — the composition (not the rule) distinguishes the destinations', async () => {
	// The maintainer's 2026-10-02 ruling: a rule installed at two boundaries knows nothing
	// of which flow it is policing. If a destination needs to decide differently, that is
	// **two rules wired at two boundaries**, not one rule told which flow it is in.
	const seen: AcceptContext[] = []
	const endpoint = modelEndpoint({ events: [signedEvent({ kind: 1, created_at: 22_000 })], tier: 'remote' })
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		policy: {
			writeBack: 'network',
			honourPersist: true,
			excluded: [],
			onReject: 'skip',
			accept: (_event, context) => {
				seen.push(context)
				return 'accept'
			},
		},
	})

	await access.query({ kinds: [1] }) // through acceptForConsumer
	await access.publish([signedEvent({ kind: 1, created_at: 22_500 })]) // through acceptForWire

	// The rule receives the tier and resolve but never the flow — it cannot tell whether
	// it is policing a read or a publish; the composition distinguishes by which boundary
	// it applies the rule at.
	expect(seen.every((context) => context.tier === 'remote')).toBe(true)
	expect(typeof seen[0]?.resolve).toBe('function')
	expect((seen[0] as any).operation).toBeUndefined()
	// Two applications — the composition wired the same rule at two distinct boundaries
	expect(seen.length).toBe(2)
})

test('a link rule resolves through the injected resolver, and absent stays different from mismatched', async () => {
	// Careless implementation it fails on: one whose gate cannot reach a referenced event at all, or
	// one that grows a **second** read path for the link half instead of taking the injected resolver
	// (`#7f4e0a`, D-O21).
	const reference = 'a'.repeat(64)
	const referencing = signedEvent({ kind: 1, created_at: 23_000, tags: [['e', reference]] })
	const endpoint = modelEndpoint({ events: [referencing] })
	const upstream = recordingUpstream({ events: [] })
	const asked: string[] = []
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		resolver: async (asked_about: string) => {
			asked.push(asked_about)
			return undefined // the injected set does not hold it — a different fact from a mismatch
		},
		policy: {
			writeBack: 'network',
			honourPersist: true,
			excluded: [],
			onReject: 'skip',
			accept: async (event, context) => {
				const linked = event.tags.find((tag) => tag[0] === 'e')?.[1]
				if (linked === undefined) return 'accept'
				const held = await context.resolve(linked)
				return held === undefined ? 'reject' : held.id === linked ? 'accept' : 'reject'
			},
		},
	})

	const answer = await access.query({ kinds: [1] })
	expect(asked).toEqual([reference]) // the rule reached the reference through the injected resolver
	expect(answer.events).toEqual([]) // absent → reject, as a value rather than a crash
	expect(endpoint.calls.filter((call) => call === 'read').length).toBe(1) // and no second read path was grown
})

test('an over-budget gate drops its candidate and the answer still resolves with what it kept', async () => {
	// Careless implementation it fails on: one whose gate is unbounded, so a hook that never answers
	// withholds the local answer — the bound is the read's own, and LF-5 (`#cf8c70`) is not weakened by it.
	const local = signedEvent({ kind: 1, created_at: 24_000 })
	const endpoint = modelEndpoint({ events: [local] })
	const upstream = neverAnsweringUpstream()
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		policy: {
			writeBack: 'network',
			honourPersist: true,
			excluded: [],
			onReject: 'skip',
			accept: () => new Promise<never>(() => undefined), // never answers at all
		},
	})

	const answer = await access.query({ kinds: [1] }, { deadlineMs: 30 })
	expect(answer.events).toEqual([]) // the over-budget candidate was dropped, not withheld
	expect(answer.complete).toBe(false) // and the wire's boundary is still reported honestly
	expect(endpoint.writes.length).toBe(0)
})

test('the one rule lives at the three destinations and nowhere else — every crossing is gated', async () => {
	// The structural claim (§10.1, `#c8e35c`): content cannot reach the store, a consumer or the wire
	// without passing the accept rule, because the one gate is called only from the three destination
	// boundaries — `acceptForStore`, `acceptForConsumer` and `acceptForWire`. A hook that rejects
	// everything must therefore suppress every crossing, on every verb; if any path could reach a
	// destination undecided, that destination would still receive content. Careless implementation it
	// fails on: one that gates at the call sites a channel happens to remember, so a path with no
	// remembered gate delivers anyway.
	const local = signedEvent({ kind: 1, created_at: 40_000 })
	const remote = signedEvent({ kind: 1, created_at: 40_500 })
	const later = signedEvent({ kind: 1, created_at: 41_000 })
	const endpoint = modelEndpoint({ events: [local] })
	const upstream = recordingUpstream({ events: [remote], acks: [{ url: RELAY_A, accepted: true }] })
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		policy: { writeBack: 'network', honourPersist: true, excluded: [], onReject: 'skip', accept: () => 'reject' },
	})

	// destination · the consumer delivery (acceptForConsumer) and, routed from it, the store write
	const answer = await access.query({ kinds: [1] })
	expect(answer.events).toEqual([]) // the local answer was gated at the consumer boundary
	expect(endpoint.writes.length).toBe(0) // and the seam fill was gated at the store boundary

	// destination · the consumer delivery for the subscription replay, the live seam event and the fan-out
	const subscription = access.subscribe({ kinds: [1] })
	const arrived: Event[] = []
	subscription.events.subscribe((candidate) => arrived.push(candidate))
	await quiet(20)
	upstream.live.next(remote) // acceptForStore → routed to the consumer; no write-back either
	endpoint.changes.push(later) // acceptForConsumer
	await quiet(80)
	subscription.unsubscribe()
	expect(arrived).toEqual([]) // no consumer delivery bypassed the rule
	expect(endpoint.writes.length).toBe(0) // and no store write either

	// destination · the wire publish (acceptForWire), which gates the store write of a publish too
	const outcome = await access.publish([signedEvent({ kind: 1, created_at: 41_500 })])
	expect(outcome.stored).toBe(false)
	expect(endpoint.writes.length).toBe(0)
	expect(upstream.calls.filter((call) => call === 'publish').length).toBe(0) // the egress never ran
})

test('the excluded list is a declared value a test reads without driving a call', async () => {
	// Careless implementation it fails on: one that moves the wallet rule's exclusion into
	// a parameter at every call site, where a test cannot read it.
	const remote = signedEvent({ kind: 1, created_at: 18_000 })
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ events: [remote] })
	const policy = { writeBack: 'network' as const, honourPersist: true, excluded: ['1:'], onReject: 'skip' as const }
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream, policy })

	expect(access.policy.excluded).toEqual(['1:']) // read from the value, no call driven
	await access.query({ kinds: [1] })
	expect(endpoint.writes.length).toBe(0) // the excluded (kind,label) is never written here
})

/* ---------------------------------------------------------------------------------------
 * the contract is port-shaped, not one-fixture-shaped (order §3.7)
 * --------------------------------------------------------------------------------------- */

test('the conformance suite passes over TWO independently written endpoint fakes and TWO upstream fakes', async () => {
	// Careless implementation it fails on: one wired to a single fixture's incidental shape
	// (a seam that only compiles against one backend is the B2 class this project paid for).
	const local = signedEvent({ kind: 1, created_at: 19_000 })
	const remote = signedEvent({ kind: 1, created_at: 20_000 })

	// each combination gets its OWN pair of fixtures, so one case's write-back cannot move
	// the next case's starting state.
	const endpointBuilders = [() => modelEndpoint({ events: [local] }), () => secondaryEndpoint([local])]
	const upstreamBuilders = [() => recordingUpstream({ events: [remote] }), () => bareUpstream([remote])]

	for (const makeEndpoint of endpointBuilders) {
		for (const makeUpstream of upstreamBuilders) {
			const endpoint = makeEndpoint()
			const upstream = makeUpstream()
			const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

			// the local count is read BEFORE the fill, so the fill's write-back does not move it.
			expect((await access.count({ kinds: [1] })).count).toBe(1)

			const answer = await access.query({ kinds: [1] })
			expect(answer.events.map((event) => event.id)).toEqual([local.id, remote.id])
			expect(answer.complete).toBe(true)
			expect(access.originOf(answer, local.id)).toBe('local')
			expect(access.originOf(answer, remote.id)).toBe('network')
			// the fill was written back through the endpoint, so the local set now holds both.
			expect((await access.count({ kinds: [1] })).count).toBe(2)
			expect((await access.delete([local.id])).removed).toBe(1)
		}
	}
})

test('the filter-boundary case FAILS over the echoing fake, which is why the model is required', async () => {
	// Careless implementation it fails on: a fixture that echoes the caller's filter (or
	// returns its whole set) certifies a boundary the module never exercised — the B2 class.
	const event = signedEvent({ kind: 1, created_at: 21_000 })
	const echo = echoingEndpoint([event])
	const access = createEventAccess({ endpoint: echo.endpoint, upstream: recordingUpstream().upstream })

	// over the model a present-but-empty `#`-key is answered as nothing; over the echo the
	// whole set comes back, so a case asserting "nothing" fails here.
	const answered = await access.query({ '#e': [] })
	expect(answered.events.map((candidate) => candidate.id)).toEqual([event.id])

	// and the echo does not reject the malformed filter the model refuses.
	await expect(access.query({ ids: ['not-a-hex-identity'] })).resolves.toBeDefined()
})

/* ---------------------------------------------------------------------------------------
 * The repairs the W4 review round forced — each with the careless implementation it fails on
 * --------------------------------------------------------------------------------------- */

test('provenance · on P2 (localFirst:false) a both-tier id is STILL local: the precedence is a rule, not an arrival order', async () => {
	// Careless implementation it fails on: one that records whichever tier answered *first*, so
	// the documented precedence silently depends on the option the caller passed. `#34dcaa`
	// states it unconditionally; P2 inverts the order of the two calls, not the rule.
	const shared = signedEvent({ kind: 1, created_at: 34_000, content: 'both' })
	const endpoint = modelEndpoint({ events: [shared] })
	const upstream = recordingUpstream({ events: [shared] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ kinds: [1] }, { localFirst: false })

	expect(answer.events.map((event) => event.id)).toEqual([shared.id]) // still one event (M2)
	expect(access.originOf(answer, shared.id)).toBe('local')
})

test('the endpoint declares its own tier, and the merge marks by THAT — never by a call site (`#bec31a`)', async () => {
	// Careless implementation it fails on: one that hard-codes "the endpoint's answer is local",
	// so an endpoint that declares itself remote has its events mislabelled.
	const event = signedEvent({ kind: 1, created_at: 35_000 })
	const endpoint = modelEndpoint({ events: [event], tier: 'remote' })
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ kinds: [1] })

	expect(access.originOf(answer, event.id)).toBe('network') // the endpoint said 'remote'
})

test('LF-3 · a later write reaches EVERY open subscription exactly once, over either change-feed semantics', async () => {
	// Careless implementation it fails on: one that iterates the endpoint's `changes` once per
	// subscription, so the second subscriber competes for a single-consumer feed and is starved
	// with no reason on its error channel (M13). The composition iterates once and fans out, so
	// the port's consumer semantics are not load-bearing — proved over both shapes.
	for (const broadcast of [false, true]) {
		const event = signedEvent({ kind: 1, created_at: 36_000 })
		const endpoint = modelEndpoint({ events: [], broadcast })
		const upstream = recordingUpstream({ events: [] })
		const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

		const first = access.subscribe({ kinds: [1] }, { onlyNew: true })
		const second = access.subscribe({ kinds: [1] }, { onlyNew: true })
		await quiet(20)

		const arrivedFirst: string[] = []
		const arrivedSecond: string[] = []
		const handleFirst = first.events.subscribe((candidate) => arrivedFirst.push(candidate.id))
		const handleSecond = second.events.subscribe((candidate) => arrivedSecond.push(candidate.id))

		await access.publish([event])
		await quiet(60)
		handleFirst.unsubscribe()
		handleSecond.unsubscribe()
		first.unsubscribe()
		second.unsubscribe()

		// exactly once each — `== 1`, never `<= 1`, and never 0 for the second subscriber
		expect(arrivedFirst).toEqual([event.id])
		expect(arrivedSecond).toEqual([event.id])
		expect(endpoint.writes.length).toBe(1)
	}
})

test('onReject · "report" reaches the subscription error channel where the answer cannot carry it', async () => {
	// Careless implementation it fails on: one whose `onReject` is an inert declared value — a
	// policy member a test can read but nothing consumes, so 'report' and 'skip' behave alike.
	const drive = async (policy: { onReject: 'skip' | 'report' }): Promise<unknown[]> => {
		const remote = signedEvent({ kind: 1, created_at: 37_000 })
		const endpoint = modelEndpoint({ events: [], refuseWrites: 1 })
		const upstream = recordingUpstream({ events: [] })
		const access = createEventAccess({
			endpoint: endpoint.endpoint,
			upstream: upstream.upstream,
			policy: { writeBack: 'network', honourPersist: true, excluded: [], onReject: policy.onReject },
		})
		const subscription = access.subscribe({ kinds: [1] })
		const arrived = collect(subscription.events, 1)
		await quiet(20)
		upstream.live.next(remote)
		await arrived
		return collect(subscription.errors, 1, 120).catch(() => [])
	}

	const reported = await drive({ onReject: 'report' })
	expect(reported[0]).toBeInstanceOf(EventAccessError)
	expect(reported[0]).toMatchObject({ reason: 'rejected' })

	const skipped = await drive({ onReject: 'skip' })
	expect(skipped).toEqual([])
})

test('the filters reach both tiers unchanged and in the caller own order (`#e391d0`, W4a N-4)', async () => {
	// Careless implementation it fails on: one that re-spells or reorders what the caller wrote
	// on its way to a tier — the echo hazard, seen from the composition's side.
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })
	const filters = [{ kinds: [1] }, { kinds: [7], authors: ['a'.repeat(64)] }]

	await access.query(filters)

	expect(endpoint.reads).toEqual([filters])
	expect(upstream.queries).toEqual([filters])
})

/* ---------------------------------------------------------------------------------------
 * Increment 3 · the bounded fill is the loader-backed upstream; the live fill stays ours
 * --------------------------------------------------------------------------------------- */

test('Increment 3 · the fill goes through the loader, and LF-1 and LF-2 are untouched', async () => {
	// Careless implementation it fails on: one that keeps a hand-built fetch at the fill site (so the
	// pool is never dialled), one that merges the fill's events ahead of the local answer, or one that
	// drops the write-back for a fill that arrived through the loader.
	//
	// The loader is composed over a POOL fake, with the store endpoint's own `read` as its cache step —
	// the cache step and the local read are one read, not two (`CacheRequest` is what `read` already is).
	const local = signedEvent({ kind: 1, created_at: 1_000, content: 'local' })
	const remote = signedEvent({ kind: 1, created_at: 2_000, content: 'remote' })
	const endpoint = modelEndpoint({ events: [local] })
	const pool = recordingPool([remote])
	const seam = recordingUpstream({ events: [] })
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: seam.upstream,
		fill: createLoaderBackedFill(pool.pool, {
			cacheRequest: (filters) => endpoint.endpoint.read(filters),
			extraRelays: [RELAY_A],
		}),
	})

	const answer = await access.query({ ids: [local.id, remote.id] })

	// the fill went through the LOADER: its last step dialled the pool, over the composition-time relay
	// set, for the one id the cache step could not answer (the id it could answer was never dialled).
	expect(pool.calls).toEqual(['request'])
	expect(pool.relays).toEqual([[RELAY_A]])
	expect(pool.requests).toEqual([[{ ids: [remote.id] }]])
	// ...and the seam's own read was never used for the fill: the fill site really is the injected function.
	expect(seam.calls).toEqual([])

	// LF-1: the local answer precedes the fill's, and the id-unique union keeps one copy of each.
	expect(answer.events.map((event) => event.id)).toEqual([local.id, remote.id])
	expect(answer.complete).toBe(true)
	// LF-2: the fill's fresh event is written back through the endpoint, counted, and only it.
	expect(endpoint.writes.length).toBe(1)
	expect(endpoint.writes[0].map((event) => event.id)).toEqual([remote.id])
})

test('Increment 3 · the live subscription is NOT routed through a loader', async () => {
	// Careless implementation it fails on: one that reaches a loader for the live path. A `Loader` is a
	// fetch with a stop, never a live REQ, so routing the live fill through one would dial the pool and
	// would record a call on the fill — both are asserted to be silent below.
	const endpoint = modelEndpoint({ events: [] })
	const seam = recordingUpstream({ events: [] })
	const pool = recordingPool()
	const loaderFill = createLoaderBackedFill(pool.pool, { extraRelays: [RELAY_A] })
	const fillCalls: string[] = []
	const access = createEventAccess({
		endpoint: endpoint.endpoint,
		upstream: seam.upstream,
		fill: (filters) => {
			fillCalls.push('fill')
			return loaderFill(filters)
		},
	})

	const subscription = access.subscribe({ ids: [signedEvent({ kind: 1, created_at: 5_000 }).id] })
	await quiet(20)

	expect(endpoint.calls).toEqual(['read']) // the replay's local read first (LF-1)
	expect(seam.calls).toEqual(['subscribe']) // the live fill is the seam's own subscription
	expect(fillCalls).toEqual([]) // the fill was never consulted for it
	expect(pool.calls).toEqual([]) // and the pool was never dialled: no Loader is a live REQ

	subscription.unsubscribe()
})

test('Increment 3 · the loader takes our pool by construction — no adapter, no cast', async () => {
	// This case is a **compile gate** as much as a runtime one, which is why it asserts so little at
	// runtime: the pool below is typed with this module's declared `UpstreamPool` — the shape the seam's
	// own `PoolPort` satisfies (`nostr-io/ts/types.ts:190-209`: `request(relays, filters, opts?)`, its
	// third argument optional, which the declared shape does not require) — and it is handed to the
	// vendor's `createEventLoader` AND to this module's builder **with no cast**. A cast added to make
	// either line compile is the break case, and it cannot be added without editing this file.
	// (The seam's `PoolPort` itself is not importable here: this module's independence criterion forbids
	// a specifier that leaves its directory — `evidence/run.sh` §4 — so the real `PoolPort` was checked
	// against this shape out of tree instead, `tsc --noEmit`, exit 0.)
	const remote = signedEvent({ kind: 1, created_at: 3_000 })
	const pool: UpstreamPool = recordingPool([remote]).pool
	const cacheRequest = () => Promise.resolve([] as Event[])

	const loader = createEventLoader(pool, { cacheRequest, extraRelays: [RELAY_A], bufferTime: 0 })
	expect(typeof loader).toBe('function')
	expect(typeof loader.stop).toBe('function')

	// and it drives that pool: the pointer's own answer arrives through the loader's last step.
	expect((await firstValueFrom(loader({ id: remote.id }).pipe(toArray()))).map((event) => event.id)).toEqual([remote.id])

	// the same pool, handed to this module's own builder, with no cast either — and the fill answers
	// with the seam's read shape, `eose` true because the march ran and nothing refused.
	const fill = createLoaderBackedFill(pool, { cacheRequest, extraRelays: [RELAY_A] })
	const answered = await fill([{ ids: [remote.id] }])
	expect(answered.events.map((event) => event.id)).toEqual([remote.id])
	expect({ eose: answered.eose, failures: answered.failures }).toEqual({ eose: true, failures: [] })
})
