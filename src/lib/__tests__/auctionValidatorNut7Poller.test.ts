import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, MinBidCurve } from '../auction/events'
import { NUT7_REACHABILITY_PROBE_Y } from '../cashu/nut7'
import { POST_GRACE_BASE_BACKOFF_SEC, POST_GRACE_MAX_ATTEMPTS, createNut7Poller } from '../../server/auction-validator/nut7Poller'
import {
	collectLiveBids,
	createValidatorState,
	recordPathRelease,
	setAuctionMintReachability,
	upsertAuction,
	upsertBid,
} from '../../server/auction-validator/state'

const SELLER_PK = 'a'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const VALIDATOR_PK = 'c'.repeat(64)
const COMPRESSED_PK = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const PROOF_Y_1 = '02' + 'f'.repeat(64)
const PROOF_Y_2 = '03' + '1'.repeat(64)
const NO_CURVE: MinBidCurve = { shape: 'none', peakMultiplier: 1, raw: '' }

const buildAuctionRawEvent = (
	overrides: {
		endAt?: number
		maxEndAt?: number
		settlementGrace?: number
		p2pkXpub?: string
		mints?: string[]
	} = {},
): NDKEvent => {
	const endAt = overrides.endAt ?? 2_000
	const maxEndAt = overrides.maxEndAt ?? 2_100
	const settlementGrace = overrides.settlementGrace ?? 100
	const mints = overrides.mints ?? ['https://mint.test']
	return {
		id: '1'.repeat(64),
		kind: 30408,
		pubkey: SELLER_PK,
		created_at: 1_000,
		content: '',
		tags: [
			['d', 'auction-test'],
			['title', 'Auction'],
			['auction_type', 'english'],
			['start_at', '1000'],
			['end_at', String(endAt)],
			['max_end_at', String(maxEndAt)],
			['settlement_grace', String(settlementGrace)],
			['currency', 'SAT'],
			['reserve', '0'],
			['starting_bid', '1000'],
			['bid_increment', '100'],
			['min_bid_curve', 'none'],
			['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', overrides.p2pkXpub ?? 'xpub-root'],
			['auditors', VALIDATOR_PK],
			['auditor_quorum', '1'],
			['max_skew_sec', '60'],
			['fallback_delay_sec', '1800'],
			...mints.map((mint) => ['mint', mint] as string[]),
		],
	} as unknown as NDKEvent
}

const buildAuction = (
	overrides: {
		endAt?: number
		maxEndAt?: number
		settlementGrace?: number
		p2pkXpub?: string
		mints?: string[]
	} = {},
): ParsedAuctionEvent => {
	const rawEvent = buildAuctionRawEvent(overrides)
	const maxEndAt = overrides.maxEndAt ?? 2_100
	const settlementGrace = overrides.settlementGrace ?? 100
	return {
		rawEvent,
		dTag: 'auction-test',
		sellerPubkey: SELLER_PK,
		coordinate: `30408:${SELLER_PK}:auction-test`,
		rootEventId: rawEvent.id,
		title: 'Auction',
		content: '',
		auctionType: 'english',
		startAt: 1_000,
		endAt: overrides.endAt ?? 2_000,
		maxEndAt,
		settlementGrace,
		currency: 'SAT',
		reserve: 0,
		startingBid: 1_000,
		bidIncrement: 100,
		minBidCurve: NO_CURVE,
		settlementPolicy: 'cashu_p2pk_bidder_path_v1',
		keyScheme: 'hd_p2pk',
		mints: overrides.mints ?? ['https://mint.test'],
		p2pkXpub: overrides.p2pkXpub ?? 'xpub-root',
		auditors: [VALIDATOR_PK],
		auditorQuorum: 1,
		maxSkewSec: 60,
		fallbackDelaySec: 1_800,
		vadiumRatioBps: 10_000,
		schema: 'auction_v1',
	}
}

const buildBid = (auction: ParsedAuctionEvent, overrides: { id?: string; proofY?: string; prevBidId?: string } = {}): ParsedBidEvent => {
	const proofY = overrides.proofY ?? PROOF_Y_1
	const id = overrides.id ?? '2'.repeat(64)
	return {
		rawEvent: {
			id,
			kind: 1023,
			pubkey: BIDDER_PK,
			created_at: 1_500,
			content: '',
			tags: [],
		} as unknown as NDKEvent,
		id,
		bidderPubkey: BIDDER_PK,
		createdAt: 1_500,
		auctionRootEventId: auction.rootEventId,
		auctionCoordinate: auction.coordinate,
		sellerPubkey: auction.sellerPubkey,
		amount: 1_200,
		currency: 'SAT',
		mint: auction.mints[0]!,
		locktime: auction.maxEndAt + auction.settlementGrace,
		refundPubkey: REFUND_PK,
		childPubkey: COMPRESSED_PK,
		lockSecrets: ['secret'],
		proofYs: [proofY],
		createdForEndAt: auction.maxEndAt,
		bidNonce: 'nonce',
		keyScheme: 'hd_p2pk',
		status: 'locked',
		prevBidId: overrides.prevBidId,
		note: undefined,
	}
}

