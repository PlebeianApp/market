/**
 * Multiparty pre-lock recovery record.
 *
 * The record is the only durable copy of a multiparty leg's refund authority **and** of which rows
 * that leg has: a leg is one swap per row (D16), so the failure it must survive is "rows 0..k locked,
 * row k+1 did not". Two guarantees are tested here besides the shape itself: the confirmed write
 * (strict save + read-back equality) and fail-closed-at-the-bound (a new record throws instead of
 * evicting a pending leg's refund key).
 *
 * User-scoped localStorage; polyfilled as in `preLockRecoveryRecordBound.test.ts`.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import { authStore } from '../stores/auth'
import {
	buildMultipartyPreLockRecoveryRecord,
	findMultipartyPreLockRecoveryRecordByRefundPubkey,
	loadMultipartyPreLockRecoveryRecords,
	multipartyRecoveryRecordMatchesManifest,
	persistMultipartyPreLockRecoveryRecord,
	removeMultipartyPreLockRecoveryRecord,
	type AuctionMultipartyPreLockRecoveryRecord,
} from '../auction/multipartyRecoveryRecord'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../auctionP2pk'

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

const childKeysFor = (seeds: string[], path: string) =>
	seeds.map((seed) => {
		const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
		return deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, path)
	})

const CHILDREN = childKeysFor(['recovery-a', 'recovery-b', 'recovery-c'], 'm/0/41')
const AMOUNTS = [8_800, 200, 1_000]

const REFUND = `02${'c'.repeat(64)}`
const REFUND_PRIVKEY = 'd'.repeat(64)

/** Distinct compressed refund pubkeys, for the bound test. */
const refundPubkeyFor = (index: number): string => `03${index.toString(16).padStart(2, '0')}${'e'.repeat(62)}`

const rows = (amounts: number[] = AMOUNTS) =>
	amounts.map((amountSats, index) => ({
		manifestIndex: index,
		childPubkeyCompressed: CHILDREN[index],
		childPubkeyXOnly: CHILDREN[index].slice(2),
		derivationPath: `m/0/41/${index}`,
		amountSats,
	}))

const input = (overrides: Record<string, unknown> = {}) => ({
	id: 'record-1',
	createdAt: 1_790_000_000_000,
	auctionEventId: '1'.repeat(64),
	auctionCoordinates: `30408:${'a'.repeat(64)}:lot-1`,
	sellerPubkey: 'a'.repeat(64),
	derivationPath: 'm/0/41',
	refundPubkey: REFUND,
	refundPrivateKey: REFUND_PRIVKEY,
	mintUrl: 'https://mint.example.com',
	legDeltaSats: 10_000,
	cumulativeAmountSats: 25_000,
	locktime: 1_790_000_600,
	prevBidEventId: null,
	rows: rows(),
	...overrides,
})

const mustBuild = (overrides: Record<string, unknown> = {}): AuctionMultipartyPreLockRecoveryRecord => {
	const result = buildMultipartyPreLockRecoveryRecord(input(overrides))
	if (!result.ok) throw new Error(`expected a record, got ${result.code}: ${result.detail}`)
	return result.record
}

beforeEach(() => {
	globalThis.localStorage.clear()
	setAuthUser()
})

