import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
	getAuctionCurrentPrice,
	getAuctionEffectiveEndAt,
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
			...(params.maxEndAt ? ([['max_end_at', String(params.maxEndAt)]] as string[][]) : []),
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
})