const buildPathRelease = (auction: ParsedAuctionEvent, bid: ParsedBidEvent): ParsedPathReleaseEvent => ({
	rawEvent: {
		id: '9'.repeat(64),
		kind: 1025,
		pubkey: bid.bidderPubkey,
		created_at: auction.maxEndAt + 120,
		content: '',
		tags: [],
	} as unknown as NDKEvent,
	id: '9'.repeat(64),
	bidderPubkey: bid.bidderPubkey,
	createdAt: auction.maxEndAt + 120,
	bidEventId: bid.id,
	auctionCoordinate: auction.coordinate,
	sellerPubkey: auction.sellerPubkey,
	derivationPath: 'm/0/0/0/0/0',
	childPubkey: bid.childPubkey,
	releaseReason: 'voluntary_late',
	auditorRefs: [],
	cashuToken: 'cashuA-test',
	content: '',
})

describe('auction validator nut7 focused refresh', () => {
	test('refreshBidChain re-queries post-grace released bids and republishes on change', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction({ settlementGrace: 100 })
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [[auction.mints[0]!, true]])

		const bid = buildBid(auction)
		const upserted = upsertBid(state, bid, bid.createdAt)
		if (!upserted) throw new Error('expected bid to upsert')
		upserted.bidState.currentClaim = 'won_pending_settlement'
		recordPathRelease(state, buildPathRelease(auction, bid), auction.maxEndAt + 120)

		const postGraceNow = auction.maxEndAt + auction.settlementGrace + 50
		// Post-grace, a released nonterminal bid IS now collected (it can
		// still settle via a voluntary_late release); only unreleased bids
		// are excluded post-grace.
		const livePostGrace = collectLiveBids(state, postGraceNow)
		expect(livePostGrace).toHaveLength(1)
		expect(livePostGrace[0]?.bidState.bid.id).toBe(bid.id)

		let publishCalls = 0
		const mintCalls: string[][] = []
		const poller = createNut7Poller({
			state,
			publisher: {
				publishIfChanged: async () => {
					publishCalls += 1
					return { verdict: { claim: 'won_pending_settlement' }, published: true }
				},
			} as any,
			now: () => postGraceNow,
			nut7Options: {
				mintClient: {
					check: async ({ Ys }: { Ys: string[] }) => {
						mintCalls.push(Ys)
						return { states: Ys.map((Y) => ({ Y, state: 'SPENT' })) }
					},
				} as any,
			},
		})

		await poller.refreshBidChain({ auctionRootEventId: auction.rootEventId, bidEventId: bid.id })

		expect(mintCalls).toHaveLength(1)
		expect(mintCalls[0]).toEqual([bid.proofYs[0]])
		expect(upserted.bidState.nut7States.get(bid.proofYs[0]!.toLowerCase())?.state).toBe('spent')
		expect(publishCalls).toBe(1)
	})

	test('refreshAuctionReleasedNonterminal skips unreleased and terminal bids', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction({ settlementGrace: 100 })
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [[auction.mints[0]!, true]])

		const releasedNonterminalBid = buildBid(auction, { id: '2'.repeat(64), proofY: PROOF_Y_1 })
		const terminalReleasedBid = buildBid(auction, { id: '3'.repeat(64), proofY: PROOF_Y_2 })
		const unreleasedBid = buildBid(auction, { id: '4'.repeat(64), proofY: '02' + '2'.repeat(64) })

		const a = upsertBid(state, releasedNonterminalBid, releasedNonterminalBid.createdAt)
		const b = upsertBid(state, terminalReleasedBid, terminalReleasedBid.createdAt)
		const c = upsertBid(state, unreleasedBid, unreleasedBid.createdAt)
		if (!a || !b || !c) throw new Error('expected bids to upsert')

		a.bidState.currentClaim = 'won_pending_settlement'
		b.bidState.currentClaim = 'settled_promptly'
		c.bidState.currentClaim = 'won_pending_settlement'

		recordPathRelease(state, buildPathRelease(auction, releasedNonterminalBid), auction.maxEndAt + 120)
		recordPathRelease(state, buildPathRelease(auction, terminalReleasedBid), auction.maxEndAt + 120)

		const mintCalls: string[][] = []
		const poller = createNut7Poller({
			state,
			publisher: {
				publishIfChanged: async () => ({ verdict: { claim: 'won_pending_settlement' }, published: true }),
			} as any,
			now: () => auction.maxEndAt + auction.settlementGrace + 10,
			nut7Options: {
				mintClient: {
					check: async ({ Ys }: { Ys: string[] }) => {
						mintCalls.push(Ys)
						return { states: Ys.map((Y) => ({ Y, state: 'UNSPENT' })) }
					},
				} as any,
			},
		})

		await poller.refreshAuctionReleasedNonterminal(auction.rootEventId)

		expect(mintCalls).toHaveLength(1)
		expect(mintCalls[0]).toEqual([releasedNonterminalBid.proofYs[0]])
	})
})

