/**
 * Phase 8 — chain-bid record helpers.
 *
 * `findLatestBidderRecordForAuction` + `walkBidderRecordChain` are the
 * substrate `publishAuctionBid` uses to detect a rebid, decide the
 * delta, and chain via `prev_bid`. `publishBidderPathRelease` uses
 * `walkBidderRecordChain` to publish a kind-1025 per leg.
 *
 * Both helpers read user-scoped localStorage; we polyfill it here as
 * in `bidderPathRelease.test.ts`.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { authStore } from '../stores/auth'
import {
	findLatestBidderRecordForAuction,
	loadBidderRecords,
	upsertBidderRecord,
	walkBidderRecordChain,
	type BidderBidRecord,
} from '../auction/bidderRecords'

// ---------- polyfill ----------

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
		clear: () => store.clear(),
		key: (i: number) => Array.from(store.keys())[i] ?? null,
		get length() {
			return store.size
		},
	}
}
const resetLocalStorage = (): void => {
	if (typeof localStorage !== 'undefined') localStorage.clear()
}

const FAKE_USER_PUBKEY = 'f'.repeat(64)
const setAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))

// ---------- fixtures ----------

const AUCTION_A = '1'.repeat(64)
const AUCTION_B = '2'.repeat(64)
const SELLER = 'a'.repeat(64)

const baseRecord = (overrides: Partial<BidderBidRecord>): BidderBidRecord => ({
	bidEventId: overrides.bidEventId ?? '00' + '0'.repeat(62),
	auctionRootEventId: overrides.auctionRootEventId ?? AUCTION_A,
	auctionCoordinate: `30408:${SELLER}:auction-1`,
	sellerPubkey: SELLER,
	p2pkXpub: 'xpub-test',
	derivationPath: 'm/1/2/3/4/5',
	childPubkey: '02' + '7'.repeat(64),
	refundPubkey: '03' + 'e'.repeat(64),
	refundPrivateKey: 'a'.repeat(64),
	mintUrl: 'https://mint.test',
	amount: overrides.amount ?? 1_000,
	legLockedAmount: overrides.legLockedAmount ?? overrides.amount ?? 1_000,
	prevBidEventId: overrides.prevBidEventId ?? null,
	locktime: 5_700,
	proofs: [],
	lockSecrets: [],
	proofYs: [],
	createdAt: 1_500,
	status: 'live',
	...overrides,
})

beforeEach(() => {
	installLocalStoragePolyfill()
	resetLocalStorage()
	setAuthUser()
})

// ---------- findLatestBidderRecordForAuction ----------

describe('findLatestBidderRecordForAuction', () => {
	test('returns null when no records exist for the auction', () => {
		expect(findLatestBidderRecordForAuction(AUCTION_A)).toBeNull()
	})

	test('returns the only record when there is one', () => {
		const r = baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000 })
		upsertBidderRecord(r)
		expect(findLatestBidderRecordForAuction(AUCTION_A)?.bidEventId).toBe('a'.repeat(64))
	})

	test('returns the highest-amount record when there are multiple legs', () => {
		upsertBidderRecord(baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000 }))
		upsertBidderRecord(baseRecord({ bidEventId: 'b'.repeat(64), amount: 12_500, prevBidEventId: 'a'.repeat(64), legLockedAmount: 2_500 }))
		upsertBidderRecord(baseRecord({ bidEventId: 'c'.repeat(64), amount: 11_000, prevBidEventId: 'a'.repeat(64), legLockedAmount: 1_000 }))
		expect(findLatestBidderRecordForAuction(AUCTION_A)?.bidEventId).toBe('b'.repeat(64))
	})

	test('does not bleed across auctions', () => {
		upsertBidderRecord(baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000, auctionRootEventId: AUCTION_A }))
		upsertBidderRecord(baseRecord({ bidEventId: 'b'.repeat(64), amount: 50_000, auctionRootEventId: AUCTION_B }))
		expect(findLatestBidderRecordForAuction(AUCTION_A)?.amount).toBe(10_000)
		expect(findLatestBidderRecordForAuction(AUCTION_B)?.amount).toBe(50_000)
	})
})

// ---------- walkBidderRecordChain ----------

describe('walkBidderRecordChain', () => {
	test('single-leg chain returns one record', () => {
		const r = baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000 })
		upsertBidderRecord(r)
		const chain = walkBidderRecordChain('a'.repeat(64))
		expect(chain).toHaveLength(1)
		expect(chain[0].bidEventId).toBe('a'.repeat(64))
		expect(chain[0].prevBidEventId).toBeNull()
	})

	test('three-leg chain returns oldest → newest', () => {
		const a = baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000 })
		const b = baseRecord({ bidEventId: 'b'.repeat(64), amount: 12_500, prevBidEventId: 'a'.repeat(64), legLockedAmount: 2_500 })
		const c = baseRecord({ bidEventId: 'c'.repeat(64), amount: 15_000, prevBidEventId: 'b'.repeat(64), legLockedAmount: 2_500 })
		upsertBidderRecord(a)
		upsertBidderRecord(b)
		upsertBidderRecord(c)
		const chain = walkBidderRecordChain('c'.repeat(64))
		expect(chain.map((r) => r.bidEventId)).toEqual(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])
		// Sanity: leg amounts sum to the latest leg's cumulative amount.
		const sum = chain.reduce((acc, r) => acc + r.legLockedAmount, 0)
		expect(sum).toBe(15_000)
	})

	test('returns empty array when starting event id is unknown', () => {
		expect(walkBidderRecordChain('z'.repeat(64))).toEqual([])
	})

	test('returns partial chain when an ancestor is missing locally', () => {
		// We have leg b (prev=a) but not leg a — chain should stop at b.
		const b = baseRecord({ bidEventId: 'b'.repeat(64), amount: 12_500, prevBidEventId: 'a'.repeat(64), legLockedAmount: 2_500 })
		upsertBidderRecord(b)
		const chain = walkBidderRecordChain('b'.repeat(64))
		expect(chain).toHaveLength(1)
		expect(chain[0].bidEventId).toBe('b'.repeat(64))
	})

	test('cycle guard: prev_bid pointing back to self', () => {
		const r = baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000, prevBidEventId: 'a'.repeat(64) })
		upsertBidderRecord(r)
		const chain = walkBidderRecordChain('a'.repeat(64))
		// Should terminate (not infinite loop) with at most one entry.
		expect(chain.length).toBeLessThanOrEqual(1)
	})

	test('cycle guard: a → b → a', () => {
		const a = baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000, prevBidEventId: 'b'.repeat(64) })
		const b = baseRecord({ bidEventId: 'b'.repeat(64), amount: 9_000, prevBidEventId: 'a'.repeat(64) })
		upsertBidderRecord(a)
		upsertBidderRecord(b)
		const chain = walkBidderRecordChain('a'.repeat(64))
		// Walker must terminate; the two entries are seen exactly once each.
		expect(chain.length).toBeLessThanOrEqual(2)
	})
})

// ---------- delta-amount invariant ----------

describe('chain invariant: sum of leg locks equals latest cumulative amount', () => {
	test('honest chain', () => {
		const a = baseRecord({ bidEventId: 'a'.repeat(64), amount: 10_000, legLockedAmount: 10_000 })
		const b = baseRecord({
			bidEventId: 'b'.repeat(64),
			amount: 12_500,
			legLockedAmount: 2_500,
			prevBidEventId: 'a'.repeat(64),
		})
		upsertBidderRecord(a)
		upsertBidderRecord(b)
		const chain = walkBidderRecordChain('b'.repeat(64))
		const latest = chain[chain.length - 1].amount
		const sum = chain.reduce((acc, r) => acc + r.legLockedAmount, 0)
		expect(sum).toBe(latest)
	})

	test('records persist correctly across reads', () => {
		const a = baseRecord({ bidEventId: 'a'.repeat(64), amount: 1, legLockedAmount: 1 })
		upsertBidderRecord(a)
		expect(loadBidderRecords()).toHaveLength(1)
		expect(loadBidderRecords()[0].legLockedAmount).toBe(1)
		expect(loadBidderRecords()[0].prevBidEventId).toBeNull()
	})
})
