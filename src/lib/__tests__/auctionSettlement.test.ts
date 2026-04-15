import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { buildActiveAuctionBidChains, compareAuctionBidChainPriority } from '../auctionSettlement'

const makeBid = (params: {
	id: string
	pubkey: string
	amount: number
	createdAt: number
	status?: string
	prevBidId?: string
}): NDKEvent =>
	({
		id: params.id,
		pubkey: params.pubkey,
		created_at: params.createdAt,
		content: JSON.stringify({ amount: params.amount }),
		tags: [
			['amount', String(params.amount), 'SAT'],
			['status', params.status ?? 'locked'],
			...(params.prevBidId ? ([['prev_bid', params.prevBidId]] as string[][]) : []),
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

	test('compareAuctionBidChainPriority prefers higher amount, then later timestamp, then lexicographic id', () => {
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
		const laterTie = {
			bidderPubkey: 'carol',
			latestBid: makeBid({ id: 'c', pubkey: 'carol', amount: 1200, createdAt: 6 }),
			chain: [],
		}

		const sorted = [lower, higher, laterTie].sort(compareAuctionBidChainPriority)

		expect(sorted.map((entry) => entry.latestBid.id)).toEqual(['c', 'b', 'a'])
	})
})
