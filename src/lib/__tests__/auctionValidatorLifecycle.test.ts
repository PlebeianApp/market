/**
 * Pure-function tests for the auction validator's verdict-derivation
 * lifecycle. No relays, no mint, no time mocks beyond passing `now`
 * explicitly.
 *
 * Lives under `src/lib/__tests__/` so the existing `bun test:unit`
 * glob picks it up (the validator code itself sits under
 * `src/server/auction-validator/`).
 */

import { describe, expect, test } from 'bun:test'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, ParsedSettlementEvent } from '../auction/events'
import { AUCTION_MIN_BID_LEG_SATS, AUCTION_MIN_BID_SATS } from '../auction/constants'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { makeHonestDleqProof } from '../cashu/dleqFixture'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	assignCloseRoles,
	deriveBidLegAmount,
	deriveVerdict,
	pickWinningBid,
	verdictChanged,
} from '../../server/auction-validator/lifecycle'
import type { ValidatorAuctionState, ValidatorBidState } from '../../server/auction-validator/state'
import { MAX_REPLACEMENT_CHAIN_DEPTH, recordNut7State, recordSettlement } from '../../server/auction-validator/state'

// ============================================================================
// Fixtures — direct object construction (no Zod parser involvement)
// ============================================================================

const SELLER_PK = 'a'.repeat(64)
const BIDDER_A = 'b'.repeat(64)
const BIDDER_B = '0'.repeat(63) + '1'
const COMPRESSED = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const PROOF_Y_A = '02' + '1'.repeat(64)
const PROOF_Y_B = '02' + '2'.repeat(64)
const REAL_XPUB = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'

const stubRawEvent = (kind: number, pubkey: string): NostrEventLike => ({
	kind,
	pubkey,
	content: '',
	tags: [] as string[][],
	id: 'stub',
	created_at: 0,
})

const buildLockSecret = (childPubkey: string, locktime: number, refundPubkey: string): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce: 'test-nonce-' + Math.random().toString(36).slice(2, 10),
			data: childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(locktime)],
				['refund', refundPubkey],
				['n_sigs_refund', '1'],
			],
		},
	])

const buildAuction = (overrides: Partial<ParsedAuctionEvent> = {}): ParsedAuctionEvent => ({
	rawEvent: stubRawEvent(30408, SELLER_PK),
	dTag: 'auction-test',
	sellerPubkey: SELLER_PK,
	coordinate: `30408:${SELLER_PK}:auction-test`,
	rootEventId: '1'.repeat(64),
	title: 'Test Auction',
	content: '',
	auctionType: 'english',
	startAt: 1_000,
	endAt: 2_000,
	maxEndAt: 2_100,
	settlementGrace: 3_600,
	currency: 'SAT',
	reserve: 0,
	startingBid: 1_000,
	bidIncrement: 100,
	minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
	settlementPolicy: 'cashu_p2pk_bidder_path_v1',
	keyScheme: 'hd_p2pk',
	mints: ['https://mint.test'],
	p2pkXpub: 'xpub6Bk...test',
	auditors: ['c'.repeat(64)],
	auditorQuorum: 1,
	maxSkewSec: 60,
	fallbackDelaySec: 1_800,
	vadiumRatioBps: 10_000,
	schema: 'auction_v1',
	...overrides,
})

const buildBid = (
	auction: ParsedAuctionEvent,
	overrides: Partial<ParsedBidEvent> & {
		id?: string
		bidderPubkey?: string
		amount?: number
		createdAt?: number
		childPubkey?: string
		proofYs?: string[]
	} = {},
): ParsedBidEvent => {
	const locktime = overrides.locktime ?? auction.maxEndAt + auction.settlementGrace
	const childPubkey = overrides.childPubkey ?? COMPRESSED
	const refundPubkey = overrides.refundPubkey ?? REFUND_PK
	const proofCount = overrides.lockSecrets?.length ?? overrides.proofYs?.length ?? 1
	const lockSecrets =
		overrides.lockSecrets ?? Array.from({ length: proofCount }, () => buildLockSecret(childPubkey, locktime, refundPubkey))
	const proofYs = overrides.proofYs ?? lockSecrets.map((secret) => hashToCurveHexFromString(secret))
	return {
		rawEvent: stubRawEvent(1023, overrides.bidderPubkey ?? BIDDER_A),
		id: overrides.id ?? '2'.repeat(64),
		bidderPubkey: overrides.bidderPubkey ?? BIDDER_A,
		createdAt: overrides.createdAt ?? 1_500,
		auctionRootEventId: auction.rootEventId,
		auctionCoordinate: auction.coordinate,
		sellerPubkey: auction.sellerPubkey,
		amount: overrides.amount ?? 1_100,
		currency: 'SAT',
		mint: overrides.mint ?? 'https://mint.test',
		locktime,
		refundPubkey,
		childPubkey,
		lockSecrets,
		proofYs,
		// DLEQ is unconditional (ADR-0011): the validator's structural pipeline
		// requires one dleq_proof per locked proof. These tests never
		// crypto-verify (that is the client read path), so structurally-honest
		// proofs are sufficient.
		dleqProofs: overrides.dleqProofs ?? lockSecrets.map((secret) => makeHonestDleqProof(overrides.amount ?? 1_100, secret)),
		createdForEndAt: auction.endAt,
		bidNonce: 'test-bid-nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
		prevBidId: overrides.prevBidId,
	}
}

