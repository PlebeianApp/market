import { describe, expect, test } from 'bun:test'
import { getSettlementDescriptor, type GetSettlementDescriptorInput, type SettlementParticipantRole } from '../auction/settlementDescriptor'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, ParsedSettlementEvent } from '../auction/events'
import type { NostrEventLike } from '../nostr/eventLike'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import { ProjectivePoint, etc } from '@noble/secp256k1'
import { HDKey } from '@scure/bip32'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'

const SELLER_PUBKEY = 'a'.repeat(64)
const BUYER_PUBKEY = 'b'.repeat(64)
const OTHER_BIDDER_PUBKEY = 'c'.repeat(64)

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
		auditors: [],
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
		payouts: [],
		fallbackChain: [],
		...overrides,
	} as ParsedSettlementEvent
}

function makeClaimOrder(overrides: Partial<NostrEventLike> = {}): NostrEventLike {
	return { id: 'order-1', pubkey: BUYER_PUBKEY, kind: 16, content: '', tags: [], ...overrides }
}

function hasKey(o: object, k: string): boolean {
	return Object.prototype.hasOwnProperty.call(o, k)
}

function makeInput(overrides: object = {}): GetSettlementDescriptorInput {
	const base: GetSettlementDescriptorInput = {
		auction: makeAuction(),
		bids: [],
		topBid: null,
		settlements: [],
		pathReleases: [],
		claimOrders: [],
		currentUserPubkey: undefined,
		myTopBidEvent: null,
		hasBidderRecord: false,
		hasPlacedBid: false,
		now: 120,
	}
	for (const [k, v] of Object.entries(overrides)) {
		if (hasKey(base as object, k) || k === 'currentUserPubkey' || k === 'myTopBidEvent') {
			;(base as Record<string, unknown>)[k] = v
		}
	}
	return base
}

const winningBid = makeBid({ bidderPubkey: BUYER_PUBKEY, amount: 50000 })
const winningBidInput = (extra: InputOverrides = {}): GetSettlementDescriptorInput =>
	makeInput({
		bids: [winningBid],
		topBid: winningBid,
		currentUserPubkey: BUYER_PUBKEY,
		myTopBidEvent: winningBid,
		hasBidderRecord: true,
		hasPlacedBid: true,
		...extra,
	})

