/**
 * Spec-validity admission for kind-30408 events (AUCTIONS.md §4.1, §6.0).
 *
 * The defect this locks: an event shaped like an auction but missing required
 * tags appeared in the staging feed and held slot #1 under the default
 * "Ending Soon" sort, rendering "No end date" — because a missing `end_at` read
 * as `0`, and `0` beats every real close time in the comparison. Two independent
 * halves are pinned here:
 *
 *   1. the gate — the event is not admissible, and the reason names the tag
 *      (`start_at`, `end_at`, `starting_bid`, …) so the notice can state it;
 *   2. the ordering — `auctionEndingSoonOrder.test.ts` pins that a non-positive
 *      cutoff sorts last rather than first (it still matters on the ungated
 *      owner surfaces, which sort by "Ending Soon" too).
 *
 * Since the maintainer's ruling of 2026-09-19 ("gate completely on invalid event
 * format") there is exactly one severity: a timing tag of `0` is refused by the
 * parser (`positiveUnixSeconds`), so the one shape that used to be a warning —
 * `start_at = 0` + `end_at = 0` — is gating like everything else. The assertions
 * below are written against the parser for that reason: they pin what the parser
 * refuses, not a list kept next to the feed.
 *
 * The gate deliberately reuses `parseAuctionEvent` rather than restating the
 * required-tag list, so this file asserts *through* the parser: the staging
 * event is the real one fetched from `wss://relay.staging.plebeian.market`
 * (only a `d` tag), and the "missing end_at" case is the same event with the
 * timing tag removed from an otherwise fully valid fixture.
 */
import { describe, expect, test } from 'bun:test'

import {
	filterAdmissibleAuctionEvents,
	inspectAuctionAdmission,
	isAdmissibleAuctionEvent,
	summarizeAuctionAdmissionIssues,
} from '../schemas/auction/auctionAdmission'
import type { NostrEventLike } from '../nostr/eventLike'

const SELLER_PK = 'a'.repeat(64)
const AUDITOR_PK = 'b'.repeat(64)

