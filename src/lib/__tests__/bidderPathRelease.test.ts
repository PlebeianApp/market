/**
 * Phase 5 — Tests for the bidder-side path-release flow.
 *
 * Two layers:
 *   1. Storage CRUD: bidderRecords against a polyfilled localStorage.
 *      Catches drift in the persistence shape and the user-scoped
 *      key derivation.
 *   2. Pre-publish derivation check: the local sanity gate that
 *      refuses to publish a kind-1025 whose path doesn't derive to
 *      the bid's child_pubkey. Exercises the path via a real xpub +
 *      `deriveAuctionChildP2pkPubkeyFromXpub` round-trip.
 *
 * We don't test the full publish action (it requires NDK + signer +
 * relay round-trip). The publisher just hands its output to NDK; the
 * pre-publish logic is what's interesting.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Proof } from '@cashu/cashu-ts'
import { authStore } from '../stores/auth'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'
import {
	findBidderRecord,
	findBidderRecordsForAuction,
	loadBidderRecords,
	updateBidderRecordStatus,
	upsertBidderRecord,
	removeBidderRecord,
	type BidderBidRecord,
} from '../auction/bidderRecords'

// =============================================================================
// localStorage polyfill — Bun's test runtime doesn't provide one.
// =============================================================================

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

const resetLocalStorage = (): void => {
	if (typeof localStorage !== 'undefined') localStorage.clear()
}

// =============================================================================
// authStore stub — the storage helpers scope keys by the auth user's pubkey
// =============================================================================

const FAKE_USER_PUBKEY = 'f'.repeat(64)

const setAuthUser = (): void => {
	// authStore is a TanStack Store; setState merges by default.
	authStore.setState((s) => ({
		...s,
		user: {
			pubkey: FAKE_USER_PUBKEY,
		} as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))
}

const clearAuthUser = (): void => {
	authStore.setState((s) => ({ ...s, user: null, isAuthenticated: false }))
}

// =============================================================================
// Fixtures
// =============================================================================

// A real xpub the project's auctionP2pk module is happy to derive from.
const REAL_AUCTION_XPUB = 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'

const SELLER_PK = 'a'.repeat(64)
const DEFAULT_REFUND_PK = '03' + 'e'.repeat(64)

const dummyProof = (amount: number, secret: string): Proof => ({
	id: '00' + '1'.repeat(14),
	amount,
	secret,
	C: '02' + '7'.repeat(64),
})

const buildRecord = (overrides: Partial<BidderBidRecord> = {}): BidderBidRecord => {
	const path = overrides.derivationPath ?? 'm/1/2/3/4/5'
	const childPubkey = overrides.childPubkey ?? deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
	return {
		bidEventId: '2'.repeat(64),
		auctionRootEventId: '1'.repeat(64),
		auctionCoordinate: `30408:${SELLER_PK}:auction-1`,
		sellerPubkey: SELLER_PK,
		p2pkXpub: REAL_AUCTION_XPUB,
		derivationPath: path,
		childPubkey,
		refundPubkey: DEFAULT_REFUND_PK,
		refundPrivateKey: 'a'.repeat(64),
		mintUrl: 'https://mint.test',
		amount: 1_000,
		legLockedAmount: 1_000,
		prevBidEventId: null,
		locktime: 5_700,
		proofs: [dummyProof(1_000, '["P2PK",{"nonce":"n","data":"' + childPubkey + '","tags":[]}]')],
		lockSecrets: ['["P2PK",{"nonce":"n","data":"' + childPubkey + '","tags":[]}]'],
		proofYs: ['02' + '3'.repeat(64)],
		createdAt: 1_500,
		status: 'live',
		...overrides,
	}
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
	installLocalStoragePolyfill()
	resetLocalStorage()
	setAuthUser()
})

// =============================================================================
// Storage CRUD
// =============================================================================

describe('bidderRecords storage', () => {
	test('upsert + load roundtrip', () => {
		const record = buildRecord()
		upsertBidderRecord(record)
		const loaded = loadBidderRecords()
		expect(loaded).toHaveLength(1)
		expect(loaded[0].bidEventId).toBe(record.bidEventId)
		expect(loaded[0].childPubkey).toBe(record.childPubkey)
		expect(loaded[0].lockSecrets).toEqual(record.lockSecrets)
	})

	test('findBidderRecord returns the matching record', () => {
		const record = buildRecord({ bidEventId: 'a'.repeat(64) })
		const other = buildRecord({ bidEventId: 'b'.repeat(64) })
		upsertBidderRecord(record)
		upsertBidderRecord(other)
		expect(findBidderRecord('a'.repeat(64))?.bidEventId).toBe('a'.repeat(64))
		expect(findBidderRecord('z'.repeat(64))).toBeUndefined()
	})

	test('upsert overwrites by bidEventId', () => {
		const v1 = buildRecord({ amount: 1_000 })
		upsertBidderRecord(v1)
		const v2 = { ...v1, amount: 2_500 }
		upsertBidderRecord(v2)
		expect(loadBidderRecords()).toHaveLength(1)
		expect(findBidderRecord(v1.bidEventId)?.amount).toBe(2_500)
	})

	test('updateBidderRecordStatus flips status', () => {
		const record = buildRecord()
		upsertBidderRecord(record)
		const updated = updateBidderRecordStatus(record.bidEventId, 'settled')
		expect(updated?.status).toBe('settled')
		expect(findBidderRecord(record.bidEventId)?.status).toBe('settled')
	})

	test('updateBidderRecordStatus returns null when record missing', () => {
		const updated = updateBidderRecordStatus('z'.repeat(64), 'settled')
		expect(updated).toBeNull()
	})

	test('findBidderRecordsForAuction returns all records for an auction', () => {
		const a = buildRecord({ bidEventId: 'a'.repeat(64), auctionRootEventId: '1'.repeat(64) })
		const b = buildRecord({ bidEventId: 'b'.repeat(64), auctionRootEventId: '1'.repeat(64) })
		const c = buildRecord({ bidEventId: 'c'.repeat(64), auctionRootEventId: '2'.repeat(64) })
		upsertBidderRecord(a)
		upsertBidderRecord(b)
		upsertBidderRecord(c)
		const matches = findBidderRecordsForAuction('1'.repeat(64))
		expect(matches.map((r) => r.bidEventId).sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)])
	})

	test('removeBidderRecord deletes by bidEventId', () => {
		const a = buildRecord({ bidEventId: 'a'.repeat(64) })
		const b = buildRecord({ bidEventId: 'b'.repeat(64) })
		upsertBidderRecord(a)
		upsertBidderRecord(b)
		removeBidderRecord('a'.repeat(64))
		expect(loadBidderRecords()).toHaveLength(1)
		expect(findBidderRecord('a'.repeat(64))).toBeUndefined()
		expect(findBidderRecord('b'.repeat(64))).toBeDefined()
	})

	test('no records when no user is signed in', () => {
		clearAuthUser()
		const record = buildRecord()
		upsertBidderRecord(record) // no-op without a user
		expect(loadBidderRecords()).toEqual([])
		// Restore for subsequent tests.
		setAuthUser()
	})

	test('records are scoped per-user — different user sees nothing', () => {
		upsertBidderRecord(buildRecord())
		expect(loadBidderRecords()).toHaveLength(1)

		// Switch users.
		authStore.setState((s) => ({
			...s,
			user: { pubkey: 'e'.repeat(64) } as unknown as NonNullable<typeof s.user>,
			isAuthenticated: true,
		}))
		expect(loadBidderRecords()).toEqual([])

		// Switch back.
		setAuthUser()
		expect(loadBidderRecords()).toHaveLength(1)
	})
})

// =============================================================================
// Pre-publish derivation check
// =============================================================================

describe('publishBidderPathRelease — pre-publish derivation check', () => {
	test('honest record: derive(p2pk_xpub, path) matches stored child_pubkey', () => {
		const path = 'm/9/8/7/6/5'
		const child = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		const record = buildRecord({ derivationPath: path, childPubkey: child })
		// What the publish function does internally:
		const recomputed = deriveAuctionChildP2pkPubkeyFromXpub(record.p2pkXpub, record.derivationPath)
		expect(recomputed.toLowerCase()).toBe(record.childPubkey.toLowerCase())
	})

	test('corrupted record: derivation does not match → refuse to publish', () => {
		const path = 'm/9/8/7/6/5'
		const realChild = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		// Tamper: store a different child_pubkey than what the path
		// actually produces.
		const wrongChild = '02' + 'b'.repeat(64)
		const record = buildRecord({ derivationPath: path, childPubkey: wrongChild })
		const recomputed = deriveAuctionChildP2pkPubkeyFromXpub(record.p2pkXpub, record.derivationPath)
		expect(recomputed.toLowerCase()).not.toBe(record.childPubkey.toLowerCase())
		expect(recomputed.toLowerCase()).toBe(realChild.toLowerCase())
	})

	test('path-derivation is deterministic across calls', () => {
		const path = 'm/12/34/56/78/90'
		const a = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		const b = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, path)
		expect(a).toBe(b)
	})

	test('different paths under the same xpub yield different children', () => {
		const a = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, 'm/1/2/3')
		const b = deriveAuctionChildP2pkPubkeyFromXpub(REAL_AUCTION_XPUB, 'm/1/2/4')
		expect(a).not.toBe(b)
	})
})
