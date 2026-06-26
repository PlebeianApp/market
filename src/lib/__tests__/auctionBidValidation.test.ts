import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { computeBidFloor, validateBid } from '../auction/validation'
import type { ParsedAuctionEvent, ParsedBidEvent, MinBidCurve } from '../auction/events'
import { AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS } from '../auction/constants'

// =============================================================================
// Fixture helpers
//
// Build `ParsedAuctionEvent` and `ParsedBidEvent` directly (skipping the Zod
// parsers) — the validation pipeline reads only the parsed fields, so we don't
// need real NDKEvents. `rawEvent` is type-cast on a small object literal so
// tests compile without dragging in NDK internals.
// =============================================================================

const SELLER_PK = 'a'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const VALIDATOR_PK = 'c'.repeat(64)
const COMPRESSED_PK = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const PROOF_Y = '02' + 'f'.repeat(64)
const ANOTHER_COMPRESSED_PK = '02' + '7'.repeat(64)

const DEFAULT_AUCTION_D = 'auction-test'
const DEFAULT_ROOT_EVENT_ID = '1'.repeat(64)
const DEFAULT_COORDINATE = `30408:${SELLER_PK}:${DEFAULT_AUCTION_D}`

const NO_CURVE: MinBidCurve = { shape: 'none', peakMultiplier: 1, raw: '' }

const stubRawEvent = (kind: number, pubkey: string, content = ''): NDKEvent =>
	({
		kind,
		pubkey,
		content,
		tags: [] as string[][],
		id: 'stub',
		created_at: 0,
	}) as unknown as NDKEvent

interface AuctionOverrides {
	startAt?: number
	endAt?: number
	maxEndAt?: number
	settlementGrace?: number
	reserve?: number
	startingBid?: number
	bidIncrement?: number
	mints?: string[]
	auditors?: string[]
	auditorQuorum?: number
	maxSkewSec?: number
	fallbackDelaySec?: number
	minBidCurve?: MinBidCurve
}

const buildAuction = (overrides: AuctionOverrides = {}): ParsedAuctionEvent => {
	const startAt = overrides.startAt ?? 1_000
	const endAt = overrides.endAt ?? 2_000
	const maxEndAt = overrides.maxEndAt ?? 2_100
	const settlementGrace = overrides.settlementGrace ?? 3_600
	return {
		rawEvent: stubRawEvent(30408, SELLER_PK),
		dTag: DEFAULT_AUCTION_D,
		sellerPubkey: SELLER_PK,
		coordinate: DEFAULT_COORDINATE,
		rootEventId: DEFAULT_ROOT_EVENT_ID,
		title: 'Test Auction',
		content: '',
		auctionType: 'english',
		startAt,
		endAt,
		maxEndAt,
		settlementGrace,
		currency: 'SAT',
		reserve: overrides.reserve ?? 0,
		startingBid: overrides.startingBid ?? 1_000,
		bidIncrement: overrides.bidIncrement ?? 100,
		minBidCurve: overrides.minBidCurve ?? NO_CURVE,
		settlementPolicy: 'cashu_p2pk_bidder_path_v1',
		keyScheme: 'hd_p2pk',
		mints: overrides.mints ?? ['https://mint.test'],
		p2pkXpub: 'xpub-stub',
		auditors: overrides.auditors ?? [VALIDATOR_PK],
		auditorQuorum: overrides.auditorQuorum ?? 1,
		maxSkewSec: overrides.maxSkewSec ?? 60,
		fallbackDelaySec: overrides.fallbackDelaySec ?? 1_800,
		vadiumRatioBps: 10_000,
		schema: 'auction_v1',
	}
}

interface BidOverrides {
	amount?: number
	createdAt?: number
	locktime?: number
	mint?: string
	childPubkey?: string
	refundPubkey?: string
	proofYs?: string[]
	auctionRootEventId?: string
	auctionCoordinate?: string
	sellerPubkey?: string
	lockSecrets?: string[]
}

const buildLockSecret = (params: { childPubkey: string; locktime: number; refundPubkey: string }): string => {
	return JSON.stringify([
		'P2PK',
		{
			nonce: 'test-nonce',
			data: params.childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(params.locktime)],
				['refund', params.refundPubkey],
				['n_sigs_refund', '1'],
			],
		},
	])
}

