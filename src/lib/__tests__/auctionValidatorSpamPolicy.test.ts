import { describe, expect, test } from 'bun:test'
import {
	checkBidSpamPolicy,
	checkEventEnvelope,
	createBidSpamState,
	readBidSpamPolicyFromEnv,
	recordAcceptedBid,
	resolveBidSpamPolicy,
	resolvePendingBufferLimits,
} from '../../server/auction-validator/spamPolicy'
import type { ParsedAuctionEvent, ParsedBidEvent } from '../auction/events'

const auction = { rootEventId: 'a'.repeat(64) } as ParsedAuctionEvent
const otherAuction = { rootEventId: 'b'.repeat(64) } as ParsedAuctionEvent

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

	test('enforces the rolling rate limit across auctions for the same bidder', () => {
		const state = createBidSpamState()
		recordAcceptedBid({
			auction,
			bid: buildBid({ id: '1'.repeat(64), bidNonce: 'nonce-1' }),
			now: 100,
			state,
			policy: { maxBidsPerWindow: 2, rateWindowSec: 10 },
		})
		recordAcceptedBid({
			auction: otherAuction,
			bid: buildBid({ id: '2'.repeat(64), bidNonce: 'nonce-2' }),
			now: 101,
			state,
			policy: { maxBidsPerWindow: 2, rateWindowSec: 10 },
		})

		const blocked = buildBid({ id: '3'.repeat(64), bidNonce: 'nonce-3' })
		expect(
			checkBidSpamPolicy({
				auction,
				bid: blocked,
				now: 105,
				state,
				trackedBidCount: 0,
				policy: { maxBidsPerWindow: 2, rateWindowSec: 10 },
			}),
		).toMatchObject({ ok: false, reason: 'rate_limited' })
	})

	test('enforces the tracked bid cap independently of rate limiting', () => {
		const state = createBidSpamState()
		const bid = buildBid()
		expect(
			checkBidSpamPolicy({ auction, bid, now: 100, state, trackedBidCount: 1, policy: { maxTrackedBidsPerAuction: 1 } }),
		).toMatchObject({
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
			AUCTION_VALIDATOR_MAX_TRACKED_CHILD_SUBSCRIPTIONS: '12',
			AUCTION_VALIDATOR_CHILD_REPLAY_LOOKBACK_SEC: '345',
			AUCTION_VALIDATOR_MAX_TRACKED_BIDS_PER_AUCTION: '5',
			AUCTION_VALIDATOR_MAX_PENDING_EVENTS: '99',
			AUCTION_VALIDATOR_MAX_TAG_COUNT: '11',
		} as NodeJS.ProcessEnv)
		expect(policy).toEqual({
			maxBidsPerWindow: 7,
			maxTrackedChildSubscriptions: 12,
			childReplayLookbackSec: 345,
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

	test('reads the admission master switch and the observation bounds from env', () => {
		expect(
			readBidSpamPolicyFromEnv({
				AUCTION_VALIDATOR_ADMISSION_ENABLED: 'false',
				AUCTION_VALIDATOR_CHILD_REPLAY_COMPLETION_TIMEOUT_SEC: '15',
				AUCTION_VALIDATOR_LATE_SETTLEMENT_OBSERVATION_SEC: '900',
			} as NodeJS.ProcessEnv),
		).toEqual({
			admissionEnabled: false,
			childReplayCompletionTimeoutSec: 15,
			lateSettlementObservationSec: 900,
		})
		expect(readBidSpamPolicyFromEnv({ AUCTION_VALIDATOR_ADMISSION_ENABLED: 'TRUE' } as NodeJS.ProcessEnv)).toEqual({
			admissionEnabled: true,
		})
		// A mistyped security control must fail loudly, not fall back to a
		// default (review 5242945675 Required 3).
		expect(() => readBidSpamPolicyFromEnv({ AUCTION_VALIDATOR_ADMISSION_ENABLED: 'maybe' } as NodeJS.ProcessEnv)).toThrow(
			'AUCTION_VALIDATOR_ADMISSION_ENABLED must be true or false',
		)
	})

	test('passes every admission gate when admission is declared off', () => {
		const state = createBidSpamState()
		const bid = buildBid({ bidNonce: 'x'.repeat(64) })
		const policy = {
			admissionEnabled: false,
			maxEventBytes: 8,
			maxTagCount: 1,
			maxNonceLength: 1,
			maxProofCount: 0,
			maxBidsPerWindow: 0,
			maxTrackedBidsPerAuction: 0,
		}

		expect(
			checkEventEnvelope(
				{
					tags: [
						['a', 'b'],
						['c', 'd'],
					],
				} as any,
				policy,
			),
		).toEqual({ ok: true })
		expect(checkBidSpamPolicy({ auction, bid, now: 100, state, trackedBidCount: 999, policy })).toEqual({ ok: true })
		// The pre-parent buffers lose their caps with it: a declaration of
		// "no limits" that still enforced them would be a published lie.
		expect(resolvePendingBufferLimits(policy)).toEqual({
			maxPendingKeys: Number.MAX_SAFE_INTEGER,
			maxPendingEventsPerKey: Number.MAX_SAFE_INTEGER,
			maxPendingEvents: Number.MAX_SAFE_INTEGER,
			pendingTtlSec: Number.MAX_SAFE_INTEGER,
		})
	})

	test('evicts the least recently active bidder, not the earliest inserted', () => {
		// `maxSeenEventIds` is the shared retention cap. Under the old
		// oldest-inserted eviction the first bidder's rate history was the
		// first thing dropped, which silently reset their documented
		// 20-per-60 s window (review 5242945675, non-blocking).
		const state = createBidSpamState()
		const policy = { maxSeenEventIds: 3, rateWindowSec: 100, maxBidsPerWindow: 20 }
		const bidderA = 'a'.repeat(64)
		const bidderB = 'b'.repeat(64)
		const record = (bidderPubkey: string, id: string, nonce: string, now: number) =>
			recordAcceptedBid({
				auction,
				bid: buildBid({ id, bidNonce: nonce, bidderPubkey }),
				now,
				state,
				policy,
			})

		record(bidderA, '1'.repeat(64), 'nonce-1', 100)
		record(bidderB, '2'.repeat(64), 'nonce-2', 101)
		record('c'.repeat(64), '3'.repeat(64), 'nonce-3', 102)
		record(bidderA, '4'.repeat(64), 'nonce-4', 103) // A is active again
		record('d'.repeat(64), '5'.repeat(64), 'nonce-5', 104)

		expect(state.bidderBidTimes.has(bidderA)).toBe(true)
		expect(state.bidderBidTimes.get(bidderA)).toEqual([100, 103])
		expect(state.bidderBidTimes.has(bidderB)).toBe(false)
		expect(state.bidderBidTimes.size).toBe(3)
	})
})
