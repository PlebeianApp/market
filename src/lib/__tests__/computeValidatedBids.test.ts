import { describe, expect, test } from 'bun:test'
import { computeValidatedBids, validateBidChainNut7PrePublish } from '../auction/bidValidation'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent, MinBidCurve } from '../auction/events'
import type { Nut7ProofState } from '../auction/constants'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { makeDleqKeyset as makeFixtureKeyset, makeHonestDleqProof } from '../cashu/dleqFixture'
import { fetchDleqKeysetsForBidsDetailed, verifyBidDleqWithKeysets, type DleqKeysetFetcher } from '../cashu/dleq'
import type { MintKeys } from '@cashu/cashu-ts'
import { parseBidEvent } from '../schemas/auction/bidEvent'
import type { NostrEventLike } from '../nostr/eventLike'

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

// Arbitrary epoch used by the DLEQ fixtures below. DLEQ is now unconditional,
// so this is just a stable in-window start_at for these bids (the retired
// rollout boundary no longer exists).
const DLEQ_EPOCH = 1_700_000_000

const stubRawEvent = (kind: number, pubkey: string): NostrEventLike => ({
	kind,
	pubkey,
	content: '',
	tags: [] as string[][],
	id: 'stub',
	created_at: 0,
})

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
	// DLEQ is unconditional: attach an honest proof per locked proof unless a
	// test deliberately supplies its own (including `[]`). The proof amount is
	// the leg delta the client verification path uses (`legLockedAmount` when a
	// test sets it explicitly, otherwise the bid amount).
	const dleqProofs =
		overrides.dleqProofs ?? lockSecrets.map((secret) => makeHonestDleqProof(overrides.legLockedAmount ?? overrides.amount ?? 5_000, secret))
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
		legLockedAmount: overrides.legLockedAmount ?? overrides.amount ?? 5_000,
		dleqProofs,
		createdForEndAt: auction.endAt,
		bidNonce: 'test-bid-nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
		prevBidId: overrides.prevBidId,
	}
}

const parseProductionBid = (
	auction: ParsedAuctionEvent,
	input: {
		id: string
		amount: number
		expectedLegAmount: number
		createdAt: number
		nonce: string
		prevBidId?: string
	},
): ParsedBidEvent => {
	const locktime = auction.maxEndAt + auction.settlementGrace
	const secret = buildLockSecret(COMPRESSED_PK, locktime, REFUND_PK, input.nonce)
	const dleqProof = makeHonestDleqProof(input.expectedLegAmount, secret)
	const event: NostrEventLike = {
		id: input.id,
		kind: 1023,
		pubkey: BIDDER_PK,
		created_at: input.createdAt,
		content: '',
		tags: [
			['e', auction.rootEventId],
			['a', auction.coordinate],
			['p', auction.sellerPubkey],
			['amount', String(input.amount), 'SAT'],
			['currency', 'SAT'],
			['mint', 'https://mint.test'],
			['locktime', String(locktime)],
			['refund_pubkey', REFUND_PK],
			['child_pubkey', COMPRESSED_PK],
			['lock_secret', secret],
			['proof_y', hashToCurveHexFromString(secret)],
			['dleq_proof', JSON.stringify(dleqProof)],
			['created_for_end_at', String(auction.endAt)],
			['bid_nonce', input.nonce],
			['key_scheme', 'hd_p2pk'],
			['status', 'locked'],
			...(input.prevBidId ? [['prev_bid', input.prevBidId]] : []),
		],
	}
	const parsed = parseBidEvent(event)
	if (!parsed.ok) throw new Error(`production bid fixture failed to parse: ${JSON.stringify(parsed.error)}`)
	return parsed.value
}

const buildProductionAdditiveChain = (auction: ParsedAuctionEvent): [ParsedBidEvent, ParsedBidEvent] => {
	const root = parseProductionBid(auction, {
		id: 'a'.repeat(64),
		amount: 5_000,
		expectedLegAmount: 5_000,
		createdAt: 1_500,
		nonce: 'production-root',
	})
	const child = parseProductionBid(auction, {
		id: 'b'.repeat(64),
		amount: 5_300,
		expectedLegAmount: 300,
		createdAt: 1_510,
		nonce: 'production-child',
		prevBidId: root.id,
	})
	return [root, child]
}

/**
 * Keyset evidence for `computeValidatedBids`'s DLEQ crypto step, covering
 * every proof amount committed by `bids` and keyed `${mint}:${proof.id}`.
 * One keyset holding the union of amounts is sufficient — the fixture proofs
 * all resolve their keyset by `(mint, id)`.
 */
const dleqKeysetsFor = (...bids: ParsedBidEvent[]): Map<string, MintKeys> => {
	const amounts = new Set<number>()
	for (const bid of bids) for (const proof of bid.dleqProofs ?? []) amounts.add(proof.amount)
	const keyset = makeFixtureKeyset(Array.from(amounts))
	const map = new Map<string, MintKeys>()
	for (const bid of bids) for (const proof of bid.dleqProofs ?? []) map.set(`${bid.mint}:${proof.id}`, keyset)
	return map
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
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
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
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
		expect(result.canonicalWinner?.id).toBe(bid.id)
	})

	test('ALL verdicts poisoned → bid stays pending (never invalid)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: auction.maxEndAt + 10_000 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: auction.maxEndAt + 20_000 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
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
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
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
	test('quorum-confirmed bid WITHOUT NUT-7 evidence is valid (NUT-7 is fraud-detection evidence, not a validity gate)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, dleqKeysets: dleqKeysetsFor(bid) })
		// ADR-0004: NUT-7 is client-side evidence for pre-settlement fraud
		// detection, not a validity gate. A quorum-confirmed bid with no
		// NUT-7 evidence is valid — the validators already asserted
		// structural validity. Missing NUT-7 does not block the bid.
		expect(result.canonicalWinner?.id).toBe(bid.id)
		expect(result.validBids).toHaveLength(1)
		expect(result.pendingBids).toHaveLength(0)
	})

	test('mint-reported unspent confirms; canonical winner derived', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
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
			dleqKeysets: dleqKeysetsFor(bid),
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
			dleqKeysets: dleqKeysetsFor(bid),
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
			dleqKeysets: dleqKeysetsFor(realWinner, fakeHighBid),
		})
		expect(result.canonicalWinner?.id).toBe(realWinner.id)
		expect(result.invalidBids).toContainEqual(expect.objectContaining({ id: fakeHighBid.id }))
	})

	test('pending NUT-7 from the mint keeps the bid valid (NUT-7 is fraud-detection, not a validity gate)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: new Map([[bid.id, 'pending' as Nut7ProofState]]),
			dleqKeysets: dleqKeysetsFor(bid),
		})
		// A pending NUT-7 state means the mint hasn't confirmed yet. The bid
		// is quorum-confirmed → valid. Only `spent` pre-settlement invalidates.
		expect(result.canonicalWinner?.id).toBe(bid.id)
		expect(result.validBids).toHaveLength(1)
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
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
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
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
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
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
		// Same anti-poisoning as confirms: the screened condemn verdicts drop
		// below quorum, so the bid stays pending rather than invalid.
		expect(result.canonicalWinner).toBeNull()
		expect(result.invalidBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(1)
	})
})