const buildBidState = (bid: ParsedBidEvent, observedAt: number, overrides: Partial<ValidatorBidState> = {}): ValidatorBidState => ({
	bid,
	observedAt,
	nut7States: new Map(),
	currentClaim: null,
	currentReason: undefined,
	currentDetail: undefined,
	lastPublishedAt: null,
	postCloseDecision: null,
	postGraceRetry: null,
	...overrides,
})

const buildCashuToken = (mint: string, secrets: string[], amounts?: number[]): string => {
	const proofs: Proof[] = secrets.map((secret, index) => ({
		id: '009a1f293253e41e',
		amount: amounts?.[index] ?? 1,
		secret,
		C: `02${String(index + 1).padStart(64, '1')}`,
	}))
	return getEncodedToken({ mint, proofs })
}

const buildAuctionState = (auction: ParsedAuctionEvent, overrides: Partial<ValidatorAuctionState> = {}): ValidatorAuctionState => ({
	rootAuction: overrides.rootAuction ?? auction,
	auction: overrides.auction ?? auction,
	contextStatus: overrides.contextStatus ?? 'active',
	mintReachability: overrides.mintReachability ?? new Map(auction.mints.map((mintUrl) => [mintUrl, 'reachable' as const])),
	bids: overrides.bids ?? new Map(),
	settlement: overrides.settlement ?? null,
	settlements: overrides.settlements ?? (overrides.settlement ? [overrides.settlement] : []),
	pathReleases: overrides.pathReleases ?? new Map(),
	pathReleaseObservedAt: overrides.pathReleaseObservedAt ?? new Map(),
	closeHandled: overrides.closeHandled ?? false,
	winnerHandled: overrides.winnerHandled ?? false,
	fallbackOfferedAt: overrides.fallbackOfferedAt ?? null,
})

/** Append an authorized release to a bid's candidate set (dedup by id). */
const seedRelease = (state: ValidatorAuctionState, bidId: string, release: ParsedPathReleaseEvent) => {
	const existing = state.pathReleases.get(bidId) ?? []
	if (!existing.some((r) => r.id === release.id)) state.pathReleases.set(bidId, [...existing, release])
}
/** Read the first (deterministic) candidate for a bid. */
const getRelease = (state: ValidatorAuctionState, bidId: string): ParsedPathReleaseEvent | undefined => state.pathReleases.get(bidId)?.[0]

const buildPathRelease = (
	bid: ParsedBidEvent,
	overrides: Partial<ParsedPathReleaseEvent> & { derivationPath?: string; childPubkey?: string } = {},
): ParsedPathReleaseEvent => ({
	rawEvent: stubRawEvent(1025, overrides.bidderPubkey ?? bid.bidderPubkey),
	id: overrides.id ?? '3'.repeat(64),
	bidderPubkey: overrides.bidderPubkey ?? bid.bidderPubkey,
	createdAt: overrides.createdAt ?? 2_200,
	bidEventId: overrides.bidEventId ?? bid.id,
	auctionCoordinate: overrides.auctionCoordinate ?? bid.auctionCoordinate,
	sellerPubkey: overrides.sellerPubkey ?? bid.sellerPubkey,
	derivationPath: overrides.derivationPath ?? 'm/0/0/0/0/0',
	childPubkey: overrides.childPubkey ?? bid.childPubkey,
	releaseReason: overrides.releaseReason ?? 'settlement',
	auditorRefs: overrides.auditorRefs ?? [],
	fallbackOfferId: overrides.fallbackOfferId,
	cashuToken: overrides.cashuToken,
	content: overrides.content ?? '',
})

const buildSettlement = (
	auction: ParsedAuctionEvent,
	winningBid: ParsedBidEvent,
	overrides: Partial<ParsedSettlementEvent> = {},
): ParsedSettlementEvent => ({
	rawEvent: stubRawEvent(1024, overrides.sellerPubkey ?? auction.sellerPubkey),
	id: overrides.id ?? '4'.repeat(64),
	sellerPubkey: overrides.sellerPubkey ?? auction.sellerPubkey,
	createdAt: overrides.createdAt ?? auction.maxEndAt + 120,
	auctionRootEventId: overrides.auctionRootEventId ?? auction.rootEventId,
	auctionCoordinate: overrides.auctionCoordinate ?? auction.coordinate,
	status: overrides.status ?? 'settled',
	closeAt: overrides.closeAt ?? auction.maxEndAt + 120,
	winningBidId: overrides.winningBidId ?? winningBid.id,
	winnerPubkey: overrides.winnerPubkey ?? winningBid.bidderPubkey,
	finalAmount: overrides.finalAmount ?? winningBid.amount,
	pathReleaseEventId: overrides.pathReleaseEventId,
	payouts: overrides.payouts ?? [{ bidEventId: winningBid.id, amount: winningBid.amount, status: 'redeemed' }],
	fallbackChain: overrides.fallbackChain ?? [],
	reason: overrides.reason,
})

// ============================================================================
// Pre-close — wraps validateBid (covered exhaustively elsewhere)
// ============================================================================

