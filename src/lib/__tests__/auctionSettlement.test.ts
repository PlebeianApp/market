import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
	computeAuctionBidFloor,
	computeAuctionFloorMultiplier,
	getAuctionBiddingCutoffAt,
	getAuctionCurrentPrice,
	getAuctionEffectiveEndAt,
	getAuctionMinBidCurve,
	getAuctionRootEventId,
	getAuctionWindowValidBids,
	resolveAuctionVersionSet,
} from '../auctionSettlement'

const makeBid = (params: {
	id: string
	pubkey: string
	amount: number
	createdAt: number
	auctionEventId?: string
	status?: string
	prevBidId?: string
}): NDKEvent =>
	({
		id: params.id,
		pubkey: params.pubkey,
		created_at: params.createdAt,
		content: JSON.stringify({ amount: params.amount }),
		tags: [
			['e', params.auctionEventId ?? 'auction-root'],
			['amount', String(params.amount), 'SAT'],
			['status', params.status ?? 'locked'],
			...(params.prevBidId ? ([['prev_bid', params.prevBidId]] as string[][]) : []),
		],
	}) as NDKEvent

const makeAuction = (params: {
	id: string
	dTag?: string
	pubkey?: string
	title?: string
	createdAt?: number
	startAt?: number
	endAt: number
	startingBid?: number
	bidIncrement?: number
	reserve?: number
	rootEventId?: string
	extensionRule?: string
	maxEndAt?: number
	/** `<shape>:<peak>` (e.g. `linear:5.0`). Omit for no curve. */
	minBidCurve?: string
}): NDKEvent =>
	({
		id: params.id,
		pubkey: params.pubkey ?? 'seller',
		created_at: params.createdAt ?? 10,
		content: 'Auction description',
		tags: [
			['d', params.dTag ?? 'auction-1'],
			['title', params.title ?? 'Auction'],
			['auction_type', 'english'],
			['start_at', String(params.startAt ?? 100)],
			['end_at', String(params.endAt)],
			['currency', 'SAT'],
			['price', String(params.startingBid ?? 1000), 'SAT'],
			['starting_bid', String(params.startingBid ?? 1000), 'SAT'],
			['bid_increment', String(params.bidIncrement ?? 100)],
			['reserve', String(params.reserve ?? 0)],
			['mint', 'https://mint.example'],
			['path_issuer', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', 'xpub-auction-root'],
			['settlement_policy', 'cashu_p2pk_path_oracle_v1'],
			['schema', 'auction_v1'],
			...(params.rootEventId ? ([['auction_root_event_id', params.rootEventId]] as string[][]) : []),
			...(params.extensionRule ? ([['extension_rule', params.extensionRule]] as string[][]) : [['extension_rule', 'none']]),
			// Mirror the production invariant: max_end_at is always present.
			// Defaults to end_at when no anti-sniping is configured.
			['max_end_at', String(params.maxEndAt ?? params.endAt)],
			...(params.minBidCurve ? ([['min_bid_curve', params.minBidCurve]] as string[][]) : []),
		],
	}) as NDKEvent

describe('auctionSettlement helpers', () => {
	test('buildActiveAuctionBidChains reconstructs latest active chain per bidder', () => {
		const firstAliceBid = makeBid({ id: 'alice-1', pubkey: 'alice', amount: 1000, createdAt: 10 })
		const secondAliceBid = makeBid({ id: 'alice-2', pubkey: 'alice', amount: 1400, createdAt: 20, prevBidId: 'alice-1' })
		const bobBid = makeBid({ id: 'bob-1', pubkey: 'bob', amount: 1200, createdAt: 15 })
		const staleAliceBid = makeBid({ id: 'alice-stale', pubkey: 'alice', amount: 900, createdAt: 5 })

		const chains = buildActiveAuctionBidChains([staleAliceBid, bobBid, firstAliceBid, secondAliceBid])
		const aliceChain = chains.find((chain) => chain.bidderPubkey === 'alice')
		const bobChain = chains.find((chain) => chain.bidderPubkey === 'bob')

		expect(chains).toHaveLength(2)
		expect(aliceChain?.latestBid.id).toBe('alice-2')
		expect(aliceChain?.chain.map((bid) => bid.id)).toEqual(['alice-1', 'alice-2'])
		expect(bobChain?.chain.map((bid) => bid.id)).toEqual(['bob-1'])
	})

	test('compareAuctionBidChainPriority prefers higher amount, then earlier timestamp, then lexicographic id', () => {
		const lower = {
			bidderPubkey: 'alice',
			latestBid: makeBid({ id: 'a', pubkey: 'alice', amount: 1000, createdAt: 10 }),
			chain: [],
		}
		const higher = {
			bidderPubkey: 'bob',
			latestBid: makeBid({ id: 'b', pubkey: 'bob', amount: 1200, createdAt: 5 }),
			chain: [],
		}
		const earlierTie = {
			bidderPubkey: 'carol',
			latestBid: makeBid({ id: 'c', pubkey: 'carol', amount: 1200, createdAt: 4 }),
			chain: [],
		}

		const sorted = [lower, higher, earlierTie].sort(compareAuctionBidChainPriority)

		expect(sorted.map((entry) => entry.latestBid.id)).toEqual(['c', 'b', 'a'])
	})

	test('compareAuctionBidChainPriority prefers smaller event id when amount and created_at match', () => {
		const smallerId = {
			bidderPubkey: 'alice',
			latestBid: makeBid({ id: 'aaa', pubkey: 'alice', amount: 1200, createdAt: 5 }),
			chain: [],
		}
		const largerId = {
			bidderPubkey: 'bob',
			latestBid: makeBid({ id: 'bbb', pubkey: 'bob', amount: 1200, createdAt: 5 }),
			chain: [],
		}

		const sorted = [largerId, smallerId].sort(compareAuctionBidChainPriority)

		expect(sorted.map((entry) => entry.latestBid.id)).toEqual(['aaa', 'bbb'])
	})

	test('resolveAuctionVersionSet pins the first publish as root and ignores immutable changes', () => {
		const rootAuction = makeAuction({ id: 'auction-root', title: 'Original title', createdAt: 10, endAt: 200 })
		const mutableUpdate = makeAuction({
			id: 'auction-update',
			title: 'Updated title',
			createdAt: 20,
			endAt: 200,
			rootEventId: 'auction-root',
		})
		const immutableViolation = makeAuction({
			id: 'auction-bad-update',
			title: 'Bad update',
			createdAt: 30,
			endAt: 240,
			rootEventId: 'auction-root',
		})

		const resolved = resolveAuctionVersionSet([immutableViolation, mutableUpdate, rootAuction])

		expect(resolved?.rootEvent.id).toBe('auction-root')
		expect(resolved?.displayEvent.id).toBe('auction-update')
		expect(resolved?.rootEventId).toBe('auction-root')
		expect(resolved?.rejectedEventIds).toEqual(['auction-bad-update'])
		expect(getAuctionRootEventId(resolved!.displayEvent)).toBe('auction-root')
	})

	test('effective end time extends only for valid in-window anti-snipe bids and caps at max_end_at', () => {
		const auction = makeAuction({
			id: 'auction-root',
			startAt: 100,
			endAt: 200,
			extensionRule: 'anti_sniping:30:60',
			maxEndAt: 320,
		})
		const bids = [
			makeBid({ id: 'bid-early', pubkey: 'alice', amount: 1100, createdAt: 150 }),
			makeBid({ id: 'bid-snipe-1', pubkey: 'bob', amount: 1200, createdAt: 185 }),
			makeBid({ id: 'bid-snipe-2', pubkey: 'carol', amount: 1300, createdAt: 250 }),
			makeBid({ id: 'bid-too-late', pubkey: 'dave', amount: 1400, createdAt: 321 }),
		]

		expect(getAuctionEffectiveEndAt(auction, bids)).toBe(320)
		expect(getAuctionWindowValidBids(auction, bids).map((bid) => bid.id)).toEqual(['bid-early', 'bid-snipe-1', 'bid-snipe-2'])
		expect(getAuctionCurrentPrice(auction, bids, 1000)).toBe(1300)
	})

	test('bidding cutoff is max_end_at when max_end_at is after end_at', () => {
		const auction = makeAuction({
			id: 'auction-root',
			startAt: 100,
			endAt: 200,
			extensionRule: 'none',
			maxEndAt: 320,
		})

		expect(getAuctionBiddingCutoffAt(auction)).toBe(320)
	})

	test('bidding cutoff falls back to end_at when max_end_at is 0', () => {
		const auction = makeAuction({
			id: 'auction-root',
			startAt: 100,
			endAt: 200,
			extensionRule: 'none',
			maxEndAt: 0,
		})

		expect(getAuctionBiddingCutoffAt(auction)).toBe(200)
	})

	test('bidding cutoff falls back to end_at when max_end_at is before end_at', () => {
		const auction = makeAuction({
			id: 'auction-root',
			startAt: 100,
			endAt: 200,
			extensionRule: 'none',
			maxEndAt: 150,
		})

		expect(getAuctionBiddingCutoffAt(auction)).toBe(200)
	})
})

describe('min_bid_curve parsing + floor multiplier (AUCTIONS.md §6.1)', () => {
	test('missing tag → none/1.0, no boost', () => {
		const auction = makeAuction({ id: 'a', endAt: 200 })
		expect(getAuctionMinBidCurve(auction).shape).toBe('none')
		expect(getAuctionMinBidCurve(auction).peakMultiplier).toBe(1)
		expect(computeAuctionFloorMultiplier({ atSeconds: 250, endAt: 200, maxEndAt: 300, shape: 'none', peakMultiplier: 1 })).toBe(1)
	})

	test('shape=none is a no-op regardless of peak', () => {
		expect(computeAuctionFloorMultiplier({ atSeconds: 300, endAt: 200, maxEndAt: 300, shape: 'none', peakMultiplier: 10 })).toBe(1)
	})

	test('zero-duration window disables the curve', () => {
		// max_end_at == end_at — no anti-snipe window picked by seller.
		expect(computeAuctionFloorMultiplier({ atSeconds: 300, endAt: 200, maxEndAt: 200, shape: 'exponential', peakMultiplier: 5 })).toBe(1)
	})

	test('peak=1 is a no-op (no flat-floor regression)', () => {
		expect(computeAuctionFloorMultiplier({ atSeconds: 250, endAt: 200, maxEndAt: 300, shape: 'linear', peakMultiplier: 1 })).toBe(1)
	})

	test('linear: midpoint = (1 + peak) / 2', () => {
		expect(computeAuctionFloorMultiplier({ atSeconds: 250, endAt: 200, maxEndAt: 300, shape: 'linear', peakMultiplier: 5 })).toBeCloseTo(
			3,
			10,
		)
	})

	test('exponential: midpoint = sqrt(peak)', () => {
		const result = computeAuctionFloorMultiplier({ atSeconds: 250, endAt: 200, maxEndAt: 300, shape: 'exponential', peakMultiplier: 9 })
		expect(result).toBeCloseTo(3, 10)
	})

	test('boundary: at exactly end_at → multiplier = 1', () => {
		expect(computeAuctionFloorMultiplier({ atSeconds: 200, endAt: 200, maxEndAt: 300, shape: 'exponential', peakMultiplier: 10 })).toBe(1)
	})

	test('boundary: at or beyond max_end_at → multiplier = peak', () => {
		expect(computeAuctionFloorMultiplier({ atSeconds: 300, endAt: 200, maxEndAt: 300, shape: 'linear', peakMultiplier: 7 })).toBe(7)
		expect(computeAuctionFloorMultiplier({ atSeconds: 500, endAt: 200, maxEndAt: 300, shape: 'exponential', peakMultiplier: 7 })).toBe(7)
	})

	test('parser clamps absurd peak to [1, 100]', () => {
		const auction = makeAuction({ id: 'a', endAt: 200, minBidCurve: 'linear:9999.0' })
		expect(getAuctionMinBidCurve(auction).peakMultiplier).toBe(100)
	})

	test('parser tolerates malformed tag → falls back to none/1', () => {
		const auction = makeAuction({ id: 'a', endAt: 200, minBidCurve: 'jellybean:42' })
		expect(getAuctionMinBidCurve(auction).shape).toBe('none')
		expect(getAuctionMinBidCurve(auction).peakMultiplier).toBe(1)
	})
})

describe('computeAuctionBidFloor (AUCTIONS.md §6.1)', () => {
	test('first-bid case (top_bid=0): floor = starting_bid × multiplier', () => {
		const auction = makeAuction({
			id: 'a',
			startAt: 100,
			endAt: 200,
			maxEndAt: 300,
			startingBid: 1000,
			bidIncrement: 50,
			minBidCurve: 'linear:5.0',
		})
		// At end_at: multiplier=1 → floor = starting_bid
		expect(computeAuctionBidFloor(auction, 0, 200)).toBe(1000)
		// Midpoint of window: multiplier=3 → floor = 3000
		expect(computeAuctionBidFloor(auction, 0, 250)).toBe(3000)
		// At max_end_at: multiplier=5 → floor = 5000
		expect(computeAuctionBidFloor(auction, 0, 300)).toBe(5000)
	})

	test('subsequent-bid case: floor = (top_bid + bid_increment) × multiplier', () => {
		const auction = makeAuction({
			id: 'a',
			startAt: 100,
			endAt: 200,
			maxEndAt: 300,
			startingBid: 1000,
			bidIncrement: 50,
			minBidCurve: 'linear:5.0',
		})
		// Before curve: floor = top + increment = 2050
		expect(computeAuctionBidFloor(auction, 2000, 150)).toBe(2050)
		// Midpoint: (top + inc) × 3 = 2050 × 3 = 6150
		expect(computeAuctionBidFloor(auction, 2000, 250)).toBe(6150)
	})

	test('rounds up: fractional multiplier is never shaved by the bidder', () => {
		const auction = makeAuction({
			id: 'a',
			startAt: 100,
			endAt: 200,
			maxEndAt: 300,
			startingBid: 100,
			bidIncrement: 1,
			minBidCurve: 'exponential:2.0',
		})
		// At t=210 (10% into 100-second window) with exp+peak=2: multiplier = 2^0.1 ≈ 1.0718
		// floor for first bid = ceil(100 × 1.0718) = 108
		expect(computeAuctionBidFloor(auction, 0, 210)).toBe(108)
	})

	test('monotonic non-decreasing over time (no surprises for bidders)', () => {
		const auction = makeAuction({
			id: 'a',
			startAt: 100,
			endAt: 200,
			maxEndAt: 300,
			startingBid: 1000,
			bidIncrement: 50,
			minBidCurve: 'exponential:10.0',
		})
		let previous = -Infinity
		for (let t = 150; t <= 320; t += 1) {
			const floor = computeAuctionBidFloor(auction, 5000, t)
			expect(floor).toBeGreaterThanOrEqual(previous)
			previous = floor
		}
	})
})
