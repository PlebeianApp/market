import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { MinBidCurve, ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent, ParsedSettlementEvent } from '../auction/events'
import { checkMintReachability, checkProofState, checkProofStateBatch } from '../cashu/nut7'
import {
	aggregateProofStates,
	collectLiveBids,
	createValidatorState,
	recordPathRelease,
	recordSettlement,
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

const buildAuctionRawEvent = (
	overrides: {
		title?: string
		endAt?: number
		p2pkXpub?: string
		mints?: string[]
		rootEventId?: string
		sellerPubkey?: string
		dTag?: string
	} = {},
): NDKEvent => {
	const endAt = overrides.endAt ?? 2_000
	const mints = overrides.mints ?? ['https://mint.test']
	const sellerPubkey = overrides.sellerPubkey ?? SELLER_PK
	return {
		id: overrides.rootEventId ?? '1'.repeat(64),
		kind: 30408,
		pubkey: sellerPubkey,
		created_at: 1_000,
		content: '',
		tags: [
			['d', overrides.dTag ?? 'auction-test'],
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

const buildAuction = (
	overrides: {
		title?: string
		endAt?: number
		p2pkXpub?: string
		mints?: string[]
		rootEventId?: string
		sellerPubkey?: string
		dTag?: string
		coordinate?: string
	} = {},
): ParsedAuctionEvent => {
	const rawEvent = buildAuctionRawEvent(overrides)
	const sellerPubkey = overrides.sellerPubkey ?? SELLER_PK
	const dTag = overrides.dTag ?? 'auction-test'
	return {
		rawEvent,
		dTag,
		sellerPubkey,
		coordinate: overrides.coordinate ?? `30408:${sellerPubkey}:${dTag}`,
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

const buildBid = (overrides: { id?: string; mint?: string } = {}): ParsedBidEvent => ({
	rawEvent: {
		id: overrides.id ?? '2'.repeat(64),
		kind: 1023,
		pubkey: BIDDER_PK,
		created_at: 1_500,
		content: '',
		tags: [],
	} as unknown as NDKEvent,
	id: overrides.id ?? '2'.repeat(64),
	bidderPubkey: BIDDER_PK,
	createdAt: 1_500,
	auctionRootEventId: '1'.repeat(64),
	auctionCoordinate: `30408:${SELLER_PK}:auction-test`,
	sellerPubkey: SELLER_PK,
	amount: 1_200,
	currency: 'SAT',
	mint: overrides.mint ?? 'https://mint.test',
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

	test('upsertAuction rejects cross-author update even when root id matches', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const inserted = upsertAuction(state, buildAuction())
		expect(inserted.status).toBe('inserted')

		const crossAuthor = upsertAuction(
			state,
			buildAuction({
				rootEventId: inserted.auctionState.rootAuction.rootEventId,
				sellerPubkey: 'f'.repeat(64),
				title: 'Spoofed update',
			}),
		)

		expect(crossAuthor.status).toBe('rejected_immutable')
		expect(crossAuthor.auctionState.auction.title).toBe('Original title')
	})

	test('upsertAuction rejects coordinate mismatch for pinned root identity', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const inserted = upsertAuction(state, buildAuction())
		expect(inserted.status).toBe('inserted')

		const coordinateMismatch = upsertAuction(
			state,
			buildAuction({
				rootEventId: inserted.auctionState.rootAuction.rootEventId,
				coordinate: `30408:${SELLER_PK}:spoofed-dtag`,
				title: 'Wrong coordinate update',
			}),
		)

		expect(coordinateMismatch.status).toBe('rejected_immutable')
		expect(coordinateMismatch.auctionState.auction.title).toBe('Original title')
	})

	test('upsertAuction resolves a same-coordinate/new-event-id addressable replacement to the pinned auction', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const inserted = upsertAuction(state, buildAuction())
		const pinnedRootId = inserted.auctionState.rootAuction.rootEventId
		expect(inserted.status).toBe('inserted')

		// A normal addressable replacement: a brand-new event id and no
		// `auction_root_event_id` tag (so parsed `rootEventId` is its own
		// new id), same seller + d + coordinate, mutable title change.
		const replacement = upsertAuction(
			state,
			buildAuction({ rootEventId: '9'.repeat(64), title: 'Updated title' }),
		)

		// Not inserted as a second auction — resolved to the existing one.
		expect(replacement.status).toBe('updated')
		expect(state.auctions.size).toBe(1)
		expect(state.auctionsByCoordinate.size).toBe(1)
		// The pinned root event id is retained; only the mutable event refreshed.
		expect(replacement.auctionState.rootAuction.rootEventId).toBe(pinnedRootId)
		expect(replacement.auctionState.auction.rootEventId).toBe('9'.repeat(64))
		expect(replacement.auctionState.auction.title).toBe('Updated title')
		// Coordinate index still points at the original pinned root.
		expect(state.auctionsByCoordinate.get(`30408:${SELLER_PK}:auction-test`)).toBe(pinnedRootId)
	})

	test('upsertAuction pins the first event of a coordinate lineage and preserves accumulated bids', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const inserted = upsertAuction(state, buildAuction())
		const pinnedRootId = inserted.auctionState.rootAuction.rootEventId
		upsertBid(state, buildBid({ id: '2'.repeat(64) }), 1_505)
		expect(inserted.auctionState.bids.size).toBe(1)

		const replacement = upsertAuction(
			state,
			buildAuction({ rootEventId: '8'.repeat(64), title: 'Updated title' }),
		)
		expect(replacement.status).toBe('updated')
		// Accumulated bid state is preserved across the addressable update.
		expect(replacement.auctionState.bids.size).toBe(1)
		expect(replacement.auctionState.rootAuction.rootEventId).toBe(pinnedRootId)
	})

	test('upsertAuction rejects a different-signer addressable replacement on the same coordinate', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const inserted = upsertAuction(state, buildAuction())
		const pinnedRootId = inserted.auctionState.rootAuction.rootEventId

		// A different valid signer cannot replace the pinned auction even
		// though the d tag matches: the coordinate includes the seller, so
		// this resolves to a *different* coordinate and is inserted as a
		// separate lineage (it must not overwrite the pinned auction).
		const otherSeller = '7'.repeat(64)
		const otherLineage = upsertAuction(
			state,
			buildAuction({ rootEventId: '6'.repeat(64), sellerPubkey: otherSeller, title: 'Imposter' }),
		)

		expect(otherLineage.status).toBe('inserted')
		expect(state.auctions.size).toBe(2)
		// The original pinned auction is untouched.
		expect(state.auctions.get(pinnedRootId)?.auction.title).toBe('Original title')
	})

	test('collectLiveBids scopes liveness to each bid mint reachability', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction({ mints: ['https://mint-a.test', 'https://mint-b.test'] })).auctionState
		const reachableBid = buildBid({ id: '2'.repeat(64), mint: 'https://mint-a.test' })
		const unreachableBid = buildBid({ id: '3'.repeat(64), mint: 'https://mint-b.test' })

		upsertBid(state, reachableBid, 1_505)
		upsertBid(state, unreachableBid, 1_506)
		expect(collectLiveBids(state, 1_600)).toEqual([])

		setAuctionMintReachability(auctionState, [
			['https://mint-a.test', true],
			['https://mint-b.test', false],
		])

		const live = collectLiveBids(state, 1_600)
		expect(live).toHaveLength(1)
		expect(live[0]?.bidState.bid.id).toBe(reachableBid.id)
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

	test('checkProofStateBatch marks omitted Ys as missing when the mint response succeeds', async () => {
		const mint = {
			check: async () => ({ states: [{ Y: PROOF_Y, state: 'UNSPENT' }] }),
		}

		const states = await checkProofStateBatch('https://mint.test', [PROOF_Y, COMPRESSED_PK], { mintClient: mint as any })
		expect(states.get(PROOF_Y.toLowerCase())).toBe('unspent')
		expect(states.get(COMPRESSED_PK.toLowerCase())).toBe('missing')
	})

	test('checkProofState returns missing for a successful response that omits the requested Y', async () => {
		const mint = {
			check: async () => ({ states: [] }),
		}

		await expect(checkProofState('https://mint.test', PROOF_Y, { mintClient: mint as any })).resolves.toBe('missing')
	})
})

const buildPathRelease = (bid: ParsedBidEvent, overrides: Partial<ParsedPathReleaseEvent> = {}): ParsedPathReleaseEvent => ({
	rawEvent: {
		id: overrides.id ?? '5'.repeat(64),
		kind: 1025,
		pubkey: overrides.bidderPubkey ?? bid.bidderPubkey,
		created_at: 2_200,
		content: '',
		tags: [],
	} as unknown as NDKEvent,
	id: overrides.id ?? '5'.repeat(64),
	bidderPubkey: overrides.bidderPubkey ?? bid.bidderPubkey,
	createdAt: 2_200,
	bidEventId: overrides.bidEventId ?? bid.id,
	auctionCoordinate: overrides.auctionCoordinate ?? bid.auctionCoordinate,
	sellerPubkey: overrides.sellerPubkey ?? bid.sellerPubkey,
	derivationPath: overrides.derivationPath ?? 'm/0/0/0/0/0',
	childPubkey: overrides.childPubkey ?? bid.childPubkey,
	releaseReason: overrides.releaseReason ?? 'settlement',
	auditorRefs: [],
	fallbackOfferId: undefined,
	cashuToken: undefined,
	content: '',
})

const buildSettlement = (
	auction: ParsedAuctionEvent,
	overrides: Partial<ParsedSettlementEvent> = {},
): ParsedSettlementEvent => ({
	rawEvent: {
		id: overrides.id ?? '6'.repeat(64),
		kind: 1024,
		pubkey: overrides.sellerPubkey ?? auction.sellerPubkey,
		created_at: 2_200,
		content: '',
		tags: [],
	} as unknown as NDKEvent,
	id: overrides.id ?? '6'.repeat(64),
	sellerPubkey: overrides.sellerPubkey ?? auction.sellerPubkey,
	createdAt: 2_200,
	auctionRootEventId: overrides.auctionRootEventId ?? auction.rootEventId,
	auctionCoordinate: overrides.auctionCoordinate ?? auction.coordinate,
	status: overrides.status ?? 'settled',
	closeAt: overrides.closeAt ?? auction.maxEndAt + 120,
	winningBidId: overrides.winningBidId,
	winnerPubkey: overrides.winnerPubkey,
	finalAmount: overrides.finalAmount ?? 1_200,
	pathReleaseEventId: overrides.pathReleaseEventId,
	payouts: overrides.payouts ?? [],
	fallbackChain: overrides.fallbackChain ?? [],
	reason: overrides.reason,
})

describe('auction validator record authorization', () => {
	test('recordPathRelease authorizes the signer against the bid and re-authorizes on replay', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		upsertAuction(state, auction)
		const bid = buildBid({ id: '2'.repeat(64) })

		// Before the bid is known → ordering gap, buffer (unknown_bid).
		const release = buildPathRelease(bid)
		expect(recordPathRelease(state, release, 2_200)).toEqual({ status: 'unknown_bid' })

		// Bid lands.
		upsertBid(state, bid, 1_505)

		// Replayed release from the bidder → recorded.
		const bidderRelease = buildPathRelease(bid, { id: '5'.repeat(64) })
		expect(recordPathRelease(state, bidderRelease, 2_200).status).toBe('recorded')

		// A correctly-signed release from a different author → wrong_author,
		// dropped without overwriting the honest bidder's release.
		const wrongAuthor = buildPathRelease(bid, { id: '7'.repeat(64), bidderPubkey: 'z'.repeat(64) })
		const result = recordPathRelease(state, wrongAuthor, 2_201)
		expect(result.status).toBe('wrong_author')
		const auctionState = state.auctions.get(auction.rootEventId)!
		expect(auctionState.pathReleases.get(bid.id)?.id).toBe('5'.repeat(64))
	})

	test('recordSettlement authorizes the signer against the pinned auction seller', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		upsertAuction(state, auction)

		// Unknown auction → ordering gap, buffer.
		const orphan = buildSettlement(auction, { auctionRootEventId: '9'.repeat(64) })
		expect(recordSettlement(state, orphan)).toEqual({ status: 'unknown_auction' })

		// Correct seller → recorded.
		const sellerSettlement = buildSettlement(auction, { id: '6'.repeat(64) })
		expect(recordSettlement(state, sellerSettlement).status).toBe('recorded')

		// Non-seller → wrong_seller, dropped without overwriting the slot.
		const imposter = buildSettlement(auction, { id: '8'.repeat(64), sellerPubkey: 'z'.repeat(64) })
		expect(recordSettlement(state, imposter).status).toBe('wrong_seller')
		const auctionState = state.auctions.get(auction.rootEventId)!
		expect(auctionState.settlement?.id).toBe('6'.repeat(64))
	})
})

