import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getAuctionBidderStatus } from '@/lib/auctionBidderStatus'

const makeAuction = (params: { id?: string; startAt?: number; endAt?: number }): NDKEvent =>
	({
		id: params.id ?? 'auction-root',
		pubkey: 'seller',
		created_at: 1,
		content: 'Auction description',
		tags: [
			['d', 'auction-1'],
			['title', 'Auction'],
			['start_at', String(params.startAt ?? 100)],
			['end_at', String(params.endAt ?? 300)],
			['max_end_at', String(params.endAt ?? 300)],
			['extension_rule', 'none'],
		],
	}) as NDKEvent

const makeBid = (params: { id: string; pubkey: string; amount: number; createdAt: number; status?: string }): NDKEvent =>
	({
		id: params.id,
		pubkey: params.pubkey,
		created_at: params.createdAt,
		content: JSON.stringify({ amount: params.amount }),
		tags: [
			['e', 'auction-root'],
			['amount', String(params.amount), 'SAT'],
			['status', params.status ?? 'locked'],
		],
	}) as NDKEvent

describe('auction bidder status', () => {
	test('no current user returns no status', () => {
		const auction = makeAuction({})
		const bids = [makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 })]

		expect(getAuctionBidderStatus({ currentUserPubkey: '', auction, bids, isEnded: false })).toBeNull()
	})

	test('current user with no bids returns no status', () => {
		const auction = makeAuction({})
		const bids = [makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 })]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: false })).toBeNull()
	})

	test('current user is top bidder while live', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: false })).toEqual({
			status: 'winning',
			label: "You're winning",
		})
	})

	test('current user is outbid while live', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: false })).toEqual({
			status: 'outbid',
			label: "You've been outbid",
		})
	})

	test('current user is top bidder after ended', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: true })).toEqual({
			status: 'won',
			label: 'You had the top bid',
		})
	})

	test('current user is outbid after ended', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-1', pubkey: 'alice', amount: 1000, createdAt: 120 }),
			makeBid({ id: 'bid-2', pubkey: 'bob', amount: 1200, createdAt: 130 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: true })).toEqual({
			status: 'was_outbid',
			label: 'You were outbid',
		})
	})

	test('tie-breaker follows existing auction bid ordering semantics', () => {
		const auction = makeAuction({})
		const bids = [
			makeBid({ id: 'bid-later', pubkey: 'alice', amount: 1200, createdAt: 130 }),
			makeBid({ id: 'bid-earlier', pubkey: 'bob', amount: 1200, createdAt: 120 }),
		]

		expect(getAuctionBidderStatus({ currentUserPubkey: 'bob', auction, bids, isEnded: false })).toEqual({
			status: 'winning',
			label: "You're winning",
		})
		expect(getAuctionBidderStatus({ currentUserPubkey: 'alice', auction, bids, isEnded: false })?.status).toBe('outbid')
	})
})
