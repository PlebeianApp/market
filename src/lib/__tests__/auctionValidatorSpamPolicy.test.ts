import { describe, expect, test } from 'bun:test'
import {
	checkBidSpamPolicy,
	createBidSpamState,
	readBidSpamPolicyFromEnv,
	recordAcceptedBid,
	resolveBidSpamPolicy,
} from '../../server/auction-validator/spamPolicy'
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

		expect(checkBidSpamPolicy({ auction, bid, now: 100, state, trackedBidCount: 0 })).toEqual({ ok: true })
		recordAcceptedBid({ auction, bid, now: 100, state })
		expect(checkBidSpamPolicy({ auction, bid, now: 101, state, trackedBidCount: 1 })).toMatchObject({
			ok: false,
			reason: 'duplicate_event',
		})
	})

	test('rejects a different event reusing the same bidder nonce', () => {
		const state = createBidSpamState()
		const first = buildBid()
		recordAcceptedBid({ auction, bid: first, now: 100, state })

		const second = buildBid({ id: 'd'.repeat(64) })
		expect(checkBidSpamPolicy({ auction, bid: second, now: 101, state, trackedBidCount: 1 })).toMatchObject({
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
					trackedBidCount: 2,
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
					trackedBidCount: 2,
				policy: { maxBidsPerWindow: 2, rateWindowSec: 10 },
			}),
		).toEqual({ ok: true })
	})

	test('enforces the tracked bid cap independently of rate limiting', () => {
		const state = createBidSpamState()
		const bid = buildBid()
		expect(checkBidSpamPolicy({ auction, bid, now: 100, state, trackedBidCount: 1, policy: { maxTrackedBidsPerAuction: 1 } })).toMatchObject({
			ok: false,
			reason: 'too_many_tracked_bids',
		})
	})

	test('rejects oversized bid metadata before admission', () => {
		const state = createBidSpamState()
		const bid = buildBid({ bidNonce: 'x'.repeat(5) })
		expect(checkBidSpamPolicy({ auction, bid, now: 100, state, trackedBidCount: 0, policy: { maxNonceLength: 4 } })).toMatchObject({
			ok: false,
			reason: 'invalid_bid_nonce',
		})
	})

	test('resolves defaults with partial overrides once', () => {
		const resolved = resolveBidSpamPolicy({ maxBidsPerWindow: 3, maxTagCount: 9 })
		expect(resolved.maxBidsPerWindow).toBe(3)
		expect(resolved.maxTagCount).toBe(9)
		expect(resolved.rateWindowSec).toBe(60)
	})

	test('reads spam policy overrides from env', () => {
		const policy = readBidSpamPolicyFromEnv({
			AUCTION_VALIDATOR_MAX_BIDS_PER_WINDOW: '7',
			AUCTION_VALIDATOR_MAX_TRACKED_BIDS_PER_AUCTION: '5',
			AUCTION_VALIDATOR_MAX_PENDING_EVENTS: '99',
			AUCTION_VALIDATOR_MAX_TAG_COUNT: '11',
		} as NodeJS.ProcessEnv)
		expect(policy).toEqual({
			maxBidsPerWindow: 7,
			maxTrackedBidsPerAuction: 5,
			maxPendingEvents: 99,
			maxTagCount: 11,
		})
	})

	test('accepts the deprecated active-bids env var as an alias', () => {
		const policy = readBidSpamPolicyFromEnv({
			AUCTION_VALIDATOR_MAX_ACTIVE_BIDS_PER_AUCTION: '4',
		} as NodeJS.ProcessEnv)
		expect(policy).toEqual({ maxTrackedBidsPerAuction: 4 })
	})
})