describe('auction validator release observed-time binding', () => {
	test('recordPathRelease binds observed time to each release event id (no cross-event inheritance)', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auction = buildAuction()
		upsertAuction(state, auction)
		const bid = buildBid({ id: '2'.repeat(64) })
		upsertBid(state, bid, 1_505)

		const releaseA = buildPathRelease(bid, { id: 'a'.repeat(64) })
		const releaseB = buildPathRelease(bid, { id: 'b'.repeat(64) })

		// Early release A observed at T0=100, then a distinct late release B
		// observed at T1=200 (both authorized by the same bidder). The
		// selected slot is the last arrival (B); B must use its OWN
		// observed time, not A's earlier timestamp.
		expect(recordPathRelease(state, releaseA, 100).status).toBe('recorded')
		expect(recordPathRelease(state, releaseB, 200).status).toBe('recorded')

		const auctionState = state.auctions.get(auction.rootEventId)!
		expect(auctionState.pathReleases.get(bid.id)?.id).toBe('b'.repeat(64))
		expect(auctionState.pathReleaseObservedAt.get('a'.repeat(64))).toBe(100)
		expect(auctionState.pathReleaseObservedAt.get('b'.repeat(64))).toBe(200)

		// Duplicate delivery of B at a later time preserves B's first
		// observation (200), so re-derivation stays deterministic.
		expect(recordPathRelease(state, releaseB, 300).status).toBe('recorded')
		expect(auctionState.pathReleaseObservedAt.get('b'.repeat(64))).toBe(200)
	})
})

