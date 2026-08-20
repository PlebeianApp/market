import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { computeValidatedBids } from '../auction/bidValidation'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent, MinBidCurve } from '../auction/events'
import type { Nut7ProofState } from '../auction/constants'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'

// =============================================================================
// computeValidatedBids — quorum eligibility, NUT-7 truthfulness, and
// post-settlement interpretation.
//
// These tests pin the ADR-0003/ADR-0004 amendment semantics:
//   1. Verdict timestamps are quorum-eligible only when the validator's own
//      observed_at passes the window + skew checks against the bid's
//      created_at. Poisoned timestamps simply do not count toward quorum —
//      they can never veto a bid.
//   2. NUT-7 states are never defaulted: an unconfirmed state yields
//      bid_pending_review, and only mint-reported evidence moves a bid.
//   3. NUT-7 states are never remapped: postSettlement=true changes how the
//      CONSUMER (this function) interprets a truthful `spent`, not the value.
// =============================================================================

const SELLER_PK = 'a'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const V1 = 'c'.repeat(64)
const V2 = 'd'.repeat(64)
const V3 = 'e'.repeat(64)
const COMPRESSED_PK = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)

const NO_CURVE: MinBidCurve = { shape: 'none', peakMultiplier: 1, raw: '' }

const stubRawEvent = (kind: number, pubkey: string): NDKEvent =>
	({
		kind,
		pubkey,
		content: '',
		tags: [] as string[][],
		id: 'stub',
		created_at: 0,
	}) as unknown as NDKEvent

const buildAuction = (overrides: Partial<ParsedAuctionEvent> = {}): ParsedAuctionEvent => {
	const startAt = overrides.startAt ?? 1_000
	const endAt = overrides.endAt ?? 2_000
	const maxEndAt = overrides.maxEndAt ?? 2_100
	const settlementGrace = overrides.settlementGrace ?? 3_600
	return {
		rawEvent: stubRawEvent(30408, SELLER_PK),
		dTag: 'auction-test',
		sellerPubkey: SELLER_PK,
		coordinate: `30408:${SELLER_PK}:auction-test`,
		rootEventId: '1'.repeat(64),
		title: 'Test Auction',
		content: '',
		auctionType: 'english',
		startAt,
		endAt,
		maxEndAt,
		settlementGrace,
		currency: 'SAT',
		reserve: 0,
		startingBid: 1_000,
		bidIncrement: 100,
		minBidCurve: NO_CURVE,
		settlementPolicy: 'cashu_p2pk_bidder_path_v1',
		keyScheme: 'hd_p2pk',
		mints: ['https://mint.test'],
		p2pkXpub: 'xpub-stub',
		auditors: [V1, V2, V3],
		auditorQuorum: 2,
		maxSkewSec: 60,
		fallbackDelaySec: 1_800,
		vadiumRatioBps: 10_000,
		schema: 'auction_v1',
		...overrides,
	}
}

const buildLockSecret = (childPubkey: string, locktime: number, refundPubkey: string, nonce: string): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce,
			data: childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(locktime)],
				['refund', refundPubkey],
				['n_sigs_refund', '1'],
			],
		},
	])

let bidCounter = 0
const buildBid = (auction: ParsedAuctionEvent, overrides: Partial<ParsedBidEvent> = {}): ParsedBidEvent => {
	bidCounter += 1
	const locktime = overrides.locktime ?? auction.maxEndAt + auction.settlementGrace
	const childPubkey = overrides.childPubkey ?? COMPRESSED_PK
	const refundPubkey = overrides.refundPubkey ?? REFUND_PK
	const lockSecrets = overrides.lockSecrets ?? [buildLockSecret(childPubkey, locktime, refundPubkey, `nonce-${bidCounter}`)]
	const proofYs = overrides.proofYs ?? lockSecrets.map((s) => hashToCurveHexFromString(s))
	return {
		rawEvent: stubRawEvent(1023, BIDDER_PK),
		id: overrides.id ?? `${bidCounter}`.padStart(64, '0'),
		bidderPubkey: overrides.bidderPubkey ?? BIDDER_PK,
		createdAt: overrides.createdAt ?? 1_500,
		auctionRootEventId: auction.rootEventId,
		auctionCoordinate: auction.coordinate,
		sellerPubkey: auction.sellerPubkey,
		amount: overrides.amount ?? 5_000,
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
		prevBidId: overrides.prevBidId,
	}
}

let verdictCounter = 0
const buildVerdict = (bid: ParsedBidEvent, overrides: Partial<ParsedValidatorVerdictEvent> = {}): ParsedValidatorVerdictEvent => {
	verdictCounter += 1
	return {
		rawEvent: stubRawEvent(30440, overrides.validatorPubkey ?? V1),
		id: overrides.id ?? `verdict-${verdictCounter}`,
		validatorPubkey: overrides.validatorPubkey ?? V1,
		createdAt: overrides.createdAt ?? 1_505,
		dTag: overrides.dTag ?? `${bid.bidderPubkey}:${bid.auctionRootEventId}:${bid.id}`,
		bidderPubkey: bid.bidderPubkey,
		auctionRootEventId: bid.auctionRootEventId,
		auctionCoordinate: bid.auctionCoordinate,
		bidEventId: bid.id,
		claim: overrides.claim ?? 'valid_bid_placed',
		observedAt: overrides.observedAt ?? bid.createdAt + 5,
		reason: overrides.reason,
	}
}

