import { describe, expect, test } from 'bun:test'
import { ALLOCATION_TOTAL_BPS } from '../v4v/allocations'
import {
	ZAP_PAYOUT_REASON_BELOW_MINIMUM,
	ZAP_PAYOUT_REASON_ZERO_SHARE,
	isZapPayoutPlanFailure,
	planZapPayout,
	type ZapPayoutPlan,
	type ZapPayoutPlanResult,
	type ZapPayoutRowInput,
} from '../v4v/payoutPlan'

/** Unwrap a plan or fail the test with the module's own refusal message. */
function planned(result: ZapPayoutPlanResult): ZapPayoutPlan {
	if (isZapPayoutPlanFailure(result)) throw new Error(`plan refused: ${result.error} — ${result.message}`)
	return result
}

/** The identity §6 requires of every plan, checked on every plan this suite builds. */
function expectReconciles(plan: ZapPayoutPlan, settledSats: number) {
	expect(plan.paidSats + plan.rolledUpSats + plan.skippedSats + plan.sellerSats).toBe(settledSats)
	expect(plan.sellerSats).toBeGreaterThanOrEqual(0)
}

const row = (id: string, bps: number, destination = `${id}@example.com`): ZapPayoutRowInput => ({ id, destination, bps })

describe('planZapPayout arithmetic', () => {
	test('10000 sats split three ways keeps the rounding remainder with the seller', () => {
		const plan = planned(planZapPayout({ rows: [row('a', 3333), row('b', 3333), row('c', 3333)], settledSats: 10_000, minimumZapSats: 1 }))

		expect(plan.rows.map((r) => r.sats)).toEqual([3333, 3333, 3333])
		expect(plan.rows.every((r) => r.action === 'pay')).toBe(true)
		expect(plan.paidSats).toBe(9999)
		expect(plan.rolledUpSats).toBe(0)
		expect(plan.skippedSats).toBe(0)
		expect(plan.sellerSats).toBe(1)
		expectReconciles(plan, 10_000)
	})

	test('a settlement that does not divide evenly leaves the truncation dust to the seller', () => {
		const plan = planned(planZapPayout({ rows: [row('a', 3333), row('b', 3333), row('c', 3333)], settledSats: 1001, minimumZapSats: 1 }))

		expect(plan.rows.map((r) => r.sats)).toEqual([333, 333, 333])
		expect(plan.paidSats).toBe(999)
		expect(plan.sellerSats).toBe(2)
		expectReconciles(plan, 1001)
	})

	test('a fully allocated settlement leaves the seller nothing', () => {
		const plan = planned(planZapPayout({ rows: [row('a', 4000), row('b', 6000)], settledSats: 5000, minimumZapSats: 1 }))

		expect(plan.rows.map((r) => r.sats)).toEqual([2000, 3000])
		expect(plan.sellerSats).toBe(0)
		expectReconciles(plan, 5000)
	})

	test('a share below the minimum zap rolls up instead of being sent', () => {
		const plan = planned(planZapPayout({ rows: [row('small', 100), row('big', 9900)], settledSats: 1000, minimumZapSats: 100 }))

		expect(plan.rows[0]).toMatchObject({ id: 'small', sats: 10, action: 'roll_up', reason: ZAP_PAYOUT_REASON_BELOW_MINIMUM })
		expect(plan.rows[1]).toMatchObject({ id: 'big', sats: 990, action: 'pay' })
		expect(plan.paidSats).toBe(990)
		expect(plan.rolledUpSats).toBe(10)
		expect(plan.sellerSats).toBe(0)
		expectReconciles(plan, 1000)
	})

	test('a share exactly at the minimum is paid, not rolled up', () => {
		const plan = planned(planZapPayout({ rows: [row('edge', 100)], settledSats: 10_000, minimumZapSats: 100 }))

		expect(plan.rows[0]).toMatchObject({ sats: 100, action: 'pay' })
		expect(plan.rolledUpSats).toBe(0)
		expectReconciles(plan, 10_000)
	})

	test('an announced zero row is skipped with a reason and is never silently absent', () => {
		const plan = planned(planZapPayout({ rows: [row('zero', 0), row('half', 5000)], settledSats: 1000, minimumZapSats: 1 }))

		expect(plan.rows).toHaveLength(2)
		expect(plan.rows[0]).toMatchObject({ id: 'zero', bps: 0, sats: 0, action: 'skip', reason: ZAP_PAYOUT_REASON_ZERO_SHARE })
		expect(plan.skippedSats).toBe(0)
		expect(plan.paidSats).toBe(500)
		expect(plan.sellerSats).toBe(500)
		expectReconciles(plan, 1000)
	})

	test('a positive share that truncates to zero is skipped, not rolled up', () => {
		const plan = planned(planZapPayout({ rows: [row('dust', 100), row('rest', 9900)], settledSats: 10, minimumZapSats: 5 }))

		expect(plan.rows[0]).toMatchObject({ sats: 0, action: 'skip', reason: ZAP_PAYOUT_REASON_ZERO_SHARE })
		expect(plan.rolledUpSats).toBe(0)
		expect(plan.skippedSats).toBe(0)
		expectReconciles(plan, 10)
	})

	test('the plan preserves the announced row order and destinations', () => {
		const plan = planned(
			planZapPayout({
				rows: [row('b', 500, 'b@x.com'), row('a', 500, 'a@x.com')],
				settledSats: 1000,
				minimumZapSats: 1,
			}),
		)

		expect(plan.rows.map((r) => r.id)).toEqual(['b', 'a'])
		expect(plan.rows.map((r) => r.destination)).toEqual(['b@x.com', 'a@x.com'])
	})

	test('a zero settlement plans nothing but still reconciles', () => {
		const plan = planned(planZapPayout({ rows: [row('a', 5000)], settledSats: 0, minimumZapSats: 1 }))

		expect(plan.rows[0]).toMatchObject({ sats: 0, action: 'skip' })
		expect(plan.paidSats).toBe(0)
		expect(plan.sellerSats).toBe(0)
		expectReconciles(plan, 0)
	})

	test('the reconciliation identity holds across a spread of amounts and splits', () => {
		const splits: readonly (readonly number[])[] = [
			[10000],
			[0, 10000],
			[1, 1, 9998],
			[3333, 3333, 3334],
			[2500, 2500, 2500, 2500],
			[7, 13, 9979],
			[9999, 1],
		]

		for (const bps of splits) {
			for (const settledSats of [0, 1, 9, 10, 100, 999, 1000, 10_000, 123_456]) {
				for (const minimumZapSats of [0, 1, 10, 100]) {
					const rows = bps.map((value, index) => row(`r${index}`, value))
					const result = planZapPayout({ rows, settledSats, minimumZapSats })
					const plan = planned(result)
					expectReconciles(plan, settledSats)
					expect(plan.paidSats + plan.rolledUpSats).toBeLessThanOrEqual(settledSats)
					expect(plan.rows.every((r) => r.action === 'pay' || r.reason !== undefined)).toBe(true)
					expect(plan.rows.map((r) => r.sats).reduce((sum, sats) => sum + sats, 0)).toBe(
						plan.paidSats + plan.rolledUpSats + plan.skippedSats,
					)
				}
			}
		}
	})
})

