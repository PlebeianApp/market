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
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent } from '../auction/events'
import {
	deriveVerdict,
	assignCloseRoles,
	pickWinningBid,
	verdictChanged,
	currentTopValidBidAmount,
} from '../../server/auction-validator/lifecycle'
import type { ValidatorAuctionState, ValidatorBidState } from '../../server/auction-validator/state'
import { recordNut7State } from '../../server/auction-validator/state'

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

const stubRawEvent = (kind: number, pubkey: string): NDKEvent =>
	({
		kind,
		pubkey,
		content: '',
		tags: [] as string[][],
		id: 'stub',
		created_at: 0,
	}) as unknown as NDKEvent

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
	const proofYs = overrides.proofYs ?? [PROOF_Y_A]
	const lockSecrets = overrides.lockSecrets ?? proofYs.map(() => buildLockSecret(childPubkey, locktime, refundPubkey))
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
		createdForEndAt: auction.endAt,
		bidNonce: 'test-bid-nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
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
	...overrides,
})

const buildAuctionState = (auction: ParsedAuctionEvent, overrides: Partial<ValidatorAuctionState> = {}): ValidatorAuctionState => ({
	auction,
	bids: new Map(),
	settlement: null,
	pathReleases: new Map(),
	closeHandled: false,
	winnerHandled: false,
	fallbackOfferedAt: null,
	...overrides,
})