describe('deriveVerdict — pre-close', () => {
	test('happy path → valid_bid_placed once NUT-7 returns unspent', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, bid.proofYs[0], 'unspent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('valid_bid_placed')
	})

	test('a replacement-chain cycle does NOT condemn the bid (ADR-0012 Phase 1)', () => {
		// `prev_bid` is declared linkage metadata: an unresolvable or cyclic
		// reference is never, by itself, grounds for condemnation. The chain is
		// walked at selection/settlement time, not in a verdict.
		const auction = buildAuction()
		const firstBid = buildBid(auction, { id: '2'.repeat(64), amount: 1_100 })
		const secondBid = buildBid(auction, { id: '3'.repeat(64), amount: 1_200, prevBidId: firstBid.id })
		const loopedFirstBid = { ...firstBid, prevBidId: secondBid.id }

		const firstBidState = buildBidState(loopedFirstBid, loopedFirstBid.createdAt, { currentClaim: null })
		const secondBidState = buildBidState(secondBid, secondBid.createdAt, { currentClaim: null })
		recordNut7State(firstBidState, firstBidState.bid.proofYs[0], 'unspent', firstBidState.observedAt)
		recordNut7State(secondBidState, secondBidState.bid.proofYs[0], 'unspent', secondBidState.observedAt)

		const auctionState = buildAuctionState(auction, {
			bids: new Map([
				[firstBidState.bid.id, firstBidState],
				[secondBidState.bid.id, secondBidState],
			]),
		})

		const verdict = deriveVerdict({ auctionState, bidState: secondBidState, now: secondBidState.observedAt })
		expect(verdict.claim).toBe('valid_bid_placed')
	})

	test('a replacement chain deeper than MAX_REPLACEMENT_CHAIN_DEPTH does NOT condemn the bid', () => {
		// The depth bound is a settlement-time walk guard, not a validity rule.
		const auction = buildAuction()
		// Build a chain longer than the depth bound. Each leg has a
		// strictly increasing amount (so the only failure is depth).
		const depth = MAX_REPLACEMENT_CHAIN_DEPTH + 2
		const bids: ParsedBidEvent[] = []
		for (let i = 0; i < depth; i++) {
			bids.push(
				buildBid(auction, {
					id: i.toString(16).padStart(64, '0'),
					amount: 1_000 + i * 100,
					prevBidId: i > 0 ? bids[i - 1].id : undefined,
				}),
			)
		}
		const head = bids[depth - 1]
		const bidMap = new Map<string, ValidatorBidState>()
		for (const b of bids) {
			const bs = buildBidState(b, b.createdAt, { currentClaim: null })
			recordNut7State(bs, b.proofYs[0], 'unspent', b.createdAt)
			bidMap.set(b.id, bs)
		}
		const auctionState = buildAuctionState(auction, { bids: bidMap })

		const verdict = deriveVerdict({
			auctionState,
			bidState: bidMap.get(head.id)!,
			now: head.createdAt,
		})
		expect(verdict.claim).toBe('valid_bid_placed')
	})

	test('no NUT-7 signal → valid_bid_placed (the verdict path consults no mint state)', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('valid_bid_placed')
	})

	test('NUT-7 evidence is skipped by the validator (client-owned per ADR-0004)', () => {
		// Validators no longer query the mint; their pre-close verdict asserts
		// structural/rules validity only. ADR-0012 Phase 1 deleted the NUT-7
		// step from `validateBid` outright, so the validator has no path to it
		// at all. Even recorded NUT-7 spent evidence does not invalidate via
		// this path — the CLIENT-side read path (computeValidatedBids) applies
		// spend state as fraud evidence over the valid set.
		const auction = buildAuction()
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, bid.proofYs[0], 'spent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('valid_bid_placed')
	})

	test('multi-proof spent evidence likewise skipped by the validator', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, {
			lockSecrets: [
				buildLockSecret(COMPRESSED, auction.maxEndAt + auction.settlementGrace, REFUND_PK),
				buildLockSecret(COMPRESSED, auction.maxEndAt + auction.settlementGrace, REFUND_PK),
			],
		})
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, bid.proofYs[0], 'unspent', bid.createdAt)
		recordNut7State(bidState, bid.proofYs[1], 'spent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('valid_bid_placed')
	})

	test('multi-proof aggregate — all unspent → valid_bid_placed', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, {
			lockSecrets: [
				buildLockSecret(COMPRESSED, auction.maxEndAt + auction.settlementGrace, REFUND_PK),
				buildLockSecret(COMPRESSED, auction.maxEndAt + auction.settlementGrace, REFUND_PK),
			],
		})
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, bid.proofYs[0], 'unspent', bid.createdAt)
		recordNut7State(bidState, bid.proofYs[1], 'unspent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('valid_bid_placed')
	})

	test('post-close partial redemption (one of two proofs spent) stays won_pending_settlement, not settled_*', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, {
			childPubkey,
			lockSecrets: [
				buildLockSecret(childPubkey, auction.maxEndAt + auction.settlementGrace, REFUND_PK),
				buildLockSecret(childPubkey, auction.maxEndAt + auction.settlementGrace, REFUND_PK),
			],
			amount: 2,
		})
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, { derivationPath: path, childPubkey, cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [1, 1]) }),
		)
		const release = getRelease(auctionState, bid.id)!
		auctionState.settlement = buildSettlement(auction, bid, {
			pathReleaseEventId: release.id,
			finalAmount: 2,
			payouts: [{ bidEventId: bid.id, amount: 2, status: 'redeemed' }],
		})
		// Only one of two proofs is spent → aggregate is NOT 'spent'.
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)
		recordNut7State(bidState, bid.proofYs[1], 'unspent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('won_pending_settlement')
	})

	test('rebid with a sub-minimum own delta still becomes valid_bid_placed (ADR-0012 Phase 1)', () => {
		// The chain-leg minimum was a verdict-time rule; it is retired. The bid
		// clears `starting_bid`, which is the only amount-based check.
		const auction = buildAuction({ startingBid: AUCTION_MIN_BID_SATS, bidIncrement: 1 })
		const previousBid = buildBid(auction, { id: 'a'.repeat(64), amount: AUCTION_MIN_BID_SATS })
		const rebidAmount = AUCTION_MIN_BID_SATS + AUCTION_MIN_BID_LEG_SATS - 1
		const rebid = buildBid(auction, { id: 'b'.repeat(64), amount: rebidAmount, prevBidId: previousBid.id })
		const auctionState = buildAuctionState(auction)
		auctionState.bids.set(previousBid.id, buildBidState(previousBid, previousBid.createdAt, { currentClaim: 'bid_pending_review' }))
		const rebidState = buildBidState(rebid, rebid.createdAt)
		auctionState.bids.set(rebid.id, rebidState)
		recordNut7State(rebidState, rebid.proofYs[0], 'unspent', rebid.createdAt)

		const v = deriveVerdict({ auctionState, bidState: rebidState, now: rebid.createdAt })
		expect(v.claim).toBe('valid_bid_placed')
	})
})

