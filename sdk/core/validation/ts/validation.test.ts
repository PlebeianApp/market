/**
 * validation.test.ts — one case per evidence obligation (`#ab04eb` (provenance) and its D-O24/D-O25
 * amendment), each naming the careless implementation it fails on, so a case that never ran
 * is the only thing it cannot survive.
 *
 * The floor the spec states: pass-through with **no presets**, a refusal with a declared
 * preset that fails, and an accept with a declared preset that passes. The extension: a format
 * rule refusing malformed and accepting conforming; a link rule for each of matched,
 * mismatched (with all four causes distinguishable), deleted, expired, malformed and
 * unresolved; the pass-through default re-asserted over a candidate no preset covers; a bound
 * exceeded as an outcome; each of the six bounds; quarantine never admitted and session-scoped;
 * the `accept` operation as the composition's hook; and no repair.
 *
 * The I4b repair added one case per accepted red-team finding, each naming the careless
 * implementation it fails on: the **format the spec describes** — one check carrying several
 * requirements, whose refusals are distinguishable in the value by the `requirement` that fired
 * (not by the check id a host happened to give them); a **resolver that rejects**, which is
 * quarantine rather than an escaping exception; an **uninterpretable preset** refused at the
 * preset on all three candidate states alike; bound 1 as **resolutions attempted**, with a link
 * reading the occurrence its preset names; bound 5's **eviction record bounded** as well as the
 * memory it records; the **revisit that turns unresolved into matched**; a **specific preset
 * winning over a wildcard**; and a preset **asking for chain following refused at the preset**.
 */
import { expect, test } from 'bun:test'

import { EVICTION_RECORD_LIMIT } from './bounds'
import { createValidator, PASS_THROUGH, ValidationError } from './index'
import { compositionContext, held, manualClock, neverAnsweringPort, recordingPort, rejectingPort, signedEvent, slowPort } from './harness'
import type {
	AcceptContext,
	AcceptDecision,
	ValidationCheck,
	ValidationOutcome,
	ValidationPort,
	ValidationPreset,
	ValidationRequirement,
} from './types'

const LISTING = 30402
const REVIEW = 31555

/** A bare link check: follow the `e` tag's id, compare nothing. */
function linkCheck(id = 'link'): ValidationCheck {
	return { kind: 'link', id, tag: 'e', index: 1, strategy: 'by-id' }
}

test('pass-through · with no presets, both operations refuse nothing', async () => {
	const validator = createValidator()
	const candidate = signedEvent({ kind: 1, created_at: 1, content: 'anything at all', tags: [['e', 'nonsense']] })
	expect(await validator.validate(candidate)).toEqual({ outcome: 'accepted' })
	expect(
		await validator.accept(
			candidate,
			compositionContext(async () => undefined),
		),
	).toBe('accept')
	expect(validator.presets).toEqual([])
	expect(PASS_THROUGH.checks.length).toBe(0)
	expect(PASS_THROUGH.kinds).toEqual([])
})

test('a refusal · a declared preset that fails names its preset and its check', async () => {
	const check: ValidationCheck = { kind: 'format', id: 'title-required', requires: [{ tag: 'title', atLeast: 1 }] }
	const preset: ValidationPreset = { name: 'listing', kinds: [LISTING], checks: [check] }
	const validator = createValidator({ presets: [preset] })
	const outcome = await validator.validate(signedEvent({ kind: LISTING, created_at: 1 }))
	expect(outcome.outcome).toBe('refused')
	if (outcome.outcome !== 'refused') return
	expect(outcome.refusal.preset).toBe('listing')
	expect(outcome.refusal.check.id).toBe('title-required')
	expect(outcome.refusal.cause).toBe('differs')
	expect(outcome.refusal.message).toContain('title')
})

test('an accept · a declared preset that passes is accepted', async () => {
	const check: ValidationCheck = { kind: 'format', id: 'title-required', requires: [{ tag: 'title', atLeast: 1 }] }
	const preset: ValidationPreset = { name: 'listing', kinds: [LISTING], checks: [check] }
	const validator = createValidator({ presets: [preset] })
	const candidate = signedEvent({ kind: LISTING, created_at: 1, tags: [['title', 'a lamp']] })
	expect(await validator.validate(candidate)).toEqual({ outcome: 'accepted' })
	expect(
		await validator.accept(
			candidate,
			compositionContext(async () => undefined),
		),
	).toBe('accept')
})

