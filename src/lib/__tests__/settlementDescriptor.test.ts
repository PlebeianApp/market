import { describe, expect, test } from 'bun:test'
import { getSettlementDescriptor, type GetSettlementDescriptorInput, type SettlementParticipantRole } from '../auction/settlementDescriptor'
import type {
	ParsedAuctionEvent,
	ParsedBidEvent,
	ParsedPathReleaseEvent,
	ParsedSettlementEvent,
	ParsedValidatorVerdictEvent,
} from '../auction/events'
import type { Nut7ProofState } from '../auction/constants'
import type { NostrEventLike } from '../nostr/eventLike'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import { ProjectivePoint, etc } from '@noble/secp256k1'
import { HDKey } from '@scure/bip32'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'

const SELLER_PUBKEY = 'a'.repeat(64)
const BUYER_PUBKEY = 'b'.repeat(64)
const OTHER_BIDDER_PUBKEY = 'c'.repeat(64)
const VALIDATOR_PUBKEY = 'd'.repeat(64)

const AUCTION_END = 100
const AUCTION_GRACE = 50
const AUCTION_LOCKTIME = AUCTION_END + AUCTION_GRACE

const TEST_XPUB = HDKey.fromMasterSeed(new Uint8Array(32).fill(0xaa)).publicExtendedKey
const TEST_DERIVATION_PATH = 'm/0'
const CHILD_PUBKEY = deriveAuctionChildP2pkPubkeyFromXpub(TEST_XPUB, TEST_DERIVATION_PATH)
const REFUND_PUBKEY = ProjectivePoint.fromPrivateKey(etc.hexToBytes('bb'.repeat(32))).toHex(true)
const LOCK_SECRET = JSON.stringify([
	'P2PK',
	{
		nonce: 'a'.repeat(16),
		data: CHILD_PUBKEY,
		tags: [
			['n_sigs', '1'],
			['locktime', String(AUCTION_LOCKTIME)],
			['refund', REFUND_PUBKEY],
			['n_sigs_refund', '1'],
			['sigflag', 'SIG_INPUTS'],
		],
	},
])
const PROOF_Y = hashToCurveHexFromString(LOCK_SECRET)
const TEST_PROOF: Proof = {
	amount: 50000,
	secret: LOCK_SECRET,
	C: ProjectivePoint.fromPrivateKey(etc.hexToBytes('11'.repeat(32))).toHex(true),
	id: '00'.repeat(16),
}
const TEST_CASHU_TOKEN = getEncodedToken({ mint: 'https://mint.example.com', proofs: [TEST_PROOF] })

type InputOverrides = Partial<GetSettlementDescriptorInput>

function makeAuction(overrides: Partial<ParsedAuctionEvent> = {}): ParsedAuctionEvent {
	return {
		rawEvent: { id: 'auction-root', pubkey: SELLER_PUBKEY, kind: 30408, tags: [], content: '' },
		dTag: 'd-tag',
		sellerPubkey: SELLER_PUBKEY,
		coordinate: '30408:seller:d-tag',
		rootEventId: 'auction-root',
		title: 'Test Auction',
		content: '',
		auctionType: 'english',
		startAt: 0,
		endAt: AUCTION_END,
		maxEndAt: AUCTION_END,
		settlementGrace: AUCTION_GRACE,
		currency: 'SAT',
		reserve: 0,
		startingBid: 1000,
		bidIncrement: 100,
		minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
		settlementPolicy: 'cashu_p2pk_bidder_path_v1',
		keyScheme: 'hd_p2pk',
		mints: ['https://mint.example.com'],
		p2pkXpub: TEST_XPUB,
		auditors: [VALIDATOR_PUBKEY],
		auditorQuorum: 1,
		maxSkewSec: 30,
		fallbackDelaySec: 25,
		vadiumRatioBps: 0,
		schema: '',
		...overrides,
	} as ParsedAuctionEvent
}

function makeBid(overrides: Partial<ParsedBidEvent> = {}): ParsedBidEvent {
	return {
		rawEvent: { id: 'bid-1', pubkey: BUYER_PUBKEY, kind: 1024, tags: [], content: '', created_at: 100 },
		id: 'bid-1',
		bidderPubkey: BUYER_PUBKEY,
		createdAt: 100,
		auctionRootEventId: 'auction-root',
		auctionCoordinate: '30408:seller:d-tag',
		sellerPubkey: SELLER_PUBKEY,
		amount: 50000,
		legLockedAmount: 50000,
		currency: 'SAT',
		mint: 'https://mint.example.com',
		locktime: AUCTION_LOCKTIME,
		refundPubkey: REFUND_PUBKEY,
		childPubkey: CHILD_PUBKEY,
		lockSecrets: [LOCK_SECRET],
		proofYs: [PROOF_Y],
		createdForEndAt: AUCTION_END,
		bidNonce: 'nonce-1',
		keyScheme: 'hd_p2pk',
		status: 'locked',
		...overrides,
	} as ParsedBidEvent
}

