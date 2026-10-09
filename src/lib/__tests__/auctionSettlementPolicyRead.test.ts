/**
 * The read path must accept every `settlement_policy` the publish path can write.
 *
 * The defect this locks down: the V4V flow publishes the root with
 * `settlement_policy = cashu_p2pk_bidder_path_multiparty_v1` (see
 * `AuctionFormContent.tsx`, which imports the constant from `multipartySchedule`), while the
 * reader pinned the tag to the single-party literal. The parser therefore refused the
 * auction's own root — the auction rendered as an empty "Untitled Auction" card, and no
 * validator service could read it either.
 *
 * Both directions matter, so both are asserted here: the multiparty value parses, and an
 * unknown policy is still refused (the reader is permissive across the two schemes, not
 * across anything).
 */
import { describe, expect, test } from 'bun:test'

import { parseAuctionEvent } from '../schemas/auction/auctionEvent'
import { AUCTION_SETTLEMENT_POLICIES, AUCTION_SETTLEMENT_POLICY } from '../auction/constants'
// Imported from the module the publish path uses, so the test breaks if the two drift apart.
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '../auction/multipartySchedule'
import type { NostrEventLike } from '../nostr/eventLike'

const SELLER_PK = 'a'.repeat(64)
const AUDITOR_PK = 'b'.repeat(64)
const SECOND_AUDITOR_PK = 'c'.repeat(64)

const rawAuctionEvent = (settlementPolicy: string, auditors: string[], auditorQuorum = auditors.length): NostrEventLike => ({
	id: SELLER_PK,
	pubkey: SELLER_PK,
	kind: 30408,
	created_at: 1_700_000_000,
	content: '',
	tags: [
		['d', 'auction-settlement-policy'],
		['title', 'Settlement policy read'],
		['auction_type', 'english'],
		['currency', 'SAT'],
		['settlement_policy', settlementPolicy],
		['key_scheme', 'hd_p2pk'],
		['start_at', '1700000000'],
		['end_at', '1700086400'],
		['max_end_at', '1700086400'],
		['settlement_grace', '60'],
		['starting_bid', '1000'],
		['bid_increment', '100'],
		['mint', 'https://mint.example.com'],
		['p2pk_xpub', 'xpub-fixture'],
		...auditors.map((pubkey) => ['auditors', pubkey]),
		['auditor_quorum', String(auditorQuorum)],
	],
})

describe('settlement_policy on the read path', () => {
	test('the single-party root still parses', () => {
		const parsed = parseAuctionEvent(rawAuctionEvent(AUCTION_SETTLEMENT_POLICY, [AUDITOR_PK]))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) throw new Error('unreachable')
		expect(parsed.value.settlementPolicy).toBe(AUCTION_SETTLEMENT_POLICY)
	})

	test('the multiparty root parses — the value the V4V publish path writes', () => {
		const parsed = parseAuctionEvent(rawAuctionEvent(AUCTION_MULTIPARTY_SETTLEMENT_POLICY, [AUDITOR_PK, SECOND_AUDITOR_PK]))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) throw new Error('unreachable')
		expect(parsed.value.settlementPolicy).toBe(AUCTION_MULTIPARTY_SETTLEMENT_POLICY)
		expect(parsed.value.auditors).toEqual([AUDITOR_PK, SECOND_AUDITOR_PK])
		expect(parsed.value.auditorQuorum).toBe(2)
	})

	test('the accepted list is exactly the two schemes', () => {
		expect([...AUCTION_SETTLEMENT_POLICIES]).toEqual([AUCTION_SETTLEMENT_POLICY, AUCTION_MULTIPARTY_SETTLEMENT_POLICY])
		expect(AUCTION_SETTLEMENT_POLICIES).toContain(AUCTION_MULTIPARTY_SETTLEMENT_POLICY)
	})

	test('an unknown settlement policy is still refused', () => {
		const parsed = parseAuctionEvent(rawAuctionEvent('cashu_p2pk_something_else_v9', [AUDITOR_PK]))
		expect(parsed.ok).toBe(false)
		if (parsed.ok) throw new Error('unreachable')
		const issues = 'issues' in parsed.error ? parsed.error.issues : []
		expect(issues.some((issue) => issue.path.includes('settlementPolicy'))).toBe(true)
	})
})