test('a format rule · refuses a malformed candidate and accepts a conforming one', async () => {
	const requires: ValidationCheck = { kind: 'format', id: 'title-required', requires: [{ tag: 'title', atLeast: 1 }] }
	const cardinality: ValidationCheck = { kind: 'format', id: 'image-single', requires: [{ tag: 'image', atLeast: 1, atMost: 1 }] }
	const domain: ValidationCheck = { kind: 'format', id: 'currency-domain', domains: [{ tag: 'currency', values: ['usd', 'eur'] }] }
	const preset: ValidationPreset = { name: 'listing', kinds: [LISTING], checks: [requires, cardinality, domain] }
	const validator = createValidator({ presets: [preset] })

	// a missing tag
	const missing = await validator.validate(
		signedEvent({
			kind: LISTING,
			created_at: 1,
			tags: [
				['image', 'x'],
				['currency', 'usd'],
			],
		}),
	)
	expect(missing.outcome === 'refused' && missing.refusal.check.id).toBe('title-required')
	expect(missing.outcome === 'refused' && missing.refusal.cause).toBe('differs')
	// a wrong cardinality
	const many = await validator.validate(
		signedEvent({
			kind: LISTING,
			created_at: 1,
			tags: [
				['title', 't'],
				['image', 'a'],
				['image', 'b'],
				['currency', 'usd'],
			],
		}),
	)
	expect(many.outcome === 'refused' && many.refusal.check.id).toBe('image-single')
	// a value outside its domain
	const outside = await validator.validate(
		signedEvent({
			kind: LISTING,
			created_at: 1,
			tags: [
				['title', 't'],
				['image', 'a'],
				['currency', 'gbp'],
			],
		}),
	)
	expect(outside.outcome === 'refused' && outside.refusal.check.id).toBe('currency-domain')
	// three distinct checks, so the three refusals are distinguishable in the value — by the
	// check id here, and by the requirement each one fired (the spec's shape, one check carrying
	// several requirements, is the next case)
	const ids = new Set([missing, many, outside].map((outcome) => (outcome.outcome === 'refused' ? outcome.refusal.check.id : '')))
	expect(ids.size).toBe(3)
	const requirements = [missing, many, outside].map((outcome) => (outcome.outcome === 'refused' ? outcome.refusal.requirement : ''))
	expect(requirements).toEqual(['missing-tag', 'cardinality', 'domain'])
	// and the conforming candidate is accepted
	const conforming = await validator.validate(
		signedEvent({
			kind: LISTING,
			created_at: 1,
			tags: [
				['title', 't'],
				['image', 'a'],
				['currency', 'eur'],
			],
		}),
	)
	expect(conforming).toEqual({ outcome: 'accepted' })
})

test('a format rule · one check carrying several requirements: each failure names its own requirement in the value', async () => {
	// **the shape the spec describes**: one format rule for one kind carrying required tags,
	// cardinalities, a value domain and a content constraint all at once. Three candidates fail
	// one requirement each, and a fourth fails the content bound. Every refusal comes from the
	// **same check** — so if they are distinguishable at all, the difference must be in the
	// value, not in a check id the host happened to give each requirement. The careless
	// implementation this fails on: one that hands every shape failure the one cause and leaves
	// a caller to parse the message, or to guess from `check.id` that a host may have shared.
	const shape: ValidationCheck = {
		kind: 'format',
		id: 'listing-shape',
		requires: [
			{ tag: 'title', atLeast: 1 },
			{ tag: 'image', atLeast: 1, atMost: 1 },
		],
		domains: [{ tag: 'currency', values: ['usd', 'eur'] }],
		maxContentBytes: 32,
	}
	const preset: ValidationPreset = { name: 'listing', kinds: [LISTING], checks: [shape] }
	const validator = createValidator({ presets: [preset] })
	const candidates: readonly (readonly [ValidationRequirement, ReturnType<typeof signedEvent>])[] = [
		[
			'missing-tag',
			signedEvent({
				kind: LISTING,
				created_at: 1,
				tags: [
					['image', 'a'],
					['currency', 'usd'],
				],
			}),
		],
		[
			'cardinality',
			signedEvent({
				kind: LISTING,
				created_at: 2,
				tags: [
					['title', 't'],
					['image', 'a'],
					['image', 'b'],
					['currency', 'usd'],
				],
			}),
		],
		[
			'domain',
			signedEvent({
				kind: LISTING,
				created_at: 3,
				tags: [
					['title', 't'],
					['image', 'a'],
					['currency', 'gbp'],
				],
			}),
		],
		[
			'content',
			signedEvent({
				kind: LISTING,
				created_at: 4,
				content: 'x'.repeat(64),
				tags: [
					['title', 't'],
					['image', 'a'],
					['currency', 'eur'],
				],
			}),
		],
	]
	const fired: string[] = []
	const checks = new Set<string>()
	for (const [requirement, candidate] of candidates) {
		const outcome = await validator.validate(candidate)
		expect(outcome.outcome).toBe('refused')
		if (outcome.outcome !== 'refused') continue
		checks.add(outcome.refusal.check.id)
		fired.push(outcome.refusal.requirement ?? '(no requirement)')
		expect(outcome.refusal.requirement).toBe(requirement)
		expect(outcome.refusal.cause).toBe('differs')
	}
	// one check id for all four, and four distinct requirements: the difference IS the value
	expect([...checks]).toEqual(['listing-shape'])
	expect(fired).toEqual(['missing-tag', 'cardinality', 'domain', 'content'])
	expect(new Set(fired).size).toBe(4)
})

test('a link rule · a held event whose named fields match is accepted', async () => {
	const referenced = signedEvent({ kind: LISTING, created_at: 5, tags: [['title', 'a lamp']] })
	const check: ValidationCheck = {
		kind: 'link',
		id: 'listing-held',
		tag: 'e',
		index: 1,
		strategy: 'by-id',
		compare: [{ candidate: { tag: 'p', index: 1 }, reference: 'pubkey', comparator: 'eq' }],
	}
	const preset: ValidationPreset = { name: 'review', kinds: [REVIEW], checks: [check] }
	const candidate = signedEvent({
		kind: REVIEW,
		created_at: 6,
		tags: [
			['e', referenced.id],
			['p', referenced.pubkey],
		],
	})
	const port = recordingPort({ [referenced.id]: held(referenced) })
	const validator = createValidator({ presets: [preset], port })
	expect(await validator.validate(candidate)).toEqual({ outcome: 'accepted' })
	expect(port.calls.map((call) => call.reference)).toEqual([referenced.id])
})