const buildBid = (auction: ParsedAuctionEvent, overrides: BidOverrides = {}): ParsedBidEvent => {
	const locktime = overrides.locktime ?? auction.maxEndAt + auction.settlementGrace
	const childPubkey = overrides.childPubkey ?? COMPRESSED_PK
	const refundPubkey = overrides.refundPubkey ?? REFUND_PK
	const lockSecrets = overrides.lockSecrets ?? [
		buildLockSecret({
			childPubkey,
			locktime,
			refundPubkey,
		}),
	]
	const proofYs = overrides.proofYs ?? Array.from({ length: lockSecrets.length }, () => PROOF_Y)
	return {
		rawEvent: stubRawEvent(1023, BIDDER_PK),
		id: '2'.repeat(64),
		bidderPubkey: BIDDER_PK,
		createdAt: overrides.createdAt ?? 1_500,
		auctionRootEventId: overrides.auctionRootEventId ?? auction.rootEventId,
		auctionCoordinate: overrides.auctionCoordinate ?? auction.coordinate,
		sellerPubkey: overrides.sellerPubkey ?? auction.sellerPubkey,
		amount: overrides.amount ?? 1_100,
		currency: 'SAT',
		mint: overrides.mint ?? 'https://mint.test',
		locktime,
		refundPubkey,
		childPubkey,
		lockSecrets,
		proofYs,
		createdForEndAt: auction.endAt,
		bidNonce: 'test-bid-nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
	}
}

// =============================================================================
// Tests — §7.1 happy path
// =============================================================================

describe('validateBid — happy path', () => {
	test('returns valid_bid_placed for a well-formed bid with unspent proof', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('first bid passes when amount >= starting_bid', () => {
		const auction = buildAuction({ startingBid: 5_000, bidIncrement: 500 })
		const bid = buildBid(auction, { amount: 5_000 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('subsequent bid passes when amount >= top_bid + bid_increment', () => {
		const auction = buildAuction({ startingBid: 1_000, bidIncrement: 100 })
		const bid = buildBid(auction, { amount: 5_100 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent', currentTopBid: 5_000 })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})
})

// =============================================================================
// Tests — Cross-event reference integrity
// =============================================================================

describe('validateBid — cross-event reference checks', () => {
	test('bad_lock when bid references different auction root', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { auctionRootEventId: '9'.repeat(64) })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
			expect(verdict.detail).toMatch(/root/)
		}
	})

	test("bad_lock when bid coordinate doesn't match auction", () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { auctionCoordinate: `30408:${BIDDER_PK}:other-auction` })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
			expect(verdict.detail).toMatch(/coordinate/)
		}
	})

	test("bad_lock when bid `p` tag doesn't match seller pubkey", () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { sellerPubkey: BIDDER_PK })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
		}
	})
})

// =============================================================================
// Tests — Time-window checks
// =============================================================================

