/**
 * `starting_bid` is a REQUIRED kind-30408 tag — AUCTIONS.md §3, ADR-0012 Phase 1,
 * issue #1315.
 *
 * Two behaviours are locked here, and both are the point of the change:
 *
 * 1. **Parsing: absence is a hard failure.** The old `readIntegerTag(...) ?? 0`
 *    fallback silently turned a missing tag into a floor of
 *    `max(0, AUCTION_MIN_BID_SATS)` = 10 sats, so an auction could run on a floor
 *    nobody declared. A loud, structured parse error replaces it.
 *    `starting_bid: 0` stays legal — there is no protocol-fixed minimum sat value
 *    (fee coverage is the seller's decision), so `0` must remain distinguishable
 *    from "absent".
 *
 * 2. **Building: the tag is always emitted.** `buildAuctionEventTags` refuses a
 *    call without a starting bid and emits the tag unconditionally, so a client
 *    cannot produce the malformed event the parser rejects.
 */
import { describe, expect, test } from 'bun:test'

import { parseAuctionEvent } from '../schemas/auction/auctionEvent'
import { buildAuctionEventTags } from '../auction/tagBuilders'
import type { NostrEventLike } from '../nostr/eventLike'

const SELLER_PK = 'a'.repeat(64)
const AUDITOR_PK = 'b'.repeat(64)

/** Fully valid kind-30408 event, minus whatever a test removes. */
const rawAuctionEvent = (overrides: { tags?: string[][] } = {}): NostrEventLike => ({
	id: SELLER_PK,
	pubkey: SELLER_PK,
	kind: 30408,
	created_at: 1_700_000_000,
	content: '',
	tags: overrides.tags ?? [
		['d', 'auction-starting-bid'],
		['title', 'Starting bid required'],
		['auction_type', 'english'],
		['currency', 'SAT'],
		['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
		['key_scheme', 'hd_p2pk'],
		['start_at', '1700000000'],
		['end_at', '1700086400'],
		['max_end_at', '1700086400'],
		['settlement_grace', '60'],
		['starting_bid', '1000'],
		['bid_increment', '100'],
		['mint', 'https://mint.example.com'],
		['p2pk_xpub', 'xpub-fixture'],
		['auditors', AUDITOR_PK],
		['auditor_quorum', '1'],
	],
})

const validTagsWithout = (tagName: string): string[][] => rawAuctionEvent().tags.filter((tag) => tag[0] !== tagName)

const buildInput = (startingBid: number) => ({
	dTag: 'auction-starting-bid',
	title: 'Starting bid required',
	startAt: 1_700_000_000,
	endAt: 1_700_086_400,
	maxEndAt: 1_700_086_400,
	settlementGrace: 60,
	reserve: 0,
	startingBid,
	bidIncrement: 100,
	mints: ['https://mint.example.com'],
	p2pkXpub: 'xpub-fixture',
	auditors: [AUDITOR_PK],
})

describe('parseAuctionEvent — starting_bid is REQUIRED (AUCTIONS.md §3)', () => {
	test('the fixture is valid with the tag present', () => {
		const result = parseAuctionEvent(rawAuctionEvent())
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.value.startingBid).toBe(1_000)
	})

	test('an absent starting_bid tag is a structured missing_required_tag failure', () => {
		const result = parseAuctionEvent({ ...rawAuctionEvent(), tags: validTagsWithout('starting_bid') })
		expect(result.ok).toBe(false)
		if (!result.ok && !(result.error instanceof Error) && 'code' in result.error) {
			expect(result.error.code).toBe('missing_required_tag')
			expect(result.error.message).toMatch(/starting_bid/)
		} else {
			throw new Error(`expected a structured missing_required_tag error, got ${JSON.stringify(result)}`)
		}
	})

	test('an absent starting_bid is NOT silently floored at AUCTION_MIN_BID_SATS', () => {
		// The regression this replaced: omission parsed to 0, and the verdict then
		// applied `max(0, AUCTION_MIN_BID_SATS)` = 10 sats, so the auction ran on a
		// floor the seller never declared. There must be no successful parse.
		const result = parseAuctionEvent({ ...rawAuctionEvent(), tags: validTagsWithout('starting_bid') })
		expect(result.ok).toBe(false)
	})

	test('a present-but-unparseable starting_bid fails schema validation, not presence', () => {
		const tags = rawAuctionEvent().tags.map((tag) => (tag[0] === 'starting_bid' ? ['starting_bid', 'ten'] : tag))
		const result = parseAuctionEvent({ ...rawAuctionEvent(), tags })
		expect(result.ok).toBe(false)
		// Distinguishable from the absence failure: this is a Zod issue on the field.
		if (!result.ok) {
			expect(typeof (result.error as { code?: string }).code).not.toBe('missing_required_tag')
		}
	})

	test('starting_bid of 0 is legal and preserved as 0 (no protocol-fixed minimum)', () => {
		const tags = rawAuctionEvent().tags.map((tag) => (tag[0] === 'starting_bid' ? ['starting_bid', '0'] : tag))
		const result = parseAuctionEvent({ ...rawAuctionEvent(), tags })
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.value.startingBid).toBe(0)
	})
})

describe('buildAuctionEventTags — starting_bid is always emitted', () => {
	test('emits the tag unconditionally', () => {
		const tags = buildAuctionEventTags(buildInput(1_234))
		expect(tags).toContainEqual(['starting_bid', '1234'])
	})

	test('emits starting_bid 0 rather than omitting the tag', () => {
		const tags = buildAuctionEventTags(buildInput(0))
		expect(tags).toContainEqual(['starting_bid', '0'])
	})

	test('round-trips: built tags parse back through the schema', () => {
		const tags = buildAuctionEventTags(buildInput(2_500))
		const result = parseAuctionEvent({ ...rawAuctionEvent(), tags: [...tags] })
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.value.startingBid).toBe(2_500)
	})

	test('throws on a non-integer starting bid', () => {
		expect(() => buildAuctionEventTags(buildInput(Number.NaN))).toThrow(/startingBid/)
		expect(() => buildAuctionEventTags(buildInput(-1))).toThrow(/startingBid/)
		expect(() => buildAuctionEventTags(buildInput(1.5))).toThrow(/startingBid/)
	})
})