test("a link rule · a mismatched field refuses with cause 'differs'", async () => {
	const referenced = signedEvent({ kind: LISTING, created_at: 5 })
	const check: ValidationCheck = {
		kind: 'link',
		id: 'listing-held',
		tag: 'e',
		index: 1,
		strategy: 'by-id',
		compare: [{ candidate: { tag: 'p', index: 1 }, reference: 'pubkey', comparator: 'eq' }],
	}
	const preset: ValidationPreset = { name: 'review', kinds: [REVIEW], checks: [check] }
	// the candidate names an author who is not the referenced event's author
	const candidate = signedEvent({
		kind: REVIEW,
		created_at: 6,
		tags: [
			['e', referenced.id],
			['p', '0'.repeat(64)],
		],
	})
	const validator = createValidator({ presets: [preset], port: recordingPort({ [referenced.id]: held(referenced) }) })
	const outcome = await validator.validate(candidate)
	expect(outcome.outcome).toBe('refused')
	if (outcome.outcome !== 'refused') return
	expect(outcome.refusal.cause).toBe('differs')
	expect(outcome.refusal.check.id).toBe('listing-held')
})

test("a link rule · a deleted reference refuses with cause 'deleted'", async () => {
	const referenced = signedEvent({ kind: LISTING, created_at: 5 })
	const candidate = signedEvent({ kind: REVIEW, created_at: 6, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = { name: 'review', kinds: [REVIEW], checks: [linkCheck()] }
	const validator = createValidator({ presets: [preset], port: recordingPort({ [referenced.id]: { state: 'deleted' } }) })
	const outcome = await validator.validate(candidate)
	expect(outcome.outcome === 'refused' && outcome.refusal.cause).toBe('deleted')
})

test("a link rule · an expired reference refuses with cause 'expired'", async () => {
	const referenced = signedEvent({ kind: LISTING, created_at: 5 })
	const candidate = signedEvent({ kind: REVIEW, created_at: 6, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = { name: 'review', kinds: [REVIEW], checks: [linkCheck()] }
	const validator = createValidator({ presets: [preset], port: recordingPort({ [referenced.id]: { state: 'expired' } }) })
	const outcome = await validator.validate(candidate)
	expect(outcome.outcome === 'refused' && outcome.refusal.cause).toBe('expired')
})

test("a link rule · a malformed reference refuses with cause 'malformed-reference'", async () => {
	const preset: ValidationPreset = { name: 'review', kinds: [REVIEW], checks: [linkCheck()] }
	const validator = createValidator({ presets: [preset], port: recordingPort({}) })
	// an `e` tag whose second element is not a 64-hex id …
	const illShaped = signedEvent({ kind: REVIEW, created_at: 6, tags: [['e', 'not-an-id']] })
	const one = await validator.validate(illShaped)
	expect(one.outcome === 'refused' && one.refusal.cause).toBe('malformed-reference')
	// … and a candidate with no `e` tag at all
	const absent = signedEvent({ kind: REVIEW, created_at: 6 })
	const two = await validator.validate(absent)
	expect(two.outcome === 'refused' && two.refusal.cause).toBe('malformed-reference')
})

test('a link rule · an unresolved reference quarantines the event', async () => {
	const referenced = signedEvent({ kind: LISTING, created_at: 5 })
	const candidate = signedEvent({ kind: REVIEW, created_at: 6, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = { name: 'review', kinds: [REVIEW], checks: [linkCheck()] }
	// the host has no answer: `undefined` means nobody could answer it, which is quarantine
	const validator = createValidator({ presets: [preset], port: recordingPort({}) })
	const outcome = await validator.validate(candidate)
	expect(outcome.outcome).toBe('quarantined')
	if (outcome.outcome !== 'quarantined') return
	expect(outcome.preset).toBe('review')
	expect(outcome.check).toBe('link')
	expect(outcome.reference).toBe(referenced.id)
})

test('a link rule · a resolver that rejects is quarantined, never an escaping exception', async () => {
	// A resolver the host injected that **rejects** (or throws before it answers) is a reference
	// **nobody could answer** — the same fact `undefined` reports — so it is quarantine, an
	// outcome a caller reads. The careless implementation this fails on: one that forwards the
	// rejection, so a host's resolver fault escapes `validate` as a bare `Error` and the spec's
	// "every outcome is a value a caller reads" becomes false exactly when it matters.
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()] }

	// an injected port that rejects
	let thrown: unknown
	let outcome: ValidationOutcome | undefined
	try {
		outcome = await createValidator({ presets: [preset], port: rejectingPort() }).validate(candidate)
	} catch (error) {
		thrown = error
	}
	expect(thrown).toBeUndefined()
	expect(outcome?.outcome).toBe('quarantined')
	expect(outcome?.outcome === 'quarantined' && outcome.reference).toBe(referenced.id)

	// a resolver that throws **synchronously** is the same fact, not an escape
	let syncThrown: unknown
	let syncOutcome: ValidationOutcome | undefined
	try {
		syncOutcome = await createValidator({ presets: [preset], port: rejectingPort('synchronously') }).validate(candidate)
	} catch (error) {
		syncThrown = error
	}
	expect(syncThrown).toBeUndefined()
	expect(syncOutcome?.outcome).toBe('quarantined')

	// and the composition's own resolver, reached through `accept` with no port injected, is read
	// the same way: the hook answers 'reject' rather than rejecting (a fresh validator, so no
	// book entry has already gated the reference)
	let hookThrown: unknown
	let decision: AcceptDecision | undefined
	const context = compositionContext(async () => {
		throw new Error('the reference store is down')
	})
	try {
		decision = await createValidator({ presets: [preset] }).accept(candidate, context)
	} catch (error) {
		hookThrown = error
	}
	expect(hookThrown).toBeUndefined()
	expect(decision).toBe('reject')
})

test('pass-through · re-asserted over a candidate no preset covers', async () => {
	const check: ValidationCheck = { kind: 'format', id: 'title-required', requires: [{ tag: 'title', atLeast: 1 }] }
	const preset: ValidationPreset = { name: 'listing', kinds: [LISTING], checks: [check] }
	const validator = createValidator({ presets: [preset] })
	// the covered kind is refused, so the preset is really in force
	expect((await validator.validate(signedEvent({ kind: LISTING, created_at: 1 }))).outcome).toBe('refused')
	// an uncovered kind passes, on both operations: no preset covers it, so nothing runs
	const uncovered = signedEvent({ kind: 1, created_at: 1 })
	expect(await validator.validate(uncovered)).toEqual({ outcome: 'accepted' })
	expect(
		await validator.accept(
			uncovered,
			compositionContext(async () => undefined),
		),
	).toBe('accept')
})

test('preset selection · a specific match wins over a wildcard, whatever the host declared first', async () => {
	// An empty `kinds` list is the wildcard, so a wildcard listed first would shadow every rule
	// beneath it and judge a candidate with a preset the host did not mean to apply. The careless
	// implementation this fails on: "the first covering preset wins", which makes a host's ordering
	// a trap the spec never asks it to avoid.
	const wildcard: ValidationPreset = {
		name: 'wild',
		kinds: [],
		checks: [{ kind: 'format', id: 'wild-shape', requires: [{ tag: 'title', atLeast: 2 }] }],
	}
	const specific: ValidationPreset = {
		name: 'specific',
		kinds: [1],
		checks: [{ kind: 'format', id: 'title-required', requires: [{ tag: 'title', atLeast: 1 }] }],
	}

	// the wildcard is declared FIRST: the specific preset must still run for a kind it names
	const wildcardFirst = createValidator({ presets: [wildcard, specific] })
	const named = await wildcardFirst.validate(signedEvent({ kind: 1, created_at: 1 }))
	expect(named.outcome).toBe('refused')
	if (named.outcome !== 'refused') return
	expect(named.refusal.preset).toBe('specific')
	expect(named.refusal.check.id).toBe('title-required')

	// the same when the specific preset is declared second (or first): order decides only within a class
	const specificFirst = createValidator({ presets: [specific, wildcard] })
	const again = await specificFirst.validate(signedEvent({ kind: 1, created_at: 2 }))
	expect(again.outcome === 'refused' && again.refusal.check.id).toBe('title-required')

	// and the wildcard still covers a kind no specific preset names — it is not disabled, only outranked
	const other = await wildcardFirst.validate(signedEvent({ kind: 7, created_at: 3 }))
	expect(other.outcome).toBe('refused')
	if (other.outcome !== 'refused') return
	expect(other.refusal.preset).toBe('wild')
	expect(other.refusal.check.id).toBe('wild-shape')
})

test('a bound exceeded · is an outcome, never a thrown exception', async () => {
	const seed = signedEvent({ kind: 1, created_at: 1 })
	// eleven link checks name eleven **resolutions attempted**, which exceeds the default fan-out
	// ceiling of ten (bound 1 counts resolutions, not the event's tags)
	const checks = Array.from({ length: 11 }, (_, index) => linkCheck(`link-${index}`))
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', seed.id]] })
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks }
	const validator = createValidator({ presets: [preset], port: recordingPort({ [seed.id]: held(seed) }) })
	// 11 resolutions exceed the ceiling: the call resolves, it does not reject
	let thrown: unknown
	let outcome: ValidationOutcome | undefined
	try {
		outcome = await validator.validate(candidate)
	} catch (error) {
		thrown = error
	}
	expect(thrown).toBeUndefined()
	expect(outcome?.outcome).toBe('quarantined')
})

test('bound 1 · resolutions attempted per event (the fan-out ceiling counts links, one resolution each)', async () => {
	// The ceiling is on **resolutions attempted**, which is one per link check — the spec's gloss
	// for bound 1. Two links name two resolutions, and with a ceiling of one the second is past the
	// bound: the reference the engine would have attempted second is the one quarantined, as an
	// outcome and never as an exception.
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const twoLinks: ValidationPreset = {
		name: 'links',
		kinds: [1],
		checks: [linkCheck('first'), { kind: 'link', id: 'second', tag: 'a', index: 1, strategy: 'by-coordinate' }],
		bounds: { maxReferencesPerEvent: 1 },
	}
	const second = signedEvent({ kind: 1, created_at: 3 })
	const coordinate = `${second.kind}:${second.pubkey}:listing`
	const both = signedEvent({
		kind: 1,
		created_at: 4,
		tags: [
			['e', referenced.id],
			['a', coordinate],
		],
	})
	// both references are answerable: with the ceiling honoured this candidate is over it and
	// quarantined; with the ceiling raised by one it would be resolved and accepted, which is what
	// makes this case fail on the careless implementation rather than pass for another reason
	const port = recordingPort({ [referenced.id]: held(referenced), [coordinate]: held(second) })
	const outcome = await createValidator({ presets: [twoLinks], port }).validate(both)
	expect(outcome.outcome).toBe('quarantined')
	if (outcome.outcome !== 'quarantined') return
	expect(outcome.reference).toBe(coordinate) // the second resolution, the one past the ceiling
	expect(outcome.preset).toBe('links')
	expect(createValidator().bounds.maxReferencesPerEvent).toBe(10)
})

test('a link rule · reads the occurrence its preset names: one link is one resolution, however many tags the event carries', async () => {
	// A link reads one reference — the element at `index` of the **first** tag named `tag` — so an
	// event carrying eleven `e` tags is one resolution, not eleven. The careless implementation this
	// fails on: one that walks every matching tag (counting, or resolving, references the preset
	// never named), which would quarantine this candidate against a ceiling of ten for junk tags it
	// never reads.
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const tags = Array.from({ length: 11 }, (_, index) => ['e', index === 0 ? referenced.id : '0'.repeat(64)])
	const candidate = signedEvent({ kind: 1, created_at: 2, tags })
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()] }
	const port = recordingPort({ [referenced.id]: held(referenced) })
	expect(await createValidator({ presets: [preset], port }).validate(candidate)).toEqual({ outcome: 'accepted' })
	expect(port.calls.map((call) => call.reference)).toEqual([referenced.id]) // exactly one: the first occurrence
	expect(createValidator().bounds.maxReferencesPerEvent).toBe(10)

	// and a link naming a different tag reads that tag's occurrence, not the first `e`
	const onA: ValidationPreset = {
		name: 'links',
		kinds: [1],
		checks: [{ kind: 'link', id: 'coordinate', tag: 'a', index: 1, strategy: 'by-coordinate' }],
	}
	const coordinate = `${referenced.kind}:${referenced.pubkey}:listing`
	const withBoth = signedEvent({
		kind: 1,
		created_at: 5,
		tags: [
			['e', referenced.id],
			['a', coordinate],
		],
	})
	const seen: string[] = []
	const answering: ValidationPort = {
		now: () => 0,
		resolve: async (reference) => {
			seen.push(reference)
			return { state: 'held', event: referenced }
		},
	}
	expect(await createValidator({ presets: [onA], port: answering }).validate(withBoth)).toEqual({ outcome: 'accepted' })
	expect(seen).toEqual([coordinate])
})

test('bound 2 · one hop: the referenced event carries links the engine does not follow (and a ceiling below one forbids the direct reference)', async () => {
	const deeper = signedEvent({ kind: 1, created_at: 1 })
	const referenced = signedEvent({ kind: 1, created_at: 2, tags: [['e', deeper.id]] })
	const candidate = signedEvent({ kind: 1, created_at: 3, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()] }
	const port = recordingPort({ [referenced.id]: held(referenced), [deeper.id]: held(deeper) })
	const validator = createValidator({ presets: [preset], port })
	expect(await validator.validate(candidate)).toEqual({ outcome: 'accepted' })
	// the referenced event's own link is not followed: exactly one hop, so exactly one call
	expect(port.calls.map((call) => call.reference)).toEqual([referenced.id])
	// a ceiling below one hop forbids even the direct reference — an outcome, not an exception
	const zero: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()], bounds: { maxChainDepth: 0 } }
	const zeroed = createValidator({ presets: [zero], port: recordingPort({ [referenced.id]: held(referenced) }) })
	expect((await zeroed.validate(candidate)).outcome).toBe('quarantined')
	expect(createValidator().bounds.maxChainDepth).toBe(1)
})