describe('validateBid — time window', () => {
	test('pre_start when bidder created_at is before start_at', () => {
		const auction = buildAuction({ startAt: 1_000 })
		const bid = buildBid(auction, { createdAt: 500 })
		const verdict = validateBid({ auction, bid, observedAt: 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('pre_start')
		}
	})

	test('post_end when bidder created_at exceeds max_end_at', () => {
		const auction = buildAuction({ maxEndAt: 2_100 })
		const bid = buildBid(auction, { createdAt: 2_500 })
		const verdict = validateBid({ auction, bid, observedAt: 2_500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('post_end')
		}
	})

	test('late_arrival when validator observed_at is past max_end_at (even if created_at is in window)', () => {
		const auction = buildAuction({ maxEndAt: 2_100 })
		const bid = buildBid(auction, { createdAt: 2_050 })
		const verdict = validateBid({ auction, bid, observedAt: 3_000, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('late_arrival')
		}
	})

	test('timestamp_skew when |created_at - observed_at| exceeds max_skew_sec', () => {
		const auction = buildAuction({ maxSkewSec: 60 })
		const bid = buildBid(auction, { createdAt: 1_500 })
		const verdict = validateBid({ auction, bid, observedAt: 1_700, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('timestamp_skew')
		}
	})

	test('skew within max_skew_sec is fine', () => {
		const auction = buildAuction({ maxSkewSec: 60 })
		const bid = buildBid(auction, { createdAt: 1_500 })
		const verdict = validateBid({ auction, bid, observedAt: 1_530, nut7State: 'unspent' })
		expect(verdict.claim).toBe('valid_bid_placed')
	})
})

// =============================================================================
// Tests — Mint allowlist
// =============================================================================

describe('validateBid — mint allowlist', () => {
	test('unsupported_mint when bid mint is not in auction allowlist', () => {
		const auction = buildAuction({ mints: ['https://mint.test'] })
		const bid = buildBid(auction, { mint: 'https://other.mint' })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('unsupported_mint')
		}
	})

	test('multi-mint allowlist accepts any listed mint', () => {
		const auction = buildAuction({ mints: ['https://mint.a', 'https://mint.b'] })
		const bid = buildBid(auction, { mint: 'https://mint.b' })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('valid_bid_placed')
	})
})

// =============================================================================
// Tests — Lock secret structure
// =============================================================================

describe('validateBid — lock secret structure', () => {
	test('bad_lock when lock_secret JSON is malformed', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { lockSecrets: ['not-json'] })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
		}
	})

	test('bad_lock when lock pubkey differs from child_pubkey tag', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, {
			lockSecrets: [
				buildLockSecret({
					childPubkey: ANOTHER_COMPRESSED_PK, // mismatch
					locktime: auction.maxEndAt + auction.settlementGrace,
					refundPubkey: REFUND_PK,
				}),
			],
		})
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
			expect(verdict.detail).toMatch(/lock_pubkey_mismatch|pubkey/)
		}
	})

	test('bad_lock when lock locktime != max_end_at + settlement_grace', () => {
		const auction = buildAuction()
		const expected = auction.maxEndAt + auction.settlementGrace
		const bid = buildBid(auction, {
			lockSecrets: [
				buildLockSecret({
					childPubkey: COMPRESSED_PK,
					locktime: expected + 60, // off by 60 seconds
					refundPubkey: REFUND_PK,
				}),
			],
		})
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
			expect(verdict.detail).toMatch(/locktime/)
		}
	})

	test('bad_lock when bid locktime tag != max_end_at + settlement_grace', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { locktime: auction.maxEndAt + auction.settlementGrace + 1 })
		// Lock secret matches the tag, but the tag itself violates the invariant.
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
		}
	})

	test('bad_lock when refund pubkey in lock differs from bid tag', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, {
			lockSecrets: [
				buildLockSecret({
					childPubkey: COMPRESSED_PK,
					locktime: auction.maxEndAt + auction.settlementGrace,
					refundPubkey: ANOTHER_COMPRESSED_PK, // doesn't match REFUND_PK
				}),
			],
		})
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
		}
	})
})

// =============================================================================
// Tests — Amount / floor / curve
// =============================================================================