/** Fully valid kind-30408 event (every required tag, §4.1). */
const validAuction = (overrides: Partial<NostrEventLike> & { tags?: string[][] } = {}): NostrEventLike => ({
	id: 'e'.repeat(64),
	pubkey: SELLER_PK,
	kind: 30408,
	created_at: 1_700_000_000,
	content: 'Auction description',
	tags: overrides.tags ?? [
		['d', 'admission-fixture'],
		['title', 'Admission fixture'],
		['auction_type', 'english'],
		['currency', 'SAT'],
		['start_at', '1700000000'],
		['end_at', '1700086400'],
		['max_end_at', '1700086400'],
		['settlement_grace', '60'],
		['starting_bid', '1000'],
		['bid_increment', '100'],
		['reserve', '0'],
		['mint', 'https://mint.example.com'],
		['p2pk_xpub', 'xpub-fixture'],
		['auditors', AUDITOR_PK],
		['auditor_quorum', '1'],
		['key_scheme', 'hd_p2pk'],
		['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
		['schema', 'auction_v1'],
	],
	...overrides,
})

const withoutTags = (...tagNames: string[]): string[][] => validAuction().tags.filter((tag) => !tagNames.includes(tag[0]))

const setTag = (tagName: string, value: string): string[][] =>
	validAuction().tags.map((tag) => (tag[0] === tagName ? [tag[0], value] : tag))

/** Replace several tag values in one pass (spreading two `setTag` calls would duplicate tags, and the first occurrence wins). */
const setTags = (values: Record<string, string>): string[][] =>
	validAuction().tags.map((tag) => (values[tag[0]] !== undefined ? [tag[0], values[tag[0]]] : tag))

/**
 * The real staging event: kind 30408, pubkey 62b74612…, created 2026-08-19,
 * whose ONLY tag is `d` (no title, no timing tags, no starting_bid, empty
 * content). It is the event that took slot #1 on the staging browse page.
 */
const STAGING_MALFORMED_EVENT: NostrEventLike = {
	id: 'ce10deeff7e631c0'.padEnd(64, '0'),
	pubkey: '62b74612'.padEnd(64, '0'),
	kind: 30408,
	created_at: 1_755_561_600,
	content: '',
	tags: [['d', 'staging-malformed']],
}

describe('inspectAuctionAdmission — the parser is the single source of truth', () => {
	test('a fully valid auction is admissible and reports no issues', () => {
		const admission = inspectAuctionAdmission(validAuction())

		expect(admission.admissible).toBe(true)
		expect(admission.issues).toEqual([])
	})

	test('the staging malformed event is gating and the reason names the missing tag', () => {
		const admission = inspectAuctionAdmission(STAGING_MALFORMED_EVENT)

		expect(admission.admissible).toBe(false)
		expect(admission.issues).toHaveLength(1)
		expect(admission.issues[0].code).toBe('missing_required_tag')
		// The event has neither timing tag; `start_at` is checked first and the
		// failure names it rather than reporting a generic "invalid event".
		expect(admission.issues[0].tag).toBe('start_at')
		expect(admission.issues[0].message).toContain('start_at')
	})

	test('an absent end_at is gating (the exact defect: no close time, slot #1)', () => {
		const admission = inspectAuctionAdmission(validAuction({ tags: withoutTags('end_at') }))

		expect(admission.admissible).toBe(false)
		expect(admission.issues[0].tag).toBe('end_at')
		expect(admission.issues[0].code).toBe('missing_required_tag')
	})

	test('an absent start_at is gating', () => {
		const admission = inspectAuctionAdmission(validAuction({ tags: withoutTags('start_at') }))

		expect(admission.admissible).toBe(false)
		expect(admission.issues[0].tag).toBe('start_at')
	})

	test('a zero end_at against a real start_at is gating (the timing invariant rejects it)', () => {
		// `end_at >= start_at` is already a schema refine, so this shape never
		// reaches the range check — it is refused outright.
		const admission = inspectAuctionAdmission(validAuction({ tags: setTag('end_at', '0') }))

		expect(admission.admissible).toBe(false)
		expect(admission.issues.some((issue) => issue.tag === 'end_at')).toBe(true)
	})

	test('a zero start_at is gating on its own (a timing tag of 0 is not a timestamp)', () => {
		// `start_at = 0` against a real `end_at` satisfied both old refines:
		// `end_at >= start_at` and `max_end_at >= end_at` are trivially true, so
		// the schema accepted the epoch as a start. The range check refuses it.
		const admission = inspectAuctionAdmission(validAuction({ tags: setTag('start_at', '0') }))

		expect(admission.admissible).toBe(false)
		expect(admission.issues.some((issue) => issue.tag === 'start_at')).toBe(true)
	})

	test('a zero close time on both timing tags is gating, not a warning (ruling of 2026-09-19)', () => {
		// `start_at = 0` + `end_at = 0` satisfies `end_at >= start_at`, so this
		// was the one zero-cutoff shape the old schema could not refuse: it was
		// warned about and sorted last. The maintainer ruled that a malformed
		// event format gates completely, so the range is part of the format now
		// and the event is not admissible.
		const admission = inspectAuctionAdmission(validAuction({ tags: setTags({ start_at: '0', end_at: '0' }) }))

		expect(admission.admissible).toBe(false)
		expect(admission.issues.map((issue) => issue.tag)).toEqual(expect.arrayContaining(['start_at', 'end_at']))
		expect(admission.issues.every((issue) => issue.code === 'invalid_tag_value')).toBe(true)
	})

	test('a Zod-level failure is gating and is attributed to the tag that failed', () => {
		// `mint` absent → the schema's `min(1)` on the mint array, which the
		// parser surfaces as a ZodError on the `mints` field.
		const admission = inspectAuctionAdmission(validAuction({ tags: withoutTags('mint') }))

		expect(admission.admissible).toBe(false)
		expect(admission.issues[0].code).toBe('invalid_tag_value')
		expect(admission.issues[0].tag).toBe('mint')
	})

	test('a non-numeric timing value is gating (presence and well-formedness are separate)', () => {
		const admission = inspectAuctionAdmission(validAuction({ tags: setTag('end_at', 'soon') }))

		expect(admission.admissible).toBe(false)
		expect(admission.issues.some((issue) => issue.tag === 'end_at')).toBe(true)
		expect(admission.issues.some((issue) => issue.code === 'missing_required_tag')).toBe(false)
	})

	test('a non-30408 event is gating with the wrong_kind code', () => {
		const admission = inspectAuctionAdmission({ ...validAuction(), kind: 30402 })

		expect(admission.admissible).toBe(false)
		expect(admission.issues[0].code).toBe('wrong_kind')
	})

	test('one issue per failing tag, not one per constraint', () => {
		// Several tags are missing and the schema can report more than one
		// constraint per field (empty `auditors` also fails the quorum refine);
		// the notice needs one line per tag.
		const admission = inspectAuctionAdmission(validAuction({ tags: withoutTags('mint', 'auditors', 'title') }))

		const tags = admission.issues.map((issue) => issue.tag)
		expect(new Set(tags).size).toBe(tags.length)
		expect(tags).toEqual(expect.arrayContaining(['title', 'mint', 'auditors']))
	})
})

describe('filterAdmissibleAuctionEvents — the feed/browse gate', () => {
	test('drops exactly the malformed events and keeps the valid one', () => {
		const valid = validAuction({ id: '1'.repeat(64) })
		const noEnd = validAuction({ id: '2'.repeat(64), tags: withoutTags('end_at') })
		const staging = { ...STAGING_MALFORMED_EVENT, id: '3'.repeat(64) }

		const admitted = filterAdmissibleAuctionEvents([valid, noEnd, staging])

		expect(admitted.map((event) => event.id)).toEqual([valid.id])
	})

	test('does not mutate the input list', () => {
		const events = [validAuction(), STAGING_MALFORMED_EVENT]

		filterAdmissibleAuctionEvents(events)

		expect(events).toHaveLength(2)
	})

	test('drops the zero-timing event too — the range is part of the format now', () => {
		// The event carries every required tag; only the three timing values are
		// `0`. Before the ruling this shape was admissible (it satisfied
		// `end_at >= start_at`) and was handled by sorting it last; now it is
		// not an auction, so it is not a feed item.
		const zeroTimestamps = validAuction({ tags: setTags({ start_at: '0', end_at: '0' }) })

		expect(filterAdmissibleAuctionEvents([zeroTimestamps])).toHaveLength(0)
		expect(isAdmissibleAuctionEvent(zeroTimestamps)).toBe(false)
	})

	test('isAdmissibleAuctionEvent agrees with the batch filter', () => {
		expect(isAdmissibleAuctionEvent(validAuction())).toBe(true)
		expect(isAdmissibleAuctionEvent(STAGING_MALFORMED_EVENT)).toBe(false)
	})
})

describe('summarizeAuctionAdmissionIssues', () => {
	test('names the offending tags for logs and notices', () => {
		const admission = inspectAuctionAdmission(STAGING_MALFORMED_EVENT)

		expect(summarizeAuctionAdmissionIssues(admission.issues)).toBe('start_at')
	})

	test('lists several tags in order', () => {
		const admission = inspectAuctionAdmission(validAuction({ tags: withoutTags('mint', 'auditors', 'title') }))
		const summary = summarizeAuctionAdmissionIssues(admission.issues)

		expect(summary.split(', ')).toEqual(expect.arrayContaining(['title', 'mint', 'auditors']))
		expect(summary.split(', ').length).toBe(admission.issues.length)
	})
})