// ============================================================================
// Close roles & winner picking
// ============================================================================

describe('pickWinningBid + assignCloseRoles', () => {
	test('picks highest-amount valid bid', () => {
		const auction = buildAuction()
		const lowBid = buildBid(auction, { id: 'a'.repeat(64), bidderPubkey: BIDDER_A, amount: 1_500 })
		const highBid = buildBid(auction, { id: 'b'.repeat(64), bidderPubkey: BIDDER_B, amount: 2_500 })
		const auctionState = buildAuctionState(auction)
		const lowState = buildBidState(lowBid, lowBid.createdAt, { currentClaim: 'valid_bid_placed' })
		const highState = buildBidState(highBid, highBid.createdAt, { currentClaim: 'valid_bid_placed' })
		auctionState.bids.set(lowBid.id, lowState)
		auctionState.bids.set(highBid.id, highState)

		expect(pickWinningBid(auctionState)).toBe(highState)
	})

	test('skips bids below reserve', () => {
		const auction = buildAuction({ reserve: 5_000 })
		const bid = buildBid(auction, { amount: 2_000 })
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt, { currentClaim: 'valid_bid_placed' })
		auctionState.bids.set(bid.id, bidState)

		expect(pickWinningBid(auctionState)).toBe(null)
	})

	test('tie-break: equal amount → earliest created_at wins', () => {
		const auction = buildAuction()
		const earlyBid = buildBid(auction, { id: 'a'.repeat(64), createdAt: 1_500, amount: 2_000 })
		const lateBid = buildBid(auction, { id: 'b'.repeat(64), bidderPubkey: BIDDER_B, createdAt: 1_600, amount: 2_000 })
		const auctionState = buildAuctionState(auction)
		const early = buildBidState(earlyBid, earlyBid.createdAt, { currentClaim: 'valid_bid_placed' })
		const late = buildBidState(lateBid, lateBid.createdAt, { currentClaim: 'valid_bid_placed' })
		auctionState.bids.set(earlyBid.id, early)
		auctionState.bids.set(lateBid.id, late)

		expect(pickWinningBid(auctionState)).toBe(early)
	})

	test('assignCloseRoles tags winner + losers, idempotent on second call', () => {
		const auction = buildAuction()
		const lowBid = buildBid(auction, { id: 'a'.repeat(64), bidderPubkey: BIDDER_A, amount: 1_500 })
		const highBid = buildBid(auction, { id: 'b'.repeat(64), bidderPubkey: BIDDER_B, amount: 2_500 })
		const auctionState = buildAuctionState(auction)
		const lowState = buildBidState(lowBid, lowBid.createdAt, { currentClaim: 'valid_bid_placed' })
		const highState = buildBidState(highBid, highBid.createdAt, { currentClaim: 'valid_bid_placed' })
		auctionState.bids.set(lowBid.id, lowState)
		auctionState.bids.set(highBid.id, highState)

		const winner = assignCloseRoles(auctionState)
		expect(winner).toBe(highState)
		expect(highState.postCloseDecision).toBe('winner')
		expect(lowState.postCloseDecision).toBe('loser')
		expect(auctionState.closeHandled).toBe(true)

		// Second call is a no-op.
		expect(assignCloseRoles(auctionState)).toBe(null)
	})
})

// ============================================================================
// Post-close lifecycle
// ============================================================================

describe('deriveVerdict — post-close', () => {
	test('loser bid → lost_pending_refund', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'loser',
		})
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, bid.proofYs[0], 'unspent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 100 })
		expect(v.claim).toBe('lost_pending_refund')
	})

	test('winner without kind-1025 (within fallback window) → won_pending_settlement', () => {
		const auction = buildAuction({ fallbackDelaySec: 1_800, settlementGrace: 3_600 })
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, bid.proofYs[0], 'unspent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('won_pending_settlement')
	})

	test('winner with spent proofs but without kind-1024 → still won_pending_settlement', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, { derivationPath: path, childPubkey, cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]) }),
		)
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('won_pending_settlement')
	})

	test('winner past fallback_delay but before grace expiry → griefed_pending_fallback', () => {
		const auction = buildAuction({ fallbackDelaySec: 100, settlementGrace: 1_000 })
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 200 })
		expect(v.claim).toBe('griefed_pending_fallback')
	})

	test('winner past grace expiry without settlement → griefed (terminal)', () => {
		const auction = buildAuction({ settlementGrace: 100 })
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 1_000 })
		expect(v.claim).toBe('griefed')
	})
})

// ============================================================================
// Settlement (kind-1025) verification
// ============================================================================

