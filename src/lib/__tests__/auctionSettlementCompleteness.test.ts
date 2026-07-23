import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, ParsedSettlementEvent } from '../auction/events'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import { validateSettlementCompleteness } from '../auction/validation'

const SELLER_PK = 'a'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const REAL_XPUB = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'

const stubRawEvent = (kind: number, pubkey: string): NDKEvent =>
	({
		kind,
		pubkey,
		content: '',
		tags: [] as string[][],
		id: 'stub',
		created_at: 0,
	}) as unknown as NDKEvent

const buildLockSecret = (childPubkey: string, locktime: number): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce: 'test-nonce-' + Math.random().toString(36).slice(2, 10),
			data: childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(locktime)],
				['refund', REFUND_PK],
				['n_sigs_refund', '1'],
			],
		},
	])

const buildAuction = (): ParsedAuctionEvent => ({
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
	p2pkXpub: REAL_XPUB,
	auditors: ['c'.repeat(64)],
	auditorQuorum: 1,
	maxSkewSec: 60,
	fallbackDelaySec: 1_800,
	vadiumRatioBps: 10_000,
	schema: 'auction_v1',
})

const buildBid = (auction: ParsedAuctionEvent, input: { id: string; amount: number; path: string; prevBidId?: string }): ParsedBidEvent => {
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(auction.p2pkXpub, input.path)
	const locktime = auction.maxEndAt + auction.settlementGrace
	const lockSecret = buildLockSecret(childPubkey, locktime)
	return {
		rawEvent: stubRawEvent(1023, BIDDER_PK),
		id: input.id,
		bidderPubkey: BIDDER_PK,
		createdAt: 1_500,
		auctionRootEventId: auction.rootEventId,
		auctionCoordinate: auction.coordinate,
		sellerPubkey: auction.sellerPubkey,
		amount: input.amount,
		currency: 'SAT',
		mint: 'https://mint.test',
		locktime,
		refundPubkey: REFUND_PK,
		childPubkey,
		lockSecrets: [lockSecret],
		proofYs: [hashToCurveHexFromString(lockSecret)],
		createdForEndAt: auction.endAt,
		bidNonce: `nonce-${input.id.slice(0, 4)}`,
		keyScheme: 'hd_p2pk',
		status: 'locked',
		prevBidId: input.prevBidId,
	}
}

const buildToken = (mint: string, secret: string, amount: number): string => {
	const proof: Proof = {
		id: '009a1f293253e41e',
		amount,
		secret,
		C: '02' + '1'.repeat(64),
	}
	return getEncodedToken({ mint, proofs: [proof] })
}

const buildPathRelease = (
	bid: ParsedBidEvent,
	path: string,
	id: string,
	releaseReason: ParsedPathReleaseEvent['releaseReason'] = 'settlement',
): ParsedPathReleaseEvent => ({
	rawEvent: stubRawEvent(1025, bid.bidderPubkey),
	id,
	bidderPubkey: bid.bidderPubkey,
	createdAt: 2_200,
	bidEventId: bid.id,
	auctionCoordinate: bid.auctionCoordinate,
	sellerPubkey: bid.sellerPubkey,
	derivationPath: path,
	childPubkey: bid.childPubkey,
	releaseReason,
	auditorRefs: [],
	fallbackOfferId: releaseReason === 'fallback_settlement' ? '9'.repeat(64) : undefined,
	cashuToken: buildToken(bid.mint, bid.lockSecrets[0], bid.prevBidId ? bid.amount - 60 : bid.amount),
	content: '',
})

const buildSettlement = (auction: ParsedAuctionEvent, winningBid: ParsedBidEvent, pathReleaseEventId: string): ParsedSettlementEvent => ({
	rawEvent: stubRawEvent(1024, SELLER_PK),
	id: '4'.repeat(64),
	sellerPubkey: SELLER_PK,
	createdAt: auction.maxEndAt + 300,
	auctionRootEventId: auction.rootEventId,
	auctionCoordinate: auction.coordinate,
	status: 'settled',
	closeAt: auction.maxEndAt + 300,
	winningBidId: winningBid.id,
	winnerPubkey: winningBid.bidderPubkey,
	finalAmount: winningBid.amount,
	pathReleaseEventId,
	payouts: [{ bidEventId: winningBid.id, amount: winningBid.amount, status: 'redeemed' }],
	fallbackChain: [],
})

