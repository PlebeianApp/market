/**
 * composition-root.test.ts — **the boundary semantics of the wiring**: `validation`'s `accept`
 * installed as `event-access`'s one accept hook by the composition root.
 *
 * These cases drive the **real** `createValidator` through the **real** `createEventAccess` gate, so
 * what they prove is not a hook-shaped fixture but the composition the maintainer asked for: the
 * validator decides, and **one rule governs the store write, the consumer delivery and the wire
 * publish** (`#c8e35c`). Each case names, in its first comment, the careless implementation that
 * turns it red.
 *
 * The four obligations the increment owes are here: absent hook ⇒ accept-all; a refusing validator ⇒
 * the event is neither written, nor delivered, nor published; the quarantine outcome behaves as the
 * spec says (held and never admitted, with the reference named); and a link rule makes the
 * composition **fetch the referenced event** through its own existing read path — the "additional
 * event fetches" the maintainer described — with no second read path grown for it (`#7f4e0a`).
 */
import { test } from 'bun:test'
import { expect } from 'bun:test'

import { composeEventAccess } from './composition-root'
import { DEFAULT_WRITE_BACK } from '../../event-access/ts/index'
import { modelEndpoint, recordingUpstream, signedEvent } from '../../event-access/ts/harness'
import type { ValidationPreset } from '../../validation/ts/index'

/**
 * The host's declared demand, in the engine's own language (`#485b96`): a kind-30408 event must carry
 * a `title` tag. One rule, data only, and the engine interprets nothing else.
 */
const LISTING_NEEDS_TITLE: ValidationPreset = {
	name: 'listing-needs-title',
	kinds: [30408],
	checks: [{ kind: 'format', id: 'listing-needs-title', requires: [{ tag: 'title', atLeast: 1 }] }],
}

/** A kind-30408 event that must reference a held event by `e` — the link half's own demand. */
const LISTING_REFERENCES_HELD: ValidationPreset = {
	name: 'listing-references-held',
	kinds: [30408],
	checks: [
		{
			kind: 'link',
			id: 'listing-e-ref',
			tag: 'e',
			index: 1,
			strategy: 'by-id',
			compare: [{ candidate: { tag: 'e', index: 1 }, reference: 'id', comparator: 'eq' }],
		},
	],
}

test('absent hook ⇒ accept-all: no declared validation installs no hook, and the event crosses every destination', async () => {
	// Careless implementation it fails on: a composition root that installs a pass-through hook
	// unconditionally, so `access.policy` is a lookalike of `DEFAULT_WRITE_BACK` rather than it —
	// and, more importantly, one that claims "absent means accept everything" while actually
	// admitting nothing (or admitting everything regardless of a declared rule).
	const listed = signedEvent({ kind: 30408, created_at: 30_000 }) // no `title`: the declared rule would refuse it
	const endpoint = modelEndpoint({ events: [] })
	const upstream = recordingUpstream({ events: [listed] })

	// (a) with nothing declared, the socket is absent and every candidate is admitted.
	const open = composeEventAccess({ endpoint: endpoint.endpoint, upstream: upstream.upstream })
	expect(open.access.policy.accept).toBeUndefined() // the socket stays absent
	expect(open.access.policy).toEqual(DEFAULT_WRITE_BACK) // and the policy is the declared default itself
	const openAnswer = await open.access.query({ kinds: [30408] })
	expect(openAnswer.events.map((event) => event.id)).toEqual([listed.id]) // delivered to the consumer
	expect(endpoint.writes.flat().map((event) => event.id)).toEqual([listed.id]) // and written to the store

	// (b) the same event, with the rule declared, is refused by the same predicate — so (a) was
	// accept-all and not a fixture that could never refuse.
	const closedEndpoint = modelEndpoint({ events: [] })
	const closedUpstream = recordingUpstream({ events: [listed] })
	const closed = composeEventAccess({
		endpoint: closedEndpoint.endpoint,
		upstream: closedUpstream.upstream,
		validation: { presets: [LISTING_NEEDS_TITLE] },
	})
	const closedAnswer = await closed.access.query({ kinds: [30408] })
	expect(closedAnswer.events).toEqual([])
	expect(closedEndpoint.writes.length).toBe(0)
})

