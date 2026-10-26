/**
 * ports.test.ts — the fail-closed filter boundary, and the two no-socket shapes.
 *
 * The boundary is reached **by calling the endpoint's read** (D-O5): the composition grows no
 * predicate of its own, and an unvalidated filter must not reach either tier. The no-socket
 * cases are structural (`#e6aa61`): a hand-written endpoint and a hand-written seam, each of
 * which **records every call and throws from every method**, are injected, so a composition
 * that needed a store or a socket could not pass by simply not being wired to one.
 *
 * Every call count below is a **stated, non-empty** list or is paired with one — a bare zero
 * is not evidence.
 */
import { expect, test } from 'bun:test'

import { EventAccessError, createEventAccess } from './index'
import { collect, foreignEndpoint, modelEndpoint, recordingUpstream, signedEvent, throwingEndpoint, throwingUpstream } from './harness'

/** What a promise did: its refusal, or the fact that it resolved. */
async function caughtOf(work: Promise<unknown>): Promise<unknown> {
	try {
		await work
		return 'resolved'
	} catch (error) {
		return error
	}
}

/* ---------------------------------------------------------------------------------------
 * The fail-closed filter boundary — both branches, reached by the endpoint's read
 * --------------------------------------------------------------------------------------- */

test('filter boundary · a malformed identity filter is rejected with the typed refusal, before either tier sees it', async () => {
	// Careless implementation it fails on: one that passes the caller's filter straight to the
	// seam, or that validates with a predicate of its own.
	const endpoint = modelEndpoint({ events: [signedEvent({ kind: 1, created_at: 1_000 })] })
	const upstream = recordingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	await expect(access.query({ ids: ['not-a-hex-identity'] })).rejects.toBeInstanceOf(EventAccessError)
	await expect(access.query({ ids: ['not-a-hex-identity'] })).rejects.toMatchObject({ reason: 'rejected' })

	// the guard was exercised THROUGH the endpoint's read, and no filter reached the wire.
	expect(endpoint.calls).toEqual(['read', 'read'])
	expect(upstream.calls).toEqual([])
})

test('the boundary precedes BOTH tiers on P2 — the wire never sees the filter, and nothing is written back', async () => {
	// The repair for the re-verification wave's falsification. Careless implementation it fails on: one
	// that honours `localFirst:false` by asking the seam before the endpoint's read has answered, so a
	// malformed filter reaches the wire and the fill's events are written into the store before the
	// boundary refuses. MEASURED before the repair: call order `['query','write','read']`, the seam handed
	// the raw filter, one write recorded on the endpoint — a refusal with side effects behind it.
	const order: string[] = []
	const endpoint = modelEndpoint({ events: [], calls: order })
	const fillEvent = signedEvent({ kind: 1, created_at: 40_000 })
	const upstream = recordingUpstream({ events: [fillEvent] }, order)
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	await expect(access.query({ ids: ['not-a-hex-identity'] }, { localFirst: false })).rejects.toMatchObject({
		reason: 'rejected',
	})

	expect(upstream.queries).toEqual([]) // the wire never saw the filter
	expect(endpoint.writes.length).toBe(0) // and the fill was never written back
	expect(order).toEqual(['read']) // the boundary is the only call that happened
})

test('filter boundary · an identity value that is not a string is refused by the same branch', async () => {
	// Careless implementation it fails on: one that repairs a malformed value instead of
	// refusing it (trimming, lower-casing, or dropping the entry).
	const endpoint = modelEndpoint()
	const upstream = recordingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	await expect(access.query({ authors: ['ABCDEF'] })).rejects.toMatchObject({ reason: 'rejected' })
	expect(endpoint.calls).toEqual(['read'])
})