const buildPathRelease = (bidEventId: string, derivationPath: string, childPubkey: string): ParsedPathReleaseEvent => ({
	rawEvent: stubRawEvent(1025, BIDDER_A),
	id: '3'.repeat(64),
	bidderPubkey: BIDDER_A,
	createdAt: 2_200,
	bidEventId,
	auctionCoordinate: `30408:${SELLER_PK}:auction-test`,
	sellerPubkey: SELLER_PK,
	derivationPath,
	childPubkey,
	releaseReason: 'settlement',
	auditorRefs: [],
	content: '',
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

	test('no NUT-7 signal → bid_pending_review', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('bid_pending_review')
	})

	test('NUT-7 reports spent → bid_invalid: proof_spent', () => {
		const auction = buildAuction()
		const bid = buildBid(auction)
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, bid.proofYs[0], 'spent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('bid_invalid')
		if (v.claim === 'bid_invalid') expect(v.reason).toBe('proof_spent')
	})

	test('multi-proof aggregate — one spent flips the bid invalid', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { proofYs: [PROOF_Y_A, PROOF_Y_B] })
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, PROOF_Y_A, 'unspent', bid.createdAt)
		recordNut7State(bidState, PROOF_Y_B, 'spent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
		expect(v.claim).toBe('bid_invalid')
		if (v.claim === 'bid_invalid') expect(v.reason).toBe('proof_spent')
	})

	test('multi-proof aggregate — all unspent → valid_bid_placed', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { proofYs: [PROOF_Y_A, PROOF_Y_B] })
		const auctionState = buildAuctionState(auction)
		const bidState = buildBidState(bid, bid.createdAt)
		auctionState.bids.set(bid.id, bidState)
		recordNut7State(bidState, PROOF_Y_A, 'unspent', bid.createdAt)
		recordNut7State(bidState, PROOF_Y_B, 'unspent', bid.createdAt)

		const v = deriveVerdict({ auctionState, bidState, now: bid.createdAt })
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
		const auction = buildAuction()
		// Use a path the test can predict will derive correctly.
		const path = 'm/0/0/0/0/0'
		// derive() in @scure/bip32 is deterministic; just compute it.
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		// Use a real xpub for derivation. The fixture xpub above is a placeholder.
		const realXpub = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(realXpub, path)
		const auctionWithRealXpub = buildAuction({ p2pkXpub: realXpub })
		const bid = buildBid(auctionWithRealXpub, { childPubkey })

		const auctionState = buildAuctionState(auctionWithRealXpub, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		auctionState.pathReleases.set(bid.id, buildPathRelease(bid.id, path, childPubkey))
		// Spent at the mint = the seller redeemed.
		recordNut7State(bidState, bid.proofYs[0], 'spent', auctionWithRealXpub.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auctionWithRealXpub.maxEndAt + 60 })
		expect(v.claim).toBe('settled_promptly')
	})

	test('kind-1025 with mismatched child_pubkey → fraudulent_bid', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { childPubkey: COMPRESSED })
		const auctionState = buildAuctionState(auction, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		// Path doesn't derive to the bid's child_pubkey because the
		// xpub is just a placeholder string. The lifecycle catches this
		// either via derivation failure or via mismatch — either way,
		// fraudulent_bid is the answer.
		auctionState.pathReleases.set(bid.id, buildPathRelease(bid.id, 'm/0/0/0/0/0', COMPRESSED))
		recordNut7State(bidState, bid.proofYs[0], 'spent', auction.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auction.maxEndAt + 60 })
		expect(v.claim).toBe('fraudulent_bid')
	})

	test('kind-1025 received but mint hasn’t flipped to spent yet → still won_pending_settlement', () => {
		const auction = buildAuction()
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const realXpub = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(realXpub, path)
		const auctionWithRealXpub = buildAuction({ p2pkXpub: realXpub })
		const bid = buildBid(auctionWithRealXpub, { childPubkey })

		const auctionState = buildAuctionState(auctionWithRealXpub, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		auctionState.pathReleases.set(bid.id, buildPathRelease(bid.id, path, childPubkey))
		// Mint state stays unspent — seller hasn't redeemed yet.
		recordNut7State(bidState, bid.proofYs[0], 'unspent', auctionWithRealXpub.maxEndAt + 60)

		const v = deriveVerdict({ auctionState, bidState, now: auctionWithRealXpub.maxEndAt + 60 })
		expect(v.claim).toBe('won_pending_settlement')
	})

	test('settled_late when grace already expired', () => {
		const auction = buildAuction({ settlementGrace: 100 })
		const path = 'm/0/0/0/0/0'
		const { deriveAuctionChildP2pkPubkeyFromXpub } = require('../auctionP2pk') as typeof import('../auctionP2pk')
		const realXpub = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(realXpub, path)
		const auctionWithRealXpub = buildAuction({ p2pkXpub: realXpub, settlementGrace: 100 })
		const bid = buildBid(auctionWithRealXpub, { childPubkey })

		const auctionState = buildAuctionState(auctionWithRealXpub, { closeHandled: true })
		const bidState = buildBidState(bid, bid.createdAt, {
			currentClaim: 'valid_bid_placed',
			postCloseDecision: 'winner',
		})
		auctionState.bids.set(bid.id, bidState)
		auctionState.pathReleases.set(bid.id, buildPathRelease(bid.id, path, childPubkey))
		recordNut7State(bidState, bid.proofYs[0], 'spent', auctionWithRealXpub.maxEndAt + 500)

		const v = deriveVerdict({ auctionState, bidState, now: auctionWithRealXpub.maxEndAt + 500 })
		expect(v.claim).toBe('settled_late')
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
// currentTopValidBidAmount
// ============================================================================

describe('currentTopValidBidAmount', () => {
	test('returns highest amount among valid_bid_placed bids', () => {
		const auction = buildAuction()
		const auctionState = buildAuctionState(auction)
		const valid1 = buildBid(auction, { id: 'a'.repeat(64), amount: 1_500 })
		const valid2 = buildBid(auction, { id: 'b'.repeat(64), bidderPubkey: BIDDER_B, amount: 2_500 })
		const pending = buildBid(auction, { id: 'c'.repeat(64), amount: 9_999 })
		auctionState.bids.set(valid1.id, buildBidState(valid1, valid1.createdAt, { currentClaim: 'valid_bid_placed' }))
		auctionState.bids.set(valid2.id, buildBidState(valid2, valid2.createdAt, { currentClaim: 'valid_bid_placed' }))
		auctionState.bids.set(pending.id, buildBidState(pending, pending.createdAt, { currentClaim: 'bid_pending_review' }))

		// pending bid not counted even though its amount is highest.
		expect(currentTopValidBidAmount(auctionState)).toBe(2_500)
	})

	test('returns 0 when no valid bids', () => {
		const auction = buildAuction()
		const auctionState = buildAuctionState(auction)
		expect(currentTopValidBidAmount(auctionState)).toBe(0)
	})
})
