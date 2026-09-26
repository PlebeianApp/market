import { describe, expect, test } from 'bun:test'
import {
	ALLOCATION_TOTAL_BPS,
	BPS_UNIT,
	PERCENT_UNIT,
	allocationBarWidth,
	allocationFits,
	bpsToFraction,
	bpsToPercent,
	clampAllocation,
	equalizeAllocations,
	formatBps,
	fractionToBps,
	percentToBps,
	sellerRemainder,
} from '@/lib/v4v/allocations'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('the allocation unit', () => {
	test('basis points keep a fractional fee exact instead of rounding it away', () => {
		// The case that motivated the unit: a validator announcing 0.5%. Whole values
		// stay whole; fractions keep two decimals, consistently.
		expect(formatBps(50)).toBe('0.50%')
		expect(formatBps(325)).toBe('3.25%')
		expect(formatBps(200)).toBe('2%')
		expect(formatBps(0)).toBe('0%')
		expect(formatBps(10_000)).toBe('100%')
	})

	test('a full allocation is the unit total, not a hardcoded 100', () => {
		expect(ALLOCATION_TOTAL_BPS).toBe(10_000)
		expect(BPS_UNIT.total).toBe(ALLOCATION_TOTAL_BPS)
		expect(PERCENT_UNIT.total).toBe(100)
		// The same value reads as the unit says it should.
		expect(BPS_UNIT.format(2_500)).toBe('25%')
		expect(PERCENT_UNIT.format(25)).toBe('25%')
	})

	test('conversions round-trip at the boundary where a percent is stored', () => {
		expect(percentToBps(10)).toBe(1_000)
		expect(bpsToPercent(1_000)).toBe(10)
		expect(fractionToBps(1)).toBe(ALLOCATION_TOTAL_BPS)
		expect(fractionToBps(0.1)).toBe(1_000)
		expect(bpsToFraction(1_000)).toBeCloseTo(0.1, 10)
		// A fraction that is not a whole percent still survives the trip.
		expect(fractionToBps(0.005)).toBe(50)
	})

	test('an allocation is clamped into the unit, and nonsense becomes zero', () => {
		expect(clampAllocation(12_000)).toBe(ALLOCATION_TOTAL_BPS)
		expect(clampAllocation(-5)).toBe(0)
		expect(clampAllocation(Number.NaN)).toBe(0)
		expect(clampAllocation(Number.POSITIVE_INFINITY)).toBe(0)
		expect(clampAllocation(50, PERCENT_UNIT.total)).toBe(50)
		expect(clampAllocation(150, PERCENT_UNIT.total)).toBe(100)
	})

	test('the seller keeps what nobody else was allocated', () => {
		expect(sellerRemainder(1_000)).toBe(9_000)
		expect(sellerRemainder(ALLOCATION_TOTAL_BPS)).toBe(0)
		// Over-allocation cannot make the seller negative.
		expect(sellerRemainder(20_000)).toBe(0)
	})

	test('bar widths are derived from the unit, never from an assumed 100', () => {
		expect(allocationBarWidth(2_500, BPS_UNIT)).toBe(25)
		expect(allocationBarWidth(25, PERCENT_UNIT)).toBe(25)
		expect(allocationBarWidth(0, BPS_UNIT)).toBe(0)
	})
})

describe('equalizing allocations', () => {
	test('locked rows hold their value and the rest split the pool', () => {
		const rows = [
			{ id: 'validator', bps: 200, locked: true },
			{ id: A, bps: 100 },
			{ id: B, bps: 500 },
		]
		const next = equalizeAllocations(rows, 1_000)
		expect(next.validator).toBeUndefined()
		expect(next[A]).toBe(400)
		expect(next[B]).toBe(400)
		// The parts sum to the pool that is actually available.
		expect(next[A] + next[B] + 200).toBe(1_000)
	})

	test('a remainder that does not divide evenly still sums to the pool', () => {
		const rows = [
			{ id: A, bps: 10 },
			{ id: B, bps: 10 },
			{ id: C, bps: 10 },
		]
		const next = equalizeAllocations(rows, 1_000)
		expect(Object.values(next).reduce((sum, value) => sum + value, 0)).toBe(1_000)
	})

	test('nothing to equalize returns nothing, rather than inventing a change', () => {
		expect(equalizeAllocations([{ id: A, bps: 100, locked: true }], 1_000)).toEqual({})
	})

	test('the pool can never fall below the fixed fees', () => {
		const rows = [
			{ id: 'validator', bps: 900, locked: true },
			{ id: A, bps: 100 },
		]
		const next = equalizeAllocations(rows, 500)
		expect(next[A]).toBe(0)
	})
})

describe('allocationFits', () => {
	test('accepts a schedule inside the total and rejects one outside it', () => {
		expect(allocationFits([1_000, 2_000, 500])).toBe(true)
		expect(allocationFits([9_000, 2_000])).toBe(false)
		expect(allocationFits([ALLOCATION_TOTAL_BPS])).toBe(true)
	})
})