describe('computeValidatedBids — rebid collateral-chain authority', () => {
	test('same-author poison parent cannot subsidize a directly confirmed 1-sat child', () => {
		const auction = buildAuction()
		const parent = buildBid(auction, {
			id: '7'.repeat(64),
			amount: 100_000,
			legLockedAmount: 1,
		})
		const child = buildBid(auction, {
			id: '8'.repeat(64),
			amount: 100_001,
			createdAt: parent.createdAt + 10,
			prevBidId: parent.id,
			legLockedAmount: 1,
		})
		const verdicts = [buildVerdict(child, { validatorPubkey: V1 }), buildVerdict(child, { validatorPubkey: V2 })]
		const dleqKeysets = dleqKeysetsFor(parent, child)
		const childProofs = child.dleqProofs!.map((proof, index) => ({ ...proof, secret: child.lockSecrets[index]! }))

		// Non-vacuous: the child's one sat is genuinely DLEQ-backed and its own
		// direct verdicts meet quorum. It fails only because the untrusted parent
		// cannot turn that one sat into 100001 sats of cumulative authority.
		expect(child.dleqProofs?.reduce((sum, proof) => sum + proof.amount, 0)).toBe(1)
		expect(verifyBidDleqWithKeysets({ mint: child.mint, legDelta: 1, proofs: childProofs }, dleqKeysets).ok).toBe(true)
		expect(new Set(verdicts.map((verdict) => verdict.validatorPubkey)).size).toBe(auction.auditorQuorum)

		const result = computeValidatedBids({
			auction,
			bids: [parent, child],
			verdicts,
			nut7States: unspent([parent, child]),
			dleqKeysets,
		})

		expect(result.validBids.map((bid) => bid.id)).not.toContain(child.id)
		expect(result.invalidBids.map((bid) => bid.id)).toContain(child.id)
		expect(result.canonicalWinner).toBeNull()
	})

	test('legitimate additive chain remains authoritative with direct child quorum only', () => {
		const auction = buildAuction()
		const leg1 = buildBid(auction, { id: 'a'.repeat(63) + '1', amount: 5_000, createdAt: 1_500, legLockedAmount: 5_000 })
		const leg2 = buildBid(auction, {
			id: 'a'.repeat(63) + '2',
			amount: 5_300,
			createdAt: 1_510,
			prevBidId: leg1.id,
			legLockedAmount: 300,
		})
		const verdicts = [
			buildVerdict(leg2, { validatorPubkey: V1, claim: 'won_pending_settlement' }),
			buildVerdict(leg2, { validatorPubkey: V2, claim: 'won_pending_settlement' }),
		]
		const result = computeValidatedBids({
			auction,
			bids: [leg1, leg2],
			verdicts,
			nut7States: unspent([leg1, leg2]),
			dleqKeysets: dleqKeysetsFor(leg1, leg2),
		})
		expect(result.validBids.map((bid) => bid.id)).toEqual([leg2.id])
		expect(result.pendingBids.map((bid) => bid.id)).toContain(leg1.id)
		expect(result.canonicalWinner?.id).toBe(leg2.id)
		expect(leg1.dleqProofs?.reduce((sum, proof) => sum + proof.amount, 0)).toBe(5_000)
		expect(leg2.dleqProofs?.reduce((sum, proof) => sum + proof.amount, 0)).toBe(300)
	})

	test('production-parsed 5000 + 300 chain exposes immutable trusted leg amounts without synthesizing parent quorum', () => {
		const auction = buildAuction()
		const [root, child] = buildProductionAdditiveChain(auction)
		const rootBefore = JSON.stringify(root)
		const childBefore = JSON.stringify(child)
		const verdicts = [
			buildVerdict(child, { validatorPubkey: V1, claim: 'won_pending_settlement' }),
			buildVerdict(child, { validatorPubkey: V2, claim: 'won_pending_settlement' }),
		]

		// The production parser initializes the child's placeholder from its
		// cumulative amount. Economic authority must not depend on rewriting it.
		expect(child.legLockedAmount).toBe(5_300)
		const result = computeValidatedBids({
			auction,
			bids: [root, child],
			verdicts,
			nut7States: unspent([root, child]),
			dleqKeysets: dleqKeysetsFor(root, child),
		})

		expect(result.classified.find((entry) => entry.bid.id === root.id)?.classification).toBe('pending')
		expect(result.validBids.map((bid) => bid.id)).toEqual([child.id])
		expect(result.canonicalWinner?.id).toBe(child.id)
		expect(result.canonicalWinner?.amount).toBe(5_300)
		expect(result.trustedCollateralChains?.get(child.id)?.map((leg) => [leg.bid.id, leg.expectedAmount])).toEqual([
			[root.id, 5_000],
			[child.id, 300],
		])
		expect(JSON.stringify(root)).toBe(rootBefore)
		expect(JSON.stringify(child)).toBe(childBefore)
		expect(child.legLockedAmount).toBe(5_300)
	})

	test('spent ancestor cannot contribute pre-settlement collateral credit', () => {
		const auction = buildAuction()
		const [root, child] = buildProductionAdditiveChain(auction)
		const verdicts = [buildVerdict(child, { validatorPubkey: V1 }), buildVerdict(child, { validatorPubkey: V2 })]
		const result = computeValidatedBids({
			auction,
			bids: [root, child],
			verdicts,
			nut7States: new Map<string, Nut7ProofState>([
				[root.id, 'spent'],
				[child.id, 'unspent'],
			]),
			dleqKeysets: dleqKeysetsFor(root, child),
		})

		expect(result.classified.find((entry) => entry.bid.id === child.id)?.classification).toBe('invalid')
		expect(result.invalidBids.map((bid) => bid.id)).toContain(child.id)
		expect(result.validBids.map((bid) => bid.id)).not.toContain(child.id)
		expect(result.canonicalWinner).toBeNull()
		expect(result.trustedCollateralChains?.has(child.id)).toBe(false)
	})

	test('post-settlement spent exception is scoped to every exact credited leg', () => {
		const auction = buildAuction()
		const [root, child] = buildProductionAdditiveChain(auction)
		const verdicts = [buildVerdict(child, { validatorPubkey: V1 }), buildVerdict(child, { validatorPubkey: V2 })]
		const spent = new Map<string, Nut7ProofState>([
			[root.id, 'spent'],
			[child.id, 'spent'],
		])
		const accepted = computeValidatedBids({
			auction,
			bids: [root, child],
			verdicts,
			nut7States: spent,
			postSettlement: true,
			settledBidIds: new Set([root.id, child.id]),
			dleqKeysets: dleqKeysetsFor(root, child),
		})
		expect(accepted.canonicalWinner?.id).toBe(child.id)
		expect(accepted.validBids.map((bid) => bid.id)).toEqual([child.id])

		const missingAncestorRecord = computeValidatedBids({
			auction,
			bids: [root, child],
			verdicts,
			nut7States: spent,
			postSettlement: true,
			settledBidIds: new Set([child.id]),
			dleqKeysets: dleqKeysetsFor(root, child),
		})
		expect(missingAncestorRecord.classified.find((entry) => entry.bid.id === child.id)?.classification).toBe('invalid')
		expect(missingAncestorRecord.invalidBids.map((bid) => bid.id)).toContain(child.id)
		expect(missingAncestorRecord.canonicalWinner).toBeNull()
	})

	test('trusted collateral chain allows exactly 256 credited legs and rejects 257', () => {
		const auction = buildAuction()
		const chain: ParsedBidEvent[] = []
		for (let index = 0; index < 257; index += 1) {
			chain.push(
				buildBid(auction, {
					id: (index + 1).toString(16).padStart(64, '0'),
					amount: 1_000 + index,
					legLockedAmount: index === 0 ? 1_000 : 1,
					prevBidId: index === 0 ? undefined : chain[index - 1]?.id,
				}),
			)
		}
		const run = (bids: ParsedBidEvent[]) => {
			const candidate = bids[bids.length - 1]!
			return computeValidatedBids({
				auction,
				bids,
				verdicts: [buildVerdict(candidate, { validatorPubkey: V1 }), buildVerdict(candidate, { validatorPubkey: V2 })],
				nut7States: unspent(bids),
				dleqKeysets: dleqKeysetsFor(...bids),
			})
		}

		const atLimit = run(chain.slice(0, 256))
		expect(atLimit.canonicalWinner?.id).toBe(chain[255]?.id)
		expect(atLimit.trustedCollateralChains?.get(chain[255]!.id)).toHaveLength(256)

		const overLimit = run(chain)
		expect(overLimit.invalidBids.map((bid) => bid.id)).toContain(chain[256]?.id)
		expect(overLimit.canonicalWinner).toBeNull()
	})

	test('trusted collateral derivation is invariant to input-array permutation', () => {
		const auction = buildAuction()
		const [root, child] = buildProductionAdditiveChain(auction)
		const verdicts = [buildVerdict(child, { validatorPubkey: V1 }), buildVerdict(child, { validatorPubkey: V2 })]
		const input = {
			auction,
			verdicts,
			nut7States: unspent([root, child]),
			dleqKeysets: dleqKeysetsFor(root, child),
		}
		const first = computeValidatedBids({ ...input, bids: [root, child] })
		const second = computeValidatedBids({ ...input, bids: [child, root] })
		const summarize = (result: ReturnType<typeof computeValidatedBids>) => ({
			winner: result.canonicalWinner?.id,
			valid: result.validBids.map((bid) => bid.id).sort(),
			chain: result.trustedCollateralChains?.get(child.id)?.map((leg) => [leg.bid.id, leg.expectedAmount]),
		})
		expect(summarize(second)).toEqual(summarize(first))
	})

	test('child verdicts remain bound to the child and do not synthesize ancestor quorum', () => {
		const auction = buildAuction()
		const parent = buildBid(auction, { id: '3'.repeat(64), amount: 5_000, legLockedAmount: 5_000 })
		const child = buildBid(auction, {
			id: '4'.repeat(64),
			amount: 5_300,
			createdAt: parent.createdAt + 10,
			prevBidId: parent.id,
			legLockedAmount: 300,
		})
		const verdicts = [buildVerdict(child, { validatorPubkey: V1 }), buildVerdict(child, { validatorPubkey: V2 })]

		expect(verdicts.every((verdict) => verdict.bidEventId === child.id)).toBe(true)
		const result = computeValidatedBids({
			auction,
			bids: [parent, child],
			verdicts,
			nut7States: unspent([parent, child]),
			dleqKeysets: dleqKeysetsFor(parent, child),
		})

		expect(result.classified.find((entry) => entry.bid.id === parent.id)?.classification).toBe('pending')
		expect(result.validBids.map((bid) => bid.id)).not.toContain(parent.id)
		expect(verdicts.every((verdict) => verdict.bidEventId === child.id)).toBe(true)
	})

	test('cross-author parent cannot contribute monetary credit to an attacker child', () => {
		const auction = buildAuction()
		const victim = buildBid(auction, {
			id: '5'.repeat(64),
			bidderPubkey: '1'.repeat(64),
			amount: 100_000,
			legLockedAmount: 100_000,
		})
		const attacker = buildBid(auction, {
			id: '6'.repeat(64),
			bidderPubkey: '2'.repeat(64),
			amount: 100_001,
			createdAt: victim.createdAt + 10,
			prevBidId: victim.id,
			legLockedAmount: 1,
		})
		const verdicts = [buildVerdict(attacker, { validatorPubkey: V1 }), buildVerdict(attacker, { validatorPubkey: V2 })]

		const result = computeValidatedBids({
			auction,
			bids: [victim, attacker],
			verdicts,
			nut7States: unspent([victim, attacker]),
			dleqKeysets: dleqKeysetsFor(victim, attacker),
		})

		expect(result.validBids.map((bid) => bid.id)).not.toContain(attacker.id)
		expect(result.invalidBids.map((bid) => bid.id)).toContain(attacker.id)
		expect(result.canonicalWinner).toBeNull()
	})

	test('missing ancestor keyset evidence keeps the directly confirmed child pending', () => {
		const auction = buildAuction()
		const locktime = auction.maxEndAt + auction.settlementGrace
		const parentKeysetId = '00aaaaaaaaaaaaaa'
		const childKeysetId = '00bbbbbbbbbbbbbb'
		const parentSecret = buildLockSecret(COMPRESSED_PK, locktime, REFUND_PK, 'missing-ancestor-keyset')
		const childSecret = buildLockSecret(COMPRESSED_PK, locktime, REFUND_PK, 'available-child-keyset')
		const parent = buildBid(auction, {
			id: '1'.repeat(64),
			amount: 5_000,
			lockSecrets: [parentSecret],
			dleqProofs: [makeHonestDleqProof(5_000, parentSecret, { keysetId: parentKeysetId })],
		})
		const child = buildBid(auction, {
			id: '2'.repeat(64),
			amount: 5_300,
			createdAt: parent.createdAt + 10,
			prevBidId: parent.id,
			legLockedAmount: 300,
			lockSecrets: [childSecret],
			dleqProofs: [makeHonestDleqProof(300, childSecret, { keysetId: childKeysetId })],
		})
		const verdicts = [buildVerdict(child, { validatorPubkey: V1 }), buildVerdict(child, { validatorPubkey: V2 })]
		const childKeyset = makeFixtureKeyset([300], { keysetId: childKeysetId })

		const result = computeValidatedBids({
			auction,
			bids: [parent, child],
			verdicts,
			nut7States: unspent([parent, child]),
			dleqKeysets: new Map([[`${child.mint}:${childKeysetId}`, childKeyset]]),
		})

		expect(result.validBids.map((bid) => bid.id)).not.toContain(child.id)
		expect(result.pendingBids.map((bid) => bid.id)).toContain(child.id)
		expect(result.classified.find((entry) => entry.bid.id === child.id)?.pendingReason).toBe('dleq_evidence_unavailable')
		expect(result.canonicalWinner).toBeNull()
	})

	test('cyclic chain fails closed without using either parent amount as collateral credit', () => {
		const auction = buildAuction()
		const first = buildBid(auction, {
			id: '9'.repeat(64),
			amount: 5_000,
			legLockedAmount: 300,
		})
		const second = buildBid(auction, {
			id: '0'.repeat(64),
			amount: 5_300,
			createdAt: first.createdAt + 10,
			prevBidId: first.id,
			legLockedAmount: 300,
		})
		first.prevBidId = second.id
		const verdicts = [buildVerdict(second, { validatorPubkey: V1 }), buildVerdict(second, { validatorPubkey: V2 })]

		const result = computeValidatedBids({
			auction,
			bids: [first, second],
			verdicts,
			nut7States: unspent([first, second]),
			dleqKeysets: dleqKeysetsFor(first, second),
		})

		expect(result.validBids.map((bid) => bid.id)).not.toContain(second.id)
		expect(result.invalidBids.map((bid) => bid.id)).toContain(second.id)
		expect(result.canonicalWinner).toBeNull()
	})

	test('stale + latest verdict copies from the same validator count once', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, createdAt: 1_505 }),
			// Same validator, newer replaceable copy — must not double-count.
			buildVerdict(bid, { validatorPubkey: V1, createdAt: 1_506 }),
		]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]), dleqKeysets: dleqKeysetsFor(bid) })
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
			dleqKeysets: dleqKeysetsFor(bidEarly, bidLate),
		})
		expect(result.canonicalWinner?.id).toBe(bidEarly.id)
	})
})