describe('multiparty pre-lock recovery record', () => {
	test('builds a record whose rows carry both forms of every child key', () => {
		const record = mustBuild()

		expect(record.scheme).toBe('cashu_p2pk_bidder_path_multiparty_v1')
		expect(record.rows).toHaveLength(3)
		expect(record.rows[0].childPubkeyCompressed).toBe(CHILDREN[0])
		// The projection is stored beside the key, so a recovered record can be matched to its manifest.
		expect(record.rows[0].childPubkeyXOnly).toBe(CHILDREN[0].slice(2))
		expect(record.rows.map((row) => row.manifestIndex)).toEqual([0, 1, 2])
	})

	test('refuses no rows', () => {
		const result = buildMultipartyPreLockRecoveryRecord(input({ rows: [] }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_rows_empty')
	})

	test('refuses row indexes that are not 0..n-1 in order', () => {
		const shuffled = rows().map((row) => ({ ...row, manifestIndex: row.manifestIndex === 1 ? 5 : row.manifestIndex }))
		const result = buildMultipartyPreLockRecoveryRecord(input({ rows: shuffled }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_rows_indexes_noncontiguous')
	})

	test('refuses an x-only value that is not the compressed key’s own projection', () => {
		const broken = rows().map((row) => (row.manifestIndex === 2 ? { ...row, childPubkeyXOnly: '0'.repeat(64) } : row))
		const result = buildMultipartyPreLockRecoveryRecord(input({ rows: broken }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_row_xonly_mismatch')
	})

	test('refuses a row key that is only x-only — the parity could never be rebuilt', () => {
		const broken = rows().map((row) => (row.manifestIndex === 0 ? { ...row, childPubkeyCompressed: CHILDREN[0].slice(2) } : row))
		const result = buildMultipartyPreLockRecoveryRecord(input({ rows: broken }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_row_key_not_compressed')
	})

	test('refuses a reused child key', () => {
		const reused = rows().map((row) =>
			row.manifestIndex === 1 ? { ...row, childPubkeyCompressed: CHILDREN[0], childPubkeyXOnly: CHILDREN[0].slice(2) } : row,
		)
		const result = buildMultipartyPreLockRecoveryRecord(input({ rows: reused }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_row_key_reused')
	})

	test('refuses rows that do not sum to the leg delta', () => {
		const result = buildMultipartyPreLockRecoveryRecord(input({ legDeltaSats: 10_001 }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_rows_sum_mismatch')
	})

	test('refuses a malformed refund private key — the record could not refund anything', () => {
		const result = buildMultipartyPreLockRecoveryRecord(input({ refundPrivateKey: 'not-hex' }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_refund_privkey_invalid')
	})

	test('refuses an uncompressed refund pubkey', () => {
		const result = buildMultipartyPreLockRecoveryRecord(input({ refundPubkey: 'c'.repeat(64) }))

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('record_refund_pubkey_invalid')
	})

	test('refuses a non-positive locktime or leg delta', () => {
		const noLocktime = buildMultipartyPreLockRecoveryRecord(input({ locktime: 0 }))
		const noDelta = buildMultipartyPreLockRecoveryRecord(input({ legDeltaSats: 0 }))

		expect(noLocktime.ok).toBe(false)
		expect(noDelta.ok).toBe(false)
		if (noLocktime.ok || noDelta.ok) return
		expect(noLocktime.code).toBe('record_locktime_invalid')
		expect(noDelta.code).toBe('record_leg_delta_invalid')
	})

	test('matches its manifest row by row', () => {
		const record = mustBuild()
		const manifest = rows().map((row) => ({
			manifest_index: row.manifestIndex,
			child_pubkey: row.childPubkeyXOnly,
			amount_sats: row.amountSats,
		}))

		expect(multipartyRecoveryRecordMatchesManifest(record, manifest)).toEqual({ ok: true })
	})

	test('reports a manifest that moved: row count, child key, or amount', () => {
		const record = mustBuild()
		const manifest = rows().map((row) => ({
			manifest_index: row.manifestIndex,
			child_pubkey: row.childPubkeyXOnly,
			amount_sats: row.amountSats,
		}))

		const fewer = multipartyRecoveryRecordMatchesManifest(record, manifest.slice(0, 2))
		const otherKey = multipartyRecoveryRecordMatchesManifest(
			record,
			manifest.map((row, position) => (position === 1 ? { ...row, child_pubkey: '9'.repeat(64) } : row)),
		)
		const otherAmount = multipartyRecoveryRecordMatchesManifest(
			record,
			manifest.map((row, position) => (position === 2 ? { ...row, amount_sats: 999 } : row)),
		)

		expect(fewer.ok).toBe(false)
		expect(otherKey.ok).toBe(false)
		expect(otherAmount.ok).toBe(false)
		if (fewer.ok || otherKey.ok || otherAmount.ok) return
		expect(fewer.code).toBe('record_manifest_row_count_mismatch')
		expect(otherKey.code).toBe('record_manifest_child_key_mismatch')
		expect(otherAmount.code).toBe('record_manifest_amount_mismatch')
	})

	test('persists with confirmed-write semantics and reads back by refund pubkey', () => {
		const record = mustBuild()
		persistMultipartyPreLockRecoveryRecord(record)

		const found = findMultipartyPreLockRecoveryRecordByRefundPubkey(REFUND)
		expect(found?.rows).toHaveLength(3)
		expect(found?.refundPrivateKey).toBe(REFUND_PRIVKEY)
	})

	test('looks a record up case-insensitively, as the single-party store does', () => {
		persistMultipartyPreLockRecoveryRecord(mustBuild())

		expect(findMultipartyPreLockRecoveryRecordByRefundPubkey(REFUND.toUpperCase())).toBeDefined()
	})

	test('fails closed at the bound instead of evicting a pending leg’s refund key', () => {
		for (let index = 0; index < 25; index += 1) {
			persistMultipartyPreLockRecoveryRecord(mustBuild({ id: `record-${index}`, refundPubkey: refundPubkeyFor(index) }))
		}
		expect(Object.keys(loadMultipartyPreLockRecoveryRecords())).toHaveLength(25)

		// The 26th distinct key throws BEFORE the write; nothing was evicted.
		expect(() => persistMultipartyPreLockRecoveryRecord(mustBuild({ id: 'record-25', refundPubkey: refundPubkeyFor(25) }))).toThrow(
			/store is full/,
		)
		expect(Object.keys(loadMultipartyPreLockRecoveryRecords())).toHaveLength(25)
		expect(findMultipartyPreLockRecoveryRecordByRefundPubkey(refundPubkeyFor(0))?.id).toBe('record-0')
	})

	test('supersedes an existing key at the bound without throwing', () => {
		for (let index = 0; index < 25; index += 1) {
			persistMultipartyPreLockRecoveryRecord(mustBuild({ id: `record-${index}`, refundPubkey: refundPubkeyFor(index) }))
		}

		persistMultipartyPreLockRecoveryRecord(mustBuild({ id: 'record-0-superseded', refundPubkey: refundPubkeyFor(0) }))

		expect(Object.keys(loadMultipartyPreLockRecoveryRecords())).toHaveLength(25)
		expect(findMultipartyPreLockRecoveryRecordByRefundPubkey(refundPubkeyFor(0))?.id).toBe('record-0-superseded')
	})

	test('removes a record, and tolerates removing one that is not there', () => {
		persistMultipartyPreLockRecoveryRecord(mustBuild())
		removeMultipartyPreLockRecoveryRecord(REFUND)

		expect(findMultipartyPreLockRecoveryRecordByRefundPubkey(REFUND)).toBeUndefined()
		expect(() => removeMultipartyPreLockRecoveryRecord(REFUND)).not.toThrow()
	})
})