test('filter boundary · a present-but-empty #-key list is answered as nothing, never dropped and never broadened', async () => {
	// Careless implementation it fails on: one that drops the empty key, broadening the filter
	// to the whole local set.
	const event = signedEvent({ kind: 1, created_at: 2_000 })
	const endpoint = modelEndpoint({ events: [event] })
	const upstream = recordingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const answer = await access.query({ '#e': [] })

	expect(answer.events).toEqual([]) // not the whole set — the key was kept and matched nothing
	expect(endpoint.calls).toEqual(['read'])
})

test('filter boundary · EVERY present-and-empty #-key matches nothing, not only the identity ones (P4/F1, I3a)', async () => {
	// This is the audit's P4/F1 divergence, proved on the model's own boundary. Careless
	// implementation it fails on: a model whose match-nothing predicate is **identity-only**
	// (`ids`/`authors`/`#e`/`#p`/`#P`), so `{'#d': []}` and `{'#t': []}` are NOT answered as
	// nothing but fall through to the matcher and are broadened to the whole local set — while
	// the rule it models (`event-store/ts/filters.ts:98`) has been GENERAL over every `#`-key
	// since I3a (D-O6 / `#7f4e0a`). The model must agree with the rule it names, exactly.
	const event = signedEvent({
		kind: 1,
		created_at: 2_500,
		tags: [
			['d', 'x'],
			['t', 'y'],
		],
	})
	const endpoint = modelEndpoint({ events: [event] })
	const upstream = recordingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	// a non-identity present-and-empty `#`-key is answered as nothing — the general rule.
	expect((await access.query({ '#d': [] })).events).toEqual([])
	expect((await access.query({ '#t': [] })).events).toEqual([])

	// the negative: a non-empty `#d` list is not this predicate's business — it is never
	// answered as nothing (the model does not skip it), so the stored event comes back.
	expect((await access.query({ '#d': ['x'] })).events.map((found) => found.id)).toEqual([event.id])

	expect(endpoint.calls).toEqual(['read', 'read', 'read'])
})

/* ---------------------------------------------------------------------------------------
 * M5 · no socket, proved structurally
 * --------------------------------------------------------------------------------------- */

test('M5 · the local operations still RESOLVE over a throwing seam, with the recorded counts stated', async () => {
	// The criterion's own wording (`#e6aa61`, order §3.6): over a seam that throws from every
	// method, the local operations still resolve — so they must not be made to *reject* to
	// prove a point. Careless implementation it fails on: one that reaches the wire for a
	// local-only operation, or that withholds a local answer because the seam failed.
	const first = signedEvent({ kind: 1, created_at: 31_000 })
	const second = signedEvent({ kind: 1, created_at: 32_000 })
	const endpoint = modelEndpoint({ events: [first, second] })
	const upstream = throwingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	await expect(access.count({ kinds: [1] })).resolves.toEqual({ count: 2, approximate: false })
	await expect(access.delete([first.id])).resolves.toEqual({ removed: 1 })
	expect(endpoint.calls).toEqual(['count', 'remove']) // the counts are stated, never a bare zero
	expect(upstream.calls).toEqual([]) // and the wire was never reached for either

	// the wire IS reached where the operation needs it, and a failure there degrades
	// completeness and never the answer (LF-6).
	const answer = await access.query({ kinds: [1] })
	expect(answer.events.map((event) => event.id)).toEqual([second.id])
	expect(answer.complete).toBe(false)
	expect(upstream.calls).toEqual(['query'])
})

test('M5 · a recording, throwing endpoint: every caller-facing verb refuses TYPED, never silently', async () => {
	// Careless implementation it fails on: one that lets a refused local operation resolve as
	// if it had succeeded — the silent-drop shape, reachable because the endpoint is local.
	const endpoint = throwingEndpoint()
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	await expect(access.count({ kinds: [1] })).rejects.toBeInstanceOf(EventAccessError)
	await expect(access.delete(['an-id'])).rejects.toBeInstanceOf(EventAccessError)
	await expect(access.query({ kinds: [1] })).rejects.toMatchObject({ reason: 'rejected' })

	expect(endpoint.calls).toEqual(['count', 'remove', 'read'])
	expect(upstream.calls).toEqual([])

	// and a subscription that cannot live ends with a typed reason rather than being dropped.
	const subscription = access.subscribe({ kinds: [1] })
	const errors = await collect(subscription.errors, 1)
	expect(errors[0]).toBeInstanceOf(EventAccessError)
	expect(endpoint.calls).toContain('changes') // the fake was reached and recorded before it threw
	expect(upstream.calls).toEqual([])
})

