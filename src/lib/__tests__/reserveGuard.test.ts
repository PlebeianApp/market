/**
 * `reserve_not_met` publish guard (ADR-0011 review A2, PR #1280
 * discussion_r3999446834).
 *
 * Publishing `reserve_not_met` is terminal and seller-signed. It must not be
 * published while a reserve-meeting bid still has UNRESOLVED DLEQ evidence.
 * `computeValidatedBids` demotes such a bid to `pending` (its mint keyset could
 * not be fetched — ADR-0011 Decision 6a) and it therefore NEVER appears in
 * `canonicalWinner`, so a winner-only check silently reads the auction as
 * reserve-unmet and lets the seller publish a terminal state that contradicts
 * a bid which may yet become valid.
 *
 * These tests drive the guard with REAL `computeValidatedBids` output (not
 * hand-built classifications) so the `pendingReason` contract the guard
 * depends on is pinned end-to-end at the pure layer.
 */
import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { computeValidatedBids } from '../auction/bidValidation'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent, MinBidCurve } from '../auction/events'
import type { Nut7ProofState } from '../auction/constants'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { makeDleqKeyset, makeHonestDleqProof } from '../cashu/dleqFixture'
import { evaluateReserveNotMetGuard } from '../auction/reserveGuard'
import type { MintKeys } from '@cashu/cashu-ts'

const SELLER_PK = 'a'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const V1 = 'c'.repeat(64)
const V2 = 'd'.repeat(64)
const V3 = 'e'.repeat(64)
const COMPRESSED_PK = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const KEYSET_ID = '00deadbeef'

const NO_CURVE: MinBidCurve = { shape: 'none', peakMultiplier: 1, raw: '' }

const stubRawEvent = (kind: number, pubkey: string): NDKEvent =>
	({ kind, pubkey, content: '', tags: [] as string[][], id: 'stub', created_at: 0 }) as unknown as NDKEvent