describe('validateBidChainNut7PrePublish — pre-publish NUT-7 gate', () => {
	const auction = buildAuction()
	const leg1 = buildBid(auction, { id: 'a'.repeat(63) + '1', amount: 1_000 })
	const leg2 = buildBid(auction, { id: 'a'.repeat(63) + '2', amount: 1_200, prevBidId: leg1.id })
	const chain = [leg1, leg2]

	test('all unspent → null (safe to publish)', () => {
		const nut7 = new Map<string, Nut7ProofState>([
			[leg1.id, 'unspent'],
			[leg2.id, 'unspent'],
		])
		expect(validateBidChainNut7PrePublish(chain, nut7, 100)).toBeNull()
	})

	test('spent pre-locktime → null (already redeemed by this seller, resumable)', () => {
		// After a crash between legs, leg 1 is all-spent (seller redeemed it).
		// Pre-locktime, only the seller's child privkey can spend, so
		// all-spent = already redeemed → skip, not fraud.
		const nut7 = new Map<string, Nut7ProofState>([
			[leg1.id, 'spent'],
			[leg2.id, 'unspent'],
		])
		// now (100) < locktime (maxEndAt + settlementGrace = 2_100 + 3_600 = 5_700)
		expect(validateBidChainNut7PrePublish(chain, nut7, 100)).toBeNull()
	})

	test('spent post-locktime → error (ambiguous: could be bidder refund)', () => {
		const nut7 = new Map<string, Nut7ProofState>([
			[leg1.id, 'spent'],
			[leg2.id, 'unspent'],
		])
		// now (6_000) > locktime (5_700) → spent is ambiguous
		const err = validateBidChainNut7PrePublish(chain, nut7, 6_000)
		expect(err).not.toBeNull()
		expect(err).toMatch(/ambiguous|refund|locktime/i)
	})

	test('missing NUT-7 for any leg → error (cannot verify)', () => {
		const nut7 = new Map<string, Nut7ProofState>([
			[leg1.id, 'unspent'],
			// leg2 missing
		])
		const err = validateBidChainNut7PrePublish(chain, nut7, 100)
		expect(err).not.toBeNull()
		expect(err).toMatch(/no confirmed NUT-7 state/)
		expect(err).toMatch(leg2.id.slice(0, 8))
	})

	test('unknown NUT-7 → error (cannot verify)', () => {
		const nut7 = new Map<string, Nut7ProofState>([
			[leg1.id, 'unknown'],
			[leg2.id, 'unspent'],
		])
		const err = validateBidChainNut7PrePublish(chain, nut7, 100)
		expect(err).not.toBeNull()
		expect(err).toMatch(/no confirmed NUT-7 state/)
	})

	test('pending NUT-7 → error (in-flight swap, retry — ADR-0004 §4.5)', () => {
		// PENDING is an in-flight swap, possibly the bidder's own spend.
		// A leg can flip to SPENT between the gate and the seller's swap.
		// Treat like unknown (retry), not as publishable.
		const nut7 = new Map<string, Nut7ProofState>([
			[leg1.id, 'pending'],
			[leg2.id, 'unspent'],
		])
		const err = validateBidChainNut7PrePublish(chain, nut7, 100)
		expect(err).not.toBeNull()
		expect(err).toMatch(/pending|retry|in-flight/i)
	})

	test('missing (mint omitted proof) → error', () => {
		const nut7 = new Map<string, Nut7ProofState>([
			[leg1.id, 'missing'],
			[leg2.id, 'unspent'],
		])
		const err = validateBidChainNut7PrePublish(chain, nut7, 100)
		expect(err).not.toBeNull()
		expect(err).toMatch(/omitted/)
	})
})