test('bound 2 · a preset asking for chain following is refused at the preset, before any candidate is judged', async () => {
	// Above one hop there is no chain to follow: the engine takes exactly one hop, so a declaration
	// of two or more is a bound with no mechanism — accepted and then silently ignored. The
	// careless implementation this fails on: the one that honoured the declaration by doing nothing
	// different, so a host declaring a two-hop chain got a one-hop check and no signal. It is
	// refused loudly and at the preset — like a comparator the vocabulary does not carry, and for
	// the same reason — because the engine must not invent what a *referenced* event's own links
	// are (`#18faf1` (provenance)).
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const asking: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()], bounds: { maxChainDepth: 2 } }
	let thrown: unknown
	try {
		await createValidator({ presets: [asking], port: recordingPort({ [referenced.id]: held(referenced) }) }).validate(candidate)
	} catch (error) {
		thrown = error
	}
	expect(thrown).toBeInstanceOf(ValidationError)
	expect((thrown as ValidationError).message).toContain('maxChainDepth 2')

	// the same declaration through the validator's own bounds is refused too, not only a preset's
	let globalThrown: unknown
	try {
		await createValidator({
			presets: [{ name: 'links', kinds: [1], checks: [linkCheck()] }],
			bounds: { maxChainDepth: 2 },
			port: recordingPort({}),
		}).validate(candidate)
	} catch (error) {
		globalThrown = error
	}
	expect(globalThrown).toBeInstanceOf(ValidationError)

	// the control: exactly one hop is a declaration the engine honours, and it is judged normally
	const oneHop = createValidator({
		presets: [{ name: 'links', kinds: [1], checks: [linkCheck()] }],
		bounds: { maxChainDepth: 1 },
		port: recordingPort({ [referenced.id]: held(referenced) }),
	})
	expect(await oneHop.validate(candidate)).toEqual({ outcome: 'accepted' })

	// and a preset with no link check has nothing to follow, so the same declaration is inert
	const formatOnly: ValidationPreset = {
		name: 'shape',
		kinds: [1],
		checks: [{ kind: 'format', id: 'content-bounded', maxContentBytes: 4 }],
		bounds: { maxChainDepth: 2 },
	}
	expect(await createValidator({ presets: [formatOnly] }).validate(signedEvent({ kind: 1, created_at: 3, content: 'ok' }))).toEqual({
		outcome: 'accepted',
	})
})

