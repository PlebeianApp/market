/**
 * Multiparty leg lock outcome — what the mint returned, checked row by row.
 *
 * The test that matters most is the parity one. A row whose key is `03||x` and a proof locked to
 * `02||x` project to the *same* x-only child key, so nothing on the wire looks wrong; the payee can
 * never spend that output. It is the failure the compressed form exists to catch, and it is caught
 * here on the near side of the irreversible call.
 */
import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Proof } from '@cashu/cashu-ts'
import { verifyMultipartyLegLockOutcome } from '@/lib/auction/multipartyLegLockOutcome'
import { planMultipartyLegLock, type MultipartyLegLock } from '@/lib/auction/multipartyLegLockPlan'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'

const LOCKTIME = 1_790_000_600
const REFUND = `02${'c'.repeat(64)}`
const MINT = 'https://mint.example.com'

/** Real derived child keys, so their parity is whatever the curve actually produced. */
const childKeysFor = (seeds: string[], path: string) =>
	seeds.map((seed) => {
		const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
		return deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, path)
	})

const CHILDREN = childKeysFor(['outcome-a', 'outcome-b', 'outcome-c', 'outcome-d', 'outcome-e', 'outcome-f'], 'm/0/31')
const AMOUNTS = [8_800, 200, 1_000]

/** A key whose y is odd — the parity case is only real when such a key is actually in the fixture. */
const ODD_PARITY_CHILD = CHILDREN.find((key) => key.startsWith('03'))
const EVEN_PARITY_CHILD = CHILDREN.find((key) => key.startsWith('02'))

const plannedLocks = (amounts: number[] = AMOUNTS): readonly MultipartyLegLock[] => {
	const result = planMultipartyLegLock({
		legDeltaSats: amounts.reduce((sum, amount) => sum + amount, 0),
		locktime: LOCKTIME,
		refundPubkey: REFUND,
		mintCandidates: [MINT],
		rows: amounts.map((amountSats, index) => ({
			manifest_index: index,
			child_pubkey_compressed: CHILDREN[index],
			amount_sats: amountSats,
		})),
	})
	if (!result.ok) throw new Error(`fixture plan refused: ${result.code} ${result.detail}`)
	return result.locks
}

/** The NUT-11 secret a mint returns for a proof locked to `key`. */
const lockSecret = (key: string, nonce: string): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce,
			data: key,
			tags: [
				['locktime', String(LOCKTIME)],
				['refund', REFUND],
			],
		},
	])

const lockedProof = (amount: number, key: string, nonce: string): Proof =>
	({ amount, id: `00${'a'.repeat(14)}`, secret: lockSecret(key, nonce), C: 'b'.repeat(64) }) as unknown as Proof

/** The happy outcome: every row locked to its own key, summing to the manifest's amounts. */
const happyRows = () =>
	plannedLocks().map((lock) => ({
		manifestIndex: lock.manifestIndex,
		proofs: [lockedProof(lock.amountSats, lock.childPubkeyCompressed, `n-${lock.manifestIndex}`)],
	}))

const verify = (overrides: Record<string, unknown> = {}) =>
	verifyMultipartyLegLockOutcome({ locks: plannedLocks(), rows: happyRows(), ...overrides })

