/**
 * Regression tests for the auction detail render crash on PR #1247
 * (CI run 34495153276: `auction.rawEvent is not a function`).
 *
 * The applesauce I/O migration made `fetchAuction`, `fetchAuctionBids`,
 * `fetchAuctionSettlements`, `fetchAuctionPathReleases`, and
 * `fetchAuctionClaimOrders` return raw `NostrEventLike` plain objects
 * instead of `NDKEvent` instances. Every schema-parse boundary that used
 * to call `.rawEvent()` on those results must go through `toRawEvent`,
 * which accepts both shapes (NDK bridge and plain events) so the fetch
 * seam can be swapped without breaking the render path.
 */
import { describe, expect, test } from 'bun:test'

import { toRawEvent, type NostrEventLike } from '../nostr/eventLike'
import { parseAuctionEvent } from '../schemas/auction/auctionEvent'
import { parseBidEvent } from '../schemas/auction/bidEvent'

const HEX64 = 'a'.repeat(64)
const BIDDER_HEX64 = 'b'.repeat(64)

/** Fully valid kind-30408 auction event in raw (applesauce/plain) shape. */
const makeRawAuctionEvent = (): NostrEventLike => ({
	id: HEX64,
	pubkey: HEX64,
	kind: 30408,
	created_at: 1700000000,
	content: 'Regression auction',
	tags: [
		['d', 'auction-regression'],
		['title', 'Regression Auction'],
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
		['p2pk_xpub', 'xpub-test-fixture'],
		['auditors', BIDDER_HEX64],
		['auditor_quorum', '1'],
	],
})

/** NDK-like wrapper: same event behind a `rawEvent()` method, as NDKEvent carries it. */
const wrapNdkLike = (raw: NostrEventLike): NostrEventLike =>
	({
		...raw,
		rawEvent: () => raw,
	}) as NostrEventLike

describe('toRawEvent', () => {
	test('returns a plain (applesauce) event unchanged — same reference', () => {
		const plain = makeRawAuctionEvent()
		expect(toRawEvent(plain)).toBe(plain)
	})

	test('unwraps an NDK-like event carrying rawEvent()', () => {
		const raw = makeRawAuctionEvent()
		const ndkLike = wrapNdkLike(raw)
		expect(typeof (ndkLike as { rawEvent?: unknown }).rawEvent).toBe('function')
		expect(toRawEvent(ndkLike)).toBe(raw)
	})
})

describe('auction parse boundary accepts raw events from the applesauce path', () => {
	test('plain canonical auction event parses (detail page h1 data path)', () => {
		const plain = makeRawAuctionEvent()
		const result = parseAuctionEvent(toRawEvent(plain))
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.title).toBe('Regression Auction')
		expect(result.value.dTag).toBe('auction-regression')
		expect(result.value.coordinate).toBe(`30408:${HEX64}:auction-regression`)
	})

	test('NDK-wrapped and plain events parse to the identical ParsedAuctionEvent', () => {
		const plainResult = parseAuctionEvent(toRawEvent(makeRawAuctionEvent()))
		const wrappedResult = parseAuctionEvent(toRawEvent(wrapNdkLike(makeRawAuctionEvent())))
		expect(wrappedResult).toEqual(plainResult)
	})

	test('plain bid event parses through the same boundary (bids memos)', () => {
		const plainBid: NostrEventLike = {
			id: BIDDER_HEX64,
			pubkey: BIDDER_HEX64,
			kind: 1023, // AUCTION_BID_KIND
			created_at: 1700000100,
			content: '',
			tags: [
				['e', '1'.repeat(64)],
				['a', `30408:${HEX64}:auction-regression`],
				['p', HEX64],
				['amount', '1000', 'SAT'],
				['currency', 'SAT'],
				['mint', 'https://mint.example.com'],
				['locktime', '5700'],
				['refund_pubkey', '03' + 'e'.repeat(64)],
				['child_pubkey', '02' + 'd'.repeat(64)],
				['lock_secret', 'lock-secret-1'],
				['proof_y', '02' + 'f'.repeat(64)],
				['created_for_end_at', '1700086400'],
				['bid_nonce', 'nonce-1'],
				['key_scheme', 'hd_p2pk'],
				['status', 'locked'],
			],
		}
		const result = parseBidEvent(toRawEvent(plainBid))
		expect(result.ok).toBe(true)
	})
})