describe('deriveVerdict — kind-1025 settlement', () => {
	test('valid path release + NUT-7 spent within grace → settled_promptly', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, { derivationPath: path, childPubkey, cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]) }),
		)
		const release = getRelease(auctionState, bid.id)
		if (!release) throw new Error('expected path release fixture')
		auctionState.settlement = buildSettlement(auction, bid, { pathReleaseEventId: release.id })
		// Spent at the mint = the seller redeemed.
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('settled_promptly')
	})

	test('kind-1025 with mismatched child_pubkey → fraudulent_bid', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const bid = buildBid(auction, { childPubkey: COMPRESSED })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				derivationPath: 'm/0/0/0/0/0',
				childPubkey: COMPRESSED,
				cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
			}),
		)
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('fraudulent_bid')
	})

	test('kind-1025 received but mint hasn’t flipped to spent yet → still won_pending_settlement', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, { derivationPath: path, childPubkey, cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]) }),
		)
		// Mint state stays unspent — seller hasn't redeemed yet.
		recordNut7State(bidState, bid.proofYs[0], 'unspent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('won_pending_settlement')
	})

	test('spent proofs plus malformed kind-1024 → still won_pending_settlement', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey, amount: 10 })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, { derivationPath: path, childPubkey, cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]) }),
		)
		const release = getRelease(auctionState, bid.id)
		if (!release) throw new Error('expected path release fixture')
		auctionState.settlement = buildSettlement(auction, bid, {
			pathReleaseEventId: release.id,
			finalAmount: 9,
			payouts: [{ bidEventId: bid.id, amount: 9, status: 'redeemed' }],
		})
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('won_pending_settlement')
	})

	test('settled_late when grace already expired', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				derivationPath: path,
				childPubkey,
				releaseReason: 'voluntary_late',
				cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
			}),
		)
		const release = getRelease(auctionState, bid.id)
		if (!release) throw new Error('expected path release fixture')
		auctionState.pathReleaseObservedAt.set(release.id, auction.maxEndAt + 110)
		auctionState.settlement = buildSettlement(auction, bid, {
			createdAt: auction.maxEndAt + 500,
			closeAt: auction.maxEndAt + 500,
			pathReleaseEventId: release.id,
		})
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 500)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 500 })
		expect(v.claim).toBe('settled_late')
	})

	test('settled_promptly when release observed inside grace even if kind-1024 is delayed', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				derivationPath: path,
				childPubkey,
				releaseReason: 'settlement',
				cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
			}),
		)
		const release = getRelease(auctionState, bid.id)
		if (!release) throw new Error('expected path release fixture')
		auctionState.pathReleaseObservedAt.set(release.id, auction.maxEndAt + 50)
		auctionState.settlement = buildSettlement(auction, bid, {
			createdAt: auction.maxEndAt + 500,
			closeAt: auction.maxEndAt + 500,
			pathReleaseEventId: release.id,
		})
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 500)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 500 })
		expect(v.claim).toBe('settled_promptly')
	})

	test('settled_late when release observed after grace even if kind-1024 is backdated', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				derivationPath: path,
				childPubkey,
				releaseReason: 'voluntary_late',
				cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
			}),
		)
		const release = getRelease(auctionState, bid.id)
		if (!release) throw new Error('expected path release fixture')
		auctionState.pathReleaseObservedAt.set(release.id, auction.maxEndAt + 130)
		auctionState.settlement = buildSettlement(auction, bid, {
			createdAt: auction.maxEndAt + 80,
			closeAt: auction.maxEndAt + 80,
			pathReleaseEventId: release.id,
		})
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 130)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 130 })
		expect(v.claim).toBe('settled_late')
	})

	test('a late voluntary_late release is classified by its OWN observed time, not an earlier release’s', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)

		// Early authorized release A (settlement, observed WITHIN grace).
		const releaseA = buildPathRelease(bid, {
			id: '3'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'settlement',
			cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
		})
		// Late authorized release B (voluntary_late, observed AFTER grace) —
		// the one the seller's kind-1024 actually settles on.
		const releaseB = buildPathRelease(bid, {
			id: '7'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'voluntary_late',
			cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
		})

		// The selected release is B; observed times are bound per release
		// event id, so B uses its own late time (maxEndAt+130), not A's
		// earlier in-grace time (maxEndAt+50).
		seedRelease(auctionState, bid.id, releaseB)
		auctionState.pathReleaseObservedAt.set(releaseA.id, auction.maxEndAt + 50)
		auctionState.pathReleaseObservedAt.set(releaseB.id, auction.maxEndAt + 130)
		auctionState.settlement = buildSettlement(auction, bid, {
			pathReleaseEventId: releaseB.id,
		})
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 130)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 130 })
		// Using B's own observed time (after grace) → settled_late. If B
		// inherited A's earlier in-grace time, voluntary_late would be
		// rejected (before grace) → fraudulent_bid.
		expect(v.claim).toBe('settled_late')
	})

	test('kind-1025 from the wrong signer → fraudulent_bid', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				bidderPubkey: BIDDER_B,
				derivationPath: path,
				childPubkey,
				cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
			}),
		)
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const verdict = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(verdict.claim).toBe('fraudulent_bid')
		expect(verdict.detail).toMatch(/original bidder/)
	})

	test('kind-1025 missing cashu_token → won_pending_settlement (validator skips cashu token validation)', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(auctionState, bid.id, buildPathRelease(bid, { derivationPath: path, childPubkey }))

		const verdict = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		// The validator skips cashu token validation (seller's job at redemption).
		// A missing token is not fraud from the validator's perspective.
		expect(verdict.claim).toBe('won_pending_settlement')
	})

	test('kind-1025 with token amount mismatch → won_pending_settlement (validator skips cashu token validation)', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey, amount: 10 })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, { derivationPath: path, childPubkey, cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [9]) }),
		)

		const verdict = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		// The validator skips cashu token validation (seller's job at redemption).
		// A token amount mismatch is not fraud from the validator's perspective.
		expect(verdict.claim).toBe('won_pending_settlement')
	})

	test('loser with a spurious settlement release stays lost_pending_refund (not fraudulent_bid)', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'loser',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				derivationPath: path,
				childPubkey,
				releaseReason: 'settlement',
				cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
			}),
		)

		const verdict = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		// A losing bid with a spurious settlement release is NOT fraud — the
		// release is irrelevant to a loser (they refund at locktime). Stay at
		// lost_pending_refund rather than condemning as fraudulent_bid.
		expect(verdict.claim).toBe('lost_pending_refund')
	})

	test('fallback bidder with valid fallback_settlement can settle', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const auctionState = buildAuctionState(auction, { closeHandled: true, fallbackOfferedAt: auction.maxEndAt + 10 })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'loser',
		})
		auctionState.bids.set(bid.id, bidState)
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				derivationPath: path,
				childPubkey,
				releaseReason: 'fallback_settlement',
				fallbackOfferId: '4'.repeat(64),
				cashuToken: buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount]),
			}),
		)
		const release = getRelease(auctionState, bid.id)
		if (!release) throw new Error('expected path release fixture')
		auctionState.settlement = buildSettlement(auction, bid, {
			pathReleaseEventId: release.id,
			fallbackChain: [
				{ bidEventId: '5'.repeat(64), status: 'griefed' },
				{ bidEventId: bid.id, status: 'accepted' },
			],
		})
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const verdict = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(verdict.claim).toBe('settled_promptly')
	})

	// ---- Deterministic release selection (review 4800100458) ---------------

	test('an isolated unusable authorized release still flags fraudulent_bid when structurally invalid (wrong derivation path)', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, { currentClaim: 'valid_bid_placed', postCloseDecision: 'winner' })
		auctionState.bids.set(bid.id, bidState)

		// Structurally invalid release (wrong derivation path → child_pubkey
		// mismatch) → the validator still catches this as fraudulent_bid.
		seedRelease(auctionState, bid.id, buildPathRelease(bid, { derivationPath: 'm/9/9/9/9/9', childPubkey, releaseReason: 'settlement' }))
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const verdict = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(verdict.claim).toBe('fraudulent_bid')
	})

	test('an early unusable release does not block a later valid release — relay-order independent', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const token = buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount])

		const unusable = buildPathRelease(bid, {
			id: 'e'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'settlement',
			cashuToken: undefined, // unusable: no redeemable token
			createdAt: auction.maxEndAt + 10,
		})
		const valid = buildPathRelease(bid, {
			id: 'l'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'settlement',
			cashuToken: token,
			createdAt: auction.maxEndAt + 20,
		})

		// Helper to run selection in a given candidate order.
		const run = (first: ParsedPathReleaseEvent, second: ParsedPathReleaseEvent) => {
			const auctionState = buildAuctionState(auction, { closeHandled: true })
			const bidState = buildBidState(bid, bid.createdAt, { currentClaim: 'valid_bid_placed', postCloseDecision: 'winner' })
			auctionState.bids.set(bid.id, bidState)
			seedRelease(auctionState, bid.id, first)
			seedRelease(auctionState, bid.id, second)
			recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)
			return deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		}

		// Order 1: unusable arrives first, then valid.
		const v1 = run(unusable, valid)
		// Order 2: valid arrives first, then unusable.
		const v2 = run(valid, unusable)

		// Both orders select the VALID release (no settlement yet → pending),
		// never fraudulent_bid. If the unusable release were selected the
		// verdict would be fraudulent_bid; relay order must not change that.
		expect(v1.claim).toBe('won_pending_settlement')
		expect(v2.claim).toBe('won_pending_settlement')
		expect(v1.claim).toBe(v2.claim)
	})

	test('settlement-referenced selection overrides the earliest-valid heuristic', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, { currentClaim: 'valid_bid_placed', postCloseDecision: 'winner' })
		auctionState.bids.set(bid.id, bidState)
		const token = buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount])

		// Two VALID authorized releases. A is earliest (created_at-wise,
		// observed within grace → prompt); B is later (observed after grace
		// → late). The seller's kind-1024 declares it acted on B.
		const releaseA = buildPathRelease(bid, {
			id: 'a'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'settlement',
			cashuToken: token,
			createdAt: auction.maxEndAt + 10,
		})
		const releaseB = buildPathRelease(bid, {
			id: 'b'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'voluntary_late',
			cashuToken: token,
			createdAt: auction.maxEndAt + 20,
		})
		seedRelease(auctionState, bid.id, releaseA)
		seedRelease(auctionState, bid.id, releaseB)
		auctionState.pathReleaseObservedAt.set(releaseA.id, auction.maxEndAt + 50) // in-grace
		auctionState.pathReleaseObservedAt.set(releaseB.id, auction.maxEndAt + 130) // after grace
		auctionState.settlement = buildSettlement(auction, bid, {
			closeAt: auction.maxEndAt + 80,
			pathReleaseEventId: releaseB.id,
		})
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 130)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 130 })
		// B is selected via the settlement's pathReleaseEventId (not the
		// earliest-valid heuristic A). B's own observed time is after grace
		// → settled_late. Had the heuristic picked A, the
		// path_release_mismatch check (settlement names B ≠ A) would have
		// left the verdict at won_pending_settlement.
		expect(v.claim).toBe('settled_late')
	})

	test('conflicting seller settlements are triaged deterministically (delivery-order independent)', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const token = buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount])

		// Two VALID authorized releases, both valid after grace:
		//  - A: 'settlement' reason (valid for the winner at any time), observed in-grace.
		//  - B: 'voluntary_late' reason (valid after grace), observed after grace.
		const releaseA = buildPathRelease(bid, {
			id: 'a'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'settlement',
			cashuToken: token,
			createdAt: auction.maxEndAt + 10,
		})
		const releaseB = buildPathRelease(bid, {
			id: 'b'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'voluntary_late',
			cashuToken: token,
			createdAt: auction.maxEndAt + 20,
		})

		// Two conflicting seller settlements, each referencing a valid release.
		const settlementA = buildSettlement(auction, bid, {
			id: 's'.repeat(64),
			closeAt: auction.maxEndAt + 30,
			pathReleaseEventId: releaseA.id,
		})
		const settlementB = buildSettlement(auction, bid, {
			id: 't'.repeat(64),
			closeAt: auction.maxEndAt + 40,
			pathReleaseEventId: releaseB.id,
		})

		const run = (settlementOrder: ParsedSettlementEvent[], releaseOrder: ParsedPathReleaseEvent[]) => {
			const auctionState = buildAuctionState(auction, { closeHandled: true })
			const bidState = buildBidState(bid, bid.createdAt, { currentClaim: 'valid_bid_placed', postCloseDecision: 'winner' })
			auctionState.bids.set(bid.id, bidState)
			for (const r of releaseOrder) seedRelease(auctionState, bid.id, r)
			auctionState.pathReleaseObservedAt.set(releaseA.id, auction.maxEndAt + 50)
			auctionState.pathReleaseObservedAt.set(releaseB.id, auction.maxEndAt + 130)
			// recordSettlement appends dedup; call in the given order.
			auctionState.settlements = []
			for (const s of settlementOrder)
				recordSettlement(
					{ auctions: new Map([[auction.rootEventId, auctionState]]), auctionsByCoordinate: new Map(), validatorPubkey: '' } as any,
					s,
				)
			recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 130)
			return deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 130 })
		}

		// Both valid settlements reference valid releases; the deterministic
		// tiebreak is earliest settlement created_at → settlementA (names A,
		// observed in-grace → settled_promptly). Delivery order must not
		// change the outcome.
		const order1 = run([settlementA, settlementB], [releaseA, releaseB])
		const order2 = run([settlementB, settlementA], [releaseB, releaseA])
		expect(order1.claim).toBe('settled_promptly')
		expect(order2.claim).toBe('settled_promptly')
		expect(order1.claim).toBe(order2.claim)
	})

	test('a settlement referencing an invalid release is not selected; a valid settlement wins', () => {
		const auction = buildAuction({ p2pkXpub: REAL_XPUB, settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })
		const token = buildCashuToken(bid.mint, bid.lockSecrets, [bid.amount])

		// releaseInvalid is structurally invalid (wrong derivation path →
		// child_pubkey mismatch); releaseValid is usable.
		const releaseInvalid = buildPathRelease(bid, {
			id: 'i'.repeat(64),
			derivationPath: 'm/9/9/9/9/9',
			childPubkey,
			releaseReason: 'settlement',
			createdAt: auction.maxEndAt + 10,
		})
		const releaseValid = buildPathRelease(bid, {
			id: 'v'.repeat(64),
			derivationPath: path,
			childPubkey,
			releaseReason: 'settlement',
			cashuToken: token,
			createdAt: auction.maxEndAt + 20,
		})

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, { currentClaim: 'valid_bid_placed', postCloseDecision: 'winner' })
		auctionState.bids.set(bid.id, bidState)
		seedRelease(auctionState, bid.id, releaseInvalid)
		seedRelease(auctionState, bid.id, releaseValid)
		auctionState.pathReleaseObservedAt.set(releaseInvalid.id, auction.maxEndAt + 50)
		auctionState.pathReleaseObservedAt.set(releaseValid.id, auction.maxEndAt + 60)
		// A settlement referencing the INVALID release is not a valid settlement.
		const badSettlement = buildSettlement(auction, bid, { closeAt: auction.maxEndAt + 30, pathReleaseEventId: releaseInvalid.id })
		// A settlement referencing the VALID release is valid.
		const goodSettlement = buildSettlement(auction, bid, {
			id: 'g'.repeat(64),
			closeAt: auction.maxEndAt + 40,
			pathReleaseEventId: releaseValid.id,
		})
		recordSettlement(
			{ auctions: new Map([[auction.rootEventId, auctionState]]), auctionsByCoordinate: new Map(), validatorPubkey: '' } as any,
			badSettlement,
		)
		recordSettlement(
			{ auctions: new Map([[auction.rootEventId, auctionState]]), auctionsByCoordinate: new Map(), validatorPubkey: '' } as any,
			goodSettlement,
		)
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		// The good settlement (valid release) is selected → settled_promptly.
		expect(v.claim).toBe('settled_promptly')
	})

	test('TDD: winner with an undecodable cashu_token in kind-1025 → won_pending_settlement (validator skips token validation)', () => {
		// The validator must NOT condemn a bid for a cashu token it can't
		// decode. Token decoding requires mint keyset info the validator
		// doesn't have (the validator makes no mint interaction per the
		// maintainer direction). Cashu token validation is the SELLER's job
		// at redemption time. An undecodable token should leave the verdict
		// at won_pending_settlement, not flip to fraudulent_bid.
		//
		// RED before the fix: currently returns fraudulent_bid because
		// validatePathRelease throws on getDecodedToken and
		// deriveSettlementVerdict maps any release invalidity to
		// fraudulent_bid. GREEN after the fix skips the cashu token decode
		// in the validator path.
		const auction = buildAuction({ p2pkXpub: REAL_XPUB })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_XPUB, path)
		const bid = buildBid(auction, { childPubkey })

		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		// Valid derivation path + child_pubkey (passes those checks), but an
		// undecodable cashu_token — a garbage string getDecodedToken can't parse.
		seedRelease(
			auctionState,
			bid.id,
			buildPathRelease(bid, {
				derivationPath: path,
				childPubkey,
				cashuToken: 'cashuNOTAVALIDTOKEN!!!garbage-that-will-throw-on-decode',
			}),
		)
		// No settlement — the validator should stay at won_pending_settlement.

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('won_pending_settlement')
	})
})