describe('multiparty leg lock outcome', () => {
	test('accepts a leg whose rows are each locked to their own key and sum to the manifest', () => {
		const result = verify()

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.rows.map((row) => row.manifestIndex)).toEqual([0, 1, 2])
		expect(result.rows.map((row) => row.amountSats)).toEqual(AMOUNTS)
		expect(result.totalSats).toBe(10_000)
		// The x-only projection reported per row is the key's own, one direction only.
		expect(result.rows.map((row) => row.lockPubkeyXOnly)).toEqual(CHILDREN.slice(0, AMOUNTS.length).map((key) => key.slice(2)))
	})

	test('reads the lock key out of the proofs themselves rather than trusting the plan', () => {
		const result = verify()

		expect(result.ok).toBe(true)
		if (!result.ok) return
		for (const [position, row] of result.rows.entries()) {
			expect(row.lockPubkeyCompressed).toBe(CHILDREN[position])
		}
	})

	test('refuses a row that was never returned — a partially locked leg', () => {
		const rows = happyRows().filter((row) => row.manifestIndex !== 1)
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_row_missing')
		expect(result.detail).toContain('partially locked')
	})

	test('refuses a row reported twice', () => {
		const rows = [...happyRows(), happyRows()[0]]
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_row_duplicated')
	})

	test('refuses a row the plan never had', () => {
		const rows = [...happyRows(), { manifestIndex: 7, proofs: [lockedProof(100, CHILDREN[0], 'n-x')] }]
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_row_unknown')
	})

	test('refuses a row that came back with no proofs at all', () => {
		const rows = happyRows().map((row) => (row.manifestIndex === 2 ? { ...row, proofs: [] } : row))
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_row_empty')
	})

	test('refuses a proof that is not a P2PK lock', () => {
		const rows = happyRows().map((row) =>
			row.manifestIndex === 0 ? { ...row, proofs: [{ ...lockedProof(8_800, CHILDREN[0], 'n'), secret: 'plain-secret' }] } : row,
		)
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_proof_not_locked')
	})

	test('catches a proof locked to the parity twin of the row’s key — the fund-stranding case', () => {
		// Not vacuous: the fixture must actually contain a key whose y is odd.
		expect(ODD_PARITY_CHILD).toBeDefined()
		expect(EVEN_PARITY_CHILD).toBeDefined()

		const flip = (key: string) => `${key.startsWith('03') ? '02' : '03'}${key.slice(2)}`
		const rows = happyRows().map((row) =>
			row.manifestIndex === 0 ? { ...row, proofs: [lockedProof(8_800, flip(CHILDREN[0]), 'n-flip')] } : row,
		)
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		// The x-only projection of the flipped key is identical to the row's — which is exactly why
		// only the compressed comparison catches this.
		expect(flip(CHILDREN[0]).slice(2)).toBe(CHILDREN[0].slice(2))
		expect(result.code).toBe('outcome_row_lock_key_mismatch')
	})

	test('catches a proof locked to a key that belongs to another row', () => {
		const rows = happyRows().map((row) =>
			row.manifestIndex === 0 ? { ...row, proofs: [lockedProof(8_800, CHILDREN[1], 'n-crossed')] } : row,
		)
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_row_lock_key_crossed')
		expect(result.detail).toContain('belongs to another row')
	})

	test('refuses a row whose proofs do not sum to the manifest amount', () => {
		const rows = happyRows().map((row) => (row.manifestIndex === 1 ? { ...row, proofs: [lockedProof(150, CHILDREN[1], 'n-short')] } : row))
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_row_sum_mismatch')
		expect(result.detail).toContain('150')
		expect(result.detail).toContain('200')
	})

	test('accepts a row split across several proofs', () => {
		const rows = happyRows().map((row) =>
			row.manifestIndex === 0 ? { ...row, proofs: [lockedProof(8_000, CHILDREN[0], 'n-a'), lockedProof(800, CHILDREN[0], 'n-b')] } : row,
		)
		const result = verify({ rows })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.rows[0].proofCount).toBe(2)
	})

	test('refuses a proof with a non-positive amount', () => {
		const rows = happyRows().map((row) => (row.manifestIndex === 0 ? { ...row, proofs: [lockedProof(0, CHILDREN[0], 'n-zero')] } : row))
		const result = verify({ rows })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_proof_amount_invalid')
	})

	test('refuses a leg with no locks to verify against', () => {
		const result = verifyMultipartyLegLockOutcome({ locks: [], rows: [] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('outcome_no_locks')
	})
})