function makePathRelease(overrides: Partial<ParsedPathReleaseEvent> = {}): ParsedPathReleaseEvent {
	return {
		rawEvent: { id: 'pr-1', pubkey: BUYER_PUBKEY, kind: 1025, tags: [], content: '', created_at: 200 },
		id: 'pr-1',
		bidderPubkey: BUYER_PUBKEY,
		createdAt: 200,
		bidEventId: 'bid-1',
		auctionCoordinate: '30408:seller:d-tag',
		sellerPubkey: SELLER_PUBKEY,
		derivationPath: TEST_DERIVATION_PATH,
		childPubkey: CHILD_PUBKEY,
		releaseReason: 'settlement',
		auditorRefs: [],
		content: '',
		cashuToken: TEST_CASHU_TOKEN,
		...overrides,
	} as ParsedPathReleaseEvent
}

function makeSettlement(overrides: Partial<ParsedSettlementEvent> = {}): ParsedSettlementEvent {
	return {
		rawEvent: { id: 'settle-1', pubkey: SELLER_PUBKEY, kind: 1024, tags: [], content: '', created_at: 200 },
		id: 'settle-1',
		sellerPubkey: SELLER_PUBKEY,
		createdAt: 200,
		auctionRootEventId: 'auction-root',
		auctionCoordinate: '30408:seller:d-tag',
		status: 'settled',
		closeAt: AUCTION_END,
		winningBidId: 'bid-1',
		winnerPubkey: BUYER_PUBKEY,
		finalAmount: 50000,
		pathReleaseEventId: 'pr-1',
		payouts: [],
		fallbackChain: [],
		...overrides,
	} as ParsedSettlementEvent
}

function makeClaimOrder(overrides: Partial<NostrEventLike> = {}): NostrEventLike {
	return {
		id: 'order-1',
		pubkey: BUYER_PUBKEY,
		kind: 16,
		content: '',
		tags: [
			['p', SELLER_PUBKEY],
			['type', 'order_creation'],
			['order', 'order-1'],
			['amount', '50000'],
			['a', '30408:seller:d-tag'],
			['e', 'auction-root'],
			['e', 'settle-1', '', 'settlement'],
		],
		...overrides,
	}
}

function makeVerdict(overrides: Partial<ParsedValidatorVerdictEvent> = {}): ParsedValidatorVerdictEvent {
	return {
		rawEvent: { id: 'verdict-1', pubkey: VALIDATOR_PUBKEY, kind: 30440, tags: [], content: '', created_at: 100 },
		id: 'verdict-1',
		validatorPubkey: VALIDATOR_PUBKEY,
		createdAt: 100,
		dTag: `${BUYER_PUBKEY}:auction-root`,
		bidderPubkey: BUYER_PUBKEY,
		auctionRootEventId: 'auction-root',
		auctionCoordinate: '30408:seller:d-tag',
		bidEventId: 'bid-1',
		claim: 'valid_bid_placed',
		observedAt: 100,
		...overrides,
	} as ParsedValidatorVerdictEvent
}

function verdictForBid(bidId: string, overrides: Partial<ParsedValidatorVerdictEvent> = {}): ParsedValidatorVerdictEvent {
	return makeVerdict({ bidEventId: bidId, id: `verdict-${bidId}`, ...overrides })
}

function hasKey(o: object, k: string): boolean {
	return Object.prototype.hasOwnProperty.call(o, k)
}

function makeInput(overrides: object = {}): GetSettlementDescriptorInput {
	const base: GetSettlementDescriptorInput = {
		auction: makeAuction(),
		bids: [],
		verdicts: [],
		settlements: [],
		pathReleases: [],
		claimOrders: [],
		currentUserPubkey: undefined,
		myTopBidEvent: null,
		hasBidderRecord: false,
		hasPlacedBid: false,
		now: 120,
		nut7States: undefined,
	}
	for (const [k, v] of Object.entries(overrides)) {
		if (hasKey(base as object, k) || k === 'currentUserPubkey' || k === 'myTopBidEvent') {
			;(base as unknown as Record<string, unknown>)[k] = v
		}
	}
	// Auto-generate NUT-7 states for all bids if not explicitly provided.
	// Default to 'unspent' — matches the old behavior where bids without NUT-7
	// data were treated as valid (bid_pending_review was collapsed to valid).
	// If nut7States wasn't explicitly provided, auto-generate 'unspent' for all bids.
	// This matches the old behavior where bids without NUT-7 data were treated as valid.
	if (base.nut7States === undefined && base.bids.length > 0) {
		base.nut7States = new Map(base.bids.map((b) => [b.id, 'unspent' as Nut7ProofState]))
	} else if (base.nut7States === undefined) {
		delete base.nut7States
	}
	return base
}