test('a FOREIGN endpoint refusal is surfaced as this module own class, on all four verbs (W4a 0.1)', async () => {
	// Careless implementation it fails on: one that lets the endpoint's own error object through
	// untranslated. `EventAccessError` is this module's class and a sibling may not import it, so
	// a real store throws something else — this fixture throws a locally declared `ForeignError`,
	// which is the only shape a foreign implementer can produce. The older fixtures threw this
	// module's own class, which certified the surface while the wrapper was absent.
	const endpoint = foreignEndpoint()
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const caught = [
		await caughtOf(access.query({ kinds: [1] })),
		await caughtOf(access.count({ kinds: [1] })),
		await caughtOf(access.delete(['an-id'])),
		await caughtOf(access.publish([signedEvent({ kind: 1, created_at: 33_000 })])),
	]

	for (const refusal of caught) {
		expect(refusal).toBeInstanceOf(EventAccessError)
		expect(refusal).toMatchObject({ reason: 'rejected' })
	}
	expect(endpoint.calls).toEqual(['read', 'count', 'remove', 'write'])
	expect(upstream.calls).toEqual([])
})

test('a signal already aborted opens NOTHING: no local read, no seam subscription, and a stated reason', async () => {
	// Careless implementation it fails on: one that opens a seam subscription it can no longer
	// cancel, because the cancellation flag was already set when the opener ran.
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ events: [] })
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	const controller = new AbortController()
	controller.abort()
	const subscription = access.subscribe({ kinds: [1] }, { signal: controller.signal })

	const errors = await collect(subscription.errors, 1)
	expect(errors[0]).toBeInstanceOf(EventAccessError)
	expect(endpoint.calls).toEqual([])
	expect(upstream.calls).toEqual([])

	subscription.unsubscribe() // idempotent, and it opens nothing new
	expect(upstream.calls).toEqual([])
})

test('M5 · the seam is reached only for the operations that need it, and a reaching call is recorded', async () => {
	// Careless implementation it fails on: one that publishes without the local write, or
	// that consults the wire for a local-only operation.
	const endpoint = modelEndpoint({ events: [] })
	const upstream = throwingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })

	// a read over a throwing seam still answers locally (LF-6), and the seam call IS recorded.
	const answer = await access.query({ kinds: [1] })
	expect(answer.complete).toBe(false)
	expect(upstream.calls).toEqual(['query'])

	// publish writes locally first, so the write is recorded BEFORE the seam refuses.
	await expect(access.publish([signedEvent({ kind: 1, created_at: 3_000 })])).rejects.toBeInstanceOf(EventAccessError)
	expect(endpoint.calls).toEqual(['read', 'write'])
	expect(upstream.calls).toEqual(['query', 'publish'])
})

test('the companion read refuses with a reason from the module own vocabulary, never a bare error', async () => {
	// Careless implementation it fails on: one that returns a default origin for an id the
	// answer never carried, or that throws an untranslated `Error`.
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream()
	const access = createEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })
	const answer = await access.query({ kinds: [1] })

	let refusal: unknown
	try {
		access.originOf(answer, 'an-id-this-answer-never-carried')
	} catch (error) {
		refusal = error
	}

	expect(refusal).toBeInstanceOf(EventAccessError)
	expect(refusal).toMatchObject({ reason: 'not-found' })
})
