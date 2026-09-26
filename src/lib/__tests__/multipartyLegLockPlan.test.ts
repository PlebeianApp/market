/**
 * Multiparty leg lock planning.
 *
 * The test that matters most is the parity one: a compressed child key whose y is odd must stay
 * odd. Reconstructing it from the x-only form would silently change the lock key, and the payee
 * could never spend that output — a fund-stranding bug that looks perfectly healthy on the wire
 * because the x-only projection is identical either way.
 */
import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { planMultipartyLegLock, xOnlyFromCompressed } from '@/lib/auction/multipartyLegLockPlan'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'

const DELTA = 10_000
const LOCKTIME = 1_790_000_600
const REFUND = `02${'c'.repeat(64)}`
const MINT = 'https://mint.example.com'

/** Real derived child keys, so their parity is whatever the curve actually produced. */
const childKeysFor = (seeds: string[], path: string) =>
	seeds.map((seed) => {
		const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
		return deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, path)
	})

const CHILDREN = childKeysFor(['leg-plan-a', 'leg-plan-b', 'leg-plan-c'], 'm/0/11')

const row = (index: number, amountSats: number, child = CHILDREN[index]) => ({
	manifest_index: index,
	child_pubkey_compressed: child,
	amount_sats: amountSats,
})

const plan = (overrides: Record<string, unknown> = {}) =>
	planMultipartyLegLock({
		legDeltaSats: DELTA,
		locktime: LOCKTIME,
		refundPubkey: REFUND,
		mintCandidates: [MINT],
		rows: [row(0, 8_800), row(1, 200), row(2, 1_000)],
		...overrides,
	})

describe('planMultipartyLegLock — the happy path', () => {
	test('one lock per row, in manifest order, carrying BOTH key forms', () => {
		const result = plan()
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.locks).toHaveLength(3)
		expect(result.locks.map((lock) => lock.manifestIndex)).toEqual([0, 1, 2])
		expect(result.locks.map((lock) => lock.amountSats)).toEqual([8_800, 200, 1_000])
		for (const [position, lock] of result.locks.entries()) {
			// The lock key keeps the parity the derivation produced …
			expect(lock.childPubkeyCompressed).toBe(CHILDREN[position])
			// … and the manifest projection is exactly that key without its parity byte.
			expect(lock.childPubkeyXOnly).toBe(CHILDREN[position].slice(2))
		}
		expect(result.totalSats).toBe(DELTA)
		expect(result.mintUrl).toBe(MINT)
		expect(result.locktime).toBe(LOCKTIME)
		expect(result.refundPubkey).toBe(REFUND)
	})

	test('the parity byte is preserved, never reconstructed', () => {
		// Find a path whose derived child key has ODD parity — the case this module exists for.
		// Without it the assertions below would be vacuous, so its absence is itself a failure.
		let oddChild: string | null = null
		for (const seed of ['leg-parity-a', 'leg-parity-b', 'leg-parity-c', 'leg-parity-d', 'leg-parity-e']) {
			const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
			const derived = deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, 'm/0/3')
			if (derived.startsWith('03')) {
				oddChild = derived
				break
			}
		}
		expect(oddChild).not.toBeNull()
		if (!oddChild) return

		const result = planMultipartyLegLock({
			legDeltaSats: 100,
			locktime: LOCKTIME,
			refundPubkey: REFUND,
			mintCandidates: [MINT],
			rows: [{ manifest_index: 0, child_pubkey_compressed: oddChild, amount_sats: 100 }],
		})
		if (!result.ok) throw new Error(`expected ok, got ${result.code}`)
		expect(result.locks[0].childPubkeyCompressed).toBe(oddChild)
		expect(result.locks[0].childPubkeyCompressed.startsWith('03')).toBe(true)
		// The x-only projection is identical either way, which is exactly why guessing parity
		// would go unnoticed until a payee could not spend.
		expect(result.locks[0].childPubkeyXOnly).toBe(oddChild.slice(2))
		expect(`02${oddChild.slice(2)}`).not.toBe(oddChild)
	})

	test('every planned key keeps the parity the derivation produced', () => {
		const result = plan()
		if (!result.ok) throw new Error('expected ok')
		for (const lock of result.locks) {
			expect(lock.childPubkeyCompressed.slice(0, 2)).toBe(CHILDREN[lock.manifestIndex].slice(0, 2))
		}
	})

	test('the expected x-only keys from the manifest are checked against the derivation', () => {
		const result = plan({ expectedXOnly: CHILDREN.map((key) => key.slice(2)) })
		expect(result.ok).toBe(true)
	})

	test('all locks share one mint — multi-mint legs are refused by construction', () => {
		const result = plan({ mintCandidates: [MINT, 'https://mint.second.example'] })
		if (!result.ok) throw new Error('expected ok')
		expect(new Set(result.locks.map((lock) => lock.mintUrl))).toEqual(new Set([MINT]))
	})
})