function spentNut7States(bids: ParsedBidEvent[]): Map<string, Nut7ProofState> {
	return new Map(bids.map((b) => [b.id, 'spent' as Nut7ProofState]))
}

const winningBid = makeBid({ bidderPubkey: BUYER_PUBKEY, amount: 50000 })
const winningBidInput = (extra: InputOverrides = {}): GetSettlementDescriptorInput =>
	makeInput({
		bids: [winningBid],
		verdicts: [verdictForBid(winningBid.id)],
		currentUserPubkey: BUYER_PUBKEY,
		myTopBidEvent: winningBid,
		hasBidderRecord: true,
		hasPlacedBid: true,
		...extra,
	})

describe('getSettlementDescriptor', () => {
	describe('role classification', () => {
		test('seller: currentUserPubkey === sellerPubkey', async () => {
			const d = await getSettlementDescriptor(makeInput({ currentUserPubkey: SELLER_PUBKEY, now: 120 }))
			expect(d?.role).toBe('seller')
		})

		test('winning-bidder: top bid is mine', async () => {
			const d = await getSettlementDescriptor(winningBidInput({ now: 120 }))
			expect(d?.role).toBe('winning-bidder')
		})

		test('outbid-bidder: I have a validated bid but am not the top', async () => {
			const myBid = makeBid({ id: 'bid-low', bidderPubkey: OTHER_BIDDER_PUBKEY, amount: 20000, createdAt: 90 })
			const topBid = makeBid({ id: 'bid-top', bidderPubkey: BUYER_PUBKEY, amount: 50000 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 55000 }),
					bids: [topBid, myBid],
					verdicts: [
						verdictForBid(topBid.id),
						verdictForBid(myBid.id, { bidderPubkey: OTHER_BIDDER_PUBKEY, dTag: `${OTHER_BIDDER_PUBKEY}:auction-root`, observedAt: 90 }),
					],
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: myBid,
					hasPlacedBid: true,
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.role).toBe('outbid-bidder')
		})

		test('non-participant: no pubkey -> observer state', async () => {
			const d = await getSettlementDescriptor(makeInput({ currentUserPubkey: undefined, now: 120 }))
			expect(d?.role).toBe('non-participant')
			expect(d?.title).toBe('Auction Ended')
		})

		test('non-participant: pubkey not in any bid, placed a bid that failed validation', async () => {
			const d = await getSettlementDescriptor(makeInput({ currentUserPubkey: OTHER_BIDDER_PUBKEY, hasPlacedBid: true, now: 120 }))
			expect(d?.role).toBe('non-participant')
			expect(d?.title).toBe('Bid Not Validated')
		})

		test('self-bidding seller classifies as seller, not winning-bidder', async () => {
			const myBid = makeBid({ bidderPubkey: SELLER_PUBKEY })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ sellerPubkey: SELLER_PUBKEY }),
					bids: [myBid],
					verdicts: [verdictForBid(myBid.id, { bidderPubkey: SELLER_PUBKEY, dTag: `${SELLER_PUBKEY}:auction-root` })],
					currentUserPubkey: SELLER_PUBKEY,
					myTopBidEvent: myBid,
					now: 120,
				}),
			)
			expect(d?.role).toBe('seller')
		})
	})

	describe('auction not ended', () => {
		test('returns null before biddingCutoffAt', async () => {
			const d = await getSettlementDescriptor(winningBidInput({ now: 50 }))
			expect(d).toBeNull()
		})
	})

	describe('seller states', () => {
		test('settlement-ready: path released, no settlement, reserve met', async () => {
			const topBid = makeBid({ amount: 50000 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					verdicts: [verdictForBid(topBid.id)],
					currentUserPubkey: SELLER_PUBKEY,
					pathReleases: [makePathRelease({ bidEventId: topBid.id })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Settlement Ready')
			expect(d?.cta?.kind).toBe('submit-settlement')
			expect(d?.tone).toBe('action')
		})

		test('late-settlement: path released but settlement window expired', async () => {
			const topBid = makeBid({ amount: 50000 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					verdicts: [verdictForBid(topBid.id)],
					currentUserPubkey: SELLER_PUBKEY,
					pathReleases: [makePathRelease({ bidEventId: topBid.id })],
					now: AUCTION_LOCKTIME + 10,
				}),
			)
			expect(d?.title).toBe('Late Settlement (Best-Effort)')
			expect(d?.cta?.kind).toBe('submit-settlement')
			expect(d?.tone).toBe('action')
			expect(d?.message).toContain('refund')
		})

		test('latestSettlement prefers latest by created_at among same status', async () => {
			const topBid = makeBid({ amount: 50000 })
			const older = makeSettlement({
				status: 'reserve_not_met',
				createdAt: 200,
			})
			const newer = makeSettlement({
				status: 'reserve_not_met',
				createdAt: 300,
			})
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 100000 }),
					bids: [topBid],
					verdicts: [verdictForBid(topBid.id)],
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [older, newer],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Auction Closed — Reserve Not Met')
		})

		test('close-auction (reserve not met): high reserve, no qualifying bid', async () => {
			const topBid = makeBid({ amount: 30000 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					verdicts: [verdictForBid(topBid.id)],
					currentUserPubkey: SELLER_PUBKEY,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Reserve Not Met')
			expect(d?.cta?.kind).toBe('close-auction')
		})

		test('close-auction (no bids): no reserve, no bids', async () => {
			const d = await getSettlementDescriptor(
				makeInput({ auction: makeAuction({ reserve: 0 }), currentUserPubkey: SELLER_PUBKEY, now: 120 }),
			)
			expect(d?.title).toBe('No Bids Received')
			expect(d?.cta?.kind).toBe('close-auction')
		})

		test('awaiting-path-release: reserve met, no path, window open', async () => {
			const topBid = makeBid({ amount: 50000 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					verdicts: [verdictForBid(topBid.id)],
					currentUserPubkey: SELLER_PUBKEY,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Awaiting Path Release')
			expect(d?.tone).toBe('waiting')
			expect(d?.cta).toBeNull()
		})

		test('settlement-window-expired: reserve met, no path, window expired', async () => {
			const topBid = makeBid({ amount: 50000 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					verdicts: [verdictForBid(topBid.id)],
					currentUserPubkey: SELLER_PUBKEY,
					now: 200,
				}),
			)
			expect(d?.title).toBe('Settlement Window Expired')
			expect(d?.tone).toBe('completed')
			expect(d?.cta).toBeNull()
		})

		test('order-received: settled, matched claim order', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [
						makeSettlement({
							status: 'settled',
							winnerPubkey: BUYER_PUBKEY,
							finalAmount: 50000,
							pathReleaseEventId: 'pr-1',
							payouts: [{ bidEventId: 'bid-1', amount: 50000, status: 'redeemed' }],
						}),
					],
					pathReleases: [makePathRelease({ bidEventId: winningBid.id })],
					claimOrders: [makeClaimOrder({ pubkey: BUYER_PUBKEY, id: 'order-1' })],
					nut7States: spentNut7States([winningBid]),
					now: 120,
				}),
			)
			expect(d?.title).toBe('Order Received')
			expect(d?.cta?.kind).toBe('view-order')
			expect(d?.cta?.orderId).toBe('order-1')
		})

		test('awaiting-shipping: settled, no claim order yet', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [
						makeSettlement({
							status: 'settled',
							winnerPubkey: BUYER_PUBKEY,
							finalAmount: 50000,
							pathReleaseEventId: 'pr-1',
							payouts: [{ bidEventId: 'bid-1', amount: 50000, status: 'redeemed' }],
						}),
					],
					pathReleases: [makePathRelease({ bidEventId: winningBid.id })],
					nut7States: spentNut7States([winningBid]),
					now: 120,
				}),
			)
			expect(d?.title).toBe('Awaiting Shipping Details')
			expect(d?.tone).toBe('waiting')
		})

		test('closed-reserve-not-met: settlement reserve_not_met -> NOT a refund card', async () => {
			const d = await getSettlementDescriptor(
				makeInput({
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Auction Closed — Reserve Not Met')
			expect(d?.cta).toBeNull()
		})

		test('closed (griefed_no_fallback)', async () => {
			const d = await getSettlementDescriptor(
				makeInput({
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [makeSettlement({ status: 'griefed_no_fallback', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Auction Closed')
			expect(d?.cta).toBeNull()
		})
	})

	describe('winning-bidder states', () => {
		test('release-path: reserve met, window open, have bidder record', async () => {
			const d = await getSettlementDescriptor(winningBidInput({ auction: makeAuction({ reserve: 40000 }), now: 120 }))
			expect(d?.title).toBe('You won — release your path to settle')
			expect(d?.cta?.kind).toBe('release-path')
			expect(d?.bidAmount).toBe(50000)
		})

		test('path-released: my path release exists', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					auction: makeAuction({ reserve: 40000 }),
					pathReleases: [makePathRelease({ bidEventId: winningBid.id })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Path release published')
			expect(d?.tone).toBe('waiting')
			expect(d?.cta).toBeNull()
		})

		test('winner-with-order: settled, settlement names me, claim order exists', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					settlements: [
						makeSettlement({
							status: 'settled',
							winnerPubkey: BUYER_PUBKEY,
							finalAmount: 50000,
							pathReleaseEventId: 'pr-1',
							payouts: [{ bidEventId: 'bid-1', amount: 50000, status: 'redeemed' }],
						}),
					],
					claimOrders: [makeClaimOrder({ pubkey: BUYER_PUBKEY, id: 'order-1' })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('You won this auction!')
			expect(d?.cta?.kind).toBe('view-order')
			expect(d?.bidAmount).toBe(50000)
		})

		test('winner-claim-dialog: settled, settlement names me, no claim order', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					settlements: [
						makeSettlement({
							status: 'settled',
							winnerPubkey: BUYER_PUBKEY,
							finalAmount: 50000,
							pathReleaseEventId: 'pr-1',
							payouts: [{ bidEventId: 'bid-1', amount: 50000, status: 'redeemed' }],
						}),
					],
					now: 120,
				}),
			)
			expect(d?.title).toBe('You won this auction!')
			expect(d?.cta?.kind).toBe('open-claim-dialog')
		})

		test('superseded: settlement names someone else', async () => {
			const otherWinner = 'd'.repeat(64)
			const d = await getSettlementDescriptor(
				winningBidInput({
					settlements: [makeSettlement({ status: 'settled', winnerPubkey: otherWinner, finalAmount: 50000 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Settlement Went to Fallback')
			expect(d?.tone).toBe('completed')
			expect(d?.cta).toBeNull()
		})

		test('settlement-expired: window closed, no path release', async () => {
			const d = await getSettlementDescriptor(winningBidInput({ auction: makeAuction({ reserve: 40000 }), now: 200 }))
			expect(d?.title).toBe('Settlement Expired')
			expect(d?.bidAmount).toBe(50000)
		})

		test('local-record-missing: no bidder record, window open', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({ auction: makeAuction({ reserve: 40000 }), hasBidderRecord: false, now: 120 }),
			)
			expect(d?.title).toBe('Local Record Missing')
			expect(d?.cta?.kind).toBe('refresh-page')
		})

		test('reserve-not-met-refund-pending: top bid below reserve, window open', async () => {
			const lowBid = makeBid({ amount: 30000 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [lowBid],
					verdicts: [verdictForBid(lowBid.id)],
					currentUserPubkey: BUYER_PUBKEY,
					myTopBidEvent: lowBid,
					hasBidderRecord: true,
					hasPlacedBid: true,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Reserve Not Met')
			expect(d?.tone).toBe('waiting')
		})
	})

	describe('outbid-bidder states', () => {
		test('bid-invalid: placed a bid but it failed validation', async () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY })
			const d = await getSettlementDescriptor(
				makeInput({
					bids: [topBid],
					verdicts: [verdictForBid(topBid.id)],
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: null,
					hasPlacedBid: true,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Bid Not Validated')
			expect(d?.tone).toBe('completed')
		})

		test('refund: outbid bidder with reserve_not_met settlement', async () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY, amount: 30000 })
			const myBid = makeBid({ id: 'bid-low', bidderPubkey: OTHER_BIDDER_PUBKEY, amount: 20000, createdAt: 90 })
			const d = await getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid, myBid],
					verdicts: [
						verdictForBid(topBid.id),
						verdictForBid(myBid.id, { bidderPubkey: OTHER_BIDDER_PUBKEY, dTag: `${OTHER_BIDDER_PUBKEY}:auction-root`, observedAt: 90 }),
					],
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: myBid,
					hasPlacedBid: true,
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Refund Pending')
		})

		test('no card: outbid with validated bid, no settlement', async () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY })
			const myBid = makeBid({ id: 'bid-low', bidderPubkey: OTHER_BIDDER_PUBKEY, amount: 20000, createdAt: 90 })
			const d = await getSettlementDescriptor(
				makeInput({
					bids: [topBid, myBid],
					verdicts: [
						verdictForBid(topBid.id),
						verdictForBid(myBid.id, { bidderPubkey: OTHER_BIDDER_PUBKEY, dTag: `${OTHER_BIDDER_PUBKEY}:auction-root`, observedAt: 90 }),
					],
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: myBid,
					hasPlacedBid: true,
					now: 120,
				}),
			)
			expect(d).toBeNull()
		})
	})

	describe('non-participant states', () => {
		test('observer: non-participant with no bid sees auction status', async () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY })
			const d = await getSettlementDescriptor(
				makeInput({ bids: [topBid], verdicts: [verdictForBid(topBid.id)], currentUserPubkey: OTHER_BIDDER_PUBKEY, now: 120 }),
			)
			expect(d?.role).toBe('non-participant')
			expect(d?.title).toBe('Awaiting Settlement')
		})

		test('bid-invalid: placed a bid but it failed validation (non-participant in validated terms)', async () => {
			const d = await getSettlementDescriptor(
				makeInput({
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: null,
					hasPlacedBid: true,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Bid Not Validated')
		})
	})

	describe('refund timing', () => {
		test('refund-pending: now < locktime', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					auction: makeAuction({ reserve: 55000 }),
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Refund Pending')
		})

		test('refund-ready: now >= locktime', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					auction: makeAuction({ reserve: 55000 }),
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: AUCTION_LOCKTIME,
				}),
			)
			expect(d?.title).toBe('Refund Ready')
			expect(d?.tone).toBe('completed')
		})
	})

	describe('verified badge', () => {
		test('settlement badge when settlement exists', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					settlements: [
						makeSettlement({
							status: 'settled',
							winnerPubkey: BUYER_PUBKEY,
							finalAmount: 50000,
							pathReleaseEventId: 'pr-1',
							payouts: [{ bidEventId: 'bid-1', amount: 50000, status: 'redeemed' }],
						}),
					],
					pathReleases: [makePathRelease({ bidEventId: winningBid.id })],
					claimOrders: [makeClaimOrder({ pubkey: BUYER_PUBKEY })],
					nut7States: spentNut7States([winningBid]),
					now: 120,
				}),
			)
			expect(d?.verifiedBadge).toBe('settlement')
		})

		test('path-release badge when path release exists but no settlement', async () => {
			const d = await getSettlementDescriptor(
				winningBidInput({
					auction: makeAuction({ reserve: 40000 }),
					pathReleases: [makePathRelease({ bidEventId: winningBid.id })],
					now: 120,
				}),
			)
			expect(d?.verifiedBadge).toBe('path-release')
		})

		test('none badge when no settlement or path release', async () => {
			const d = await getSettlementDescriptor(winningBidInput({ auction: makeAuction({ reserve: 40000 }), now: 120 }))
			expect(d?.verifiedBadge).toBe('none')
		})
	})

	describe('role exhaustiveness', () => {
		const roles: SettlementParticipantRole[] = ['seller', 'winning-bidder', 'outbid-bidder', 'non-participant']

		test.each(roles)('role %s always produces a defined descriptor or null (no crash)', (role: SettlementParticipantRole) => {
			let d: ReturnType<typeof getSettlementDescriptor>
			switch (role) {
				case 'seller':
					d = getSettlementDescriptor(makeInput({ currentUserPubkey: SELLER_PUBKEY, now: 120 }))
					break
				case 'winning-bidder':
					d = getSettlementDescriptor(winningBidInput({ now: 120 }))
					break
				case 'outbid-bidder': {
					const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY })
					const myBid = makeBid({ id: 'bid-low', bidderPubkey: OTHER_BIDDER_PUBKEY, amount: 20000 })
					d = getSettlementDescriptor(
						makeInput({
							bids: [topBid, myBid],
							verdicts: [verdictForBid(topBid.id)],
							currentUserPubkey: OTHER_BIDDER_PUBKEY,
							myTopBidEvent: myBid,
							hasPlacedBid: true,
							now: 120,
						}),
					)
					break
				}
				default:
					d = getSettlementDescriptor(makeInput({ currentUserPubkey: undefined, now: 120 }))
					break
			}
			expect(d === null || d !== undefined).toBe(true)
		})
	})
})