const unspent = (bids: ParsedBidEvent[]): Map<string, Nut7ProofState> => new Map(bids.map((b) => [b.id, 'unspent' as Nut7ProofState]))

// =============================================================================

describe('computeValidatedBids — quorum-timing eligibility', () => {
	test('quorum of in-window, within-skew verdicts confirms the bid', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner?.id).toBe(bid.id)
		expect(result.validBids).toHaveLength(1)
	})

	test('poisoned observed_at (far past max_end_at) does NOT veto: the verdict just does not count', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1 }),
			buildVerdict(bid, { validatorPubkey: V2 }),
			// Malicious: observed_at way past the auction window. If this verdict
			// were able to influence the validation timestamp it would veto the bid.
			buildVerdict(bid, { validatorPubkey: V3, observedAt: auction.maxEndAt + 99_999 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner?.id).toBe(bid.id)
	})

	test('ALL verdicts poisoned → bid stays pending (never invalid)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: auction.maxEndAt + 10_000 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: auction.maxEndAt + 20_000 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner).toBeNull()
		expect(result.validBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(1)
		expect(result.invalidBids).toHaveLength(0)
	})

	test('observed_at beyond max_skew_sec of created_at is not quorum-eligible', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + auction.maxSkewSec + 1 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt - auction.maxSkewSec - 1 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner).toBeNull()
		expect(result.pendingBids).toHaveLength(1)
	})

	test('sub-quorum eligible verdicts → pending, not valid', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: [buildVerdict(bid, { validatorPubkey: V1 })],
			nut7States: unspent([bid]),
		})
		expect(result.canonicalWinner).toBeNull()
		expect(result.pendingBids).toHaveLength(1)
	})

	test('non-auditor verdicts are ignored entirely', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: [buildVerdict(bid, { validatorPubkey: 'f'.repeat(64) }), buildVerdict(bid, { validatorPubkey: 'f'.repeat(64) })],
			nut7States: unspent([bid]),
		})
		expect(result.canonicalWinner).toBeNull()
		expect(result.pendingBids).toHaveLength(1)
	})
})

describe('computeValidatedBids — NUT-7 truthfulness (no defaults, no remaps)', () => {
	test('quorum-confirmed bid WITHOUT NUT-7 evidence stays pending (never defaulted to unspent)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts })
		expect(result.canonicalWinner).toBeNull()
		expect(result.validBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(1)
	})

	test('mint-reported unspent confirms; canonical winner derived', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner?.id).toBe(bid.id)
	})

	test('mint-reported SPENT pre-settlement invalidates (double-spend fraud)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: new Map([[bid.id, 'spent' as Nut7ProofState]]),
			postSettlement: false,
		})
		expect(result.canonicalWinner).toBeNull()
		expect(result.invalidBids).toHaveLength(1)
	})

	test('postSettlement=true: spent is interpreted as terminal redemption — bid valid AND state stays truthful', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: new Map([[bid.id, 'spent' as Nut7ProofState]]),
			postSettlement: true,
			// settledBidIds is REQUIRED when postSettlement is true — a bid NOT
			// recorded in the settlement keeps proof_spent as an invalidation.
			settledBidIds: new Set([bid.id]),
		})
		expect(result.canonicalWinner?.id).toBe(bid.id)
		// The NUT-7 value itself is never rewritten: classified still reports
		// the mint-reported truth.
		const classified = result.classified.find((c) => c.bid.id === bid.id)
		expect(classified?.nut7State).toBe('spent')
	})

	test('postSettlement=true: a bid NOT recorded in settledBidIds stays invalid (displacement blocked)', () => {
		const auction = buildAuction()
		const realWinner = buildBid(auction, { id: 'a'.repeat(64), amount: 5_000 })
		const fakeHighBid = buildBid(auction, { id: 'b'.repeat(64), bidderPubkey: '9'.repeat(64), amount: 9_000, createdAt: 1_400 })
		const verdicts = [
			buildVerdict(realWinner, { validatorPubkey: V1 }),
			buildVerdict(realWinner, { validatorPubkey: V2 }),
			buildVerdict(fakeHighBid, { validatorPubkey: V1, observedAt: fakeHighBid.createdAt + 5 }),
			buildVerdict(fakeHighBid, { validatorPubkey: V2, observedAt: fakeHighBid.createdAt + 5 }),
		]
		const result = computeValidatedBids({
			auction,
			bids: [realWinner, fakeHighBid],
			verdicts,
			// Both bids spent — realWinner is in the settlement, fakeHighBid is not.
			nut7States: new Map([
				[realWinner.id, 'spent' as Nut7ProofState],
				[fakeHighBid.id, 'spent' as Nut7ProofState],
			]),
			postSettlement: true,
			settledBidIds: new Set([realWinner.id]),
		})
		expect(result.canonicalWinner?.id).toBe(realWinner.id)
		expect(result.invalidBids).toContainEqual(expect.objectContaining({ id: fakeHighBid.id }))
	})

	test('pending NUT-7 from the mint keeps the bid pending', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: new Map([[bid.id, 'pending' as Nut7ProofState]]),
		})
		expect(result.canonicalWinner).toBeNull()
		expect(result.pendingBids).toHaveLength(1)
	})
})

