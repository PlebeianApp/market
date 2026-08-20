import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { EventTemplate } from 'nostr-tools'
import type { MinBidCurve, ParsedAuctionEvent, ParsedBidEvent } from '../auction/events'
import { hashToCurveHexFromString } from '../cashu/hashToCurve'
import { createVerdictPublisher } from '../../server/auction-validator/publisher'
import { createValidatorState, setAuctionMintReachability, upsertAuction, upsertBid } from '../../server/auction-validator/state'

const SELLER_PK = 'a'.repeat(64)
const BIDDER_A = 'b'.repeat(64)
const BIDDER_B = 'c'.repeat(64)
const VALIDATOR_PK = 'd'.repeat(64)
const COMPRESSED_PK = '02' + 'e'.repeat(64)
const REFUND_PK = '03' + 'f'.repeat(64)
const PROOF_Y_A = '02' + '1'.repeat(64)
const PROOF_Y_B = '03' + '2'.repeat(64)
const NO_CURVE: MinBidCurve = { shape: 'none', peakMultiplier: 1, raw: '' }

const buildAuction = (): ParsedAuctionEvent => {
	const rawEvent = {
		id: '1'.repeat(64),
		kind: 30408,
		pubkey: SELLER_PK,
		created_at: 1_000,
		content: '',
		tags: [],
	} as unknown as NDKEvent

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
		endAt: 2_000,
		maxEndAt: 2_100,
		settlementGrace: 3_600,
		currency: 'SAT',
		reserve: 0,
		startingBid: 1_000,
		bidIncrement: 100,
		minBidCurve: NO_CURVE,
		settlementPolicy: 'cashu_p2pk_bidder_path_v1',
		keyScheme: 'hd_p2pk',
		mints: ['https://mint.test'],
		p2pkXpub: 'xpub-root',
		auditors: [VALIDATOR_PK],
		auditorQuorum: 1,
		maxSkewSec: 60,
		fallbackDelaySec: 1_800,
		vadiumRatioBps: 10_000,
		schema: 'auction_v1',
	}
}

const buildBid = (
	auction: ParsedAuctionEvent,
	input: { id: string; bidderPubkey: string; amount: number; proofY: string },
): ParsedBidEvent => ({
	rawEvent: {
		id: input.id,
		kind: 1023,
		pubkey: input.bidderPubkey,
		created_at: 1_500,
		content: '',
		tags: [],
	} as unknown as NDKEvent,
	id: input.id,
	bidderPubkey: input.bidderPubkey,
	createdAt: 1_500,
	auctionRootEventId: auction.rootEventId,
	auctionCoordinate: auction.coordinate,
	sellerPubkey: auction.sellerPubkey,
	amount: input.amount,
	currency: 'SAT',
	mint: auction.mints[0]!,
	locktime: auction.maxEndAt + auction.settlementGrace,
	refundPubkey: REFUND_PK,
	childPubkey: COMPRESSED_PK,
	lockSecrets: ['secret'],
	proofYs: [input.proofY],
	createdForEndAt: auction.maxEndAt,
	bidNonce: 'nonce',
	keyScheme: 'hd_p2pk',
	status: 'locked',
	prevBidId: undefined,
	note: undefined,
})