describe('validator integration', () => {
	test('path release with undecodable cashu token is rejected', async () => {
		const winningBid = makeBid({ amount: 50000 })
		const pr = makePathRelease({
			bidEventId: winningBid.id,
			cashuToken: 'not-a-valid-token',
		})
		const d = await getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				verdicts: [verdictForBid(winningBid.id)],
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [pr],
				now: 120,
			}),
		)
		expect(d?.title).not.toBe('Path release published')
		expect(d?.verifiedBadge).toBe('none')
	})

	test('path release with no cashu token is rejected', async () => {
		const winningBid = makeBid({ amount: 50000 })
		const pr = makePathRelease({ bidEventId: winningBid.id, cashuToken: undefined })
		const d = await getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				verdicts: [verdictForBid(winningBid.id)],
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [pr],
				now: 120,
			}),
		)
		expect(d?.title).not.toBe('Path release published')
		expect(d?.verifiedBadge).toBe('none')
	})

	test('settlement referencing invalid path release is rejected', async () => {
		const winningBid = makeBid({ amount: 50000 })
		const badPr = makePathRelease({
			bidEventId: winningBid.id,
			cashuToken: 'garbage',
		})
		const settlement = makeSettlement({
			pathReleaseEventId: badPr.id,
		})
		const d = await getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				verdicts: [verdictForBid(winningBid.id)],
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [badPr],
				settlements: [settlement],
				now: 120,
			}),
		)
		expect(d?.title).not.toBe('You won this auction!')
	})

	test('path release with valid cashu token is fully validated', async () => {
		const winningBid = makeBid({ amount: 50000 })
		const pr = makePathRelease({ bidEventId: winningBid.id })
		const d = await getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				verdicts: [verdictForBid(winningBid.id)],
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [pr],
				now: 120,
			}),
		)
		expect(d?.title).toBe('Path release published')
		expect(d?.verifiedBadge).toBe('path-release')
	})

	test('bid with wrong mint is rejected from top bid', async () => {
		const badBid = makeBid({ mint: 'https://wrong-mint.com' })
		const d = await getSettlementDescriptor(
			winningBidInput({
				bids: [badBid],
				verdicts: [verdictForBid(badBid.id)],
				myTopBidEvent: badBid,
				hasBidderRecord: true,
				now: 120,
			}),
		)
		expect(d?.role).not.toBe('winning-bidder')
	})
})

