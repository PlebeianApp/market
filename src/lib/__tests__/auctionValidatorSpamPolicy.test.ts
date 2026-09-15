import { describe, expect, test } from 'bun:test'
import { checkBidSpamPolicy, createBidSpamState, recordAcceptedBid } from '../../server/auction-validator/spamPolicy'
import type { ParsedAuctionEvent, ParsedBidEvent } from '../auction/events'

const auction = { rootEventId: 'a'.repeat(64) } as ParsedAuctionEvent

const buildBid = (overrides: Partial<ParsedBidEvent> = {}): ParsedBidEvent =>
	({
		id: 'b'.repeat(64),
		bidderPubkey: 'c'.repeat(64),
		bidNonce: 'nonce-1',
		rawEvent: { content: '' },
		lockSecrets: ['secret'],
		proofYs: ['02' + 'd'.repeat(64)],
		...overrides,
	}) as ParsedBidEvent

describe('auction validator bid spam policy', () => {
	test('accepts a new bid and deduplicates its event id', () => {
		const state = createBidSpamState()
		const bid = buildBid()

		expect(checkBidSpamPolicy({ auction, bid, now: 100, state, activeBidCount: 0 })).toEqual({ ok: true })
		recordAcceptedBid({ auction, bid, now: 100, state })
		expect(checkBidSpamPolicy({ auction, bid, now: 101, state, activeBidCount: 1 })).toMatchObject({
			ok: false,
			reason: 'duplicate_event',
		})
	})

	test('rejects a different event reusing the same bidder nonce', () => {
		const state = createBidSpamState()
		const first = buildBid()
		recordAcceptedBid({ auction, bid: first, now: 100, state })

		const second = buildBid({ id: 'd'.repeat(64) })
		expect(checkBidSpamPolicy({ auction, bid: second, now: 101, state, activeBidCount: 1 })).toMatchObject({
			ok: false,
			reason: 'duplicate_bid_nonce',
		})
	})

	test('enforces a rolling rate limit and allows expired entries', () => {
		const state = createBidSpamState()
		for (let index = 0; index < 2; index += 1) {
			const bid = buildBid({ id: `${index}`.repeat(64), bidNonce: `nonce-${index}` })
			recordAcceptedBid({ auction, bid, now: 100 + index, state, policy: { maxBidsPerWindow: 2, rateWindowSec: 10 } })
		}

		const blocked = buildBid({ id: 'e'.repeat(64), bidNonce: 'nonce-3' })
		expect(
			checkBidSpamPolicy({
				auction,
				bid: blocked,
				now: 105,
				state,
				activeBidCount: 2,
				policy: { maxBidsPerWindow: 2, rateWindowSec: 10 },
			}),
		).toMatchObject({ ok: false, reason: 'rate_limited' })

		const allowed = buildBid({ id: 'f'.repeat(64), bidNonce: 'nonce-4' })
		expect(
			checkBidSpamPolicy({
				auction,
				bid: allowed,
				now: 111,
				state,
				activeBidCount: 2,
				policy: { maxBidsPerWindow: 2, rateWindowSec: 10 },
			}),
		).toEqual({ ok: true })
	})

	test('enforces the active bid cap independently of rate limiting', () => {
		const state = createBidSpamState()
		const bid = buildBid()
		expect(checkBidSpamPolicy({ auction, bid, now: 100, state, activeBidCount: 1, policy: { maxActiveBidsPerAuction: 1 } })).toMatchObject({
			ok: false,
			reason: 'too_many_active_bids',
		})
	})

	test('rejects oversized bid metadata before admission', () => {
		const state = createBidSpamState()
		const bid = buildBid({ bidNonce: 'x'.repeat(5) })
		expect(checkBidSpamPolicy({ auction, bid, now: 100, state, activeBidCount: 0, policy: { maxNonceLength: 4 } })).toMatchObject({
			ok: false,
			reason: 'invalid_bid_nonce',
		})
	})
})
