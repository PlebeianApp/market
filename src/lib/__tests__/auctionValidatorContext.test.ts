import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { MinBidCurve, ParsedAuctionEvent, ParsedBidEvent } from '../auction/events'
import { checkMintReachability } from '../cashu/nut7'
import {
	collectLiveBids,
	createValidatorState,
	setAuctionMintReachability,
	upsertAuction,
	upsertBid,
} from '../../server/auction-validator/state'

const SELLER_PK = 'a'.repeat(64)
const BIDDER_PK = 'b'.repeat(64)
const VALIDATOR_PK = 'c'.repeat(64)
const COMPRESSED_PK = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const PROOF_Y = '02' + 'f'.repeat(64)
const NO_CURVE: MinBidCurve = { shape: 'none', peakMultiplier: 1, raw: '' }

const buildAuctionRawEvent = (overrides: { title?: string; endAt?: number; p2pkXpub?: string; mints?: string[] } = {}): NDKEvent => {
	const endAt = overrides.endAt ?? 2_000
	const mints = overrides.mints ?? ['https://mint.test']
	return {
		id: '1'.repeat(64),
		kind: 30408,
		pubkey: SELLER_PK,
		created_at: 1_000,
		content: '',
		tags: [
			['d', 'auction-test'],
			['title', overrides.title ?? 'Original title'],
			['auction_type', 'english'],
			['start_at', '1000'],
			['end_at', String(endAt)],
			['max_end_at', '2100'],
			['settlement_grace', '3600'],
			['currency', 'SAT'],
			['reserve', '0'],
			['starting_bid', '1000'],
			['bid_increment', '100'],
			['min_bid_curve', 'none'],
			['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', overrides.p2pkXpub ?? 'xpub-root'],
			['auditors', VALIDATOR_PK],
			['auditor_quorum', '1'],
			['max_skew_sec', '60'],
			['fallback_delay_sec', '1800'],
			...mints.map((mint) => ['mint', mint] as string[]),
		],
	} as unknown as NDKEvent
}

const buildAuction = (overrides: { title?: string; endAt?: number; p2pkXpub?: string; mints?: string[] } = {}): ParsedAuctionEvent => {
	const rawEvent = buildAuctionRawEvent(overrides)
	return {
		rawEvent,
		dTag: 'auction-test',
		sellerPubkey: SELLER_PK,
		coordinate: `30408:${SELLER_PK}:auction-test`,
		rootEventId: rawEvent.id,
		title: overrides.title ?? 'Original title',
		content: '',
		auctionType: 'english',
		startAt: 1_000,
		endAt: overrides.endAt ?? 2_000,
		maxEndAt: 2_100,
		settlementGrace: 3_600,
		currency: 'SAT',
		reserve: 0,
		startingBid: 1_000,
		bidIncrement: 100,
		minBidCurve: NO_CURVE,
		settlementPolicy: 'cashu_p2pk_bidder_path_v1',
		keyScheme: 'hd_p2pk',
		mints: overrides.mints ?? ['https://mint.test'],
		p2pkXpub: overrides.p2pkXpub ?? 'xpub-root',
		auditors: [VALIDATOR_PK],
		auditorQuorum: 1,
		maxSkewSec: 60,
		fallbackDelaySec: 1_800,
		vadiumRatioBps: 10_000,
		schema: 'auction_v1',
	}
}

const buildBid = (): ParsedBidEvent => ({
	rawEvent: {
		id: '2'.repeat(64),
		kind: 1023,
		pubkey: BIDDER_PK,
		created_at: 1_500,
		content: '',
		tags: [],
	} as unknown as NDKEvent,
	id: '2'.repeat(64),
	bidderPubkey: BIDDER_PK,
	createdAt: 1_500,
	auctionRootEventId: '1'.repeat(64),
	auctionCoordinate: `30408:${SELLER_PK}:auction-test`,
	sellerPubkey: SELLER_PK,
	amount: 1_200,
	currency: 'SAT',
	mint: 'https://mint.test',
	locktime: 5_700,
	refundPubkey: REFUND_PK,
	childPubkey: COMPRESSED_PK,
	lockSecrets: ['secret'],
	proofYs: [PROOF_Y],
	createdForEndAt: 2_100,
	bidNonce: 'nonce',
	keyScheme: 'hd_p2pk',
	status: 'locked',
	prevBidId: undefined,
	note: undefined,
})

describe('auction validator context guards', () => {
	test('upsertAuction preserves root context and rejects immutable updates', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const inserted = upsertAuction(state, buildAuction())

		expect(inserted.status).toBe('inserted')
		expect(inserted.auctionState.rootAuction.p2pkXpub).toBe('xpub-root')

		const mutableUpdate = upsertAuction(state, buildAuction({ title: 'New title' }))
		expect(mutableUpdate.status).toBe('updated')
		expect(mutableUpdate.auctionState.rootAuction.title).toBe('Original title')
		expect(mutableUpdate.auctionState.auction.title).toBe('New title')

		const immutableUpdate = upsertAuction(state, buildAuction({ p2pkXpub: 'xpub-other' }))
		expect(immutableUpdate.status).toBe('rejected_immutable')
		expect(immutableUpdate.auctionState.auction.p2pkXpub).toBe('xpub-root')
	})

	test('collectLiveBids skips auctions until mint reachability is active', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction()).auctionState
		const bid = buildBid()

		upsertBid(state, bid, 1_505)
		expect(collectLiveBids(state, 1_600)).toEqual([])

		setAuctionMintReachability(auctionState, [['https://mint.test', true]])

		const live = collectLiveBids(state, 1_600)
		expect(live).toHaveLength(1)
		expect(live[0]?.bidState.bid.id).toBe(bid.id)
	})

	test('checkMintReachability distinguishes healthy and failing NUT-7 clients', async () => {
		const healthyMint = {
			check: async () => ({ states: [{ Y: 'deadbeef', state: 'UNSPENT' }] }),
		}
		const failingMint = {
			check: async () => {
				throw new Error('network down')
			},
		}

		await expect(checkMintReachability('https://mint.test', { mintClient: healthyMint as any })).resolves.toBe(true)
		await expect(checkMintReachability('https://mint.test', { mintClient: failingMint as any })).resolves.toBe(false)
	})
})