describe('auction validator nut7 post-grace retry scheduler', () => {
	const setupReleasedPostGraceBid = () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction({ settlementGrace: 100 })
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [[auction.mints[0]!, true]])
		const bid = buildBid(auction)
		const upserted = upsertBid(state, bid, bid.createdAt)
		if (!upserted) throw new Error('expected bid to upsert')
		upserted.bidState.currentClaim = 'won_pending_settlement'
		recordPathRelease(state, buildPathRelease(auction, bid), auction.maxEndAt + 120)
		return { state, auction, bid, upserted }
	}

	test('first post-grace check unknown, later scheduled check becomes spent without a relay event', async () => {
		const { state, auction, bid, upserted } = setupReleasedPostGraceBid()
		let proofCheckCalls = 0
		let clock = auction.maxEndAt + auction.settlementGrace + 50
		const publishCalls: number[] = []
		const poller = createNut7Poller({
			state,
			publisher: {
				publishIfChanged: async () => {
					publishCalls.push(1)
					return { verdict: { claim: 'won_pending_settlement' }, published: true }
				},
			} as any,
			now: () => clock,
			nut7Options: {
				mintClient: {
					check: async ({ Ys }: { Ys: string[] }) => {
						if (Ys.includes(NUT7_REACHABILITY_PROBE_Y)) {
							return { states: [{ Y: NUT7_REACHABILITY_PROBE_Y, state: 'UNSPENT' }] }
						}
						proofCheckCalls += 1
						// First proof check: malformed state → 'unknown' (no signal).
						if (proofCheckCalls === 1) return { states: Ys.map((Y) => ({ Y, state: 'BOGUS' })) }
						// Later scheduled check: spent → settlement observed.
						return { states: Ys.map((Y) => ({ Y, state: 'SPENT' })) }
					},
				} as any,
			},
		})

		// First tick (post-grace): one proof query, result unknown.
		await poller.tick()
		expect(proofCheckCalls).toBe(1)
		expect(upserted.bidState.nut7States.get(bid.proofYs[0]!.toLowerCase())?.state).toBe('unknown')
		expect(publishCalls).toHaveLength(1)
		// A retry is scheduled with backoff.
		expect(upserted.bidState.postGraceRetry?.attempts).toBe(1)
		expect(upserted.bidState.postGraceRetry?.nextAttemptAt).toBe(clock + POST_GRACE_BASE_BACKOFF_SEC)

		// Advance the clock past the backoff; no new relay event arrives.
		clock = upserted.bidState.postGraceRetry!.nextAttemptAt + 1
		await poller.tick()
		expect(proofCheckCalls).toBe(2)
		expect(upserted.bidState.nut7States.get(bid.proofYs[0]!.toLowerCase())?.state).toBe('spent')
		expect(publishCalls).toHaveLength(2)
	})

	test('backoff respects the explicit cutoff and stops polling a never-redeemed bid', async () => {
		const { state, auction, bid, upserted } = setupReleasedPostGraceBid()
		let proofCheckCalls = 0
		let clock = auction.maxEndAt + auction.settlementGrace + 50
		const poller = createNut7Poller({
			state,
			publisher: {
				publishIfChanged: async () => ({ verdict: { claim: 'won_pending_settlement' }, published: true }),
			} as any,
			now: () => clock,
			nut7Options: {
				mintClient: {
					check: async ({ Ys }: { Ys: string[] }) => {
						if (Ys.includes(NUT7_REACHABILITY_PROBE_Y)) {
							return { states: [{ Y: NUT7_REACHABILITY_PROBE_Y, state: 'UNSPENT' }] }
						}
						proofCheckCalls += 1
						// Never redeems — always unknown.
						return { states: Ys.map((Y) => ({ Y, state: 'BOGUS' })) }
					},
				} as any,
			},
		})

		// Drive ticks past every backoff until the cutoff.
		for (let i = 0; i < POST_GRACE_MAX_ATTEMPTS; i++) {
			await poller.tick()
			const retry = upserted.bidState.postGraceRetry
			if (retry && Number.isFinite(retry.nextAttemptAt)) clock = retry.nextAttemptAt + 1
		}
		expect(proofCheckCalls).toBe(POST_GRACE_MAX_ATTEMPTS)
		// After the cutoff, the bid is no longer due.
		expect(upserted.bidState.postGraceRetry?.attempts).toBe(POST_GRACE_MAX_ATTEMPTS)
		const callsBefore = proofCheckCalls
		await poller.tick()
		await poller.tick()
		expect(proofCheckCalls).toBe(callsBefore) // no further polling
	})
})