test('bound 3 · the wall-clock budget for one reference', async () => {
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()], bounds: { referenceTimeoutMs: 20 } }
	const validator = createValidator({ presets: [preset], port: neverAnsweringPort() })
	// the resolver never answers; the per-reference budget fires and the reference is unresolved
	expect((await validator.validate(candidate)).outcome).toBe('quarantined')
	expect(createValidator().bounds.referenceTimeoutMs).toBe(5_000)
})

test('bound 4 · the wall-clock budget for one event', async () => {
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = {
		name: 'links',
		kinds: [1],
		checks: [linkCheck()],
		bounds: { eventTimeoutMs: 30, referenceTimeoutMs: 5_000 },
	}
	// the reference would answer at 60ms; the event budget of 30ms cuts the whole evaluation off first
	const validator = createValidator({ presets: [preset], port: slowPort({ [referenced.id]: held(referenced) }, 60) })
	expect((await validator.validate(candidate)).outcome).toBe('quarantined')
	expect(createValidator().bounds.eventTimeoutMs).toBe(30_000)
})

test('bound 5 · memory held for unresolved references (oldest-first eviction, recorded and re-resolved)', async () => {
	const a = signedEvent({ kind: 1, created_at: 1 })
	const b = signedEvent({ kind: 1, created_at: 2 })
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()], bounds: { unresolvedMemoryBytes: 64 } }
	const port = recordingPort({})
	const validator = createValidator({ presets: [preset], port })
	const candidateA = signedEvent({ kind: 1, created_at: 3, tags: [['e', a.id]] })
	const candidateB = signedEvent({ kind: 1, created_at: 4, tags: [['e', b.id]] })

	expect((await validator.validate(candidateA)).outcome).toBe('quarantined')
	expect(validator.unresolved.references).toEqual([a.id])
	expect((await validator.validate(candidateB)).outcome).toBe('quarantined')
	// the second 64-byte reference does not fit beside the first, so the oldest is evicted
	expect(validator.unresolved.references).toEqual([b.id])
	expect(validator.unresolved.evictions).toEqual([a.id]) // recorded as data loss, not a silent drop
	// an evicted reference is re-resolved, not forgotten: the next evaluation calls the port again
	const before = port.calls.filter((call) => call.reference === a.id).length
	expect((await validator.validate(candidateA)).outcome).toBe('quarantined')
	expect(port.calls.filter((call) => call.reference === a.id).length).toBe(before + 1)
	expect(createValidator().bounds.unresolvedMemoryBytes).toBe(1_048_576)
})