// =============================================================================
// M5 — cross-bid duplicate-proof detection extended to DLEQ mint signatures C
// =============================================================================

describe('computeValidatedBids — M5 duplicate dleq_proof C', () => {
	test("a bid reusing another bid's dleq_proof C is marked invalid (fabricated collateral)", () => {
		const auction = buildAuction()
		// bid1 holds an honest proof; bid2 (distinct lock_secret, same proof
		// object → same C) republishes it. bid1 must crypto-verify, so its own
		// proof has to be honest; bid2 is condemned by the C-dedup before crypto.
		const bid1 = buildBid(auction)
		const bid2 = buildBid(auction, { dleqProofs: [bid1.dleqProofs![0]!] })
		// Prove the fixture's two bids differ on secret/Y and share ONLY the
		// DLEQ `C`, so the C-dedup is the sole discriminator (not the legacy
		// secret/Y dedup) and this test cannot pass vacuously.
		expect(bid1.lockSecrets).not.toEqual(bid2.lockSecrets)
		expect(bid1.proofYs).not.toEqual(bid2.proofYs)
		expect(bid1.dleqProofs?.[0]?.C).toBe(bid2.dleqProofs?.[0]?.C)
		const verdicts = [
			buildVerdict(bid1, { validatorPubkey: V1 }),
			buildVerdict(bid1, { validatorPubkey: V2, observedAt: bid1.createdAt + 30 }),
			buildVerdict(bid2, { validatorPubkey: V1 }),
			buildVerdict(bid2, { validatorPubkey: V2, observedAt: bid2.createdAt + 30 }),
		]

		const result = computeValidatedBids({
			auction,
			bids: [bid1, bid2],
			verdicts,
			nut7States: unspent([bid1, bid2]),
			dleqKeysets: dleqKeysetsFor(bid1),
		})

		// Earliest observed bid keeps the C; the reuser is invalid.
		expect(result.validBids.map((b) => b.id)).toEqual([bid1.id])
		expect(result.invalidBids.map((b) => b.id)).toContain(bid2.id)
	})

	test('two bids with distinct dleq_proof C values both stay valid', () => {
		const auction = buildAuction()
		const bid1 = buildBid(auction)
		const bid2 = buildBid(auction, { amount: 6_000 })
		expect(bid1.dleqProofs?.[0]?.C).not.toBe(bid2.dleqProofs?.[0]?.C)
		const verdicts = [
			buildVerdict(bid1, { validatorPubkey: V1 }),
			buildVerdict(bid1, { validatorPubkey: V2, observedAt: bid1.createdAt + 30 }),
			buildVerdict(bid2, { validatorPubkey: V1 }),
			buildVerdict(bid2, { validatorPubkey: V2, observedAt: bid2.createdAt + 30 }),
		]

		const result = computeValidatedBids({
			auction,
			bids: [bid1, bid2],
			verdicts,
			nut7States: unspent([bid1, bid2]),
			dleqKeysets: dleqKeysetsFor(bid1, bid2),
		})

		expect(result.invalidBids).toHaveLength(0)
		expect(result.validBids).toHaveLength(2)
	})
})

