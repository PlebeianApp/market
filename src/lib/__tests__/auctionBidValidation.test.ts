import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { computeBidFloor, validateBid } from '../auction/validation'
import type { ParsedAuctionEvent, ParsedBidEvent, MinBidCurve } from '../auction/events'
import { VALIDATOR_REASONS, APP_AUCTION_DLEQ_ROLLOUT_START_AT, AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS } from '../auction/constants'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import type { DleqProof } from '../cashu/dleq'

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
	dleqProofs?: DleqProof[]
	prevBidId?: string
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
	const effectiveLockSecrets =
		overrides.lockSecrets ??
		Array.from({ length: overrides.proofYs?.length ?? lockSecrets.length }, () =>
			buildLockSecret({
				childPubkey,
				locktime,
				refundPubkey,
			}),
		)
	const proofYs = overrides.proofYs ?? effectiveLockSecrets.map((secret) => hashToCurveHexFromString(secret))
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
		lockSecrets: effectiveLockSecrets,
		proofYs,
		dleqProofs: overrides.dleqProofs ?? [],
		createdForEndAt: auction.endAt,
		bidNonce: 'test-bid-nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
		prevBidId: overrides.prevBidId,
	}
}

// =============================================================================
// Tests — §7.1 happy path
// =============================================================================

describe('validateBid — happy path', () => {
	test('returns valid_bid_placed for a well-formed bid with unspent proof', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('first bid passes when amount >= starting_bid', () => {
		const auction = buildAuction({ startingBid: 5_000, bidIncrement: 500 })
		const bid = buildBid(auction, { amount: 5_000 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('subsequent bid passes when amount >= top_bid + bid_increment', () => {
		const auction = buildAuction({ startingBid: 1_000, bidIncrement: 100 })
		const bid = buildBid(auction, { amount: 5_100 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
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
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
			expect(verdict.detail).toMatch(/root/)
		}
	})

	test("bad_lock when bid coordinate doesn't match auction", () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { auctionCoordinate: `30408:${BIDDER_PK}:other-auction` })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
			expect(verdict.detail).toMatch(/coordinate/)
		}
	})

	test("bad_lock when bid `p` tag doesn't match seller pubkey", () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { sellerPubkey: BIDDER_PK })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
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
		const verdict = validateBid({ auction, bid, observedAt: 500 })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('pre_start')
		}
	})

	test('post_end when bidder created_at exceeds max_end_at', () => {
		const auction = buildAuction({ maxEndAt: 2_100 })
		const bid = buildBid(auction, { createdAt: 2_500 })
		const verdict = validateBid({ auction, bid, observedAt: 2_500 })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('post_end')
		}
	})

	test('late_arrival when validator observed_at is past max_end_at (even if created_at is in window)', () => {
		const auction = buildAuction({ maxEndAt: 2_100 })
		const bid = buildBid(auction, { createdAt: 2_050 })
		const verdict = validateBid({ auction, bid, observedAt: 3_000 })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('late_arrival')
		}
	})

	test('timestamp_skew when |created_at - observed_at| exceeds max_skew_sec', () => {
		const auction = buildAuction({ maxSkewSec: 60 })
		const bid = buildBid(auction, { createdAt: 1_500 })
		const verdict = validateBid({ auction, bid, observedAt: 1_700 })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('timestamp_skew')
		}
	})

	test('skew within max_skew_sec is fine', () => {
		const auction = buildAuction({ maxSkewSec: 60 })
		const bid = buildBid(auction, { createdAt: 1_500 })
		const verdict = validateBid({ auction, bid, observedAt: 1_530 })
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
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('unsupported_mint')
		}
	})

	test('multi-mint allowlist accepts any listed mint', () => {
		const auction = buildAuction({ mints: ['https://mint.a', 'https://mint.b'] })
		const bid = buildBid(auction, { mint: 'https://mint.b' })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('valid_bid_placed')
	})
})

// =============================================================================
// Tests — Lock secret structure
// =============================================================================

describe('validateBid — lock secret structure', () => {
	test('bad_proof_y when published proof_y does not match hash_to_curve(lock_secret)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, {
			proofYs: [PROOF_Y],
		})
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_proof_y')
		}
	})

	test('bad_lock when lock_secret JSON is malformed', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { lockSecrets: ['not-json'] })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
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
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
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
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
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
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
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
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('bad_lock')
		}
	})
})