test('bound 5 · the eviction record is bounded too: a count plus the last few, never an ever-growing log', async () => {
	// The bound is on "memory held for unresolved references" — and the book it keeps must be
	// bounded on both sides. The careless implementation this fails on: one that caps the held set,
	// records every eviction as data loss, and leaks the memory through the loss log itself — the
	// structure meant to prove the bound was honoured being the thing that is unbounded.
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()], bounds: { unresolvedMemoryBytes: 64 } }
	const validator = createValidator({ presets: [preset], port: recordingPort({}) })
	const id = (n: number) => n.toString(16).padStart(64, '0') // a well-formed 64-hex id, 64 bytes each
	const evaluations = 200
	for (let n = 0; n < evaluations; n += 1) {
		expect((await validator.validate(signedEvent({ kind: 1, created_at: n, tags: [['e', id(n)]] }))).outcome).toBe('quarantined')
	}
	const book = validator.unresolved
	expect(book.references).toEqual([id(evaluations - 1)]) // one 64-byte reference fits the ceiling
	expect(book.bytes).toBe(64) // the byte ceiling holds
	expect(book.limitBytes).toBe(64)
	// the count is exact, and the names are a window of the most recent — never the whole log
	expect(book.evictionCount).toBe(evaluations - 1)
	expect(book.evictions.length).toBe(EVICTION_RECORD_LIMIT)
	expect(book.evictions.length).toBeLessThan(book.evictionCount)
	expect(book.evictions[book.evictions.length - 1]).toBe(id(evaluations - 2)) // most recent last
	expect(book.evictions[0]).toBe(id(evaluations - 1 - EVICTION_RECORD_LIMIT)) // and only the last few are kept
	expect(book.evictions.includes(id(0))).toBe(false) // the oldest names have been dropped, not accumulated
})

test('bound 6 · revisit count and interval', async () => {
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = {
		name: 'links',
		kinds: [1],
		checks: [linkCheck()],
		bounds: { revisitCount: 2, revisitIntervalMs: 100 },
	}
	const clock = manualClock(1_000)
	const port = recordingPort({}, () => clock.now())
	const validator = createValidator({ presets: [preset], port, clock })

	expect((await validator.validate(candidate)).outcome).toBe('quarantined') // attempt 1
	await validator.validate(candidate)
	expect(port.calls.length).toBe(1) // inside the interval: not retried
	clock.advance(100)
	await validator.validate(candidate)
	expect(port.calls.length).toBe(2) // interval passed: retried once
	clock.advance(100)
	await validator.validate(candidate)
	expect(port.calls.length).toBe(2) // the count is spent: not retried again
	expect(createValidator().bounds.revisitCount).toBe(3)
	expect(createValidator().bounds.revisitIntervalMs).toBe(300_000)
})