// =============================================================================
// DLEQ crypto verification — ADR-0011 C1: dleq_invalid when verifyBidDleq fails
// =============================================================================

const GENERATOR_HEX = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const TWO_G_HEX = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'

const makeDleqKeyset = (amounts: number[]): MintKeys => {
	const keys: Record<number, string> = {}
	for (const amt of amounts) {
		keys[amt] = amt === 1 ? GENERATOR_HEX : TWO_G_HEX
	}
	return { id: '00deadbeef', unit: 'sat', keys }
}

const dleqKeyset1 = makeDleqKeyset([100])

// Garbage DLEQ — will NEVER pass hasValidDleq (real crypto verification fails)
const garbageDleq = { id: '00deadbeef', amount: 100, C: GENERATOR_HEX, e: '00', s: '00', r: 'ff' }

const buildPostRolloutAuction = (overrides: Partial<ParsedAuctionEvent> = {}): ParsedAuctionEvent =>
	buildAuction({
		...overrides,
		startAt: DLEQ_EPOCH,
		endAt: DLEQ_EPOCH + 1_000,
		maxEndAt: DLEQ_EPOCH + 1_100,
	})

describe('computeValidatedBids — DLEQ crypto verification (ADR-0011 C1)', () => {
	test('dleq_invalid: post-rollout bid with garbage DLEQ fails crypto verification and is invalid', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: DLEQ_EPOCH + 500,
			dleqProofs: [garbageDleq],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		const dleqKeysets = new Map([['https://mint.test:00deadbeef', dleqKeyset1]])

		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
			dleqKeysets,
		})

		expect(result.canonicalWinner).toBeNull()
		expect(result.invalidBids).toHaveLength(1)
		expect(result.validBids).toHaveLength(0)
		// The invalidation is DLEQ-specific, not a NUT-7 or structural failure.
		const invalidClassified = result.classified.find((cl) => cl.bid.id === bid.id)
		expect(invalidClassified?.classification).toBe('invalid')
		expect(invalidClassified?.invalidReason).toBe('dleq_invalid')
	})

	test('dleq_invalid: DLEQ sum-check mismatch (proof amount != legDelta) invalidates', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			amount: 5_000,
			createdAt: DLEQ_EPOCH + 500,
			dleqProofs: [{ id: '00deadbeef', amount: 100, C: GENERATOR_HEX, e: 'aa', s: 'bb', r: 'cc' }],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		const dleqKeysets = new Map([['https://mint.test:00deadbeef', dleqKeyset1]])

		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
			dleqKeysets,
		})

		expect(result.canonicalWinner).toBeNull()
		expect(result.invalidBids).toHaveLength(1)
		expect(result.validBids).toHaveLength(0)
		const invalidClassified = result.classified.find((cl) => cl.bid.id === bid.id)
		expect(invalidClassified?.classification).toBe('invalid')
		expect(invalidClassified?.invalidReason).toBe('dleq_invalid')
	})

	test('no grandfathered exemption: a bid with no dleq_proof is dleq_invalid (DLEQ is unconditional)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { dleqProofs: [] })
		const verdicts = [buildVerdict(bid, { validatorPubkey: V1 }), buildVerdict(bid, { validatorPubkey: V2 })]
		const result = computeValidatedBids({ auction, bids: [bid], verdicts, nut7States: unspent([bid]) })
		expect(result.canonicalWinner).toBeNull()
		expect(result.validBids).toHaveLength(0)
		expect(result.invalidBids.map((b) => b.id)).toEqual([bid.id])
	})

	test('post-rollout bid without dleqKeysets is PENDING (DLEQ evidence not yet gathered, non-authoritative)', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: DLEQ_EPOCH + 500,
			dleqProofs: [garbageDleq],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]

		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
		})

		// Unavailable DLEQ evidence is non-authoritative: the bid must NOT be
		// treated as valid (it cannot be crypto-verified), but it is also not
		// condemned — it is pending until the keyset is gathered.
		expect(result.canonicalWinner).toBeNull()
		expect(result.validBids).toHaveLength(0)
		expect(result.invalidBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(1)
		const pendingClassified = result.classified.find((cl) => cl.bid.id === bid.id)
		expect(pendingClassified?.classification).toBe('pending')
	})

	test('post-rollout bid whose keyset is not in a SUPPLIED dleqKeysets map is PENDING (evidence unavailable, not fraud)', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: DLEQ_EPOCH + 500,
			dleqProofs: [garbageDleq],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		// The bid declares keyset `00deadbeef` but the fetched map only holds
		// `other.mint` keysets — exactly what `fetchDleqKeysetsForBids` yields
		// when the keyset fetch for THIS (mint, keyset) pair failed. PR #1280
		// round 3: an absent entry in a supplied map means EVIDENCE
		// UNAVAILABLE (temporary mint/network failure), not fraud — the bid
		// is pending (ADR-0011 Decision 6a), never valid: a malicious bidder
		// pointing dleqProofs[0].id at an unfetched id still cannot make the
		// bid win, since pending bids are excluded from validBids/winner.
		const otherKeysets = new Map([['https://other.mint:00deadbeef', dleqKeyset1]])

		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
			dleqKeysets: otherKeysets,
		})

		expect(result.canonicalWinner).toBeNull()
		expect(result.validBids).toHaveLength(0)
		expect(result.invalidBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(1)
		const pendingClassified = result.classified.find((cl) => cl.bid.id === bid.id)
		expect(pendingClassified?.classification).toBe('pending')
		expect(pendingClassified?.invalidReason).toBeUndefined()
	})

	test('post-rollout bid whose absent keyset is reported TERMINAL (dleqUnknownKeysets) is INVALID, not pending (ADR-0011 R3)', () => {
		// The counterpart to the test above: when acquisition learned the mint
		// ANSWERED and does not advertise this keyset id, the proof names
		// fabricated/foreign collateral — `dleq_invalid`, which does NOT block
		// reserve_not_met. A transient miss (unknownKeysets absent) stays pending.
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: DLEQ_EPOCH + 500,
			dleqProofs: [garbageDleq],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]

		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
			dleqKeysets: new Map(),
			dleqUnknownKeysets: new Set([`${bid.mint}:${garbageDleq.id}`]),
		})

		expect(result.validBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(0)
		expect(result.invalidBids).toHaveLength(1)
		const classified = result.classified.find((cl) => cl.bid.id === bid.id)
		expect(classified?.classification).toBe('invalid')
		expect(classified?.invalidReason).toBe('dleq_invalid')
	})

	test('multi-proof leg with one absent keyset is PENDING even when another proof has garbage DLEQ (no condemning on incomplete evidence)', () => {
		const auction = buildPostRolloutAuction()
		// Proof 0: garbage DLEQ under a keyset that IS in the map (would be
		// dleq_invalid on its own). Proof 1: keyset never fetched (absent).
		// Evidence for the leg as a whole is INCOMPLETE, so the bid is
		// pending — dleq_invalid is reserved for positive verification
		// failure over COMPLETE evidence.
		const locktime = auction.maxEndAt + auction.settlementGrace
		const secret0 = buildLockSecret(COMPRESSED_PK, locktime, REFUND_PK, 'mixed-evidence-0')
		const secret1 = buildLockSecret(COMPRESSED_PK, locktime, REFUND_PK, 'mixed-evidence-1')
		const bid = buildBid(auction, {
			createdAt: DLEQ_EPOCH + 500,
			lockSecrets: [secret0, secret1],
			// Proof amounts sum to the default 5_000 leg so the ONLY thing
			// blocking verification is the absent keyset. Distinct C values —
			// M5 rejects duplicate C within a bid as fabricated collateral.
			dleqProofs: [garbageDleq, { id: '00feedface', amount: 4_900, C: TWO_G_HEX, e: 'aa', s: 'bb', r: 'cc' }],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		const partialKeysets = new Map([['https://mint.test:00deadbeef', dleqKeyset1]])

		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
			dleqKeysets: partialKeysets,
		})

		expect(result.validBids).toHaveLength(0)
		expect(result.invalidBids).toHaveLength(0)
		expect(result.pendingBids).toHaveLength(1)
		const pendingClassified = result.classified.find((cl) => cl.bid.id === bid.id)
		expect(pendingClassified?.classification).toBe('pending')
	})

	test('post-rollout bid with no dleqProofs is invalid via structural check (validateBid Step 3.5)', () => {
		const auction = buildPostRolloutAuction()
		const bid = buildBid(auction, {
			createdAt: DLEQ_EPOCH + 500,
			dleqProofs: [],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		// No dleqProofs and no dleqKeysets — the bid cannot be crypto-verified,
		// but the structural presence check (validateBid Step 3.5) already
		// rejects it pre-DLEQ as dleq_invalid.
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
		})

		expect(result.canonicalWinner).toBeNull()
		expect(result.invalidBids).toHaveLength(1)
		expect(result.validBids).toHaveLength(0)
	})

	test('multi-keyset rebid leg: proofs spanning two keysets are NOT dleq_invalid (both keysets supplied)', () => {
		const auction = buildPostRolloutAuction()
		// A mint keyset rotation: this leg's proofs were minted against two
		// cryptographically distinct keysets (distinct base keys), so proof[1]
		// does NOT verify under proof[0]'s keyset. Pre-fix the consumer resolved
		// only `dleqProofs[0].id` and verified every proof against that single
		// keyset → false `dleq_invalid`. Post-fix each proof resolves its OWN
		// keyset via the supplied `${mint}:${keysetId}` map.
		const ksAId = '00aaaaaaaaaaaaaa'
		const ksBId = '00bbbbbbbbbbbbbb'
		const ksA = makeFixtureKeyset([500], { keysetId: ksAId, basePrivKey: 500 })
		const ksB = makeFixtureKeyset([500], { keysetId: ksBId, basePrivKey: 900 })
		const locktime = auction.maxEndAt + auction.settlementGrace
		const secretA = buildLockSecret(COMPRESSED_PK, locktime, REFUND_PK, 'multi-ks-nonce-a')
		const secretB = buildLockSecret(COMPRESSED_PK, locktime, REFUND_PK, 'multi-ks-nonce-b')
		const proofA = makeHonestDleqProof(500, secretA, { keysetId: ksAId, basePrivKey: 500 })
		const proofB = makeHonestDleqProof(500, secretB, { keysetId: ksBId, basePrivKey: 900 })
		const bid = buildBid(auction, {
			amount: 1_000,
			createdAt: DLEQ_EPOCH + 500,
			lockSecrets: [secretA, secretB],
			dleqProofs: [proofA, proofB],
		})
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1, observedAt: bid.createdAt + 5 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		const dleqKeysets = new Map([
			[`https://mint.test:${ksAId}`, ksA],
			[`https://mint.test:${ksBId}`, ksB],
		])

		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
			dleqKeysets,
		})

		const classified = result.classified.find((cl) => cl.bid.id === bid.id)
		expect(classified?.classification).toBe('valid')
		expect(classified?.invalidReason).toBeUndefined()
		expect(result.invalidBids).toHaveLength(0)
		expect(result.validBids).toHaveLength(1)
		expect(result.canonicalWinner?.id).toBe(bid.id)
	})
})