describe('validateBid — amount and floor', () => {
	test('rejects first bid below AUCTION_MIN_BID_SATS', () => {
		const auction = buildAuction({ startingBid: 1, bidIncrement: 1 })
		const bid = buildBid(auction, { amount: AUCTION_MIN_BID_SATS - 1 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('under_increment')
		}
	})

	test('accepts first bid exactly AUCTION_MIN_BID_SATS', () => {
		const auction = buildAuction({ startingBid: 1, bidIncrement: 1 })
		const bid = buildBid(auction, { amount: AUCTION_MIN_BID_SATS })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('rejects subsequent bid when raise is below AUCTION_MIN_BID_LEG_SATS', () => {
		const auction = buildAuction({ startingBid: 1, bidIncrement: 1 })
		const currentTopBid = 100
		const bid = buildBid(auction, { amount: currentTopBid + AUCTION_MIN_BID_LEG_SATS - 1 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent', currentTopBid })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('under_increment')
		}
	})

	test('accepts subsequent bid when raise equals AUCTION_MIN_BID_LEG_SATS', () => {
		const auction = buildAuction({ startingBid: 1, bidIncrement: 1 })
		const currentTopBid = 100
		const bid = buildBid(auction, { amount: currentTopBid + AUCTION_MIN_BID_LEG_SATS })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent', currentTopBid })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('curve behavior applies on top of the minimum baseline', () => {
		const auction = buildAuction({
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100,
			startingBid: 1,
			bidIncrement: 1,
			minBidCurve: { shape: 'linear', peakMultiplier: 2, raw: 'linear:2' },
		})

		expect(computeBidFloor({ auction, topBid: 0, atSeconds: auction.maxEndAt })).toBe(AUCTION_MIN_BID_SATS * 2)
		expect(computeBidFloor({ auction, topBid: 100, atSeconds: auction.maxEndAt })).toBe((100 + AUCTION_MIN_BID_LEG_SATS) * 2)
	})

	test('under_increment when amount < starting_bid (no prior bid)', () => {
		const auction = buildAuction({ startingBid: 5_000 })
		const bid = buildBid(auction, { amount: 4_000 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('under_increment')
		}
	})

	test('under_increment when amount < top_bid + bid_increment', () => {
		const auction = buildAuction({ bidIncrement: 100 })
		const bid = buildBid(auction, { amount: 5_050 }) // top + 50 < top + 100
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent', currentTopBid: 5_000 })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('under_increment')
		}
	})

	test('under_curve when in anti-snipe window and below curve floor', () => {
		const auction = buildAuction({
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100, // 100s curve window
			minBidCurve: { shape: 'linear', peakMultiplier: 2, raw: 'linear:2' },
		})
		// observed_at past end_at → curve active. At t=maxEndAt the floor is
		// baseline * 2. baseline = 1000 + 100 = 1100 → curve floor at peak = 2200.
		// (BID_FLOOR_TIME_GRACE_SECONDS=5 so effective_t = observed_at - 5)
		const bid = buildBid(auction, { amount: 1_500, createdAt: 2_100 })
		const verdict = validateBid({ auction, bid, observedAt: 2_100, nut7State: 'unspent', currentTopBid: 1_000 })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('under_curve')
		}
	})

	test('curve floor met → passes', () => {
		const auction = buildAuction({
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100,
			minBidCurve: { shape: 'linear', peakMultiplier: 2, raw: 'linear:2' },
		})
		// At peak: floor = (1000 + 100) * 2 = 2200
		const bid = buildBid(auction, { amount: 2_200, createdAt: 2_100 })
		const verdict = validateBid({ auction, bid, observedAt: 2_100, nut7State: 'unspent', currentTopBid: 1_000 })
		expect(verdict.claim).toBe('valid_bid_placed')
	})
})

// =============================================================================
// Tests — NUT-7 proof state
// =============================================================================

describe('validateBid — NUT-7 state', () => {
	test('bid_pending_review when nut7State is undefined', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('bid_pending_review')
	})

	test('bid_pending_review when nut7State is unknown', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unknown' })
		expect(verdict.claim).toBe('bid_pending_review')
	})

	test('bid_pending_review when nut7State is pending', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'pending' })
		expect(verdict.claim).toBe('bid_pending_review')
	})

	test('proof_spent when nut7State is spent (fake bid signal)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'spent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('proof_spent')
		}
	})
})

// =============================================================================
// Tests — Policy hook
// =============================================================================

describe('validateBid — policy hook', () => {
	test('passes when policy returns "pass"', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({
			auction,
			bid,
			observedAt: bid.createdAt,
			nut7State: 'unspent',
			policy: () => 'pass',
		})
		expect(verdict.claim).toBe('valid_bid_placed')
	})

	test('policy rejection surfaces with the provided reason', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({
			auction,
			bid,
			observedAt: bid.createdAt,
			nut7State: 'unspent',
			policy: () => ({ reject: true, reason: 'relatr_below_threshold', detail: 'score=0.05 < 0.1' }),
		})
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('relatr_below_threshold')
			expect(verdict.detail).toMatch(/score/)
		}
	})

	test('policy is not consulted when an earlier check fails', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { mint: 'https://wrong.mint' })
		let policyCalled = false
		const verdict = validateBid({
			auction,
			bid,
			observedAt: bid.createdAt,
			nut7State: 'unspent',
			policy: () => {
				policyCalled = true
				return 'pass'
			},
		})
		expect(verdict.claim).toBe('bid_invalid')
		expect(policyCalled).toBe(false)
	})
})

// =============================================================================
// Tests — short-circuiting / ordering
// =============================================================================

describe('validateBid — short-circuit ordering', () => {
	test('a bid failing multiple checks reports the FIRST failure (pre_start before under_increment)', () => {
		const auction = buildAuction({ startAt: 1_000, startingBid: 5_000 })
		const bid = buildBid(auction, { createdAt: 500, amount: 100 }) // both pre_start AND under_increment
		const verdict = validateBid({ auction, bid, observedAt: 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('pre_start')
		}
	})

	test('NUT-7 only consulted after rule checks pass', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { createdAt: 500 }) // pre_start
		const verdict = validateBid({ auction, bid, observedAt: 500, nut7State: 'spent' })
		// Without short-circuiting we'd get proof_spent. With it, we get pre_start.
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('pre_start')
		}
	})
})