// ============================================================================
// verdictChanged
// ============================================================================

describe('verdictChanged', () => {
	test('same claim + reason → false (suppress republish)', () => {
		expect(verdictChanged({ claim: 'valid_bid_placed' }, 'valid_bid_placed', undefined)).toBe(false)
		expect(verdictChanged({ claim: 'bid_invalid', reason: 'pre_start' }, 'bid_invalid', 'pre_start')).toBe(false)
	})

	test('different claim → true', () => {
		expect(verdictChanged({ claim: 'valid_bid_placed' }, 'bid_pending_review', undefined)).toBe(true)
	})

	test('different reason → true', () => {
		expect(verdictChanged({ claim: 'bid_invalid', reason: 'pre_start' }, 'bid_invalid', 'post_end')).toBe(true)
	})

	test('detail-only difference → false (detail is informational only)', () => {
		const a = { claim: 'bid_invalid' as const, reason: 'pre_start' as const, detail: 'created_at=500' }
		expect(verdictChanged(a, 'bid_invalid', 'pre_start')).toBe(false)
	})
})

// ============================================================================
// deriveBidLegAmount — a leg's predecessor must be this bidder's own, in this auction
//
// #1280 tightened the client's rule (`verifyBidCollateralChain`): a bid's
// `prev_bid` must name the same bidder's leg in the same auction. The
// validator resolved the parent by event id alone, so citing another bidder's
// bid made that amount this leg's predecessor.
// ============================================================================