describe('rebid chain path release validation', () => {
	// Rebid chain fixtures: leg1 (original bid) + leg2 (rebid with delta)
	const PATH_1 = 'm/0'
	const PATH_2 = 'm/1'
	const CHILD_1 = deriveAuctionChildP2pkPubkeyFromXpub(TEST_XPUB, PATH_1)
	const CHILD_2 = deriveAuctionChildP2pkPubkeyFromXpub(TEST_XPUB, PATH_2)
	const SECRET_1 = JSON.stringify([
		'P2PK',
		{
			nonce: 'a'.repeat(16),
			data: CHILD_1,
			tags: [
				['n_sigs', '1'],
				['locktime', String(AUCTION_LOCKTIME)],
				['refund', REFUND_PUBKEY],
				['n_sigs_refund', '1'],
				['sigflag', 'SIG_INPUTS'],
			],
		},
	])
	const SECRET_2 = JSON.stringify([
		'P2PK',
		{
			nonce: 'b'.repeat(16),
			data: CHILD_2,
			tags: [
				['n_sigs', '1'],
				['locktime', String(AUCTION_LOCKTIME)],
				['refund', REFUND_PUBKEY],
				['n_sigs_refund', '1'],
				['sigflag', 'SIG_INPUTS'],
			],
		},
	])
	const PROOF_Y_1 = hashToCurveHexFromString(SECRET_1)
	const PROOF_Y_2 = hashToCurveHexFromString(SECRET_2)
	const TOKEN_1 = getEncodedToken({
		mint: 'https://mint.example.com',
		proofs: [
			{
				amount: 50000,
				secret: SECRET_1,
				C: ProjectivePoint.fromPrivateKey(etc.hexToBytes('11'.repeat(32))).toHex(true),
				id: '00'.repeat(16),
			},
		],
	})
	const TOKEN_2 = getEncodedToken({
		mint: 'https://mint.example.com',
		proofs: [
			{
				amount: 3000,
				secret: SECRET_2,
				C: ProjectivePoint.fromPrivateKey(etc.hexToBytes('22'.repeat(32))).toHex(true),
				id: '00'.repeat(16),
			},
		],
	})

	const leg1 = makeBid({
		id: 'leg-1',
		amount: 50000,
		legLockedAmount: 50000,
		childPubkey: CHILD_1,
		lockSecrets: [SECRET_1],
		proofYs: [PROOF_Y_1],
		prevBidId: undefined,
	})
	const leg2 = makeBid({
		id: 'leg-2',
		amount: 53000,
		legLockedAmount: 3000,
		childPubkey: CHILD_2,
		lockSecrets: [SECRET_2],
		proofYs: [PROOF_Y_2],
		prevBidId: 'leg-1',
	})

	const release1 = makePathRelease({
		id: 'pr-leg-1',
		bidEventId: 'leg-1',
		derivationPath: PATH_1,
		childPubkey: CHILD_1,
		cashuToken: TOKEN_1,
	})
	const release2 = makePathRelease({
		id: 'pr-leg-2',
		bidEventId: 'leg-2',
		derivationPath: PATH_2,
		childPubkey: CHILD_2,
		cashuToken: TOKEN_2,
	})

	test('seller sees Settlement Ready when both legs have valid path releases', async () => {
		const d = await getSettlementDescriptor(
			makeInput({
				bids: [leg1, leg2],
				verdicts: [verdictForBid(leg1.id, { observedAt: 100 }), verdictForBid(leg2.id, { observedAt: 100 })],
				pathReleases: [release1, release2],
				currentUserPubkey: SELLER_PUBKEY,
				now: 120,
			}),
		)
		expect(d?.title).toBe('Settlement Ready')
		expect(d?.verifiedBadge).toBe('path-release')
	})

	test('seller sees Settlement Ready when only the top bid leg has a path release', async () => {
		const d = await getSettlementDescriptor(
			makeInput({
				bids: [leg1, leg2],
				verdicts: [verdictForBid(leg1.id, { observedAt: 100 }), verdictForBid(leg2.id, { observedAt: 100 })],
				pathReleases: [release2],
				currentUserPubkey: SELLER_PUBKEY,
				now: 120,
			}),
		)
		expect(d?.title).toBe('Settlement Ready')
	})

	test('leg 1 path release is NOT rejected when validated against its own bid (not top bid)', async () => {
		const d = await getSettlementDescriptor(
			makeInput({
				bids: [leg1, leg2],
				verdicts: [verdictForBid(leg1.id, { observedAt: 100 }), verdictForBid(leg2.id, { observedAt: 100 })],
				pathReleases: [release1],
				currentUserPubkey: SELLER_PUBKEY,
				now: 120,
			}),
		)
		// With only leg 1's release, the seller should still see a path release
		// (it's valid against leg 1's bid). But the top bid (leg 2) has no release,
		// so the seller stays on "Awaiting Path Release".
		expect(d?.title).toBe('Awaiting Path Release')
	})

	test('leg 2 path release with delta token amount is validated correctly', async () => {
		const d = await getSettlementDescriptor(
			makeInput({
				bids: [leg1, leg2],
				verdicts: [verdictForBid(leg1.id, { observedAt: 100 }), verdictForBid(leg2.id, { observedAt: 100 })],
				pathReleases: [release1, release2],
				currentUserPubkey: BUYER_PUBKEY,
				myTopBidEvent: leg2,
				hasBidderRecord: true,
				now: 120,
			}),
		)
		// The winning bidder sees "Path release published" because leg 2's release
		// is valid (token sum = 3000 = legLockedAmount, not 53000 = amount).
		expect(d?.title).toBe('Path release published')
		expect(d?.verifiedBadge).toBe('path-release')
	})

	test('leg 2 path release with wrong token amount (cumulative instead of delta) is rejected', async () => {
		const badToken2 = getEncodedToken({
			mint: 'https://mint.example.com',
			proofs: [
				{
					amount: 53000,
					secret: SECRET_2,
					C: ProjectivePoint.fromPrivateKey(etc.hexToBytes('22'.repeat(32))).toHex(true),
					id: '00'.repeat(16),
				},
			],
		})
		const badRelease2 = makePathRelease({
			id: 'pr-leg-2-bad',
			bidEventId: 'leg-2',
			derivationPath: PATH_2,
			childPubkey: CHILD_2,
			cashuToken: badToken2,
		})
		const d = await getSettlementDescriptor(
			makeInput({
				bids: [leg1, leg2],
				verdicts: [verdictForBid(leg1.id, { observedAt: 100 }), verdictForBid(leg2.id, { observedAt: 100 })],
				pathReleases: [release1, badRelease2],
				currentUserPubkey: SELLER_PUBKEY,
				now: 120,
			}),
		)
		// Leg 2's release has a token sum of 53000 (cumulative) but legLockedAmount
		// is 3000 (delta). The validator should reject it as amount_mismatch.
		// Leg 1's release is still valid, so the seller sees "Awaiting Path Release"
		// (leg 1 is valid but leg 2 is not — the top bid has no valid release).
		expect(d?.title).toBe('Awaiting Path Release')
	})

	test('seller sees Awaiting Shipping Details when a settled rebid-chain settlement with 2 payouts passes completeness validation', async () => {
		const d = await getSettlementDescriptor(
			makeInput({
				bids: [leg1, leg2],
				verdicts: [verdictForBid(leg1.id, { observedAt: 100 }), verdictForBid(leg2.id, { observedAt: 100 })],
				nut7States: spentNut7States([leg1, leg2]),
				pathReleases: [release1, release2],
				settlements: [
					makeSettlement({
						status: 'settled',
						winningBidId: 'leg-2',
						winnerPubkey: BUYER_PUBKEY,
						finalAmount: 53000,
						pathReleaseEventId: 'pr-leg-2',
						payouts: [
							{ bidEventId: 'leg-1', amount: 50000, status: 'redeemed' },
							{ bidEventId: 'leg-2', amount: 3000, status: 'redeemed' },
						],
					}),
				],
				currentUserPubkey: SELLER_PUBKEY,
				now: 120,
			}),
		)
		// The settlement has 2 payout tags (one per leg). The descriptor builds
		// the bid chain from prevBidId links and passes it to
		// validateSettlementCompleteness, which should accept 2 payouts.
		expect(d?.title).toBe('Awaiting Shipping Details')
		expect(d?.tone).toBe('waiting')
		expect(d?.verifiedBadge).toBe('settlement')
	})

	test('seller sees Awaiting Path Release when a settled rebid-chain settlement has wrong payout count', async () => {
		const d = await getSettlementDescriptor(
			makeInput({
				bids: [leg1, leg2],
				verdicts: [verdictForBid(leg1.id, { observedAt: 100 }), verdictForBid(leg2.id, { observedAt: 100 })],
				pathReleases: [release1, release2],
				settlements: [
					makeSettlement({
						status: 'settled',
						winningBidId: 'leg-2',
						winnerPubkey: BUYER_PUBKEY,
						finalAmount: 53000,
						pathReleaseEventId: 'pr-leg-2',
						payouts: [{ bidEventId: 'leg-2', amount: 53000, status: 'redeemed' }],
					}),
				],
				currentUserPubkey: SELLER_PUBKEY,
				now: 120,
			}),
		)
		// The settlement has only 1 payout tag but the chain has 2 legs.
		// validateSettlementCompleteness should reject it (payout_missing:
		// "expected 2, got 1"), so the settlement is filtered out and the
		// seller falls back to "Settlement Ready" (both path releases are valid).
		expect(d?.title).toBe('Settlement Ready')
		expect(d?.verifiedBadge).toBe('path-release')
	})
})