describe('planZapPayout refusals', () => {
	test('reuses the shared allocation total rather than a private constant', () => {
		expect(ALLOCATION_TOTAL_BPS).toBe(10_000)
		// Exactly 10000 bps of a 10000-sat settlement is payable: no rounding to hide in.
		const plan = planned(planZapPayout({ rows: [row('all', ALLOCATION_TOTAL_BPS)], settledSats: 10_000, minimumZapSats: 1 }))
		expect(plan.rows[0].sats).toBe(10_000)
		expect(plan.sellerSats).toBe(0)
	})

	test('an empty row list is refused', () => {
		const result = planZapPayout({ rows: [], settledSats: 1000, minimumZapSats: 1 })
		expect(isZapPayoutPlanFailure(result)).toBe(true)
		if (isZapPayoutPlanFailure(result)) expect(result.error).toBe('empty_rows')
	})

	test('bps summing above 10000 is refused', () => {
		const result = planZapPayout({ rows: [row('a', 5001), row('b', 5000)], settledSats: 1000, minimumZapSats: 1 })
		expect(isZapPayoutPlanFailure(result)).toBe(true)
		if (isZapPayoutPlanFailure(result)) expect(result.error).toBe('split_over_allocated')
	})

	test('exactly 10000 bps is not over-allocated', () => {
		const result = planZapPayout({ rows: [row('a', 5000), row('b', 5000)], settledSats: 1000, minimumZapSats: 1 })
		expect(isZapPayoutPlanFailure(result)).toBe(false)
	})

	test('negative, fractional or out-of-range bps is refused', () => {
		for (const bps of [-1, 1.5, 10_001, Number.NaN, Number.POSITIVE_INFINITY]) {
			const result = planZapPayout({ rows: [row('a', bps)], settledSats: 1000, minimumZapSats: 1 })
			expect(isZapPayoutPlanFailure(result)).toBe(true)
			if (isZapPayoutPlanFailure(result)) expect(result.error).toBe('invalid_bps')
		}
	})

	test('a negative or fractional settled amount is refused', () => {
		const negative = planZapPayout({ rows: [row('a', 1000)], settledSats: -1, minimumZapSats: 1 })
		expect(isZapPayoutPlanFailure(negative)).toBe(true)
		if (isZapPayoutPlanFailure(negative)) expect(negative.error).toBe('negative_settled_amount')

		const fractional = planZapPayout({ rows: [row('a', 1000)], settledSats: 100.5, minimumZapSats: 1 })
		expect(isZapPayoutPlanFailure(fractional)).toBe(true)
		if (isZapPayoutPlanFailure(fractional)) expect(fractional.error).toBe('non_integer_settled_amount')
	})

	test('an unusable minimum zap is refused', () => {
		for (const minimumZapSats of [-1, 1.5, Number.NaN]) {
			const result = planZapPayout({ rows: [row('a', 1000)], settledSats: 1000, minimumZapSats })
			expect(isZapPayoutPlanFailure(result)).toBe(true)
			if (isZapPayoutPlanFailure(result)) expect(result.error).toBe('invalid_minimum_zap')
		}
	})

	test('a duplicated row id is refused rather than silently merged', () => {
		const result = planZapPayout({ rows: [row('a', 1000), row('a', 1000)], settledSats: 1000, minimumZapSats: 1 })
		expect(isZapPayoutPlanFailure(result)).toBe(true)
		if (isZapPayoutPlanFailure(result)) expect(result.error).toBe('duplicate_row_id')
	})

	test('refusals are typed values, never throws', () => {
		const bad: readonly ZapPayoutResultLike[] = [
			{ rows: [], settledSats: 1, minimumZapSats: 1 },
			{ rows: [row('a', 20_000)], settledSats: 1, minimumZapSats: 1 },
			{ rows: [row('a', 1)], settledSats: Number.NaN, minimumZapSats: 1 },
		]
		for (const input of bad) {
			expect(() => planZapPayout(input)).not.toThrow()
			const result = planZapPayout(input)
			expect(result.ok).toBe(false)
			expect(isZapPayoutPlanFailure(result)).toBe(true)
		}
	})
})

type ZapPayoutResultLike = Parameters<typeof planZapPayout>[0]