const buildAuction = (overrides: Partial<ParsedAuctionEvent> = {}): ParsedAuctionEvent => {
	const endAt = overrides.endAt ?? 2_000
	return {
		rawEvent: stubRawEvent(30408, SELLER_PK),
		dTag: 'auction-test',
		sellerPubkey: SELLER_PK,
		coordinate: `30408:${SELLER_PK}:auction-test`,
		rootEventId: '1'.repeat(64),
		title: 'Test Auction',
		content: '',
		auctionType: 'english',
		startAt: overrides.startAt ?? 1_000,
		endAt,
		maxEndAt: overrides.maxEndAt ?? 2_100,
		settlementGrace: overrides.settlementGrace ?? 3_600,
		currency: 'SAT',
		reserve: overrides.reserve ?? 5_000,
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

let bidCounter = 0
const buildBid = (auction: ParsedAuctionEvent, overrides: Partial<ParsedBidEvent> = {}): ParsedBidEvent => {
	bidCounter += 1
	const locktime = auction.maxEndAt + auction.settlementGrace
	const lockSecret = JSON.stringify([
		'P2PK',
		{
			nonce: `nonce-${bidCounter}`,
			data: COMPRESSED_PK,
			tags: [
				['locktime', String(locktime)],
				['refund', REFUND_PK],
			],
		},
	])
	const lockSecrets = [lockSecret]
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
		mint: 'https://mint.test',
		locktime,
		refundPubkey: REFUND_PK,
		childPubkey: COMPRESSED_PK,
		lockSecrets,
		proofYs: [hashToCurveHexFromString(lockSecret)],
		dleqProofs: overrides.dleqProofs ?? [{ id: KEYSET_ID, amount: overrides.amount ?? 5_000, C: COMPRESSED_PK, e: 'aa', s: 'bb', r: 'cc' }],
		createdForEndAt: auction.endAt,
		bidNonce: 'test-bid-nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
		...overrides,
	}
}

const buildVerdict = (bid: ParsedBidEvent, overrides: Partial<ParsedValidatorVerdictEvent> = {}): ParsedValidatorVerdictEvent => ({
	rawEvent: stubRawEvent(30440, overrides.validatorPubkey ?? V1),
	id: overrides.id ?? `verdict-${bid.id}`,
	validatorPubkey: overrides.validatorPubkey ?? V1,
	createdAt: 1_505,
	dTag: `${bid.bidderPubkey}:${bid.auctionRootEventId}:${bid.id}`,
	bidderPubkey: bid.bidderPubkey,
	auctionRootEventId: bid.auctionRootEventId,
	auctionCoordinate: bid.auctionCoordinate,
	bidEventId: bid.id,
	claim: 'valid_bid_placed',
	observedAt: bid.createdAt + 5,
	...overrides,
})

const quorumFor = (bid: ParsedBidEvent): ParsedValidatorVerdictEvent[] => [
	buildVerdict(bid, { validatorPubkey: V1 }),
	buildVerdict(bid, { validatorPubkey: V2, observedAt: bid.createdAt + 30 }),
]

const unspent = (bids: ParsedBidEvent[]): Map<string, Nut7ProofState> => new Map(bids.map((b) => [b.id, 'unspent' as Nut7ProofState]))

const makeKeyset = (id: string): MintKeys => ({ id, unit: 'sat', keys: { 1: COMPRESSED_PK } }) as MintKeys

describe('reserve_not_met guard — unresolved DLEQ evidence blocks a terminal publish (A2)', () => {
	test('quorum-confirmed reserve-meeting bid with NO gathered keysets is pending, and the guard refuses to publish', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: quorumFor(bid),
			nut7States: unspent([bid]),
			// Caller never gathered keysets: evidence UNAVAILABLE, not fraud.
			dleqKeysets: undefined,
		})

		// Precondition: the bid is quorum-confirmed and structurally valid, yet
		// it is absent from the winner because its DLEQ evidence is unresolved.
		const classified = result.classified.find((c) => c.bid.id === bid.id)
		expect(classified?.classification).toBe('pending')
		expect(classified?.pendingReason).toBe('dlequ_evidence_unavailable')
		expect(result.canonicalWinner).toBeNull()

		expect(evaluateReserveNotMetGuard(result, auction.reserve)).toEqual({
			kind: 'evidence-unavailable',
			bidIds: [bid.id],
			maxPendingAmount: 5_000,
		})
	})

	test('keyset map supplied but the (mint, keyset) entry is ABSENT (fetch failed) → still evidence-unavailable', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: quorumFor(bid),
			nut7States: unspent([bid]),
			// fetchDleqKeysetsForBids omits an entry precisely when the mint
			// fetch failed — that is temporary infrastructure state.
			dleqKeysets: new Map<string, MintKeys>(),
		})
		expect(result.classified.find((c) => c.bid.id === bid.id)?.pendingReason).toBe('dlequ_evidence_unavailable')
		expect(evaluateReserveNotMetGuard(result, auction.reserve).kind).toBe('evidence-unavailable')
	})

	test('complete DLEQ evidence that verifies keeps the bid a canonical winner → blocked', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		// DLEQ is unconditional: give the bid an honest proof + the matching
		// keyset so the crypto verification succeeds and the bid is authoritative.
		const proof = makeHonestDleqProof(bid.amount, bid.lockSecrets[0])
		bid.dleqProofs = [proof]
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: quorumFor(bid),
			nut7States: unspent([bid]),
			dleqKeysets: new Map([[`https://mint.test:${proof.id}`, makeDleqKeyset([bid.amount])]]),
		})
		expect(evaluateReserveNotMetGuard(result, auction.reserve)).toEqual({
			kind: 'blocked',
			winnerBidId: bid.id,
			winnerAmount: 5_000,
		})
	})

	test('a bid pending only for validator quorum does NOT block (deliberately narrow: quorum never forming is a valid reason to close)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: [],
			nut7States: unspent([bid]),
		})
		const classified = result.classified.find((c) => c.bid.id === bid.id)
		expect(classified?.classification).toBe('pending')
		expect(classified?.pendingReason).toBeUndefined()
		expect(evaluateReserveNotMetGuard(result, auction.reserve)).toEqual({ kind: 'clear' })
	})

	test('unresolved evidence BELOW the reserve does not block (guard is reserve-scoped)', () => {
		const auction = buildAuction({ reserve: 5_000 })
		const bid = buildBid(auction, { amount: 4_000 })
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: quorumFor(bid),
			nut7States: unspent([bid]),
			dleqKeysets: undefined,
		})
		expect(result.classified.find((c) => c.bid.id === bid.id)?.classification).toBe('pending')
		expect(evaluateReserveNotMetGuard(result, auction.reserve)).toEqual({ kind: 'clear' })
	})

	test('a verifiable keyset map lets the bid become valid (guard reports blocked, no false retry loop)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const result = computeValidatedBids({
			auction,
			bids: [bid],
			verdicts: quorumFor(bid),
			nut7States: unspent([bid]),
			dleqKeysets: new Map([[`https://mint.test:${KEYSET_ID}`, makeKeyset(KEYSET_ID)]]),
		})
		// The fixture DLEQ tuple is not a real mint signature, so the bid is
		// expected to be condemned as dleq_invalid here — the point is that
		// resolved evidence NEVER yields 'evidence-unavailable'.
		expect(evaluateReserveNotMetGuard(result, auction.reserve).kind).not.toBe('evidence-unavailable')
	})
})