test('a refusing validator drops the event at all three destinations: not written, not delivered, not published', async () => {
	// Careless implementation it fails on: one whose hook governs only the read's write-back (the
	// pre-D-O9 shape), or one that gates the consumer answer but hands the seam the unfiltered set —
	// then a refused event still reaches a destination, which is the second accept rule D-O9 forbids.
	const local = signedEvent({ kind: 30408, created_at: 40_000 }) // no `title`
	const remote = signedEvent({ kind: 30408, created_at: 40_500 }) // no `title`
	const outgoing = signedEvent({ kind: 30408, created_at: 41_000 }) // no `title`
	const calls: string[] = []
	const endpoint = modelEndpoint({ events: [local], calls })
	const upstream = recordingUpstream({ events: [remote] }, calls)
	const composed = composeEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		validation: { presets: [LISTING_NEEDS_TITLE] },
	})

	// destination · the consumer delivery (the local answer) and the store write (the fill's fresh event)
	const answer = await composed.access.query({ kinds: [30408] })
	expect(answer.events).toEqual([]) // the local event never reached a consumer
	expect(answer.complete).toBe(true) // and a dropped event is not an incomplete answer (`#87b422`)
	expect(endpoint.writes.length).toBe(0) // the fill's fresh event was never written back

	// destination · the wire publish (and the local write that follows it)
	const outcome = await composed.access.publish([outgoing])
	expect(endpoint.writes.length).toBe(0) // the store write is suppressed
	expect(outcome.stored).toBe(false)
	expect(calls.filter((call) => call === 'publish').length).toBe(0) // and the relay attempt saw the same set: nothing

	// the positive companion: the same two destinations carry a conforming event, so the refusals
	// above are the predicate's and not a fixture that could never write or publish.
	const titled = signedEvent({ kind: 30408, created_at: 42_000, tags: [['title', 'a listing']] })
	const second = composeEventAccess({
		endpoint: modelEndpoint({ events: [] }).endpoint,
		upstream: recordingUpstream({ events: [titled] }).upstream,
		validation: { presets: [LISTING_NEEDS_TITLE] },
	})
	const accepted = await second.access.query({ kinds: [30408] })
	expect(accepted.events.map((event) => event.id)).toEqual([titled.id])
	expect((await second.access.publish([titled])).stored).toBe(true)
})

test('the quarantine outcome · a rule demanding a reference nobody can answer holds the event and never admits it', async () => {
	// Careless implementation it fails on: one that maps quarantine to `'accept'` at the hook (a
	// quarantined event is **never** admitted), or one that reports it as a refusal rather than its
	// own third outcome — quarantine names the reference nobody could answer, a refusal names a cause.
	const absent = 'b'.repeat(64) // a well-formed id the local set does not hold
	const candidate = signedEvent({ kind: 30408, created_at: 50_000, tags: [['e', absent]] })
	const endpoint = modelEndpoint({ events: [candidate] })
	const upstream = recordingUpstream({ events: [] })
	const composed = composeEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		validation: { presets: [LISTING_REFERENCES_HELD] },
	})

	// the gate is closed to it: a quarantined event is held, never admitted — and reaching this
	// verdict made the composition ask its own read path for the reference, by id.
	const answer = await composed.access.query({ kinds: [30408] })
	expect(answer.events).toEqual([])
	expect(endpoint.writes.length).toBe(0)
	expect(endpoint.reads.some((list) => list.length === 1 && list[0].ids?.[0] === absent)).toBe(true)

	// and the module's own entry reports the third outcome, naming what nobody could answer — read
	// after the gate has run, because the reference is already held and the session-scoped book
	// (bound 6) answers from memory rather than re-resolving it.
	const outcome = await composed.validator.validate(candidate)
	expect(outcome.outcome).toBe('quarantined')
	expect(outcome.outcome === 'quarantined' && outcome.reference).toBe(absent)
})

test('the extra fetch · a link rule makes the composition fetch the referenced event through its own read path', async () => {
	// Careless implementation it fails on: one that grows a **second** read path for the link half
	// (`#7f4e0a`), or one whose gate cannot reach a referenced event at all — then the rule is
	// unsatisfiable and a conforming event is quarantined. The criterion is the endpoint being asked
	// for the reference by id, through the module's existing read, and the comparison then deciding.
	const referenced = signedEvent({ kind: 1, created_at: 10_000 })
	const listing = signedEvent({
		kind: 30408,
		created_at: 60_000,
		tags: [
			['e', referenced.id],
			['title', 'references a held event'],
		],
	})
	const endpoint = modelEndpoint({ events: [referenced, listing] })
	const upstream = recordingUpstream({ events: [] })
	const composed = composeEventAccess({
		endpoint: endpoint.endpoint,
		upstream: upstream.upstream,
		validation: { presets: [LISTING_REFERENCES_HELD] },
	})

	const answer = await composed.access.query({ kinds: [30408] })

	// the additional fetch the maintainer described: the reference was asked for BY ID, through the
	// composition's own read path — not through a second path grown for the link half.
	expect(endpoint.reads.some((list) => list.length === 1 && list[0].ids?.length === 1 && list[0].ids[0] === referenced.id)).toBe(true)
	// and the rule's own comparison then admitted the candidate (a mismatching reference would refuse
	// it, an absent one would quarantine it).
	expect(answer.events.map((event) => event.id)).toEqual([listing.id])
})
