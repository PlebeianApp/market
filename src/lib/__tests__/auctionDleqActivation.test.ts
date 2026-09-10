import { describe, expect, test } from 'bun:test'
import { parseAuctionEvent } from '../schemas/auction/auctionEvent'
import type { NostrEventLike } from '../nostr/eventLike'
import { AUCTION_KIND } from '../auction/constants'

const SELLER_PK = 'a'.repeat(64)
const AUDITOR = 'c'.repeat(64)

const buildAuctionEvent = (overrides: { startAt?: number; dleqRequired?: string } = {}): NostrEventLike => {
	const startAt = overrides.startAt ?? 1_000
	const tags: string[][] = [
		['d', 'auction-test'],
		['title', 'Test'],
		['auction_type', 'english'],
		['start_at', String(startAt)],
		['end_at', String(startAt + 1000)],
		['max_end_at', String(startAt + 1100)],
		['currency', 'SAT'],
		['price', '100', 'SAT'],
		['starting_bid', '100', 'SAT'],
		['bid_increment', '10'],
		['reserve', '0'],
		['mint', 'https://mint.test'],
		['auditors', AUDITOR],
		['auditor_quorum', '1'],
		['max_skew_sec', '120'],
		['settlement_grace', '3600'],
		['min_bid_curve', 'none:1.0'],
		['key_scheme', 'hd_p2pk'],
		['p2pk_xpub', 'xpub-stub'],
		['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
		['schema', 'auction_v1'],
	]
	if (overrides.dleqRequired !== undefined) tags.push(['dleq_required', overrides.dleqRequired])
	return {
		id: '1'.repeat(64),
		kind: AUCTION_KIND,
		pubkey: SELLER_PK,
		created_at: 1_000,
		content: '',
		tags,
	} as NostrEventLike
}

describe('DLEQ activation is canonical protocol truth (ADR-0011 Blocker 4)', () => {
	test('parses dleq_required=1 as true', () => {
		const result = parseAuctionEvent(buildAuctionEvent({ dleqRequired: '1' }))
		expect(result.ok).toBe(true)
		expect(result.ok && result.value.dleqRequired).toBe(true)
	})

	test('parses dleq_required=0 as false', () => {
		const result = parseAuctionEvent(buildAuctionEvent({ dleqRequired: '0' }))
		expect(result.ok).toBe(true)
		expect(result.ok && result.value.dleqRequired).toBe(false)
	})

	test('absent dleq_required defaults to false (grandfathered)', () => {
		const result = parseAuctionEvent(buildAuctionEvent())
		expect(result.ok).toBe(true)
		expect(result.ok && result.value.dleqRequired).toBe(false)
	})

	test('a post-rollout auction with dleq_required=0 is grandfathered (seller opted out, canonical)', () => {
		// startAt is far past any boundary, but the signed tag says DLEQ not
		// required — the requirement is canonical from the signed event, not
		// derived from a client-side boundary comparison.
		const auction = parseAuctionEvent(buildAuctionEvent({ startAt: 9_999_999_999, dleqRequired: '0' }))
		expect(auction.ok).toBe(true)
		expect(auction.ok && auction.value.dleqRequired).toBe(false)
	})

	test('a pre-rollout auction with dleq_required=1 requires DLEQ (canonical, not boundary-derived)', () => {
		const auction = parseAuctionEvent(buildAuctionEvent({ startAt: 1, dleqRequired: '1' }))
		expect(auction.ok).toBe(true)
		expect(auction.ok && auction.value.dleqRequired).toBe(true)
	})
})