describe('getSettlementDescriptor', () => {
	describe('role classification', () => {
		test('seller: currentUserPubkey === sellerPubkey', () => {
			const d = getSettlementDescriptor(makeInput({ currentUserPubkey: SELLER_PUBKEY, now: 120 }))
			expect(d?.role).toBe('seller')
		})

		test('winning-bidder: top bid is mine', () => {
			const d = getSettlementDescriptor(winningBidInput({ now: 120 }))
			expect(d?.role).toBe('winning-bidder')
		})

		test('outbid-bidder: I have a validated bid but am not the top', () => {
			const myBid = makeBid({ id: 'bid-low', bidderPubkey: OTHER_BIDDER_PUBKEY, amount: 20000 })
			const topBid = makeBid({ id: 'bid-top', bidderPubkey: BUYER_PUBKEY, amount: 50000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid, myBid],
					topBid,
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: myBid,
					hasPlacedBid: true,
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.role).toBe('outbid-bidder')
		})

		test('non-participant: no pubkey -> observer state', () => {
			const d = getSettlementDescriptor(makeInput({ currentUserPubkey: undefined, now: 120 }))
			expect(d?.role).toBe('non-participant')
			expect(d?.title).toBe('Auction Ended')
		})

		test('non-participant: pubkey not in any bid, placed a bid that failed validation', () => {
			const d = getSettlementDescriptor(makeInput({ currentUserPubkey: OTHER_BIDDER_PUBKEY, hasPlacedBid: true, now: 120 }))
			expect(d?.role).toBe('non-participant')
			expect(d?.title).toBe('Bid Not Validated')
		})

		test('self-bidding seller classifies as seller, not winning-bidder', () => {
			const myBid = makeBid({ bidderPubkey: SELLER_PUBKEY })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ sellerPubkey: SELLER_PUBKEY }),
					bids: [myBid],
					topBid: myBid,
					currentUserPubkey: SELLER_PUBKEY,
					myTopBidEvent: myBid,
					now: 120,
				}),
			)
			expect(d?.role).toBe('seller')
		})
	})

	describe('auction not ended', () => {
		test('returns null before biddingCutoffAt', () => {
			const d = getSettlementDescriptor(winningBidInput({ now: 50 }))
			expect(d).toBeNull()
		})
	})

	describe('seller states', () => {
		test('settlement-ready: path released, no settlement, reserve met', () => {
			const topBid = makeBid({ amount: 50000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					topBid,
					currentUserPubkey: SELLER_PUBKEY,
					pathReleases: [makePathRelease({ bidEventId: topBid.id })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Settlement Ready')
			expect(d?.cta?.kind).toBe('submit-settlement')
			expect(d?.tone).toBe('action')
		})

		test('late-settlement: path released but settlement window expired', () => {
			const topBid = makeBid({ amount: 50000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					topBid,
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

		test('latestSettlement prefers latest by created_at among same status', () => {
			const topBid = makeBid({ amount: 50000 })
			const older = makeSettlement({
				status: 'reserve_not_met',
				createdAt: 200,
			})
			const newer = makeSettlement({
				status: 'reserve_not_met',
				createdAt: 300,
			})
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 100000 }),
					bids: [topBid],
					topBid,
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [older, newer],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Auction Closed — Reserve Not Met')
		})

		test('close-auction (reserve not met): high reserve, no qualifying bid', () => {
			const topBid = makeBid({ amount: 30000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					topBid,
					currentUserPubkey: SELLER_PUBKEY,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Reserve Not Met')
			expect(d?.cta?.kind).toBe('close-auction')
		})

		test('close-auction (no bids): no reserve, no bids', () => {
			const d = getSettlementDescriptor(makeInput({ auction: makeAuction({ reserve: 0 }), currentUserPubkey: SELLER_PUBKEY, now: 120 }))
			expect(d?.title).toBe('No Bids Received')
			expect(d?.cta?.kind).toBe('close-auction')
		})

		test('awaiting-path-release: reserve met, no path, window open', () => {
			const topBid = makeBid({ amount: 50000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					topBid,
					currentUserPubkey: SELLER_PUBKEY,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Awaiting Path Release')
			expect(d?.tone).toBe('waiting')
			expect(d?.cta).toBeNull()
		})

		test('settlement-window-expired: reserve met, no path, window expired', () => {
			const topBid = makeBid({ amount: 50000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid],
					topBid,
					currentUserPubkey: SELLER_PUBKEY,
					now: 200,
				}),
			)
			expect(d?.title).toBe('Settlement Window Expired')
			expect(d?.tone).toBe('completed')
			expect(d?.cta).toBeNull()
		})

		test('order-received: settled, matched claim order', () => {
			const d = getSettlementDescriptor(
				makeInput({
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [makeSettlement({ status: 'settled', winnerPubkey: BUYER_PUBKEY })],
					claimOrders: [makeClaimOrder({ pubkey: BUYER_PUBKEY, id: 'order-1' })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Order Received')
			expect(d?.cta?.kind).toBe('view-order')
			expect(d?.cta?.orderId).toBe('order-1')
		})

		test('awaiting-shipping: settled, no claim order yet', () => {
			const d = getSettlementDescriptor(
				makeInput({
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [makeSettlement({ status: 'settled', winnerPubkey: BUYER_PUBKEY })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Awaiting Shipping Details')
			expect(d?.tone).toBe('waiting')
		})

		test('closed-reserve-not-met: settlement reserve_not_met -> NOT a refund card', () => {
			const d = getSettlementDescriptor(
				makeInput({
					currentUserPubkey: SELLER_PUBKEY,
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Auction Closed — Reserve Not Met')
			expect(d?.cta).toBeNull()
		})

		test('closed (griefed_no_fallback)', () => {
			const d = getSettlementDescriptor(
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
		test('release-path: reserve met, window open, have bidder record', () => {
			const d = getSettlementDescriptor(winningBidInput({ auction: makeAuction({ reserve: 40000 }), now: 120 }))
			expect(d?.title).toBe('You won — release your path to settle')
			expect(d?.cta?.kind).toBe('release-path')
			expect(d?.bidAmount).toBe(50000)
		})

		test('path-released: my path release exists', () => {
			const d = getSettlementDescriptor(
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

		test('winner-with-order: settled, settlement names me, claim order exists', () => {
			const d = getSettlementDescriptor(
				winningBidInput({
					settlements: [makeSettlement({ status: 'settled', winnerPubkey: BUYER_PUBKEY, finalAmount: 50000 })],
					claimOrders: [makeClaimOrder({ pubkey: BUYER_PUBKEY, id: 'order-1' })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('You won this auction!')
			expect(d?.cta?.kind).toBe('view-order')
			expect(d?.bidAmount).toBe(50000)
		})

		test('winner-claim-dialog: settled, settlement names me, no claim order', () => {
			const d = getSettlementDescriptor(
				winningBidInput({
					settlements: [makeSettlement({ status: 'settled', winnerPubkey: BUYER_PUBKEY, finalAmount: 50000 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('You won this auction!')
			expect(d?.cta?.kind).toBe('open-claim-dialog')
		})

		test('superseded: settlement names someone else', () => {
			const otherWinner = 'd'.repeat(64)
			const d = getSettlementDescriptor(
				winningBidInput({
					settlements: [makeSettlement({ status: 'settled', winnerPubkey: otherWinner, finalAmount: 50000 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Settlement Went to Fallback')
			expect(d?.tone).toBe('completed')
			expect(d?.cta).toBeNull()
		})

		test('settlement-expired: window closed, no path release', () => {
			const d = getSettlementDescriptor(winningBidInput({ auction: makeAuction({ reserve: 40000 }), now: 200 }))
			expect(d?.title).toBe('Settlement Expired')
			expect(d?.bidAmount).toBe(50000)
		})

		test('local-record-missing: no bidder record, window open', () => {
			const d = getSettlementDescriptor(winningBidInput({ auction: makeAuction({ reserve: 40000 }), hasBidderRecord: false, now: 120 }))
			expect(d?.title).toBe('Local Record Missing')
			expect(d?.cta?.kind).toBe('refresh-page')
		})

		test('reserve-not-met-refund-pending: top bid below reserve, window open', () => {
			const lowBid = makeBid({ amount: 30000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [lowBid],
					topBid: lowBid,
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
		test('bid-invalid: placed a bid but it failed validation', () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY })
			const d = getSettlementDescriptor(
				makeInput({
					bids: [topBid],
					topBid,
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: null,
					hasPlacedBid: true,
					now: 120,
				}),
			)
			expect(d?.title).toBe('Bid Not Validated')
			expect(d?.tone).toBe('completed')
		})

		test('refund: outbid bidder with reserve_not_met settlement', () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY, amount: 30000 })
			const myBid = makeBid({ id: 'bid-low', bidderPubkey: OTHER_BIDDER_PUBKEY, amount: 20000 })
			const d = getSettlementDescriptor(
				makeInput({
					auction: makeAuction({ reserve: 40000 }),
					bids: [topBid, myBid],
					topBid,
					currentUserPubkey: OTHER_BIDDER_PUBKEY,
					myTopBidEvent: myBid,
					hasPlacedBid: true,
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Refund Pending')
		})

		test('no card: outbid with validated bid, no settlement', () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY })
			const myBid = makeBid({ id: 'bid-low', bidderPubkey: OTHER_BIDDER_PUBKEY, amount: 20000 })
			const d = getSettlementDescriptor(
				makeInput({
					bids: [topBid, myBid],
					topBid,
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
		test('observer: non-participant with no bid sees auction status', () => {
			const topBid = makeBid({ bidderPubkey: BUYER_PUBKEY })
			const d = getSettlementDescriptor(makeInput({ bids: [topBid], topBid, currentUserPubkey: OTHER_BIDDER_PUBKEY, now: 120 }))
			expect(d?.role).toBe('non-participant')
			expect(d?.title).toBe('Awaiting Settlement')
		})

		test('bid-invalid: placed a bid but it failed validation (non-participant in validated terms)', () => {
			const d = getSettlementDescriptor(
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
		test('refund-pending: now < locktime', () => {
			const d = getSettlementDescriptor(
				winningBidInput({
					auction: makeAuction({ reserve: 40000 }),
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: 120,
				}),
			)
			expect(d?.title).toBe('Refund Pending')
		})

		test('refund-ready: now >= locktime', () => {
			const d = getSettlementDescriptor(
				winningBidInput({
					auction: makeAuction({ reserve: 40000 }),
					settlements: [makeSettlement({ status: 'reserve_not_met', winnerPubkey: undefined, finalAmount: 0 })],
					now: AUCTION_LOCKTIME,
				}),
			)
			expect(d?.title).toBe('Refund Ready')
			expect(d?.tone).toBe('completed')
		})
	})

	describe('verified badge', () => {
		test('settlement badge when settlement exists', () => {
			const d = getSettlementDescriptor(
				winningBidInput({
					settlements: [makeSettlement({ status: 'settled', winnerPubkey: BUYER_PUBKEY })],
					claimOrders: [makeClaimOrder({ pubkey: BUYER_PUBKEY })],
					now: 120,
				}),
			)
			expect(d?.verifiedBadge).toBe('settlement')
		})

		test('path-release badge when path release exists but no settlement', () => {
			const d = getSettlementDescriptor(
				winningBidInput({
					auction: makeAuction({ reserve: 40000 }),
					pathReleases: [makePathRelease({ bidEventId: winningBid.id })],
					now: 120,
				}),
			)
			expect(d?.verifiedBadge).toBe('path-release')
		})

		test('none badge when no settlement or path release', () => {
			const d = getSettlementDescriptor(winningBidInput({ auction: makeAuction({ reserve: 40000 }), now: 120 }))
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
							topBid,
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
	test('path release with undecodable cashu token is rejected', () => {
		const winningBid = makeBid({ amount: 50000 })
		const pr = makePathRelease({
			bidEventId: winningBid.id,
			cashuToken: 'not-a-valid-token',
		})
		const d = getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				topBid: winningBid,
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [pr],
				now: 120,
			}),
		)
		expect(d?.title).not.toBe('Path release published')
		expect(d?.verifiedBadge).toBe('none')
	})

	test('path release with no cashu token is rejected', () => {
		const winningBid = makeBid({ amount: 50000 })
		const pr = makePathRelease({ bidEventId: winningBid.id, cashuToken: undefined })
		const d = getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				topBid: winningBid,
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [pr],
				now: 120,
			}),
		)
		expect(d?.title).not.toBe('Path release published')
		expect(d?.verifiedBadge).toBe('none')
	})

	test('settlement referencing invalid path release is rejected', () => {
		const winningBid = makeBid({ amount: 50000 })
		const badPr = makePathRelease({
			bidEventId: winningBid.id,
			cashuToken: 'garbage',
		})
		const settlement = makeSettlement({
			pathReleaseEventId: badPr.id,
		})
		const d = getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				topBid: winningBid,
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [badPr],
				settlements: [settlement],
				now: 120,
			}),
		)
		expect(d?.title).not.toBe('You won this auction!')
	})

	test('path release with valid cashu token is fully validated', () => {
		const winningBid = makeBid({ amount: 50000 })
		const pr = makePathRelease({ bidEventId: winningBid.id })
		const d = getSettlementDescriptor(
			winningBidInput({
				auction: makeAuction({ reserve: 40000 }),
				bids: [winningBid],
				topBid: winningBid,
				myTopBidEvent: winningBid,
				hasBidderRecord: true,
				pathReleases: [pr],
				now: 120,
			}),
		)
		expect(d?.title).toBe('Path release published')
		expect(d?.verifiedBadge).toBe('path-release')
	})

	test('bid with wrong mint is rejected from top bid', () => {
		const badBid = makeBid({ mint: 'https://wrong-mint.com' })
		const d = getSettlementDescriptor(
			winningBidInput({
				bids: [badBid],
				topBid: badBid,
				myTopBidEvent: badBid,
				hasBidderRecord: true,
				now: 120,
			}),
		)
		expect(d?.role).not.toBe('winning-bidder')
	})
})