test('bound 6 · the default clock is real: with no port and no clock a quarantined reference is retried once the interval has passed', async () => {
	// A6 (the I4c repair). With **no injected port and no injected clock** the module must still
	// carry a mechanism for bound 6, in every configuration it supports. The revisit gate is
	// `now - lastAttemptAt >= intervalMs`, so the careless implementation this fails on is the one
	// whose default clock is a frozen constant (the old `{ now: () => 0 }`, which this line's
	// mutation restores): under it the left side is always zero, the gate is false forever, and a
	// reference quarantined here can never be retried — so a candidate denied because a *different*
	// operation quarantined it is denied permanently. With a real default clock the gate is
	// satisfiable, and this case drives that through the composition's hook, which is the only
	// resolver when no port is present. Overriding the interval to a millisecond or two in this
	// case's own bounds, and letting the wall clock move between the two calls, is how 'after the
	// interval has passed' is made deterministic without freezing the clock.
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = {
		name: 'links',
		kinds: [1],
		checks: [linkCheck()],
		bounds: { revisitIntervalMs: 1, revisitCount: 3 },
	}
	const validator = createValidator({ presets: [preset] }) // no port, no clock
	let asked = 0
	let answerable = false
	const context = compositionContext(async (reference) => {
		asked += 1
		return answerable && reference === referenced.id ? referenced : undefined
	})

	// the first call: nobody can answer the reference yet — quarantined, and never admitted
	expect(await validator.accept(candidate, context)).toBe('reject')
	expect(asked).toBe(1)
	expect(validator.unresolved.references).toEqual([referenced.id])

	// the answer changes, and the revisit interval passes on the real clock: the same candidate is
	// re-evaluated, so the hook is asked a **second** time, and the outcome changes with the answer
	await new Promise((resolve) => setTimeout(resolve, 25))
	answerable = true
	expect(await validator.accept(candidate, context)).toBe('accept')
	expect(asked).toBe(2)
	// and the book forgot it the moment it resolved: it is not a quarantine any more
	expect(validator.unresolved.references).toEqual([])
})

test('quarantine · a revisit that turns unresolved into matched admits the event that was held', async () => {
	// The spec's admission condition for a quarantined event: "it enters only if a later resolution
	// turns unresolved into matched" (`validation.md`, the D-O25 amendment beneath `#bc3095` (provenance)). The
	// careless implementation this fails on: one that re-decides from scratch but never lets a
	// turned-matched reference in — the "unresolved stays unresolved" reading, which would deny a
	// candidate the port has since answered.
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = {
		name: 'links',
		kinds: [1],
		checks: [linkCheck()],
		bounds: { revisitCount: 3, revisitIntervalMs: 100 },
	}
	const clock = manualClock(1_000)
	const calls: number[] = []
	let answers = 0
	const port: ValidationPort = {
		now: () => clock.now(),
		resolve: async () => {
			calls.push(clock.now())
			answers += 1
			// nobody can answer it the first time; the same reference resolves on the revisit
			return answers === 1 ? undefined : held(referenced)
		},
	}
	const validator = createValidator({ presets: [preset], port, clock })

	// the first pass: nobody could answer it — quarantine, and the reference is held
	expect((await validator.validate(candidate)).outcome).toBe('quarantined')
	expect(calls).toHaveLength(1)
	// inside the interval it is not retried at all (bound 6's interval is the admission boundary)
	expect((await validator.validate(candidate)).outcome).toBe('quarantined')
	expect(calls).toHaveLength(1)
	// the interval passes: the same reference is resolved again, and this time it matches — so the
	// event that was held is admitted, not refused and not held again
	clock.advance(100)
	expect(await validator.validate(candidate)).toEqual({ outcome: 'accepted' })
	expect(calls).toHaveLength(2)
	// and the book forgot it the moment it resolved: it is not a quarantine any more
	expect(validator.unresolved.references).toEqual([])
})

test('quarantine · is never admitted, and is session-scoped', async () => {
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()] }
	const validator = createValidator({ presets: [preset], port: recordingPort({}) })
	expect((await validator.validate(candidate)).outcome).toBe('quarantined')
	// never admitted: the hook's own two-member answer makes a quarantine a rejection
	expect(
		await validator.accept(
			candidate,
			compositionContext(async () => undefined),
		),
	).toBe('reject')
	expect(validator.unresolved.references.length).toBeGreaterThan(0)
	// session-scoped: nothing durable, and a fresh validator carries none of it
	const fresh = createValidator({ presets: [preset], port: recordingPort({}) })
	expect(fresh.unresolved.references).toEqual([])
	expect(fresh.unresolved.evictions).toEqual([])
})

test("the accept operation · is the composition's hook (tier and resolve both reach it)", async () => {
	const referenced = signedEvent({ kind: LISTING, created_at: 5 })
	const check: ValidationCheck = {
		kind: 'link',
		id: 'listing-held',
		tag: 'e',
		index: 1,
		strategy: 'by-id',
		compare: [{ candidate: 'pubkey', reference: 'pubkey', comparator: 'eq' }],
	}
	const preset: ValidationPreset = { name: 'review', kinds: [REVIEW], checks: [check] }
	const candidate = signedEvent({ kind: REVIEW, created_at: 6, tags: [['e', referenced.id]] })

	// `resolve` reaches the module through the composition's context, with no port injected
	const noPort = createValidator({ presets: [preset] })
	const context: AcceptContext = compositionContext(async (reference) => (reference === referenced.id ? referenced : undefined), 'remote')
	expect(await noPort.accept(candidate, context)).toBe('accept')

	// the tier reaches the module through the injected port's `at`
	const port = recordingPort({ [referenced.id]: held(referenced) })
	const withPort = createValidator({ presets: [preset], port })
	expect(
		await withPort.accept(
			candidate,
			compositionContext(async () => undefined, 'local'),
		),
	).toBe('accept')
	expect(port.calls[0]?.at).toEqual({ tier: 'local' })

	// and to the hook's two-member answer, a refusal is a rejection just as a quarantine is
	const refusing = createValidator({ presets: [preset], port: recordingPort({ [referenced.id]: { state: 'deleted' } }) })
	expect(
		await refusing.accept(
			candidate,
			compositionContext(async () => undefined),
		),
	).toBe('reject')
})