describe('aggregateProofStates — all-spent semantics', () => {
	const snap = (state: import("../auction/constants").Nut7ProofState) => ({ state, observedAt: 1 })
	const mk = (entries: Array<[string, import("../auction/constants").Nut7ProofState]>) => {
		const m = new Map<string, { state: import("../auction/constants").Nut7ProofState; observedAt: number }>()
		for (const [y, s] of entries) m.set(y, snap(s))
		return m
	}

	test('spent only when every expected proof is present and spent', () => {
		const ys = ['aa', 'bb', 'cc']
		expect(aggregateProofStates(mk([['aa', 'spent'], ['bb', 'spent'], ['cc', 'spent']]), ys)).toBe('spent')
	})

	test('mixed spent + unspent is not spent', () => {
		const ys = ['aa', 'bb']
		expect(aggregateProofStates(mk([['aa', 'spent'], ['bb', 'unspent']]), ys)).not.toBe('spent')
		expect(aggregateProofStates(mk([['aa', 'spent'], ['bb', 'unspent']]), ys)).toBe('unknown')
	})

	test('spent + missing is not spent', () => {
		const ys = ['aa', 'bb']
		expect(aggregateProofStates(mk([['aa', 'spent'], ['bb', 'missing']]), ys)).toBe('missing')
	})

	test('spent + pending is not spent', () => {
		const ys = ['aa', 'bb']
		expect(aggregateProofStates(mk([['aa', 'spent'], ['bb', 'pending']]), ys)).toBe('pending')
	})

	test('spent + unknown is not spent', () => {
		const ys = ['aa', 'bb']
		expect(aggregateProofStates(mk([['aa', 'spent']]), ys)).toBe('unknown')
	})

	test('all unspent → unspent', () => {
		const ys = ['aa', 'bb']
		expect(aggregateProofStates(mk([['aa', 'unspent'], ['bb', 'unspent']]), ys)).toBe('unspent')
	})
})

