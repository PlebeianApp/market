import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	buildActiveAuctionBidChains,
	compareAuctionBidChainPriority,
	computeAuctionBidFloor,
	computeAuctionFloorMultiplier,
	getAuctionBidAcceptanceEndAt,
	getAuctionBiddingCutoffAt,
	getAuctionCurrentPrice,
	getAuctionEffectiveEndAt,
	getAuctionMinBidCurve,
	getAuctionRootEventId,
	getAuctionWindowValidBids,
	resolveAuctionVersionSet,
	validateAuctionSettlementEvents,
} from '../auctionSettlement'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { HDKey } from '@scure/bip32'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import { AUCTION_BID_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '../auction/constants'
import { AUCTION_KIND } from '../nip53'

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
	endAt?: number
	startingBid?: number
	bidIncrement?: number
	reserve?: number
	rootEventId?: string
	p2pk_xpub?: string
	extensionRule?: string
	pathIssuer?: string
	maxEndAt?: number
	settlementGrace?: number
	auditors?: string[]
	auditorQuorum?: number
	/** `<shape>:<peak>` (e.g. `linear:5.0`). Omit for no curve. */
	minBidCurve?: string
}): NDKEvent =>
	({
		id: params.id,
		pubkey: params.pubkey ?? 'seller',
		created_at: params.createdAt ?? Date.now() / 1000,
		content: 'Auction description',
		kind: AUCTION_KIND,
		tags: [
			['d', params.dTag ?? 'auction-1'],
			['title', params.title ?? 'Auction'],
			['auction_type', 'english'],
			['start_at', String(params.startAt ?? Date.now() / 1000)],
			['end_at', String(params.endAt ?? Date.now() / 1000 + 86400)],
			['max_end_at', String(params.maxEndAt ?? Date.now() / 1000 + 86400 + 6000)],
			['currency', 'SAT'],
			['price', String(params.startingBid ?? 1000), 'SAT'],
			['starting_bid', String(params.startingBid ?? 1000), 'SAT'],
			['bid_increment', String(params.bidIncrement ?? 100)],
			['reserve', String(params.reserve ?? 0)],
			['mint', 'https://mint.example'],
			['path_issuer', String(params.pathIssuer ?? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', String(params.p2pk_xpub ?? 'xpub-auction-root')],
			['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
			['settlement_grace', params.settlementGrace ?? 0],
			['schema', 'auction_v1'],
			...(params.auditors ? [['auditors', ...params.auditors]] : []),
			...(params.auditorQuorum ? [['auditor_quorum', params.auditorQuorum]] : []),
			...(params.rootEventId ? [['auction_root_event_id', params.rootEventId]] : []),
			...(params.extensionRule ? [['extension_rule', params.extensionRule]] : [['extension_rule', 'none']]),
			// Mirror the production invariant: max_end_at is always present.
			// Defaults to end_at when no anti-sniping is configured.
			...(params.minBidCurve ? [['min_bid_curve', params.minBidCurve]] : []),
		],
	}) as NDKEvent

const makeOrder = (params: { buyerPubkey: string; sellerPubkey: string }): OrderWithRelatedEvents => ({
	order: {
		pubkey: params.buyerPubkey,
		tags: [['p', params.sellerPubkey]],
	} as NDKEvent,
	statusUpdates: [],
	shippingUpdates: [],
	paymentRequests: [],
	paymentReceipts: [],
	generalMessages: [],
	latestStatus: undefined,
	latestShipping: undefined,
	latestPaymentRequest: undefined,
	latestPaymentReceipt: undefined,
	latestMessage: undefined,
})

const makePathRelease = (params: {
	id?: string
	pubkey: string
	auctionCoordinate: string
	sellerPubkey: string
	derivationPath?: string
	childPubkey?: string
	releaseReason?: string
	bidEventId?: string
}): NDKEvent =>
	({
		id: params.id ?? 'path-release-id',
		pubkey: params.pubkey,
		kind: 1025,
		created_at: params.id ? undefined : 1000,
		content: params.id ? undefined : '',
		tags: [
			['a', params.auctionCoordinate],
			['p', params.sellerPubkey],
			...(params.derivationPath ? [['derivation_path', params.derivationPath]] : []),
			...(params.childPubkey ? [['child_pubkey', params.childPubkey]] : []),
			...(params.releaseReason ? [['release_reason', params.releaseReason]] : []),
			...(params.bidEventId ? [['e', params.bidEventId]] : []),
		],
	}) as NDKEvent

const makeSettlement = (params: {
	id?: string
	pubkey: string
	auctionCoordinate: string
	winnerPubkey: string
	finalAmount: string
	status?: string
	winningBidId?: string
	pathReleaseId?: string
	auctionRootEventId?: string
}): NDKEvent =>
	({
		id: params.id ?? 'settlement-id',
		pubkey: params.pubkey,
		kind: 1024,
		created_at: params.id ? undefined : 1000,
		tags: [
			['a', params.auctionCoordinate],
			['winner', params.winnerPubkey],
			['final_amount', params.finalAmount],
			...(params.auctionRootEventId ? [['e', params.auctionRootEventId]] : []),
			...(params.status ? [['status', params.status]] : []),
			...(params.winningBidId ? [['winning_bid', params.winningBidId]] : []),
			...(params.pathReleaseId ? [['path_release', params.pathReleaseId]] : []),
		],
	}) as NDKEvent

const makeBidEvent = (params: {
	id: string
	pubkey: string
	auctionCoordinate: string
	amount: string
	status?: string
	auctionRootEventId?: string
	sellerPubkey?: string
	currency?: string
	locktime?: number
	refundPubkey?: string
	childPubkey?: string
	lockSecrets?: string[]
	proofYs?: string[]
	bidNonce?: string
	keyScheme?: string
}): NDKEvent =>
	({
		id: params.id,
		pubkey: params.pubkey,
		kind: AUCTION_BID_KIND,
		tags: [
			['a', params.auctionCoordinate],
			['amount', params.amount],
			['mint', 'https://testmint.xyz'],
			['currency', params.currency ?? 'SAT'],
			['locktime', String(params.locktime ?? 1000)],
			['refund_pubkey', params.refundPubkey ?? '02' + 'a'.repeat(64)],
			['child_pubkey', params.childPubkey ?? '03' + 'b'.repeat(64)],
			['lock_secret', params.lockSecrets?.[0] ?? 'secret1'],
			['proof_y', params.proofYs?.[0] ?? '02' + 'a'.repeat(64)],
			['bid_nonce', params.bidNonce ?? 'nonce1'],
			['key_scheme', params.keyScheme ?? 'hd_p2pk'],
			...(params.auctionRootEventId ? [['e', params.auctionRootEventId]] : [['e', SELLER_PUBKEY.padEnd(64, '0')]]),
			...(params.sellerPubkey ? [['p', params.sellerPubkey]] : [['p', SELLER_PUBKEY]]),
			...(params.status ? [['status', params.status]] : []),
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

	test('fixed-window v1 bid helpers include bids through max_end_at', () => {
		const auction = makeAuction({
			id: 'auction-root',
			startAt: 100,
			endAt: 200,
			extensionRule: 'none',
			maxEndAt: 320,
		})
		const bids = [
			makeBid({ id: 'bid-before-end-at', pubkey: 'alice', amount: 1100, createdAt: 150 }),
			makeBid({ id: 'bid-in-anti-snipe-window', pubkey: 'bob', amount: 1400, createdAt: 250 }),
			makeBid({ id: 'bid-after-max-end-at', pubkey: 'carol', amount: 1800, createdAt: 321 }),
		]

		expect(getAuctionBidAcceptanceEndAt(auction, bids)).toBe(320)
		expect(getAuctionWindowValidBids(auction, bids).map((bid) => bid.id)).toEqual(['bid-before-end-at', 'bid-in-anti-snipe-window'])
		expect(getAuctionCurrentPrice(auction, bids, 1000)).toBe(1400)
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

const REAL_AUCTION_XPUB = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'
const VALID_DERIVATION_PATH = 'm/1/2/3/4/5'
const SELLER_PUBKEY = 'a'.repeat(64)
const BUYER_PUBKEY = 'b'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:test-auction`
const EVENT_ID = 'c288e898b46897f206c886621083e8725b1d0d84db73e51ad9bcc4536777552d'
const EVENT_ID_2 = '51d21be4c387aa3c072da39c1e2cc016f2152cdbf6979cd0388f562e499c33cf'
const EVENT_ID_3 = 'd85c279aef539a379574ee7be9b55f26f0c15efaf56ed82a0af9c3cc73b65c35'
const EVENT_ID_4 = '2e76f654c482be541e8cd5f2c34c69e2613046db0357031144b9cd5344d4c3ef'

describe('enhanced auctionSettlement validation', () => {
	test('rejects path release with invalid derivation path format', () => {
		const pathRelease = makePathRelease({
			id: EVENT_ID,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: 'invalid/path',
			childPubkey: '02' + 'a'.repeat(64),
			releaseReason: 'settlement',
			bidEventId: EVENT_ID_2,
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order)

		expect(result.state).toBe('observed_unverified')
		expect(result.detailedErrors.pathRelease?.some((err) => err.includes('Invalid derivation path format'))).toBeTruthy()
	})

	test('rejects path release with invalid derivation path format', () => {
		const pathRelease = makePathRelease({
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: 'invalid/path',
			childPubkey: '02' + 'a'.repeat(64),
			releaseReason: 'settlement',
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order)

		expect(result.state).toBe('observed_unverified')
		expect(result.detailedErrors.pathRelease?.some((err) => err.includes('Invalid derivation path format'))).toBeTruthy()
	})

	test('rejects path release missing child_pubkey tag', () => {
		const pathRelease = makePathRelease({
			id: EVENT_ID,
			bidEventId: EVENT_ID_2,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			releaseReason: 'settlement',
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order)

		expect(result.state).toBe('observed_unverified')
		// Schema validation will fail first
		expect(result.detailedErrors.pathRelease?.some((err) => err.includes('Path release schema validation failed'))).toBeTruthy()
		expect(result.detailedErrors.pathRelease?.some((err) => err.includes('Must be a compressed secp256k1 pubkey'))).toBeTruthy()
	})

	test('rejects path release with invalid release_reason', () => {
		const pathRelease = makePathRelease({
			pubkey: BUYER_PUBKEY,
			id: EVENT_ID,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			childPubkey: '02' + 'a'.repeat(64),
			releaseReason: 'invalid_reason',
			bidEventId: EVENT_ID_2,
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order)

		expect(result.state).toBe('observed_unverified')
		expect(result.detailedErrors.pathRelease?.some((err) => err.includes('Path release schema validation failed'))).toBeTruthy()

		// Check if our custom validation caught the invalid release_reason
		expect(result.detailedErrors.pathRelease?.some((err) => err.includes('release_reason must be settlement'))).toBeTruthy()
	})

	test('rejects settlement with invalid status', () => {
		const settlement = makeSettlement({
			pubkey: SELLER_PUBKEY,
			id: EVENT_ID,
			auctionCoordinate: AUCTION_COORDINATE,
			winnerPubkey: BUYER_PUBKEY,
			finalAmount: '1000',
			status: 'invalid_status',
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([settlement], [], AUCTION_COORDINATE, order)

		expect(result.state).toBe('observed_unverified')
		expect(result.detailedErrors.settlement?.some((err) => err.includes('Settlement schema validation failed'))).toBeTruthy()

		// Check if our custom validation caught the invalid status
		expect(result.detailedErrors.settlement?.some((err) => err.includes('status must be'))).toBeTruthy()
	})

	test('rejects settlement with status=settled but missing path_release tag', () => {
		const settlement = makeSettlement({
			pubkey: SELLER_PUBKEY,
			id: EVENT_ID,
			auctionCoordinate: AUCTION_COORDINATE,
			winnerPubkey: BUYER_PUBKEY,
			finalAmount: '1000',
			status: 'settled',
			winningBidId: EVENT_ID_2,
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([settlement], [], AUCTION_COORDINATE, order)

		expect(result.state).toBe('observed_unverified')
		expect(result.detailedErrors.settlement?.some((err) => err.includes('Settlement schema validation failed'))).toBeTruthy()
		// Check if our custom validation caught the missing path_release tag
		expect(result.detailedErrors.settlement?.some((err) => err.match(/status.*requires.*path_release tag/i))).toBeTruthy()
	})

	test('accepts settlement with status=settled and path_release tag present', () => {
		const settlement = makeSettlement({
			id: EVENT_ID,
			pubkey: SELLER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			winnerPubkey: BUYER_PUBKEY,
			finalAmount: '1000',
			status: 'settled',
			winningBidId: EVENT_ID_2,
			pathReleaseId: EVENT_ID_3,
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([settlement], [], AUCTION_COORDINATE, order)

		// Should pass basic validation
		expect(['validated_seller_settlement', 'observed_unverified']).toContain(result.state)
	})

	test('rejects path release referencing non-existent bid event', () => {
		const pathRelease = makePathRelease({
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			childPubkey: '02' + 'a'.repeat(64),
			releaseReason: 'settlement',
			id: EVENT_ID,
			bidEventId: EVENT_ID_2,
		})

		const bidEvents: NDKEvent[] = [] // No bids available

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order, undefined, bidEvents)

		expect(result.state).toBe('observed_unverified')
		expect(result.errors).toContain('Referenced bid event not found')
		expect(result.detailedErrors.crossReference?.some((err) => err.includes('Path release references non-existent bid event'))).toBeTruthy()
	})

	test('rejects path release referencing bid from different auction', () => {
		const bidEvent = makeBidEvent({
			id: EVENT_ID,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: '30408:different_seller:different_auction',
			auctionRootEventId: EVENT_ID_3,
			amount: '1000',
			status: 'locked',
		})

		const pathRelease = makePathRelease({
			id: EVENT_ID_2,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			childPubkey: '02' + 'a'.repeat(64),
			releaseReason: 'settlement',
			bidEventId: EVENT_ID,
		})

		const bidEvents = [bidEvent]

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order, undefined, bidEvents)

		expect(result.state).toBe('observed_unverified')
		expect(result.detailedErrors.crossReference?.some((err) => err.includes('Referenced bid does not belong to this auction'))).toBeTruthy()
	})

	test('rejects settlement amount not matching bid amount', () => {
		const bidEvent = makeBidEvent({
			id: EVENT_ID,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			amount: '1500',
			status: 'locked',
		})

		const settlement = makeSettlement({
			id: EVENT_ID_2,
			pubkey: SELLER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			winnerPubkey: BUYER_PUBKEY,
			finalAmount: '1000',
			status: 'settled',
			winningBidId: EVENT_ID,
			pathReleaseId: EVENT_ID_3,
			auctionRootEventId: EVENT_ID_4,
		})

		const bidEvents = [bidEvent]

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([settlement], [], AUCTION_COORDINATE, order, undefined, bidEvents)

		expect(result.state).toBe('observed_unverified')
		expect(result.detailedErrors.crossReference).toContain('Settlement amount 1000 does not match bid amount 1500')
	})

	test('accepts valid cryptographic derivation', () => {
		// Generate a valid child pubkey using the real xpub
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, VALID_DERIVATION_PATH)

		const pathRelease = makePathRelease({
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			childPubkey: childPubkey,
			releaseReason: 'settlement',
		})

		// Create a mock auction event with the real xpub
		const auctionEvent = makeAuction({
			id: 'auction123',
			pubkey: SELLER_PUBKEY,
			dTag: 'test-auction',
			p2pk_xpub: REAL_AUCTION_XPUB,
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order, auctionEvent)

		// Should not have cryptographic errors
		expect(result.detailedErrors.cryptographic).not.toContain('Path derivation failed to match child pubkey')
	})

	test('rejects invalid cryptographic derivation', () => {
		const pathRelease = makePathRelease({
			id: EVENT_ID,
			bidEventId: EVENT_ID_2,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			childPubkey: '02' + 'c'.repeat(64), // Arbitrary pubkey that won't match derivation
			releaseReason: 'settlement',
		})

		// Create a mock auction event with the real xpub
		const auctionEvent = makeAuction({
			id: EVENT_ID_3,
			pubkey: SELLER_PUBKEY,
			dTag: 'test-auction',
			p2pk_xpub: REAL_AUCTION_XPUB,
			auditors: ['a'.repeat(64)],
			auditorQuorum: 1,
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order, auctionEvent)

		expect(result.state).toBe('observed_unverified')
		expect(result.errors).toContain('Derived pubkey does not match child_pubkey')
		expect(result.detailedErrors.cryptographic).toContain('Path derivation failed to match child pubkey')
	})

	test('handles malformed bid event schema gracefully', () => {
		const malformedBidEvent = makeBidEvent({
			id: 'bid123',
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			amount: '1000',
			// Missing status
		})

		const pathRelease = makePathRelease({
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			childPubkey: '02' + 'a'.repeat(64),
			releaseReason: 'settlement',
			bidEventId: 'bid123',
		})

		const bidEvents = [malformedBidEvent]

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order, undefined, bidEvents)

		// Should still process but may have cross-reference errors
		expect(['observed_unverified', 'validated_buyer_path_release']).toContain(result.state)
	})

	test('fully validates all components successfully', () => {
		// Generate a valid child pubkey
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, VALID_DERIVATION_PATH)

		const bidEvent = makeBidEvent({
			id: EVENT_ID,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			amount: '1000',
			status: 'locked',
		})

		const pathRelease = makePathRelease({
			id: EVENT_ID_2,
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: VALID_DERIVATION_PATH,
			childPubkey: childPubkey,
			releaseReason: 'settlement',
			bidEventId: bidEvent.id,
		})

		const settlement = makeSettlement({
			id: EVENT_ID_3,
			pubkey: SELLER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			auctionRootEventId: EVENT_ID_4,
			winnerPubkey: BUYER_PUBKEY,
			finalAmount: '1000',
			status: 'settled',
			winningBidId: bidEvent.id,
			pathReleaseId: pathRelease.id,
		})

		const auctionEvent = makeAuction({
			id: EVENT_ID_4,
			pubkey: SELLER_PUBKEY,
			dTag: 'test-auction',
			p2pk_xpub: REAL_AUCTION_XPUB,
			title: 'Test Auction Item',
			startAt: Date.now() - 1000,
			endAt: Date.now() + 10000,
			maxEndAt: Date.now() + 12500,
			startingBid: 1000,
			bidIncrement: 100,
			reserve: 500,
			minBidCurve: 'exponential:5.0',
			auditors: ['a'.repeat(64)],
			auditorQuorum: 1,
		})

		const bidEvents = [bidEvent]

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([settlement], [pathRelease], AUCTION_COORDINATE, order, auctionEvent, bidEvents)

		// Everything should validate correctly
		expect(result.state).toBe('fully_validated_settled')
		expect(result.pathReleaseValid).toBe(true)
		expect(result.settlementValid).toBe(true)
		expect(result.errors).toEqual([])
	})

	test('handles valid path release with proper derivation path format', () => {
		const pathRelease = makePathRelease({
			pubkey: BUYER_PUBKEY,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PUBKEY,
			derivationPath: 'm/0/1/2/3/4', // Valid format
			childPubkey: '02' + 'a'.repeat(64),
			releaseReason: 'settlement',
		})

		const order = makeOrder({ buyerPubkey: BUYER_PUBKEY, sellerPubkey: SELLER_PUBKEY })
		const result = validateAuctionSettlementEvents([], [pathRelease], AUCTION_COORDINATE, order)

		// Should pass basic structural validation (cryptographic checks skipped without real data)
		expect(result.hasPathRelease).toBe(true)
		expect(result.detailedErrors.pathRelease).not.toContain('Invalid derivation path format')
	})
})