describe('validateSettlementCompleteness', () => {
	test('accepts a valid single-leg settlement', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { id: '2'.repeat(64), amount: 100, path: 'm/0/0/0/0/0' })
		const release = buildPathRelease(bid, 'm/0/0/0/0/0', '3'.repeat(64))
		const settlement = buildSettlement(auction, bid, release.id)

		const result = validateSettlementCompleteness({
			auction,
			settlement,
			winningBid: bid,
			pathRelease: release,
			winningBidClaim: 'won_pending_settlement',
			winningBidPostCloseDecision: 'winner',
			winningBidNut7State: 'spent',
		})

		expect(result.isComplete).toBe(true)
		if (result.isComplete) {
			expect(result.payoutSum).toBe(100)
			expect(result.legCount).toBe(1)
		}
	})

	test('rejects payout sum mismatch', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { id: '2'.repeat(64), amount: 100, path: 'm/0/0/0/0/0' })
		const release = buildPathRelease(bid, 'm/0/0/0/0/0', '3'.repeat(64))
		const settlement = {
			...buildSettlement(auction, bid, release.id),
			finalAmount: 99,
			payouts: [{ bidEventId: bid.id, amount: 100, status: 'redeemed' }],
		}

		const result = validateSettlementCompleteness({
			auction,
			settlement,
			winningBid: bid,
			pathRelease: release,
			winningBidPostCloseDecision: 'winner',
			winningBidNut7State: 'spent',
		})

		expect(result.isComplete).toBe(false)
		if (!result.isComplete) expect(result.failureCode).toBe('payout_sum_mismatch')
	})

	test('accepts a valid two-leg payout chain', () => {
		const auction = buildAuction()
		const leg1 = buildBid(auction, { id: '2'.repeat(64), amount: 60, path: 'm/0/0/0/0/1' })
		const leg2 = buildBid(auction, { id: '3'.repeat(64), amount: 100, path: 'm/0/0/0/0/2', prevBidId: leg1.id })
		const release1: ParsedPathReleaseEvent = {
			...buildPathRelease(leg1, 'm/0/0/0/0/1', '5'.repeat(64)),
			cashuToken: buildToken(leg1.mint, leg1.lockSecrets[0], 60),
		}
		const release2: ParsedPathReleaseEvent = {
			...buildPathRelease(leg2, 'm/0/0/0/0/2', '6'.repeat(64)),
			cashuToken: buildToken(leg2.mint, leg2.lockSecrets[0], 40),
		}
		const settlement: ParsedSettlementEvent = {
			...buildSettlement(auction, leg2, release2.id),
			payouts: [
				{ bidEventId: leg1.id, amount: 60, status: 'redeemed' },
				{ bidEventId: leg2.id, amount: 40, status: 'redeemed' },
			],
		}

		const result = validateSettlementCompleteness({
			auction,
			settlement,
			winningBid: leg2,
			pathRelease: release2,
			winningBidClaim: 'won_pending_settlement',
			winningBidPostCloseDecision: 'winner',
			winningBidNut7State: 'spent',
			bidChain: [
				{ bid: leg1, pathRelease: release1, nut7State: 'spent' },
				{ bid: leg2, pathRelease: release2, nut7State: 'spent' },
			],
		})

		expect(result.isComplete).toBe(true)
		if (result.isComplete) {
			expect(result.payoutSum).toBe(100)
			expect(result.legCount).toBe(2)
		}
	})

	test('rejects fallback settlement without accepted fallback entry', () => {
		const auction = buildAuction()
		const bid = buildBid(auction, { id: '2'.repeat(64), amount: 100, path: 'm/0/0/0/0/0' })
		const release = buildPathRelease(bid, 'm/0/0/0/0/0', '3'.repeat(64), 'fallback_settlement')
		const settlement: ParsedSettlementEvent = {
			...buildSettlement(auction, bid, release.id),
			fallbackChain: [{ bidEventId: '5'.repeat(64), status: 'griefed' }],
		}

		const result = validateSettlementCompleteness({
			auction,
			settlement,
			winningBid: bid,
			pathRelease: release,
			winningBidPostCloseDecision: 'loser',
			winningBidNut7State: 'spent',
		})

		expect(result.isComplete).toBe(false)
		if (!result.isComplete) expect(result.failureCode).toBe('fallback_chain_inconsistent')
	})
})