describe('deriveBidLegAmount — ancestor scope', () => {
	const legAmount = (bid: ParsedBidEvent, parent?: ParsedBidEvent, auction?: ParsedAuctionEvent): number => {
		const a = auction ?? buildAuction()
		const bids = new Map<string, ValidatorBidState>([[bid.id, buildBidState(bid, bid.createdAt)]])
		if (parent) bids.set(parent.id, buildBidState(parent, parent.createdAt))
		return deriveBidLegAmount(buildAuctionState(a, { bids }), buildBidState(bid, bid.createdAt))
	}

	test('no prev_bid → the bid is its own leg', () => {
		const auction = buildAuction()
		expect(legAmount(buildBid(auction, { amount: 1_100 }), undefined, auction)).toBe(1_100)
	})

	test('own parent below this amount → the signed delta', () => {
		const auction = buildAuction()
		const parent = buildBid(auction, { id: '5'.repeat(64), amount: 1_000 })
		const rebid = buildBid(auction, { id: '6'.repeat(64), amount: 1_100, prevBidId: parent.id })
		expect(legAmount(rebid, parent, auction)).toBe(100)
	})

	test("a parent from ANOTHER bidder → this bid's own amount, never the foreign difference", () => {
		const auction = buildAuction()
		const victim = buildBid(auction, { id: '5'.repeat(64), amount: 1_000, bidderPubkey: BIDDER_B })
		const attacker = buildBid(auction, { id: '6'.repeat(64), amount: 1_100, prevBidId: victim.id })
		// Without the same-bidder rule this returns 100 — a delta this leg never locked.
		expect(legAmount(attacker, victim, auction)).toBe(1_100)
	})

	test("a parent from another auction → this bid's own amount", () => {
		const auction = buildAuction()
		const otherAuction = buildAuction({ coordinate: '30408:' + 'f'.repeat(64) + ':other' })
		const foreign = buildBid(otherAuction, { id: '5'.repeat(64), amount: 1_000 })
		const attacker = buildBid(auction, { id: '6'.repeat(64), amount: 1_100, prevBidId: foreign.id })
		expect(legAmount(attacker, foreign, auction)).toBe(1_100)
	})

	test('a parent at or above this amount → fall back to the bid amount (never a non-positive leg)', () => {
		const auction = buildAuction()
		const parent = buildBid(auction, { id: '5'.repeat(64), amount: 1_100 })
		const rebid = buildBid(auction, { id: '6'.repeat(64), amount: 1_100, prevBidId: parent.id })
		expect(legAmount(rebid, parent, auction)).toBe(1_100)
	})

	test('an unresolvable prev_bid → fall back to the bid amount (unchanged behaviour)', () => {
		const auction = buildAuction()
		expect(legAmount(buildBid(auction, { amount: 1_100, prevBidId: '9'.repeat(64) }), undefined, auction)).toBe(1_100)
	})
})
