/**
 * gate.test.ts — **V3: kind 30408 wired end to end from the cited rules** (`increments.md` V3).
 *
 * This is the cheapest falsification of the whole mechanism: one declaration, no new module, no new
 * placement. It proves, over the **real** gate and the **real** engine:
 *
 * 1. a malformed 30408 — the motivating defect, an **absent `end_at`** that used to read as `0` and win the
 *    "Ending Soon" ordering — is **dropped by the app's own gate** on the gated read path, while the same
 *    event carrying `end_at` crosses (so the drop is the rule's, not a fixture's);
 * 2. **direct navigation still resolves it**, naming the failing constraint (the refusal carries the check
 *    and the requirement that fired — V4 adds the tag);
 * 3. **with the declaration withdrawn**, the same subject is ungated again: the pass-through default is
 *    re-asserted over the same event, so the drop was the 30408 rule's and nothing else's.
 *
 * **The mutations that turn it red:** drop `end_at` from the declaration's `requires` → case 1 admits the
 * malformed event; make `composeCommerce` always pass `validation` → case 3's `gated` is `true` and the
 * withdrawn subject is still dropped; collapse `refused` onto `accepted` → case 2 loses its refusal.
 */
import { describe, expect, test } from 'bun:test'

import { validationDeclaration as auctions } from '../../../commerce/auctions/validationDeclaration'
import type { CommerceValidationDeclaration } from './declaration'
import { createPresetRegistry } from './registry'
import { composeCommerce } from './compose'
import { DEFAULT_WRITE_BACK } from '../../event-access/ts/index'
import { modelEndpoint, recordingUpstream, signedEvent } from '../../event-access/ts/harness'
import type { Event } from '../../event-access/ts/index'

/** A kind-30408 listing with every declared `requires` satisfied — the shaped companion. */
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
	// The motivating defect: `end_at` absent, so the old parser's `?? 0` fallback made it look un-ended.
	if (withEndAt) tags.push(['end_at', '2000'])
	return signedEvent({ kind: 30408, created_at: 30_000, tags })
}

/** The declaration with kind 30408 withdrawn — the set the pass-through default is re-asserted over. */
function withoutListing(): CommerceValidationDeclaration {
	return { ...auctions, kinds: auctions.kinds.filter((owned) => owned.kind !== 30408) }
}

describe('kind 30408 wired from the cited rules', () => {
	test('a malformed 30408 (absent end_at) is dropped by the gate; the same event with end_at crosses', async () => {
		const malformed = listing(false)
		const conforming = listing(true)
		const endpoint = modelEndpoint({ events: [malformed, conforming] })
		const upstream = recordingUpstream({ events: [] })
		const composed = composeCommerce({ declarations: [auctions], endpoint: endpoint.endpoint, upstream: upstream.upstream })

		expect(composed.gated).toBe(true)
		expect(composed.access.policy.accept).toBeDefined()

		const answer = await composed.access.query({ kinds: [30408] })
		expect(answer.events.map((event) => event.id)).toEqual([conforming.id]) // the malformed one never reached a consumer
		expect(endpoint.writes.length).toBe(0) // and nothing was written back for it
	})

	test('direct navigation still resolves it, naming the failing constraint', async () => {
		const malformed = listing(false)
		const composed = composeCommerce({
			declarations: [auctions],
			endpoint: modelEndpoint({ events: [] }).endpoint,
			upstream: recordingUpstream({ events: [] }).upstream,
		})
		const outcome = await composed.validator.validate(malformed)
		expect(outcome.outcome).toBe('refused')
		if (outcome.outcome !== 'refused') return
		// the constraint: the check that fired, and the requirement within it.
		expect(outcome.refusal.check.id).toBe('auction-required-tags')
		expect(outcome.refusal.requirement).toBe('missing-tag')
		expect(outcome.refusal.message).toContain('end_at')
	})

	test('with the declaration withdrawn the same event is ungated again', async () => {
		// the registry drops the 30408 preset on withdrawal …
		const registry = createPresetRegistry({ declarations: [auctions] })
		expect(registry.snapshot().some((preset) => preset.kinds.includes(30408))).toBe(true)
		registry.withdraw('commerce.auctions', 30408)
		expect(registry.snapshot().some((preset) => preset.kinds.includes(30408))).toBe(false)

		// … and composed over the SAME subject, the pass-through default is re-asserted: the event the
		// rule dropped above now crosses. (Rebuild-on-registry-change is V6; this case composes the
		// withdrawn set, which is the fact V6's rebuild consumes.)
		const malformed = listing(false)
		const endpoint = modelEndpoint({ events: [malformed] })
		const upstream = recordingUpstream({ events: [] })
		const withdrawn = composeCommerce({
			declarations: [withoutListing()],
			endpoint: endpoint.endpoint,
			upstream: upstream.upstream,
		})
		const answer = await withdrawn.access.query({ kinds: [30408] })
		expect(answer.events.map((event) => event.id)).toEqual([malformed.id])
		// the pass-through default for 30408 is the engine's own: no preset covers it, and the policy that
		// governs it is the declared default, not a lookalike.
		expect(withdrawn.validator.presets.some((preset) => preset.kinds.includes(30408))).toBe(false)
		expect(await withdrawn.validator.validate(malformed)).toEqual({ outcome: 'accepted' })
		expect(DEFAULT_WRITE_BACK.accept).toBeUndefined()
	})
})
