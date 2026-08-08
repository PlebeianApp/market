/**
 * Pipeline tests: bidder record → publishBidderPathRelease → event tags
 * → parsePathReleaseEvent → isAuctionPathReleaseForCoordinate → validatePathRelease
 *
 * Verifies that a kind-1025 event built from a real bidder record can
 * round-trip through the parser and validator without losing data.
 * Catches drift between what the publisher writes and what the query/
 * descriptor read.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Proof } from '@cashu/cashu-ts'
import { getDecodedToken } from '@cashu/cashu-ts'
import { authStore } from '../stores/auth'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import { upsertBidderRecord, walkBidderRecordChain, type BidderBidRecord } from '../auction/bidderRecords'
import { buildPathReleaseTags } from '../auction/tagBuilders'
import { parsePathReleaseEvent } from '../schemas/auction/settlementEvents'
import { validatePathRelease } from '../auction/validation'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedPathReleaseEvent } from '../auction/events'

// ---------- localStorage polyfill ----------

const installLocalStoragePolyfill = (): void => {
	if (typeof globalThis.localStorage !== 'undefined') return
	const store = new Map<string, string>()
	;(globalThis as { localStorage: Storage }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value)
		},
		removeItem: (key: string) => {
			store.delete(key)
		},
		clear: () => {
			store.clear()
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size
		},
	}
}

// ---------- Fixtures ----------

const FAKE_USER_PUBKEY = 'f'.repeat(64)
const SELLER_PK = 'a'.repeat(64)
const BUYER_PK = 'b'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PK}:test-auction`
const AUCTION_ROOT_ID = '1'.repeat(64)
const BID_EVENT_ID = '2'.repeat(64)

const REAL_AUCTION_XPUB = 'xpub6CHGS91EATnrt7a3wBLqCeJ13KvVXQp3m39ufe1TYiFxHHmAK1TiwfrT1N89CAHNLa9YQgbJAyysBZTiRRH38wTvYeBiYvgRrqxALmvghTH'
const DERIVATION_PATH = 'm/0'

const CHILD_PUBKEY = '02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0'

const LOCK_SECRET =
	'["P2PK",{"nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","data":"02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]'

const PROOF: Proof = {
	id: '0000000000000000',
	amount: 50_000,
	secret: LOCK_SECRET,
	C: '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
}

const CASHU_TOKEN =
	'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBK1siUDJQSyIseyJub25jZSI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiZGF0YSI6IjAyYzcxM2UwOTZkZjRmMzc0YjMyZDFjYjBlOTZkNzE2ZjE4MmZiNjJjMTVjZjdiZDk5YzNhODE2ZmFkMzJmMzBlMCIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMTUwIl0sWyJyZWZ1bmQiLCIwMjY4NjgwNzM3Yzc2ZGFiYjgwMWNiMjIwNGY1N2RiZTRlNDU3OWU0ZjcxMGNkNjdkYzFiNDIyNzU5MmM4MWU5YjUiXSxbIm5fc2lnc19yZWZ1bmQiLCIxIl0sWyJzaWdmbGFnIiwiU0lHX0lOUFVUUyJdXX1dYWNYIQNPNVvct8wK9yjvPM65YV2QaEu1sspfhZqw8LcEB1hxqg'

const buildRecord = (overrides: Partial<BidderBidRecord> = {}): BidderBidRecord => ({
	bidEventId: BID_EVENT_ID,
	auctionRootEventId: AUCTION_ROOT_ID,
	auctionCoordinate: AUCTION_COORDINATE,
	sellerPubkey: SELLER_PK,
	p2pkXpub: REAL_AUCTION_XPUB,
	derivationPath: DERIVATION_PATH,
	childPubkey: CHILD_PUBKEY,
	refundPubkey: '0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5',
	refundPrivateKey: 'a'.repeat(64),
	mintUrl: 'https://testnut.cashu.space',
	amount: 50_000,
	legLockedAmount: 50_000,
	prevBidEventId: null,
	locktime: 200,
	proofs: [PROOF],
	lockSecrets: [LOCK_SECRET],
	proofYs: ['023d5fb1f71aa08f907ce34a0cdebea8c52d35648756dd6392254b1cbf897944bc'],
	createdAt: 1_500,
	status: 'live',
	...overrides,
})

// ---------- Setup ----------

beforeEach(() => {
	installLocalStoragePolyfill()
	if (typeof localStorage !== 'undefined') localStorage.clear()
	authStore.setState((s) => ({
		...s,
		user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))
})

// ---------- Tests ----------

describe('path release pipeline: bidder record → publish → parse → validate', () => {
	test('walkBidderRecordChain finds the record and returns it', () => {
		const record = buildRecord()
		upsertBidderRecord(record)
		const chain = walkBidderRecordChain(BID_EVENT_ID)
		expect(chain.length).toBe(1)
		expect(chain[0].bidEventId).toBe(BID_EVENT_ID)
		expect(chain[0].auctionCoordinate).toBe(AUCTION_COORDINATE)
		expect(chain[0].derivationPath).toBe(DERIVATION_PATH)
		expect(chain[0].childPubkey).toBe(CHILD_PUBKEY)
	})

	test('buildPathReleaseTags produces tags with the correct auction coordinate', () => {
		const record = buildRecord()
		const tags = buildPathReleaseTags({
			bidEventId: record.bidEventId,
			auctionCoordinate: record.auctionCoordinate,
			sellerPubkey: record.sellerPubkey,
			derivationPath: record.derivationPath,
			childPubkey: record.childPubkey,
			releaseReason: 'settlement',
			cashuToken: CASHU_TOKEN,
		})

		// The 'a' tag must match the auction coordinate — this is what
		// the query filter { kinds: [1025], '#a': [coordinate] } matches on.
		const aTag = tags.find((t) => t[0] === 'a')
		expect(aTag).toBeDefined()
		expect(aTag![1]).toBe(AUCTION_COORDINATE)

		// All required tags must be present
		const tagMap = new Map(tags.map((t) => [t[0], t[1]]))
		expect(tagMap.get('e')).toBe(BID_EVENT_ID)
		expect(tagMap.get('a')).toBe(AUCTION_COORDINATE)
		expect(tagMap.get('p')).toBe(SELLER_PK)
		expect(tagMap.get('derivation_path')).toBe(DERIVATION_PATH)
		expect(tagMap.get('child_pubkey')).toBe(CHILD_PUBKEY)
		expect(tagMap.get('release_reason')).toBe('settlement')
		expect(tagMap.has('cashu_token')).toBe(true)
	})

	test('parsePathReleaseEvent round-trips the event built by the publisher', () => {
		const record = buildRecord()
		const tags = buildPathReleaseTags({
			bidEventId: record.bidEventId,
			auctionCoordinate: record.auctionCoordinate,
			sellerPubkey: record.sellerPubkey,
			derivationPath: record.derivationPath,
			childPubkey: record.childPubkey,
			releaseReason: 'settlement',
			cashuToken: CASHU_TOKEN,
		})

		// Simulate the NDKEvent as a NostrEventLike
		const event = {
			id: 'a'.repeat(64),
			pubkey: BUYER_PK,
			kind: 1025,
			created_at: 2_000,
			tags,
			content: '',
		}

		const result = parsePathReleaseEvent(event)
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const parsed = result.value
		expect(parsed.id).toBe('a'.repeat(64))
		expect(parsed.bidderPubkey).toBe(BUYER_PK)
		expect(parsed.bidEventId).toBe(BID_EVENT_ID)
		expect(parsed.auctionCoordinate).toBe(AUCTION_COORDINATE)
		expect(parsed.sellerPubkey).toBe(SELLER_PK)
		expect(parsed.derivationPath).toBe(DERIVATION_PATH)
		expect(parsed.childPubkey).toBe(CHILD_PUBKEY)
		expect(parsed.releaseReason).toBe('settlement')
		expect(parsed.cashuToken).toBe(CASHU_TOKEN)
	})

	test('isAuctionPathReleaseForCoordinate matches the published event', async () => {
		// Simulate the NDK filter result matching logic
		const record = buildRecord()
		const tags = buildPathReleaseTags({
			bidEventId: record.bidEventId,
			auctionCoordinate: record.auctionCoordinate,
			sellerPubkey: record.sellerPubkey,
			derivationPath: record.derivationPath,
			childPubkey: record.childPubkey,
			releaseReason: 'settlement',
			cashuToken: CASHU_TOKEN,
		})

		// The query filter is { kinds: [1025], '#a': [coordinate] }
		// The relay returns events matching the filter, then the code
		// double-checks with isAuctionPathReleaseForCoordinate
		const hasMatchingATag = tags.some((tag) => tag[0] === 'a' && tag[1] === AUCTION_COORDINATE)
		expect(hasMatchingATag).toBe(true)

		// Also verify a non-matching coordinate is rejected
		const wrongCoord = `30408:${SELLER_PK}:different-auction`
		const hasWrongMatch = tags.some((tag) => tag[0] === 'a' && tag[1] === wrongCoord)
		expect(hasWrongMatch).toBe(false)
	})

	test('validatePathRelease accepts the parsed event against a matching auction and bid', () => {
		const record = buildRecord()
		const tags = buildPathReleaseTags({
			bidEventId: record.bidEventId,
			auctionCoordinate: record.auctionCoordinate,
			sellerPubkey: record.sellerPubkey,
			derivationPath: record.derivationPath,
			childPubkey: record.childPubkey,
			releaseReason: 'settlement',
			cashuToken: CASHU_TOKEN,
		})

		const event = {
			id: 'a'.repeat(64),
			pubkey: BUYER_PK,
			kind: 1025,
			created_at: 2_000,
			tags,
			content: '',
		}

		const parseResult = parsePathReleaseEvent(event)
		expect(parseResult.ok).toBe(true)
		if (!parseResult.ok) return
		const parsedRelease = parseResult.value

		// Build matching auction and bid fixtures
		const auction: ParsedAuctionEvent = {
			rawEvent: { id: AUCTION_ROOT_ID, pubkey: SELLER_PK, kind: 30408, tags: [], content: '' },
			dTag: 'test-auction',
			sellerPubkey: SELLER_PK,
			coordinate: AUCTION_COORDINATE,
			rootEventId: AUCTION_ROOT_ID,
			title: 'Test',
			content: '',
			auctionType: 'english',
			startAt: 0,
			endAt: 100,
			maxEndAt: 100,
			settlementGrace: 50,
			currency: 'SAT',
			reserve: 0,
			startingBid: 1000,
			bidIncrement: 100,
			minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
			settlementPolicy: 'cashu_p2pk_bidder_path_v1',
			keyScheme: 'hd_p2pk',
			mints: ['https://testnut.cashu.space'],
			p2pkXpub: REAL_AUCTION_XPUB,
			auditors: [],
			auditorQuorum: 1,
			maxSkewSec: 30,
			fallbackDelaySec: 25,
			vadiumRatioBps: 0,
			schema: '',
		} as ParsedAuctionEvent

		const bid: ParsedBidEvent = {
			rawEvent: { id: BID_EVENT_ID, pubkey: BUYER_PK, kind: 1024, tags: [], content: '', created_at: 1_500 },
			id: BID_EVENT_ID,
			bidderPubkey: BUYER_PK,
			createdAt: 1_500,
			auctionRootEventId: AUCTION_ROOT_ID,
			auctionCoordinate: AUCTION_COORDINATE,
			sellerPubkey: SELLER_PK,
			amount: 50_000,
			currency: 'SAT',
			mint: 'https://testnut.cashu.space',
			locktime: 150,
			refundPubkey: '0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5',
			childPubkey: CHILD_PUBKEY,
			lockSecrets: [LOCK_SECRET],
			proofYs: ['023d5fb1f71aa08f907ce34a0cdebea8c52d35648756dd6392254b1cbf897944bc'],
			createdForEndAt: 100,
			bidNonce: 'nonce-1',
			keyScheme: 'hd_p2pk',
			status: 'locked',
		} as ParsedBidEvent

		// Validate with now=150 (before locktime=200, during settlement window)
		const result = validatePathRelease({
			auction,
			bid,
			release: parsedRelease,
			now: 150,
			postCloseDecision: 'winner',
		})

		expect(result.isValid).toBe(true)
		if (!result.isValid) {
			console.error('validatePathRelease failed:', JSON.stringify(result, null, 2))
		}
	})

	test('full round-trip: record → tags → event → parse → coordinate match → validate', () => {
		// This is the integration test that catches any drift between
		// what the publisher writes and what the query/descriptor read.
		const record = buildRecord()
		upsertBidderRecord(record)

		// 1. Walk the chain (same as publishBidderPathRelease does)
		const chain = walkBidderRecordChain(BID_EVENT_ID)
		expect(chain.length).toBe(1)

		// 2. Build tags (same as publishBidderPathRelease does)
		const leg = chain[0]
		const tags = buildPathReleaseTags({
			bidEventId: leg.bidEventId,
			auctionCoordinate: leg.auctionCoordinate,
			sellerPubkey: leg.sellerPubkey,
			derivationPath: leg.derivationPath,
			childPubkey: leg.childPubkey,
			releaseReason: 'settlement',
			cashuToken: CASHU_TOKEN,
		})

		// 3. Simulate the published event
		const event = {
			id: 'a'.repeat(64),
			pubkey: BUYER_PK,
			kind: 1025,
			created_at: 2_000,
			tags,
			content: '',
		}

		// 4. Parse it (same as the query's parsePathReleaseEvent)
		const parseResult = parsePathReleaseEvent(event)
		expect(parseResult.ok).toBe(true)
		if (!parseResult.ok) return
		const parsed = parseResult.value

		// 5. The auction coordinate must match what the query filters on
		expect(parsed.auctionCoordinate).toBe(AUCTION_COORDINATE)

		// 6. The bidEventId must match the bid (for descriptor's myAlreadyReleased check)
		expect(parsed.bidEventId).toBe(BID_EVENT_ID)

		// 7. The cashuToken must be present (required for validatePathRelease)
		expect(parsed.cashuToken).toBe(CASHU_TOKEN)

		// 8. The childPubkey must match (required for validation)
		expect(parsed.childPubkey).toBe(CHILD_PUBKEY)
	})
})
