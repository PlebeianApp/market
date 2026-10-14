/**
 * notice.test.ts — **V4: the reason travels, and the notice names the failing constraint**
 * (`increments.md` V4; `design.md` §4.7).
 *
 * The three obligations, each with the mutation that turns it red:
 *
 * 1. **the badge and the feed cannot disagree.** For one event, `accept` answers `'reject'` and `validate`
 *    names the same check the drop was caused by — asserted for **both** a refusal and a quarantine.
 *    Mutation: have the notice re-implement the predicate (a second `safeParse`/evaluation with different
 *    rules) → the two readings diverge and this case is red.
 * 2. **the notice names the tag the publisher wrote** — `end_at` — read off `ValidationRefusal.tag`
 *    (`design.md` §7.3), never re-derived from the message. Mutation: drop the `tag` field from the
 *    refusal assembly → `notice.tag` is `undefined` and red.
 * 3. **a quarantined event's notice is distinguishable from a refusal's** — a `reference`, not a
 *    constraint, and no `tag` at all. Mutation: map quarantine onto a refusal (or invent a tag) → red.
 */
import { describe, expect, test } from 'bun:test'

import { validationDeclaration as auctions } from '../../../commerce/auctions/validationDeclaration'
import type { AcceptContext, Event } from '../../event-access/ts/index'
import { modelEndpoint, recordingUpstream, signedEvent } from '../../event-access/ts/harness'
import { composeCommerce } from './compose'
import type { CommerceValidationDeclaration } from './declaration'
import { QUARANTINE_MESSAGE, judgeAdmission } from './notice'

/** A kind-30408 listing with every declared `requires` satisfied, and (optionally) `end_at`. */
function listing(withEndAt: boolean): Event {
	const tags: string[][] = [
		['d', 'lot-1'],
		['title', 'A lot'],
		['start_at', '1000'],
		['starting_bid', '10'],
		['p2pk_xpub', 'xpub'],
		['mint', 'https://mint.invalid'],
		['auditors', 'a'.repeat(64)],
		['auction_type', 'english'],
		['currency', 'SAT'],
		['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
		['key_scheme', 'hd_p2pk'],
	]
	if (withEndAt) tags.push(['end_at', '2000'])
	return signedEvent({ kind: 30408, created_at: 30_000, tags })
}

/** The two readings a surface takes from the one instance: the gate's binary, and the notice. */
const context: AcceptContext = { tier: 'local', resolve: async () => undefined }

describe('the notice reads the same Validator the gate uses', () => {
	test('a refusal: accept says reject and validate names the same check, the requirement and the TAG', async () => {
		const composed = composeCommerce({
			declarations: [auctions],
			endpoint: modelEndpoint({ events: [] }).endpoint,
			upstream: recordingUpstream({ events: [] }).upstream,
		})
		const { decision, notice } = await judgeAdmission(composed.validator, listing(false), context)

		expect(decision).toBe('reject') // the gate's binary
		expect(notice.kind).toBe('refusal')
		if (notice.kind !== 'refusal') return
		// the constraint the drop was caused by — the same check the preset ran.
		expect(notice.check).toBe('auction-required-tags')
		expect(notice.requirement).toBe('missing-tag')
		expect(notice.cause).toBe('differs')
		// the tag the publisher wrote, from the engine's own value: `end_at` is the absent required tag.
		expect(notice.tag).toBe('end_at')
		expect(notice.label).toContain('tag `end_at` is invalid')
		// the doctrine's interactivity decision: no bid, purchase, claim or settlement.
		expect(notice.interactive).toBe(false)
	})

	test('a quarantine: accept says reject, and the notice names the reference — never a made-up tag', async () => {
		// One link check: the listing must reference a held event by `e[1]`, and nothing can answer it.
		const absent = 'b'.repeat(64)
		const needsReference: CommerceValidationDeclaration = {
			owner: 'commerce.auctions',
			kinds: [
				{
					kind: 30408,
					source: 'test fixture',
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
				},
			],
			contributions: [],
			accepts: [],
		}
		const candidate = signedEvent({ kind: 30408, created_at: 40_000, tags: [['e', absent]] })
		const composed = composeCommerce({
			declarations: [needsReference],
			endpoint: modelEndpoint({ events: [candidate] }).endpoint,
			upstream: recordingUpstream({ events: [] }).upstream,
		})
		const { decision, notice } = await judgeAdmission(composed.validator, candidate, context)

		expect(decision).toBe('reject') // never admitted
		expect(notice.kind).toBe('quarantine')
		if (notice.kind !== 'quarantine') return
		// a reference nobody could answer — and NOT a constraint, and NOT a tag.
		expect(notice.reference).toBe(absent)
		expect(notice.message).toBe(QUARANTINE_MESSAGE)
		expect('tag' in notice).toBe(false)
		expect('requirement' in notice).toBe(false)
		expect(notice.interactive).toBe(false)
		// distinguishable from a refusal by construction: the two notice kinds differ.
		const refused = await composeCommerce({
			declarations: [auctions],
			endpoint: modelEndpoint({ events: [] }).endpoint,
			upstream: recordingUpstream({ events: [] }).upstream,
		})
		const refusal = await judgeAdmission(refused.validator, listing(false), context)
		expect(refusal.notice.kind).not.toBe(notice.kind)
	})

	test('an admitted item is interactive and the gate says accept', async () => {
		const composed = composeCommerce({
			declarations: [auctions],
			endpoint: modelEndpoint({ events: [] }).endpoint,
			upstream: recordingUpstream({ events: [] }).upstream,
		})
		const { decision, notice } = await judgeAdmission(composed.validator, listing(true), context)
		expect(decision).toBe('accept')
		expect(notice.kind).toBe('admitted')
		expect(notice.interactive).toBe(true)
	})
})
