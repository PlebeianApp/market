import { beforeEach, describe, expect, test } from 'bun:test'
import { hasFinalSettlementForAuctionWin, isAuctionWonModalSuppressedPath, selectValidatedAuctionWinner } from '@/lib/auction/winNotification'
import { auctionWonActions, auctionWonStore, type AuctionWonPayload } from '@/lib/stores/auctionWon'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'

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
const AUDITOR_PUBKEY = '5'.repeat(64)
const MINT_URL = 'https://mint.test'

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

const parsedAuction: ParsedAuctionEvent = {
	rawEvent: auction,
	dTag: 'auction-1',
	sellerPubkey: SELLER_PUBKEY,
	coordinate: AUCTION_COORDINATE,
	rootEventId: AUCTION_ROOT_ID,
	title: 'Auction',
	content: '',
	auctionType: 'english',
	startAt: 100,
	endAt: 200,
	maxEndAt: 200,
	settlementGrace: 100,
	currency: 'SAT',
	reserve: 0,
	startingBid: 1000,
	bidIncrement: 100,
	minBidCurve: { shape: 'none', peakMultiplier: 1, raw: 'none:1.0' },
	settlementPolicy: 'cashu_p2pk_bidder_path_v1',
	keyScheme: 'hd_p2pk',
	mints: [MINT_URL],
	p2pkXpub: 'xpub-test',
	auditors: [AUDITOR_PUBKEY],
	auditorQuorum: 1,
	maxSkewSec: 60,
	fallbackDelaySec: 50,
	vadiumRatioBps: 10_000,
	schema: 'auction_v1',
}

const makeParsedBid = (id: string, bidderPubkey: string, amount: number, createdAt: number): ParsedBidEvent => {
	const childPubkey = `02${'6'.repeat(64)}`
	const refundPubkey = `03${'7'.repeat(64)}`
	const locktime = parsedAuction.maxEndAt + parsedAuction.settlementGrace
	const lockSecret = JSON.stringify([
		'P2PK',
		{
			nonce: id,
			data: childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(locktime)],
				['refund', refundPubkey],
				['n_sigs_refund', '1'],
			],
		},
	])
	return {
		rawEvent: { id, pubkey: bidderPubkey, kind: 1023, created_at: createdAt, content: '', tags: [] },
		id,
		bidderPubkey,
		createdAt,
		auctionRootEventId: AUCTION_ROOT_ID,
		auctionCoordinate: AUCTION_COORDINATE,
		sellerPubkey: SELLER_PUBKEY,
		amount,
		legLockedAmount: amount,
		currency: 'SAT',
		mint: MINT_URL,
		locktime,
		refundPubkey,
		childPubkey,
		lockSecrets: [lockSecret],
		proofYs: [hashToCurveHexFromString(lockSecret)],
		createdForEndAt: parsedAuction.endAt,
		bidNonce: id,
		keyScheme: 'hd_p2pk',
		status: 'locked',
	}
}

const makeConfirmVerdict = (bid: ParsedBidEvent): ParsedValidatorVerdictEvent => ({
	rawEvent: { id: `v${bid.id.slice(1)}`, pubkey: AUDITOR_PUBKEY, kind: 30440, created_at: bid.createdAt + 1, content: '', tags: [] },
	id: `v${bid.id.slice(1)}`,
	validatorPubkey: AUDITOR_PUBKEY,
	createdAt: bid.createdAt + 1,
	dTag: `${bid.bidderPubkey}:${AUCTION_ROOT_ID}:${bid.id}`,
	bidderPubkey: bid.bidderPubkey,
	auctionRootEventId: AUCTION_ROOT_ID,
	auctionCoordinate: AUCTION_COORDINATE,
	bidEventId: bid.id,
	claim: 'valid_bid_placed',
	observedAt: bid.createdAt + 1,
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

describe('auction win candidate selection', () => {
	const lowerBid = makeParsedBid('8'.repeat(64), WINNER_PUBKEY, 2000, 150)
	const unvalidatedHighBid = makeParsedBid('9'.repeat(64), OTHER_BIDDER_PUBKEY, 5000, 160)

	test('does not promise a win to the highest window-valid bid without quorum', () => {
		const winner = selectValidatedAuctionWinner(
			parsedAuction,
			[lowerBid, unvalidatedHighBid],
			[makeConfirmVerdict(lowerBid)],
			new Map([
				[lowerBid.id, 'unspent'],
				[unvalidatedHighBid.id, 'unspent'],
			]),
		)

		expect(winner?.id).toBe(lowerBid.id)
	})

	test('excludes a quorum-confirmed high bid when NUT-7 reports it spent', () => {
		const winner = selectValidatedAuctionWinner(
			parsedAuction,
			[lowerBid, unvalidatedHighBid],
			[makeConfirmVerdict(lowerBid), makeConfirmVerdict(unvalidatedHighBid)],
			new Map([
				[lowerBid.id, 'unspent'],
				[unvalidatedHighBid.id, 'spent'],
			]),
		)

		expect(winner?.id).toBe(lowerBid.id)
	})
})

describe('auction winner modal route visibility', () => {
	test('suppresses the global modal on auction and order detail routes', () => {
		expect(isAuctionWonModalSuppressedPath(`/auctions/${AUCTION_ROOT_ID}`)).toBe(true)
		expect(isAuctionWonModalSuppressedPath(`/dashboard/products/auctions/${AUCTION_ROOT_ID}`)).toBe(true)
		expect(isAuctionWonModalSuppressedPath('/dashboard/orders/order-1')).toBe(true)
	})

	test('allows the global modal on auction lists and unrelated routes', () => {
		expect(isAuctionWonModalSuppressedPath('/auctions')).toBe(false)
		expect(isAuctionWonModalSuppressedPath('/dashboard/products/auctions')).toBe(false)
		expect(isAuctionWonModalSuppressedPath('/dashboard/orders')).toBe(false)
		expect(isAuctionWonModalSuppressedPath('/products')).toBe(false)
	})
})
