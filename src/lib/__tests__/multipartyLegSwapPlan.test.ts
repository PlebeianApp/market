/**
 * Multiparty leg swap planning.
 *
 * A leg is locked one swap per row (D16), so the planner's job is to prove, before the first
 * irreversible call, that every row can be funded from a *disjoint* subset of the leg's proofs.
 * The two tests that carry the weight are the disjointness one (a proof offered to two rows is a
 * proof the second mint call cannot spend) and the unfundable-row one (a refusal, never a leg that
 * gets half-locked).
 */
import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import type { Proof } from '@cashu/cashu-ts'
import { planMultipartyLegSwaps, type MultipartyLegLockPlan } from '@/lib/auction/multipartyLegSwapPlan'
import { planMultipartyLegLock } from '@/lib/auction/multipartyLegLockPlan'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'

const LOCKTIME = 1_790_000_600
const REFUND = `02${'c'.repeat(64)}`
const MINT = 'https://mint.example.com'
const OTHER_MINT = 'https://mint.example.org'

/** Real derived child keys, so their parity is whatever the curve actually produced. */
const childKeysFor = (seeds: string[], path: string) =>
	seeds.map((seed) => {
		const master = HDKey.fromMasterSeed(sha256(new TextEncoder().encode(seed)))
		return deriveAuctionChildP2pkPubkeyFromXpub(master.publicExtendedKey as string, path)
	})

const CHILDREN = childKeysFor(['swap-plan-a', 'swap-plan-b', 'swap-plan-c'], 'm/0/21')

/** A wallet proof, as the wallet holds it: amount + the mint's identity fields. */
const proof = (amount: number, tag: string): Proof =>
	({
		amount,
		id: `00${'a'.repeat(14)}`,
		secret: `secret-${tag}`,
		C: `${'b'.repeat(62)}${tag.length.toString(16).padStart(2, '0')}`,
	}) as unknown as Proof

/** The plan the lock planner produced, which is what the swap planner consumes. */
const plannedLeg = (amounts: number[] = [8_800, 200, 1_000]): MultipartyLegLockPlan => {
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
	return result
}

/** The happy pool: one proof per row, each exactly the row's amount. */
const exactPool = () => [proof(8_800, 'a'), proof(200, 'b'), proof(1_000, 'c')]

const planSwaps = (overrides: Record<string, unknown> = {}) =>
	planMultipartyLegSwaps({
		plan: plannedLeg(),
		availableProofs: exactPool(),
		...overrides,
	})

const mustPlan = (overrides: Record<string, unknown> = {}) => {
	const result = planSwaps(overrides)
	if (!result.ok) throw new Error(`expected a plan, got ${result.code}: ${result.detail}`)
	return result
}

describe('multiparty leg swap plan', () => {
	test('plans one swap per row, in manifest index order, each locking its own compressed child key', () => {
		const planned = mustPlan()

		expect(planned.requests.map((request) => request.manifestIndex)).toEqual([0, 1, 2])
		expect(planned.requests.map((request) => request.p2pk.pubkey)).toEqual(CHILDREN)
		expect(planned.requests.map((request) => request.amountSats)).toEqual([8_800, 200, 1_000])
		// The whole leg is one mint, so every request carries it.
		expect(planned.requests.every((request) => request.mintUrl === MINT)).toBe(true)
		expect(planned.totalSats).toBe(10_000)
	})

	test('carries the leg locktime and the leg refund authority on every row', () => {
		const planned = mustPlan()

		for (const request of planned.requests) {
			expect(request.p2pk.locktime).toBe(LOCKTIME)
			expect(request.p2pk.refundKeys).toEqual([REFUND])
		}
	})

	test('never offers the same proof to two rows', () => {
		const planned = mustPlan({
			availableProofs: [proof(8_800, 'a'), proof(1_000, 'b'), proof(1_000, 'c'), proof(200, 'd')],
		})

		const allocated = planned.requests.flatMap((request) => request.inputs.map((input) => input.secret))
		expect(new Set(allocated).size).toBe(allocated.length)
		expect(allocated).toHaveLength(3)
		for (const request of planned.requests) {
			expect(request.inputTotalSats).toBeGreaterThanOrEqual(request.amountSats)
		}
	})

	test('covers a row with the smallest single proof that fits it, so change stays minimal', () => {
		const planned = mustPlan({
			availableProofs: [proof(8_800, 'exact'), proof(20_000, 'large'), proof(200, 'b'), proof(1_000, 'c')],
		})

		// Row 0 takes the 8_800 proof, not the 20_000 one, even though both cover it.
		expect(planned.requests[0].inputs.map((input) => input.secret)).toEqual(['secret-exact'])
		expect(planned.requests[0].expectedChangeSats).toBe(0)
	})

	test('accumulates several proofs when no single proof covers the row', () => {
		// A one-row leg, where consuming the pool is exactly the point.
		const planned = mustPlan({
			plan: plannedLeg([9_000]),
			availableProofs: [proof(4_000, 'a'), proof(5_000, 'b')],
		})

		expect(planned.requests).toHaveLength(1)
		expect(planned.requests[0].inputs.map((input) => input.secret)).toEqual(['secret-a', 'secret-b'])
		expect(planned.requests[0].inputTotalSats).toBe(9_000)
		expect(planned.requests[0].expectedChangeSats).toBe(0)
	})

	test('reports the change a row returns when the cover overshoots its amount', () => {
		const planned = mustPlan({ availableProofs: [proof(9_000, 'a'), proof(200, 'b'), proof(1_000, 'c')] })

		expect(planned.requests[0].inputTotalSats).toBe(9_000)
		expect(planned.requests[0].expectedChangeSats).toBe(200)
	})

	test('refuses a row whose mint disagrees with the leg’s', () => {
		const leg = plannedLeg()
		const handBuilt = { ...leg, locks: leg.locks.map((lock, index) => (index === 1 ? { ...lock, mintUrl: OTHER_MINT } : lock)) }
		const result = planSwaps({ plan: handBuilt })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_mint_mismatch')
	})

	test('refuses an uncompressed refund key', () => {
		const result = planSwaps({ plan: { ...plannedLeg(), refundPubkey: 'c'.repeat(64) } })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_refund_pubkey_invalid')
	})

	test('refuses a non-positive locktime', () => {
		const result = planSwaps({ plan: { ...plannedLeg(), locktime: 0 } })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_locktime_invalid')
	})

	test('refuses a leg with no mint', () => {
		const result = planSwaps({ plan: { ...plannedLeg(), mintUrl: '   ' } })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_mint_missing')
	})

	test('refuses when no input proofs are supplied', () => {
		const result = planSwaps({ availableProofs: [] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_inputs_missing')
	})

	test('refuses an input proof with a non-positive amount', () => {
		const result = planSwaps({ availableProofs: [proof(0, 'zero')] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_input_amount_invalid')
	})

	test('refuses the same proof supplied twice, which would hand one burn to two rows', () => {
		const duplicated = proof(8_800, 'a')
		const result = planSwaps({ availableProofs: [duplicated, duplicated] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_input_duplicated')
	})

	test('refuses a row the pool cannot cover, naming the row and the shortfall', () => {
		const result = planSwaps({ availableProofs: [proof(5_000, 'a'), proof(100, 'b')] })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_row_unfundable')
		expect(result.detail).toContain('row 0')
		expect(result.detail).toContain('8800')
		expect(result.detail).toContain('5100')
	})

	test('refuses a leg with no rows', () => {
		const result = planSwaps({ plan: { ...plannedLeg(), locks: [] } })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('swaps_no_rows')
	})
})
