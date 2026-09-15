import { beforeEach, describe, expect, test } from 'bun:test'
import { hasFinalSettlementForAuctionWin, isAuctionDetailPath } from '@/lib/auction/winNotification'
import { auctionWonActions, auctionWonStore, type AuctionWonPayload } from '@/lib/stores/auctionWon'
import type { NostrEventLike } from '@/lib/nostr/eventLike'

const AUCTION_ROOT_ID = 'a'.repeat(64)
const OTHER_AUCTION_ROOT_ID = 'b'.repeat(64)
const SELLER_PUBKEY = 'c'.repeat(64)
const OTHER_SELLER_PUBKEY = 'd'.repeat(64)
const WINNING_BID_ID = 'e'.repeat(64)
const WINNER_PUBKEY = 'f'.repeat(64)
const OTHER_BIDDER_PUBKEY = '4'.repeat(64)
const PATH_RELEASE_ID = '1'.repeat(64)
const SETTLEMENT_ID = '2'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-1`

const auction: NostrEventLike = {
	id: AUCTION_ROOT_ID,
	pubkey: SELLER_PUBKEY,
	kind: 30408,
	created_at: 100,
	content: '',
	tags: [['d', 'auction-1']],
}

const win: AuctionWonPayload = {
	bidderPubkey: WINNER_PUBKEY,
	auctionRootEventId: AUCTION_ROOT_ID,
	bidEventId: WINNING_BID_ID,
	bidAmount: 5000,
}

const makeSettlement = (overrides: Partial<NostrEventLike> = {}): NostrEventLike => ({
	id: SETTLEMENT_ID,
	pubkey: SELLER_PUBKEY,
	kind: 1024,
	created_at: 200,
	content: '',
	tags: [
		['e', AUCTION_ROOT_ID],
		['a', AUCTION_COORDINATE],
		['status', 'settled'],
		['close_at', '190'],
		['winning_bid', WINNING_BID_ID],
		['winner', WINNER_PUBKEY],
		['final_amount', '5000'],
		['path_release', PATH_RELEASE_ID],
	],
	...overrides,
})

beforeEach(() => {
	auctionWonStore.setState(() => ({ queue: [] }))
})

describe('auction win queue', () => {
	test('queues multiple wins in FIFO order and ignores duplicate auctions', () => {
		const secondWin: AuctionWonPayload = {
			bidderPubkey: WINNER_PUBKEY,
			auctionRootEventId: OTHER_AUCTION_ROOT_ID,
			bidEventId: '3'.repeat(64),
			bidAmount: 7000,
		}

		auctionWonActions.enqueue(win)
		auctionWonActions.enqueue(secondWin)
		auctionWonActions.enqueue({ ...win, bidAmount: 9000 })

		expect(auctionWonStore.state.queue).toEqual([win, secondWin])
	})

	test('dismisses only the active win so the next queued win can be verified', () => {
		const secondWin: AuctionWonPayload = {
			bidderPubkey: WINNER_PUBKEY,
			auctionRootEventId: OTHER_AUCTION_ROOT_ID,
			bidEventId: '3'.repeat(64),
			bidAmount: 7000,
		}
		auctionWonActions.enqueue(win)
		auctionWonActions.enqueue(secondWin)

		auctionWonActions.dismissActive()

		expect(auctionWonStore.state.queue).toEqual([secondWin])
	})

	test('retains only wins owned by the authenticated bidder', () => {
		const otherBidderWin: AuctionWonPayload = {
			bidderPubkey: OTHER_BIDDER_PUBKEY,
			auctionRootEventId: AUCTION_ROOT_ID,
			bidEventId: '3'.repeat(64),
			bidAmount: 7000,
		}
		auctionWonActions.enqueue(win)
		auctionWonActions.enqueue(otherBidderWin)

		auctionWonActions.retainForBidder(OTHER_BIDDER_PUBKEY)

		expect(auctionWonStore.state.queue).toEqual([otherBidderWin])
	})

	test('clears every queued win on logout', () => {
		auctionWonActions.enqueue(win)

		auctionWonActions.clear()

		expect(auctionWonStore.state.queue).toEqual([])
	})
})

describe('auction win settlement verification', () => {
	test('marks the queued auction resolved when its seller published a final settlement', () => {
		expect(hasFinalSettlementForAuctionWin(win, auction, AUCTION_COORDINATE, [makeSettlement()])).toBe(true)
	})

	test('keeps the queued auction unresolved when no settlement exists', () => {
		expect(hasFinalSettlementForAuctionWin(win, auction, AUCTION_COORDINATE, [])).toBe(false)
	})

	test('ignores settlements from another seller or auction', () => {
		const wrongSeller = makeSettlement({ pubkey: OTHER_SELLER_PUBKEY })
		const wrongAuction = makeSettlement({
			tags: makeSettlement().tags.map((tag) => (tag[0] === 'e' ? ['e', OTHER_AUCTION_ROOT_ID] : tag)),
		})

		expect(hasFinalSettlementForAuctionWin(win, auction, AUCTION_COORDINATE, [wrongSeller, wrongAuction])).toBe(false)
	})

	test('ignores malformed settlement events', () => {
		const malformed = makeSettlement({ tags: makeSettlement().tags.filter((tag) => tag[0] !== 'path_release') })

		expect(hasFinalSettlementForAuctionWin(win, auction, AUCTION_COORDINATE, [malformed])).toBe(false)
	})
})

describe('auction winner modal route visibility', () => {
	test('suppresses the global modal on auction detail routes', () => {
		expect(isAuctionDetailPath(`/auctions/${AUCTION_ROOT_ID}`)).toBe(true)
		expect(isAuctionDetailPath(`/dashboard/products/auctions/${AUCTION_ROOT_ID}`)).toBe(true)
	})

	test('allows the global modal on auction lists and unrelated routes', () => {
		expect(isAuctionDetailPath('/auctions')).toBe(false)
		expect(isAuctionDetailPath('/dashboard/products/auctions')).toBe(false)
		expect(isAuctionDetailPath('/products')).toBe(false)
	})
})