test('no repair · a malformed candidate is refused, never corrected', async () => {
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [linkCheck()] }
	const validator = createValidator({ presets: [preset], port: recordingPort({}) })
	const candidate = signedEvent({ kind: 1, created_at: 1, tags: [['e', 'not-an-id']] })
	const before = JSON.stringify(candidate)
	expect((await validator.validate(candidate)).outcome).toBe('refused')
	expect(JSON.stringify(candidate)).toBe(before) // the event the caller holds is byte-identical

	// and a candidate that passes is likewise unchanged
	const referenced = signedEvent({ kind: 1, created_at: 2 })
	const passing = signedEvent({ kind: 1, created_at: 3, tags: [['e', referenced.id]] })
	const beforePassing = JSON.stringify(passing)
	expect(
		await createValidator({ presets: [preset], port: recordingPort({ [referenced.id]: held(referenced) }) }).validate(passing),
	).toEqual({
		outcome: 'accepted',
	})
	expect(JSON.stringify(passing)).toBe(beforePassing)
})

test('the comparator vocabulary · a comparison it does not carry is refused, naming the comparator', async () => {
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const bad = {
		kind: 'link',
		id: 'comparison',
		tag: 'e',
		index: 1,
		strategy: 'by-id',
		compare: [{ candidate: 'pubkey', reference: 'pubkey', comparator: 'gt' }],
	} as unknown as ValidationCheck
	const preset: ValidationPreset = { name: 'links', kinds: [1], checks: [bad] }
	const validator = createValidator({ presets: [preset], port: recordingPort({ [referenced.id]: held(referenced) }) })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	let thrown: unknown
	try {
		await validator.validate(candidate)
	} catch (error) {
		thrown = error
	}
	expect(thrown).toBeInstanceOf(ValidationError)
	const error = thrown as ValidationError
	expect(error.reason).toBe('malformed-reference')
	expect(error.message).toContain('gt')
})

test('the comparator vocabulary · an uninterpretable preset fails at the preset, the same way whatever the candidate is', async () => {
	// The comparator guard is reached **when the link check is reached**, before any resolution, so
	// a preset naming a comparator the vocabulary does not carry fails identically however the
	// candidate's reference resolves. The careless implementation this fails on: the one that
	// checked the vocabulary only after a reference had been resolved, so the same malformed preset
	// threw for a held reference, quarantined an unresolved one and refused a deleted one — three
	// behaviours for one host configuration error, and a host that tested it against one candidate
	// would never see the other two.
	const referenced = signedEvent({ kind: 1, created_at: 1 })
	const candidate = signedEvent({ kind: 1, created_at: 2, tags: [['e', referenced.id]] })
	const comparison = (comparator: string) => [{ candidate: 'pubkey', reference: 'pubkey', comparator }]
	const checkWith = (comparator: string) =>
		({
			kind: 'link',
			id: 'comparison',
			tag: 'e',
			index: 1,
			strategy: 'by-id',
			compare: comparison(comparator),
		}) as unknown as ValidationCheck
	const bad: ValidationPreset = { name: 'links', kinds: [1], checks: [checkWith('gt')] }
	const good: ValidationPreset = { name: 'links', kinds: [1], checks: [checkWith('eq')] }
	const states: readonly (readonly [string, ValidationPort])[] = [
		['unresolved — the port answers nothing', recordingPort({})],
		['deleted — the port answers deleted', recordingPort({ [referenced.id]: { state: 'deleted' } })],
		['held — the port answers held', recordingPort({ [referenced.id]: held(referenced) })],
	]

	// the bad preset: one behaviour on all three paths — the same `ValidationError`, naming `gt`
	const messages: string[] = []
	for (const [state, port] of states) {
		let thrown: unknown
		try {
			await createValidator({ presets: [bad], port }).validate(candidate)
		} catch (error) {
			thrown = error
		}
		expect(thrown, state).toBeInstanceOf(ValidationError)
		messages.push(thrown instanceof ValidationError ? thrown.message : `(no throw: ${state})`)
	}
	expect(messages).toHaveLength(3)
	expect(new Set(messages).size).toBe(1)
	expect(messages[0]).toContain('gt')

	// the control: the same preset with a comparator the vocabulary carries does not throw — the
	// preset is what is judged, and the three candidate states really do differ
	const outcomes: string[] = []
	for (const [, port] of states) {
		outcomes.push((await createValidator({ presets: [good], port }).validate(candidate)).outcome)
	}
	expect(outcomes).toEqual(['quarantined', 'refused', 'accepted'])
})

test('the declared values · the six bounds are the research §4 suggested defaults, readable without driving a call', () => {
	expect(createValidator().bounds).toEqual({
		maxReferencesPerEvent: 10,
		maxChainDepth: 1,
		referenceTimeoutMs: 5_000,
		eventTimeoutMs: 30_000,
		unresolvedMemoryBytes: 1_048_576,
		revisitCount: 3,
		revisitIntervalMs: 300_000,
	})
})