describe('auction validator per-mint availability scoping', () => {
	test('an unavailable selected mint leaves that bid pending without blocking bids on healthy mints', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction({ mints: ['https://mint-a.test', 'https://mint-b.test'] })).auctionState
		const bidOnA = buildBid({ id: '2'.repeat(64), mint: 'https://mint-a.test' })
		const bidOnB = buildBid({ id: '3'.repeat(64), mint: 'https://mint-b.test' })
		upsertBid(state, bidOnA, 1_505)
		upsertBid(state, bidOnB, 1_506)

		// mint-b is healthy, mint-a is down. The auction stays active
		// (any reachable mint) — one unavailable mint does not gate it.
		setAuctionMintReachability(auctionState, [
			['https://mint-a.test', false],
			['https://mint-b.test', true],
		])
		expect(auctionState.contextStatus).toBe('active')

		const live = collectLiveBids(state, 1_600)
		// The bid on the healthy mint is polled; the bid on the down mint
		// is left pending (not collected, not hard-failed) and does not
		// block the healthy bid.
		expect(live).toHaveLength(1)
		expect(live[0]?.bidState.bid.id).toBe(bidOnB.id)
		const stuckBid = auctionState.bids.get(bidOnA.id)!
		expect(stuckBid.currentClaim).toBeNull()
	})

	test('an auction with no reachable mints is pending, not blocking, and polls nothing', () => {
		const state = createValidatorState(VALIDATOR_PK)
		const auctionState = upsertAuction(state, buildAuction({ mints: ['https://mint-a.test'] })).auctionState
		upsertBid(state, buildBid({ id: '2'.repeat(64) }), 1_505)
		setAuctionMintReachability(auctionState, [['https://mint-a.test', false]])
		expect(auctionState.contextStatus).toBe('pending_mint_check')
		expect(collectLiveBids(state, 1_600)).toEqual([])
	})
})