describe('computeValidatedBids — condemn-claim quorum (symmetric anti-poisoning)', () => {
	test('a single bid_invalid verdict cannot veto a quorum-confirmed bid', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1 }),
			buildVerdict(bid, { validatorPubkey: V3 }),
			// Lone condemning validator: its verdict does not reach quorum, so
			// it neither condemns the bid nor blocks the honest confirm quorum.
			buildVerdict(bid, { validatorPubkey: V2, claim: 'bid_invalid', reason: 'timestamp_skew' }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner?.id).toBe(bid.id)
		expect(result.invalidBids).toHaveLength(0)
	})

	test('quorum of bid_invalid verdicts condemns the bid', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, claim: 'bid_invalid', reason: 'timestamp_skew' }),
			buildVerdict(bid, { validatorPubkey: V2, claim: 'bid_invalid', reason: 'timestamp_skew' }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner).toBeNull()
		expect(result.invalidBids).toHaveLength(1)
	})

	test('condemn verdicts with poisoned observed_at do not reach the condemn quorum', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, claim: 'bid_invalid', reason: 'timestamp_skew', observedAt: auction.maxEndAt + 99_999 }),
			buildVerdict(bid, { validatorPubkey: V2, claim: 'bid_invalid', reason: 'timestamp_skew', observedAt: auction.maxEndAt + 99_999 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		// Same anti-poisoning as confirms: the screened condemn verdicts drop
		// below quorum, so the bid stays pending rather than invalid.
		expect(result.canonicalWinner).toBeNull()
		expect(result.invalidBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(1)
	})
})

describe('computeValidatedBids — rebid chain verdict propagation', () => {
	test('latest-leg quorum verdicts confirm earlier legs (belt-and-braces propagation)', () => {
		const auction = buildAuction()
		const leg1 = buildBid(auction, { id: 'a'.repeat(63) + '1', amount: 5_000, createdAt: 1_500 })
		const leg2 = buildBid(auction, { id: 'a'.repeat(63) + '2', amount: 5_300, createdAt: 1_510, prevBidId: leg1.id })
		// Only the latest leg has direct verdicts. Under the per-bid d-tag
		// scheme (ADR-0003 §4.4.1 amendment) each leg has its own replaceable
		// address so the earlier leg's verdict would normally survive on the
		// relay; the backward-propagation is retained as belt-and-braces for
		// the case where a validator only published for the latest leg.
		const verdicts = [
			buildVerdict(leg2, { validatorPubkey: V1, claim: 'won_pending_settlement' }),
			buildVerdict(leg2, { validatorPubkey: V2, claim: 'won_pending_settlement' }),
		]
		const result = computeValidatedBids({ auction, bids: [leg1, leg2], verdicts, nut7States: unspent([leg1, leg2]) })
		expect(result.validBids).toHaveLength(2)
		expect(result.canonicalWinner?.id).toBe(leg2.id)
	})

	test('stale + latest verdict copies from the same validator count once', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, createdAt: 1_505 }),
			// Same validator, newer replaceable copy — must not double-count.
			buildVerdict(bid, { validatorPubkey: V1, createdAt: 1_506 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		// quorum = 2, one validator → pending
		expect(result.canonicalWinner).toBeNull()
		expect(result.pendingBids).toHaveLength(1)
	})
})

describe('computeValidatedBids — canonical winner ordering', () => {
	test('highest amount wins; tie-break is earliest created_at (deterministic)', () => {
		const auction = buildAuction()
		const bidder2 = '9'.repeat(64)
		const bidEarly = buildBid(auction, { id: 'b'.repeat(64), amount: 5_000, createdAt: 1_400 })
		const bidLate = buildBid(auction, { id: 'c'.repeat(64), bidderPubkey: bidder2, amount: 5_000, createdAt: 1_500 })
		const mk = (bid: ParsedBidEvent, pk: string) => buildVerdict(bid, { validatorPubkey: pk, observedAt: bid.createdAt + 5 })
		const verdicts = [mk(bidEarly, V1), mk(bidEarly, V2), mk(bidLate, V1), mk(bidLate, V2)]
		const result = computeValidatedBids({
			auction,
			bids: [bidLate, bidEarly],
			verdicts,
			nut7States: unspent([bidEarly, bidLate]),
		})
		expect(result.canonicalWinner?.id).toBe(bidEarly.id)
	})
})