// =============================================================================
// M5 (A3) — collateral must be bound to ONE bidder across authors
//
// Review A3 (PR #1280 discussion_r3999446835): scoping the duplicate-collateral
// check per Nostr pubkey was insufficient. DLEQ authenticates the Cashu proof
// against the mint keyset — it says nothing about OWNERSHIP by the event author
// — and the `lock_secret` / `proof_y` / `C` values are public in whichever
// event first published them. A second author can therefore republish another
// bidder's collateral under its own (higher) amount, and both bids would be
// treated as authoritative for the same coins. These tests extend the M5
// material above (same fixtures, no duplication).
// =============================================================================

const OTHER_BIDDER_PK = '9'.repeat(64)

describe('computeValidatedBids — M5 (A3) bidder↔collateral binding across authors', () => {
	test("a DIFFERENT author republishing another bid's locked proof is invalid (collateral is bound to one bidder)", () => {
		const auction = buildAuction()
		const bid1 = buildBid(auction, { id: 'a'.repeat(64), amount: 5_000, createdAt: 1_450 })
		// bid2 republishes bid1's WHOLE locked proof (`lock_secret` and the
		// `proof_y` it hashes to are public in bid1's event) under a new author
		// and a HIGHER amount. `proof_y` cannot be forged independently: validateBid
		// binds each `proofY` to its own `lockSecret`, so a same-Y/different-secret
		// bid is already structurally invalid — the reachable cross-author attack
		// is copying the secret (and therefore the Y, and therefore the coins).
		// A distinct DLEQ C keeps the legacy C dedup from being the discriminator.
		const bid2 = buildBid(auction, {
			id: 'b'.repeat(64),
			bidderPubkey: OTHER_BIDDER_PK,
			amount: 6_000,
			createdAt: 1_600,
			lockSecrets: bid1.lockSecrets,
			// Honest for bid2's own (copied) secret and 6_000 delta, so that in
			// isolation bid2 would be a valid winner; a different amount yields a
			// different C than bid1's, keeping the C-dedup from being the cause.
			dleqProofs: [makeHonestDleqProof(6_000, bid1.lockSecrets[0]!)],
		})
		expect(bid2.bidderPubkey).not.toBe(bid1.bidderPubkey)
		expect(bid2.lockSecrets).toEqual(bid1.lockSecrets)
		expect(bid2.proofYs).toEqual(bid1.proofYs)
		expect(bid2.dleqProofs?.[0]?.C).not.toBe(bid1.dleqProofs?.[0]?.C)

		const verdicts = [
			buildVerdict(bid1, { validatorPubkey: V1 }),
			buildVerdict(bid1, { validatorPubkey: V2, observedAt: bid1.createdAt + 30 }),
			buildVerdict(bid2, { validatorPubkey: V1 }),
			buildVerdict(bid2, { validatorPubkey: V2, observedAt: bid2.createdAt + 30 }),
		]

		const both = computeValidatedBids({
			auction,
			bids: [bid1, bid2],
			verdicts,
			nut7States: unspent([bid1, bid2]),
			dleqKeysets: dleqKeysetsFor(bid1, bid2),
		})
		expect(both.invalidBids.map((b) => b.id)).toContain(bid2.id)
		expect(both.validBids.map((b) => b.id)).toEqual([bid1.id])
		expect(both.canonicalWinner?.id).toBe(bid1.id)

		// Non-vacuity — on its own, the SAME bid2 (same verdicts, same NUT-7)
		// is a valid canonical winner, so the cross-author collateral collision
		// is the sole reason it is rejected above.
		const alone = computeValidatedBids({
			auction,
			bids: [bid2],
			verdicts: verdicts.filter((v) => v.bidEventId === bid2.id),
			nut7States: unspent([bid2]),
			dleqKeysets: dleqKeysetsFor(bid2),
		})
		expect(alone.canonicalWinner?.id).toBe(bid2.id)
	})

	test("a DIFFERENT author reusing another bid's DLEQ `C` (fabricated collateral) is invalid", () => {
		const auction = buildAuction()
		const bid1 = buildBid(auction, { id: 'c'.repeat(64), amount: 5_000, createdAt: 1_450 })
		// bid2 reuses bid1's DLEQ `C` verbatim while publishing a different
		// secret/Y. A same-C proof cannot verify for two secrets, so bid2 is
		// caught by the cross-author C-dedup before crypto verification.
		const bid2 = buildBid(auction, {
			id: 'd'.repeat(64),
			bidderPubkey: OTHER_BIDDER_PK,
			amount: 6_000,
			createdAt: 1_600,
			dleqProofs: [bid1.dleqProofs![0]!],
		})
		// C is the sole shared value: distinct authors, secrets, Ys.
		expect(bid2.lockSecrets).not.toEqual(bid1.lockSecrets)
		expect(bid2.proofYs).not.toEqual(bid1.proofYs)
		expect(bid2.dleqProofs?.[0]?.C).toBe(bid1.dleqProofs?.[0]?.C)

		const verdicts = [
			buildVerdict(bid1, { validatorPubkey: V1 }),
			buildVerdict(bid1, { validatorPubkey: V2, observedAt: bid1.createdAt + 30 }),
			buildVerdict(bid2, { validatorPubkey: V1 }),
			buildVerdict(bid2, { validatorPubkey: V2, observedAt: bid2.createdAt + 30 }),
		]
		const result = computeValidatedBids({
			auction,
			bids: [bid1, bid2],
			verdicts,
			nut7States: unspent([bid1, bid2]),
			dleqKeysets: dleqKeysetsFor(bid1),
		})
		expect(result.validBids.map((b) => b.id)).toEqual([bid1.id])
		expect(result.invalidBids.map((b) => b.id)).toContain(bid2.id)
	})

	test('positive control: different authors with fully DISTINCT collateral both stay valid', () => {
		const auction = buildAuction()
		const bid1 = buildBid(auction, { id: 'e'.repeat(64), amount: 5_000, createdAt: 1_450 })
		const bid2 = buildBid(auction, {
			id: 'f'.repeat(64),
			bidderPubkey: OTHER_BIDDER_PK,
			amount: 6_000,
			createdAt: 1_600,
		})
		const verdicts = [
			buildVerdict(bid1, { validatorPubkey: V1 }),
			buildVerdict(bid1, { validatorPubkey: V2, observedAt: bid1.createdAt + 30 }),
			buildVerdict(bid2, { validatorPubkey: V1 }),
			buildVerdict(bid2, { validatorPubkey: V2, observedAt: bid2.createdAt + 30 }),
		]
		const result = computeValidatedBids({
			auction,
			bids: [bid1, bid2],
			verdicts,
			nut7States: unspent([bid1, bid2]),
			dleqKeysets: dleqKeysetsFor(bid1, bid2),
		})
		expect(result.invalidBids).toHaveLength(0)
		expect(result.validBids.map((b) => b.id).sort()).toEqual([bid1.id, bid2.id].sort())
	})
})

/**
 * R2 regression (review 2026-09-18): `publishBidderPathRelease` re-derives the
 * winner with keysets gathered by `fetchDleqKeysetsForBidsDetailed`. This pins
 * that exact composition — gather → `computeValidatedBids` → `canonicalWinner`
 * — so a DLEQ-bearing winning bid no longer falls into the "Auction winner
 * changed" branch.
 */
describe('path-release winner guard composition (ADR-0011 R2)', () => {
	test('keysets gathered by fetchDleqKeysetsForBidsDetailed yield the canonical winner', async () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const verdicts = [
			buildVerdict(bid, { validatorPubkey: V1 }),
			buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
		]
		const fetcher: DleqKeysetFetcher = async () => makeFixtureKeyset((bid.dleqProofs ?? []).map((p) => p.amount))
		const acq = await fetchDleqKeysetsForBidsDetailed([bid], auction.mints, fetcher)
		expect(acq.keysets.size).toBeGreaterThan(0)
		expect(acq.unknownKeysets.size).toBe(0)
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts,
			nut7States: unspent([bid]),
			dleqKeysets: acq.keysets,
			dleqUnknownKeysets: acq.unknownKeysets,
		})
		expect(result.canonicalWinner?.id).toBe(bid.id)
	})
})