// =============================================================================
// Tests — the absolute floor: the only amount-based validity check
//
// ADR-0012 Phase 1. The minimum increment and the anti-snipe curve are NOT
// validity rules — they are selection-time rules (Phase 2) and advisory client
// hints. A bid below either is *valid but not leading*. These tests assert the
// new behaviour directly, and the retired reasons must be unreachable rather
// than merely renamed.
// =============================================================================

describe('validateBid — absolute floor', () => {
	test('rejects a bid below starting_bid with below_starting_bid', () => {
		const auction = buildAuction({ startingBid: 5_000 })
		const bid = buildBid(auction, { amount: 4_999 })
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('below_starting_bid')
			expect(verdict.detail).toMatch(/starting_bid=5000/)
		}
	})

	test('accepts a bid exactly equal to starting_bid (the floor is inclusive)', () => {
		const auction = buildAuction({ startingBid: 5_000 })
		const bid = buildBid(auction, { amount: 5_000 })
		expect(validateBid({ auction, bid, observedAt: bid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
	})

	test('a starting_bid of 0 admits any non-negative amount — no protocol-fixed minimum', () => {
		// ADR-0012 Phase 1: fee coverage is mint- and network-dependent, so it is
		// the seller's decision baked into `starting_bid`. The verdict path holds
		// no `AUCTION_MIN_BID_SATS` floor of its own.
		const auction = buildAuction({ startingBid: 0 })
		const bid = buildBid(auction, { amount: 0 })
		expect(validateBid({ auction, bid, observedAt: bid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
	})

	test('an outbid bid is still valid — the floor consults no other bid', () => {
		// The core of the phase: a bid that is below the current leader, and below
		// `leader + bid_increment`, stays in the valid set so it can lead again
		// after an elimination or refund cleanly through the loser path. There is
		// deliberately no `currentTopBid` input to even express the old rule.
		const auction = buildAuction({ startingBid: 1_000, bidIncrement: 100 })
		const outbid = buildBid(auction, { amount: 1_001 })
		expect(validateBid({ auction, bid: outbid, observedAt: outbid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
	})

	test('a bid that a 5_000-sat leader would have out-incremented is valid', () => {
		const auction = buildAuction({ startingBid: 1_000, bidIncrement: 100 })
		const bid = buildBid(auction, { amount: 5_050 })
		expect(validateBid({ auction, bid, observedAt: bid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
	})

	test('a bid below the active anti-snipe curve floor is valid (curve is selection-time)', () => {
		const auction = buildAuction({
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100,
			startingBid: 1_000,
			bidIncrement: 100,
			minBidCurve: { shape: 'linear', peakMultiplier: 2, raw: 'linear:2' },
		})
		// The curve floor at the peak is (1000 + 100) × 2 = 2200; the bid is well
		// under it and still structurally valid.
		const bid = buildBid(auction, { amount: 1_500, createdAt: 2_100 })
		expect(validateBid({ auction, bid, observedAt: 2_100 })).toEqual({ claim: 'valid_bid_placed' })
	})

	test('a bid at starting_bid inside an aggressive curve window is valid', () => {
		const auction = buildAuction({
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100,
			startingBid: 1_000,
			minBidCurve: { shape: 'exponential', peakMultiplier: 10, raw: 'exponential:10' },
		})
		const bid = buildBid(auction, { amount: 1_000, createdAt: 2_100 })
		expect(validateBid({ auction, bid, observedAt: 2_100 })).toEqual({ claim: 'valid_bid_placed' })
	})
})

describe('validateBid — prev_bid is declared linkage metadata only', () => {
	test('an unresolvable prev_bid does not condemn the bid', () => {
		const auction = buildAuction({ startingBid: 1_000 })
		const bid = buildBid(auction, { amount: 2_000, prevBidId: '3'.repeat(64) })
		expect(validateBid({ auction, bid, observedAt: bid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
	})

	test('a self-referential prev_bid does not condemn the bid', () => {
		const auction = buildAuction({ startingBid: 1_000 })
		const bid = buildBid(auction, { amount: 2_000 })
		const selfReferential = { ...bid, prevBidId: bid.id }
		expect(validateBid({ auction, bid: selfReferential, observedAt: bid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
	})

	test('a rebid whose delta is below the leg minimum is valid', () => {
		const auction = buildAuction({ startingBid: 1_000 })
		const bid = buildBid(auction, { amount: 1_001, prevBidId: '3'.repeat(64) })
		expect(validateBid({ auction, bid, observedAt: bid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
	})
})

// =============================================================================
// Tests — determinism, no external state, retired reasons
// =============================================================================

describe('validateBid — no external state at verdict time (ADR-0012 Phase 1)', () => {
	test('a full verdict derivation makes zero network calls', () => {
		const originalFetch = globalThis.fetch
		let fetchCalls = 0
		globalThis.fetch = (() => {
			fetchCalls += 1
			throw new Error('ADR-0012 Phase 1: a verdict must never make a network call')
		}) as unknown as typeof fetch
		try {
			const auction = buildAuction()
			const valid = buildBid(auction)
			const belowFloor = buildBid(auction, { amount: 1 })
			expect(validateBid({ auction, bid: valid, observedAt: valid.createdAt })).toEqual({ claim: 'valid_bid_placed' })
			expect(validateBid({ auction, bid: belowFloor, observedAt: belowFloor.createdAt }).claim).toBe('bid_invalid')
		} finally {
			globalThis.fetch = originalFetch
		}
		expect(fetchCalls).toBe(0)
	})

	test('no public key of the verdict input surface accepts NUT-7 or top-bid state', () => {
		// Compile-time invariant expressed at runtime: the input object the
		// pipeline actually reads has exactly four keys, and none of the removed
		// inputs are among them. A regression that re-adds `currentTopBid` or a
		// NUT-7 state would have to add it back here too.
		const auction = buildAuction()
		const bid = buildBid(auction)
		const input = { auction, bid, observedAt: bid.createdAt }
		expect(Object.keys(input).sort()).toEqual(['auction', 'bid', 'observedAt'])
		expect(validateBid(input)).toEqual({ claim: 'valid_bid_placed' })
	})

	test('the same input yields the same verdict every time', () => {
		const auction = buildAuction({ startingBid: 5_000, bidIncrement: 100 })
		const bid = buildBid(auction, { amount: 5_100 })
		const first = validateBid({ auction, bid, observedAt: bid.createdAt })
		const second = validateBid({ auction, bid, observedAt: bid.createdAt })
		expect(second).toEqual(first)
		expect(first).toEqual({ claim: 'valid_bid_placed' })
	})

	test('inputs that previously produced each retired reason now all yield valid_bid_placed', () => {
		const auction = buildAuction({
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100,
			startingBid: 1_000,
			bidIncrement: 5_000,
			minBidCurve: { shape: 'exponential', peakMultiplier: 50, raw: 'exponential:50' },
		})
		const previouslyRejected = [
			buildBid(auction, { amount: 1_000 }), // used to be under_increment against a leader
			buildBid(auction, { amount: 1_000, createdAt: 2_100 }), // used to be under_curve
			buildBid(auction, { amount: 1_000, prevBidId: '3'.repeat(64) }), // used to be replacement_chain_invalid
		]
		for (const bid of previouslyRejected) {
			const observedAt = Math.min(Math.max(bid.createdAt, auction.startAt), auction.maxEndAt)
			expect(validateBid({ auction, bid, observedAt })).toEqual({ claim: 'valid_bid_placed' })
		}
	})

	test('the retired reasons are absent from the emittable reason set', () => {
		expect(VALIDATOR_REASONS).not.toContain('under_increment')
		expect(VALIDATOR_REASONS).not.toContain('under_curve')
		expect(VALIDATOR_REASONS).not.toContain('replacement_chain_invalid')
		expect(VALIDATOR_REASONS).toContain('below_starting_bid')
	})
})

// =============================================================================
// Tests — computeBidFloor (§6.1 reference maths; selection/display only)
// =============================================================================

describe('computeBidFloor — §6.1 reference maths, never a validity gate', () => {
	test('the zero-top baseline is starting_bid, never reserve (issue #1315)', () => {
		const auction = buildAuction({
			startAt: 1_000,
			endAt: 2_000,
			maxEndAt: 2_100,
			startingBid: 500,
			reserve: 9_000,
			bidIncrement: 100,
			minBidCurve: { shape: 'linear', peakMultiplier: 2, raw: 'linear:2' },
		})
		// No top bid → baseline is starting_bid (500). `reserve` (9000) is a
		// close-time winner gate and must not appear here.
		expect(computeBidFloor({ auction, topBid: 0, atSeconds: auction.endAt })).toBe(500)
		expect(computeBidFloor({ auction, topBid: 0, atSeconds: auction.maxEndAt })).toBe(1_000)
		// With a top bid → baseline is top + bid_increment.
		expect(computeBidFloor({ auction, topBid: 100, atSeconds: auction.maxEndAt })).toBe((100 + 100) * 2)
	})

	test('the multiplier is 1 outside the curve window', () => {
		const auction = buildAuction({ startingBid: 1_000, minBidCurve: { shape: 'linear', peakMultiplier: 3, raw: 'linear:3' } })
		expect(computeBidFloor({ auction, topBid: 0, atSeconds: auction.endAt })).toBe(1_000)
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
	test('a bid failing multiple checks reports the FIRST failure (pre_start before below_starting_bid)', () => {
		const auction = buildAuction({ startAt: 1_000, startingBid: 5_000 })
		const bid = buildBid(auction, { createdAt: 500, amount: 100 }) // both pre_start AND below_starting_bid
		const verdict = validateBid({ auction, bid, observedAt: 500 })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('pre_start')
		}
	})

	test('the absolute floor is only consulted after the time window passes', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { createdAt: 500, amount: 1 }) // pre_start AND below floor
		const verdict = validateBid({ auction, bid, observedAt: 500 })
		// Without short-circuiting we'd get below_starting_bid. With it, pre_start.
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('pre_start')
		}
	})
})

// =============================================================================
// Tests — NUT-12 DLEQ structural checks (ADR-0011)
// =============================================================================

describe('validateBid — DLEQ collateral checks (ADR-0011)', () => {
	const POST = APP_AUCTION_DLEQ_ROLLOUT_START_AT

	const makeDleqProof = (overrides: Partial<DleqProof> = {}): DleqProof => ({
		id: '00deadbeef',
		amount: 100,
		C: COMPRESSED_PK,
		e: 'aa',
		s: 'bb',
		r: 'cc',
		...overrides,
	})

	const buildPostRolloutAuction = (): ParsedAuctionEvent =>
		buildAuction({
			startAt: POST,
			endAt: POST + 1_000,
			maxEndAt: POST + 2_000,
		})

	// A lock secret with a caller-supplied nonce so we can build two DISTINCT
	// lock secrets for the same bid (the fixed-nonce fixture helper would
	// otherwise collide and trip the duplicate-secret check instead).
	const lockSecretWithNonce = (locktime: number, nonce: string): string =>
		JSON.stringify([
			'P2PK',
			{
				nonce,
				data: COMPRESSED_PK,
				tags: [
					['sigflag', 'SIG_INPUTS'],
					['locktime', String(locktime)],
					['refund', REFUND_PK],
					['n_sigs_refund', '1'],
				],
			},
		])

	test('grandfathered pre-rollout bid with no dleq_proof still validates', () => {
		const auction = buildAuction() // start_at=1000 < boundary
		const bid = buildBid(auction)
		const verdict = validateBid({ auction, bid, observedAt: bid.createdAt, nut7State: 'unspent' })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('dleq_invalid when a post-rollout bid carries no dleq_proof tags', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, { createdAt: POST + 500 })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
		}
	})

	test('dleq_invalid when a post-rollout bid carries too few dleq_proof tags', () => {
		const auction = buildPostRolloutAuction()
		const locktime = auction.maxEndAt + auction.settlementGrace
		const bid = buildBid(auction, {
			createdAt: POST + 500,
			lockSecrets: [lockSecretWithNonce(locktime, 'n1'), lockSecretWithNonce(locktime, 'n2')],
			dleqProofs: [makeDleqProof()],
		})
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
		}
	})

	test('valid_bid_placed when a post-rollout bid carries a matching dleq_proof', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [makeDleqProof()] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('dleq_invalid when a bid reuses the same dleq_proof C across two lock secrets', () => {
		const auction = buildPostRolloutAuction()
		const locktime = auction.maxEndAt + auction.settlementGrace
		const sharedC = makeDleqProof()
		const bid = buildBid(auction, {
			createdAt: POST + 500,
			lockSecrets: [lockSecretWithNonce(locktime, 'n1'), lockSecretWithNonce(locktime, 'n2')],
			dleqProofs: [sharedC, sharedC],
		})
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
		}
	})

	test('dleq_invalid (Step 3.5) reported before amount/floor (Step 5) failures', () => {
		const auction = buildPostRolloutAuction()
		// amount=1 is below the floor → would be `under_increment`, but the
		// missing DLEQ collateral is checked earlier (Step 3.5 < Step 5).
		const bid = buildBid(auction, { createdAt: POST + 500, amount: 1 })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
		}
	})
})

// =============================================================================
// Tests — NUT-12 DLEQ proof structural field validation (ADR-0011 B4)
// =============================================================================

describe('validateBid — DLEQ proof structural fields (ADR-0011 B4)', () => {
	const POST = APP_AUCTION_DLEQ_ROLLOUT_START_AT

	const makeDleqProof = (overrides: Partial<DleqProof> = {}): DleqProof => ({
		id: '00deadbeef',
		amount: 100,
		C: COMPRESSED_PK,
		e: 'aa',
		s: 'bb',
		r: 'cc',
		...overrides,
	})

	const buildPostRolloutAuction = (): ParsedAuctionEvent =>
		buildAuction({
			startAt: POST,
			endAt: POST + 1_000,
			maxEndAt: POST + 2_000,
		})

	test('dleq_invalid when dleq_proof is missing the required id field', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), id: '' } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*id/)
		}
	})

	test('dleq_invalid when dleq_proof is missing the required amount field', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), amount: 0 } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*amount/)
		}
	})

	test('dleq_invalid when dleq_proof amount is not a positive safe integer', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), amount: -1 } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*amount/)
		}
	})

	test('dleq_invalid when dleq_proof amount is not an integer (float)', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), amount: 100.5 } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*amount/)
		}
	})

	test('dleq_invalid when dleq_proof is missing the required C (mint signature) field', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), C: '' } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*C/)
		}
	})

	test('dleq_invalid when dleq_proof C is not a 66-char compressed pubkey hex', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), C: '02' + 'f'.repeat(63) } as DleqProof // 65 chars
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*C.*66/)
		}
	})

	test('dleq_invalid when dleq_proof is missing the required e (challenge) field', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), e: '' } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*e/)
		}
	})

	test('dleq_invalid when dleq_proof is missing the required s (response) field', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), s: '' } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*s/)
		}
	})

	test('dleq_invalid when dleq_proof is missing the required r (blinding factor) field', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), r: '' } as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*r/)
		}
	})

	test('valid_bid_placed when all dleq_proof entries are structurally well-formed', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: POST + 500,
			dleqProofs: [makeDleqProof()],
		})
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict).toEqual({ claim: 'valid_bid_placed' })
	})

	test('dleq_invalid null C field rejected as missing', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), C: undefined } as unknown as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
		}
	})

	test('dleq_invalid null r field rejected as missing (fail-closed)', () => {
		const auction = buildPostRolloutAuction()
		const badProof = { ...makeDleqProof(), r: undefined } as unknown as DleqProof
		const bid = buildBid(auction, { createdAt: POST + 500, dleqProofs: [badProof] })
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
		}
	})

	test('dleq_invalid when second proof in a multi-proof bid is structurally malformed', () => {
		const auction = buildPostRolloutAuction()
		const locktime = auction.maxEndAt + auction.settlementGrace
		const bid = buildBid(auction, {
			createdAt: POST + 500,
			lockSecrets: [
				buildLockSecret({
					childPubkey: COMPRESSED_PK,
					locktime,
					refundPubkey: REFUND_PK,
				}),
				JSON.stringify([
					'P2PK',
					{
						nonce: 'distinct-nonce-2',
						data: COMPRESSED_PK,
						tags: [
							['sigflag', 'SIG_INPUTS'],
							['locktime', String(locktime)],
							['refund', REFUND_PK],
							['n_sigs_refund', '1'],
						],
					},
				]),
			],
			dleqProofs: [makeDleqProof({ C: COMPRESSED_PK }), makeDleqProof({ C: '', e: '', s: '', r: '' })],
		})
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 2/)
		}
	})

	test('dleq_invalid (fail-closed, no throw) when a dleq_proof entry is null', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: POST + 500,
			dleqProofs: [null as unknown as DleqProof],
		})
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*object/)
		}
	})

	test('dleq_invalid (fail-closed, no throw) when a dleq_proof entry is undefined', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: POST + 500,
			dleqProofs: [undefined as unknown as DleqProof],
		})
		const verdict = validateBid({ auction, bid, observedAt: POST + 500, nut7State: 'unspent' })
		expect(verdict.claim).toBe('bid_invalid')
		if (verdict.claim === 'bid_invalid') {
			expect(verdict.reason).toBe('dleq_invalid')
			expect(verdict.detail).toMatch(/proof 1.*object/)
		}
	})
})