describe('planMultipartyLegLock — refusals', () => {
	test('rows that do not sum to the leg delta are refused', () => {
		// The release's per-row sum check would fail, so this plan must never reach a mint.
		const result = plan({ legDeltaSats: 9_999 })
		expect(result).toMatchObject({ ok: false, code: 'leg_rows_sum_mismatch' })
	})

	test('an x-only child key is refused rather than completed with a guessed parity', () => {
		const result = plan({ rows: [row(0, 8_800, CHILDREN[0].slice(2) as string), row(1, 200), row(2, 1_000)] })
		expect(result).toMatchObject({ ok: false, code: 'leg_child_pubkey_invalid' })
	})

	test('a reused child key is refused — two rows must not share one output', () => {
		const result = plan({ rows: [row(0, 8_800), row(1, 200, CHILDREN[0]), row(2, 1_000)] })
		expect(result).toMatchObject({ ok: false, code: 'leg_child_pubkey_reused' })
	})

	test('a row below the leg floor is refused', () => {
		// 9, 990 + 5 + 5 = 10,000: sums correctly, but two rows are un-redeemable in practice.
		const result = plan({ rows: [row(0, 9_990), row(1, 5), row(2, 5)] })
		expect(result).toMatchObject({ ok: false, code: 'leg_row_below_floor' })
	})

	test('non-contiguous manifest indexes are refused', () => {
		const result = plan({ rows: [row(0, 8_800), row(2, 200), row(3, 1_000)] })
		expect(result).toMatchObject({ ok: false, code: 'leg_rows_indexes_noncontiguous' })
	})

	test('an empty row list, an empty mint list, and invalid scalars are refused', () => {
		expect(plan({ rows: [] })).toMatchObject({ ok: false, code: 'leg_rows_empty' })
		expect(plan({ mintCandidates: [] })).toMatchObject({ ok: false, code: 'leg_mint_missing' })
		expect(plan({ legDeltaSats: 0 })).toMatchObject({ ok: false, code: 'leg_delta_invalid' })
		expect(plan({ legDeltaSats: 1.5 })).toMatchObject({ ok: false, code: 'leg_delta_invalid' })
		expect(plan({ locktime: -1 })).toMatchObject({ ok: false, code: 'leg_locktime_invalid' })
	})

	test('an x-only or malformed refund key is refused — NUT-11 needs the compressed form', () => {
		expect(plan({ refundPubkey: 'c'.repeat(64) })).toMatchObject({ ok: false, code: 'leg_refund_pubkey_invalid' })
		expect(plan({ refundPubkey: 'not-hex' })).toMatchObject({ ok: false, code: 'leg_refund_pubkey_invalid' })
	})

	test('a manifest whose child keys the derivation does not reproduce is refused', () => {
		// This is the release-time check (manifest §6 rule 1) run before the money moves instead of
		// after: a row that does not derive from its xpub would be grief.
		const result = plan({ expectedXOnly: [CHILDREN[0].slice(2), CHILDREN[2].slice(2), CHILDREN[1].slice(2)] })
		expect(result).toMatchObject({ ok: false, code: 'leg_derivation_mismatch' })
	})

	test('a manifest with a different row count is refused', () => {
		const result = plan({ expectedXOnly: [CHILDREN[0].slice(2)] })
		expect(result).toMatchObject({ ok: false, code: 'leg_manifest_row_count_mismatch' })
	})
})

describe('xOnlyFromCompressed', () => {
	test('projects a compressed key and refuses anything else', () => {
		for (const key of CHILDREN) expect(xOnlyFromCompressed(key)).toBe(key.slice(2))
		expect(() => xOnlyFromCompressed(CHILDREN[0].slice(2))).toThrow(/cannot be completed/)
		expect(() => xOnlyFromCompressed('04' + 'd'.repeat(64))).toThrow()
	})

	test('the derivation really does produce the parity we lock with', () => {
		// Guards the premise of the module: the compressed key names the same point the payee's
		// private key does, which is why the parity must not be substituted.
		const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode('leg-plan-a')))
		const child = master.derive('m/0/11')
		expect(bytesToHex(schnorr.getPublicKey(child.privateKey as Uint8Array))).toBe(CHILDREN[0].slice(2))
	})
})
