/**
 * #1235 follow-up 3 — STRICT fail-closed storage writes.
 *
 * `saveUserData` historically swallows every storage failure (console.error)
 * and silently skips the write when no user scope exists. That default stays
 * for every existing caller. The new `{ strict: true }` option rethrows
 * instead — reserved for writes whose silent loss is unrecoverable. The
 * first (and so far only) caller is `upsertBidderRecord`: the bidder record
 * holds the ONLY durable copy of a locked leg's refund private key + full
 * locked proofs. A silent failure there would strand the locked leg with no
 * recoverable refund key while the bid publish pipeline continued.
 *
 * User-scoped localStorage; polyfilled as in `bidderChainRecords.test.ts`.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { authStore } from '../stores/auth'
import { loadUserData, saveUserData } from '../wallet/storage'
import { loadBidderRecords, upsertBidderRecord, type BidderBidRecord } from '../auction/bidderRecords'

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
		clear: () => {
			store.clear()
		},
		key: (i: number) => Array.from(store.keys())[i] ?? null,
		get length() {
			return store.size
		},
	}
}
installLocalStoragePolyfill()

const FAKE_USER_PUBKEY = 'f'.repeat(64)
const setAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))

const clearAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: null,
		isAuthenticated: false,
	}))

// ---------- fixtures ----------

const baseRecord = (bidEventId: string): BidderBidRecord => ({
	bidEventId,
	auctionRootEventId: '1'.repeat(64),
	auctionCoordinate: `30408:${'a'.repeat(64)}:auction-1`,
	sellerPubkey: 'a'.repeat(64),
	p2pkXpub: 'xpub-test',
	derivationPath: 'm/1/2/3/4/5',
	childPubkey: '02' + '7'.repeat(64),
	refundPubkey: '03' + 'e'.repeat(64),
	refundPrivateKey: 'a'.repeat(64),
	mintUrl: 'https://mint.test',
	amount: 1_000,
	legLockedAmount: 1_000,
	prevBidEventId: null,
	locktime: 5_700,
	proofs: [],
	lockSecrets: [],
	proofYs: [],
	createdAt: 1_500,
	status: 'live',
})

// ---------- tests ----------

beforeEach(() => {
	localStorage.clear()
	setAuthUser()
})

describe('saveUserData strict option (#1235 follow-up 3)', () => {
	test('DEFAULT behavior unchanged: storage failures are swallowed, not thrown', () => {
		const originalSetItem = localStorage.setItem.bind(localStorage)
		localStorage.setItem = () => {
			throw new Error('QuotaExceededError: setItem failed')
		}
		try {
			// Must NOT throw — every other caller depends on the swallow.
			expect(() => saveUserData('some_noncritical_key_v1', { a: 1 })).not.toThrow()
		} finally {
			localStorage.setItem = originalSetItem
		}
	})

	test('DEFAULT behavior unchanged: a missing user scope silently skips the write', () => {
		clearAuthUser()
		expect(() => saveUserData('some_noncritical_key_v1', { a: 1 })).not.toThrow()
		// The write never happened — load returns the default.
		expect(loadUserData('some_noncritical_key_v1', null)).toBeNull()
	})

	test('strict: a storage failure RETHROWS (fail closed)', () => {
		const originalSetItem = localStorage.setItem.bind(localStorage)
		localStorage.setItem = () => {
			throw new Error('QuotaExceededError: setItem failed')
		}
		try {
			expect(() => saveUserData('critical_key_v1', { a: 1 }, { strict: true })).toThrow('QuotaExceededError')
		} finally {
			localStorage.setItem = originalSetItem
		}
	})

	test('strict: a missing user scope THROWS — the record would not be persisted', () => {
		clearAuthUser()
		// Silently skipping a strict write would be a silent fund-loss hazard:
		// the caller believes the recovery record is durable when it is not.
		expect(() => saveUserData('critical_key_v1', { a: 1 }, { strict: true })).toThrow('no authenticated user scope')
	})

	test('strict: a successful write behaves like the default path', () => {
		expect(() => saveUserData('critical_key_v1', { a: 1 }, { strict: true })).not.toThrow()
		expect(loadUserData('critical_key_v1', { a: 0 })).toEqual({ a: 1 })
	})
})

describe('upsertBidderRecord strict persistence (#1235 follow-up 3)', () => {
	test('the bidder-record write is STRICT: a storage failure surfaces (fail closed), never a silent skip', () => {
		const originalSetItem = localStorage.setItem.bind(localStorage)
		localStorage.setItem = (key: string, value: string) => {
			if (key.startsWith('auction_bidder_records_v1')) throw new Error('QuotaExceededError: setItem failed')
			originalSetItem(key, value)
		}
		try {
			// Pre-follow-up behavior: the write was swallowed and the caller
			// believed the refund key was durably persisted. It must throw.
			expect(() => upsertBidderRecord(baseRecord('00' + '0'.repeat(62)))).toThrow('QuotaExceededError')
		} finally {
			localStorage.setItem = originalSetItem
		}
		// And nothing was persisted.
		expect(loadBidderRecords()).toEqual([])
	})

	test('a successful upsert still persists the record durably', () => {
		upsertBidderRecord(baseRecord('11' + '1'.repeat(62)))
		const records = loadBidderRecords()
		expect(records).toHaveLength(1)
		expect(records[0].refundPrivateKey).toBe('a'.repeat(64))
		expect(records[0].status).toBe('live')
	})

	test('upsert overwrites by bidEventId without duplicating', () => {
		const bidEventId = '22' + '2'.repeat(62)
		upsertBidderRecord(baseRecord(bidEventId))
		upsertBidderRecord({ ...baseRecord(bidEventId), status: 'refunded' })
		const records = loadBidderRecords()
		expect(records).toHaveLength(1)
		expect(records[0].status).toBe('refunded')
	})
})