describe('auction validator publisher close-role runtime wiring', () => {
	test('publishIfChanged assigns winner/loser roles after close before deriving verdict', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [['https://mint.test', true]])

		const lowBid = buildBid(auction, {
			id: '2'.repeat(64),
			bidderPubkey: BIDDER_A,
			amount: 1_200,
			proofY: PROOF_Y_A,
		})
		const highBid = buildBid(auction, {
			id: '3'.repeat(64),
			bidderPubkey: BIDDER_B,
			amount: 1_500,
			proofY: PROOF_Y_B,
		})
		const lowState = upsertBid(state, lowBid, lowBid.createdAt)
		const highState = upsertBid(state, highBid, highBid.createdAt)
		if (!lowState || !highState) throw new Error('expected bids to upsert')

		lowState.bidState.currentClaim = 'valid_bid_placed'
		highState.bidState.currentClaim = 'valid_bid_placed'
		lowState.bidState.postCloseDecision = null
		highState.bidState.postCloseDecision = null
		auctionState.closeHandled = false

		let publishedCount = 0
		const publisher = createVerdictPublisher({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) =>
					({ ...template, id: '9'.repeat(64), pubkey: VALIDATOR_PK, sig: 'a'.repeat(128) }) as any,
			} as any,
			relayPool: {
				publish: async () => {
					publishedCount += 1
				},
			} as any,
			now: () => auction.maxEndAt + 10,
		})

		await publisher.publishIfChanged({
			auctionState,
			bidState: highState.bidState,
			currentTopBid: highBid.amount,
		})

		const winnerDecision = auctionState.bids.get(highBid.id)?.postCloseDecision
		const loserDecision = auctionState.bids.get(lowBid.id)?.postCloseDecision

		expect(auctionState.closeHandled).toBe(true)
		expect(winnerDecision).toBe('winner')
		expect(loserDecision).toBe('loser')
		expect(publishedCount).toBe(1)
	})
	test('a bid pending at close that becomes valid after close takes the loser role, not the winner path', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [['https://mint.test', true]])

		// The only bid: pending review at close (no NUT-7 confirmation yet).
		// Use a real P2PK lock secret with a matching proof_y so the
		// pre-close validation pipeline can confirm it valid_bid_placed.
		const locktime = auction.maxEndAt + auction.settlementGrace
		const lockSecret = JSON.stringify([
			'P2PK',
			{
				nonce: 'n',
				data: COMPRESSED_PK,
				tags: [
					['sigflag', 'SIG_INPUTS'],
					['locktime', String(locktime)],
					['refund', REFUND_PK],
					['n_sigs_refund', '1'],
				],
			},
		])
		const proofY = hashToCurveHexFromString(lockSecret)
		const pendingBid = buildBid(auction, { id: '2'.repeat(64), bidderPubkey: BIDDER_A, amount: 1_200, proofY })
		pendingBid.lockSecrets = [lockSecret]
		pendingBid.proofYs = [proofY]
		const pending = upsertBid(state, pendingBid, pendingBid.createdAt)
		if (!pending) throw new Error('expected bid to upsert')
		pending.bidState.currentClaim = 'bid_pending_review'
		pending.bidState.postCloseDecision = null
		auctionState.closeHandled = false

		const publishedClaims: string[] = []
		const publisher = createVerdictPublisher({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) =>
					({ ...template, id: '9'.repeat(64), pubkey: VALIDATOR_PK, sig: 'a'.repeat(128) }) as any,
			} as any,
			relayPool: {
				publish: async () => {
					publishedClaims.push('published')
				},
			} as any,
			now: () => auction.maxEndAt + 10,
		})

		// NUT-7 now confirms the bid's proof unspent — it reaches
		// valid_bid_placed, but only AFTER close. Snapshot semantics: it
		// was not confirmed valid at the close snapshot, so it cannot win.
		pending.bidState.nut7States.set(proofY.toLowerCase(), { state: 'unspent', observedAt: auction.maxEndAt + 10 })

		const result = await publisher.publishIfChanged({
			auctionState,
			bidState: pending.bidState,
			currentTopBid: 0,
		})

		expect(auctionState.closeHandled).toBe(true)
		// The close snapshot saw no valid bid → no winner.
		expect(auctionState.bids.get(pendingBid.id)?.postCloseDecision).toBe('loser')
		// It is routed to the loser path (refund), never the winner path.
		expect(result.verdict.claim).toBe('lost_pending_refund')
		expect(publishedClaims).toEqual(['published'])
	})

	test("verdict observed_at stamps the validator's FIRST observation, not publish time", async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [['https://mint.test', true]])

		// Bid first observed at 1_500 (in-window). The publisher runs much
		// later (post-close, maxEndAt + 10). Without first-observation
		// stamping, the close-phase upgrade would carry `publish time`
		// (> maxEndAt) and the client-side quorum-eligibility screen
		// (ADR-0003 §2.3 amendment) would drop it — winner derivation
		// would break for every previously-confirmed bid.
		const bid = buildBid(auction, { id: '2'.repeat(64), bidderPubkey: BIDDER_A, amount: 1_200, proofY: PROOF_Y_A })
		const bidState = upsertBid(state, bid, 1_500)
		if (!bidState) throw new Error('expected bid to upsert')
		bidState.bidState.currentClaim = 'valid_bid_placed'
		auctionState.closeHandled = false

		let capturedTemplate: EventTemplate | null = null
		const publisher = createVerdictPublisher({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) => {
					capturedTemplate = template
					return { ...template, id: '9'.repeat(64), pubkey: VALIDATOR_PK, sig: 'a'.repeat(128) } as any
				},
			} as any,
			relayPool: { publish: async () => {} } as any,
			now: () => auction.maxEndAt + 10,
		})

		await publisher.publishIfChanged({
			auctionState,
			bidState: bidState.bidState,
			currentTopBid: bid.amount,
		})

		if (!capturedTemplate) throw new Error('expected a verdict publish')
		const observedAtTag = (capturedTemplate as EventTemplate).tags.find((t) => t[0] === 'observed_at')
		expect(observedAtTag?.[1]).toBe(String(1_500))
		expect(observedAtTag?.[1]).not.toBe(String(auction.maxEndAt + 10))
	})

	test('Fix 3: post-close late_arrival is suppressed (never condemns an in-window bid)', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [['https://mint.test', true]])

		// Simulate a restart: fresh in-memory state (currentClaim = null) with
		// a re-stamped observed_at = post-close now. Without Fix 1 recovery,
		// deriveVerdict produces bid_invalid: late_arrival.
		const bid = buildBid(auction, { id: '3'.repeat(64), bidderPubkey: BIDDER_A, amount: 1_200, proofY: PROOF_Y_A })
		const bidState = upsertBid(state, bid, auction.maxEndAt + 100)
		if (!bidState) throw new Error('expected bid to upsert')
		// currentClaim stays null (fresh memory); observed_at is post-close.
		auctionState.closeHandled = false

		let published = false
		const publisher = createVerdictPublisher({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) => {
					published = true
					return { ...template, id: '9'.repeat(64), pubkey: VALIDATOR_PK, sig: 'a'.repeat(128) } as any
				},
			} as any,
			relayPool: { publish: async () => {} } as any,
			now: () => auction.maxEndAt + 100,
		})

		const result = await publisher.publishIfChanged({
			auctionState,
			bidState: bidState.bidState,
			currentTopBid: bid.amount,
		})

		// Fix 3: the late_arrival condemn is suppressed — the relay keeps any
		// surviving prior valid_bid_placed, and with no prior verdict the bid
		// stays pending (never condemned). In-memory claim is unchanged.
		expect(published).toBe(false)
		expect(result.published).toBe(false)
		expect(result.verdict.claim).toBe('bid_invalid')
		expect(result.verdict.reason).toBe('late_arrival')
		expect(bidState.bidState.currentClaim).toBeNull()
	})

	test('Fix 3: pre-close late_arrival is still published (not suppressed)', async () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		const auctionState = upsertAuction(state, auction).auctionState
		setAuctionMintReachability(auctionState, [['https://mint.test', true]])

		// Bid observed before start_at (observed_at < startAt) while still
		// pre-close (now <= maxEndAt) → late_arrival, which IS published.
		const bid = buildBid(auction, { id: '4'.repeat(64), bidderPubkey: BIDDER_A, amount: 1_200, proofY: PROOF_Y_A })
		const bidState = upsertBid(state, bid, auction.startAt - 50)
		if (!bidState) throw new Error('expected bid to upsert')
		auctionState.closeHandled = false

		let published = false
		const publisher = createVerdictPublisher({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) => {
					published = true
					return { ...template, id: '8'.repeat(64), pubkey: VALIDATOR_PK, sig: 'b'.repeat(128) } as any
				},
			} as any,
			relayPool: { publish: async () => {} } as any,
			now: () => auction.startAt + 10,
		})

		await publisher.publishIfChanged({
			auctionState,
			bidState: bidState.bidState,
			currentTopBid: bid.amount,
		})

		expect(published).toBe(true)
	})
})
