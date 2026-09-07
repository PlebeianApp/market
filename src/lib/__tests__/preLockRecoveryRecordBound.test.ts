/**
 * #1235 round-3 fix 4 (felixfelix #5) — the pre-lock recovery record store
 * must FAIL CLOSED at its 25-entry bound instead of evicting.
 *
 * Each `AuctionBidPreLockRecoveryRecord` is the ONLY durable copy of its
 * leg's refund private key from before the mint lock call. The old
 * oldest-first eviction silently deleted one the moment a 26th record
 * arrived — stranding a still-pending leg with no usable refund branch
 * (not even timelock-reclaimable). At the bound:
 *   - persisting a NEW key throws BEFORE saveUserData (the publish layer
 *     maps the throw to AuctionBidPreLockRecordWriteFailedError and aborts
 *     with zero mint interaction — safe re-submit);
 *   - superseding/updating an EXISTING key still succeeds (the entry count
 *     is unchanged, and the publish flow's supersede path relies on it).
 *
 * User-scoped localStorage; polyfilled as in `bidderChainRecords.test.ts`.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { authStore } from '../stores/auth'
import { loadPreLockRecoveryRecords, persistPreLockRecoveryRecord, type AuctionBidPreLockRecoveryRecord } from '../auction/bidderRecords'

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
installLocalStoragePolyfill()

const FAKE_USER_PUBKEY = 'f'.repeat(64)
const setAuthUser = () =>
	authStore.setState((s) => ({
		...s,
		user: { pubkey: FAKE_USER_PUBKEY } as unknown as NonNullable<typeof s.user>,
		isAuthenticated: true,
	}))

// ---------- fixtures ----------

const AUCTION_EVENT_ID = '1'.repeat(64)
const SELLER_PK = 'a'.repeat(64)

/** Distinct 64-hex refund pubkeys: '03' + zero-padded index + filler. */
const refundPubkeyFor = (index: number): string => '03' + index.toString(16).padStart(2, '0') + 'e'.repeat(60)

const baseRecoveryRecord = (overrides: Partial<AuctionBidPreLockRecoveryRecord>): AuctionBidPreLockRecoveryRecord => ({
	id: overrides.id ?? `${overrides.refundPubkey}-uuid`,
	createdAt: overrides.createdAt ?? 1_000,
	auctionEventId: AUCTION_EVENT_ID,
	auctionCoordinates: `30408:${SELLER_PK}:auction-1`,
	sellerPubkey: SELLER_PK,
	p2pkXpub: 'xpub-test',
	derivationPath: 'm/1/2/3/4/5',
	childPubkey: '02' + '7'.repeat(64),
	refundPubkey: overrides.refundPubkey ?? refundPubkeyFor(0),
	refundPrivateKey: 'a'.repeat(64),
	mintUrl: 'https://mint.test',
	legLockAmount: overrides.legLockAmount ?? 1_000,
	cumulativeAmount: overrides.cumulativeAmount ?? 1_000,
	locktime: 5_700,
	prevBidEventId: null,
	...overrides,
})

/** Seed the store to the bound: `count` records, createdAt ascending. */
const seedRecoveryRecords = (count: number): AuctionBidPreLockRecoveryRecord[] => {
	const seeded: AuctionBidPreLockRecoveryRecord[] = []
	for (let index = 0; index < count; index++) {
		const record = baseRecoveryRecord({
			refundPubkey: refundPubkeyFor(index),
			createdAt: 1_000 + index,
			id: `record-${index}`,
		})
		persistPreLockRecoveryRecord(record)
		seeded.push(record)
	}
	return seeded
}

beforeEach(() => {
	localStorage.clear()
	setAuthUser()
})

// ---------- tests ----------

describe('persistPreLockRecoveryRecord fails closed at the 25-entry bound (#1235 round-3 fix 4)', () => {
	test('a NEW key past the bound throws; the 25 originals stay intact, none evicted, the 26th absent', () => {
		const seeded = seedRecoveryRecords(25)
		expect(Object.keys(loadPreLockRecoveryRecords())).toHaveLength(25)

		const twentySixth = baseRecoveryRecord({ refundPubkey: refundPubkeyFor(99), createdAt: 2_000, id: 'record-26' })

		// Fail closed BEFORE saveUserData — a clear error, never a silent eviction.
		expect(() => persistPreLockRecoveryRecord(twentySixth)).toThrow(
			'Pre-lock recovery record store is full (25 entries) — refusing to persist a NEW recovery record instead of evicting an existing one.',
		)

		// The 25 originals are INTACT — none was evicted to make room.
		const after = loadPreLockRecoveryRecords()
		expect(Object.keys(after)).toHaveLength(25)
		for (const record of seeded) {
			const stored = after[record.refundPubkey]
			expect(stored).toBeDefined()
			expect(stored.createdAt).toBe(record.createdAt)
			expect(stored.refundPrivateKey).toBe(record.refundPrivateKey)
		}
		// The 26th is absent — the refused write persisted nothing.
		expect(after[twentySixth.refundPubkey]).toBeUndefined()
	})

	test('at the bound, superseding (re-persisting) an EXISTING key still succeeds', () => {
		const seeded = seedRecoveryRecords(25)
		const supersededKey = seeded[12].refundPubkey

		// In-place update: same refund pubkey, refreshed leg metadata. The
		// entry count is unchanged, so the bound must not refuse it (the
		// publish flow's supersede path relies on exactly this).
		const superseding = baseRecoveryRecord({
			refundPubkey: supersededKey,
			createdAt: 9_000,
			id: 'record-12-refreshed',
			legLockAmount: 2_500,
			cumulativeAmount: 2_500,
		})
		expect(() => persistPreLockRecoveryRecord(superseding)).not.toThrow()

		const after = loadPreLockRecoveryRecords()
		expect(Object.keys(after)).toHaveLength(25)
		expect(after[supersededKey].id).toBe('record-12-refreshed')
		expect(after[supersededKey].createdAt).toBe(9_000)
		expect(after[supersededKey].legLockAmount).toBe(2_500)
	})

	test('below the bound, persisting a NEW key still succeeds (the gate only fires past the bound)', () => {
		const seeded = seedRecoveryRecords(24)

		const twentyFifth = baseRecoveryRecord({ refundPubkey: refundPubkeyFor(99), createdAt: 2_000, id: 'record-25' })
		expect(() => persistPreLockRecoveryRecord(twentyFifth)).not.toThrow()

		const after = loadPreLockRecoveryRecords()
		expect(Object.keys(after)).toHaveLength(25)
		expect(after[twentyFifth.refundPubkey].id).toBe('record-25')
		expect(after[seeded[0].refundPubkey].id).toBe('record-0')
	})
})
