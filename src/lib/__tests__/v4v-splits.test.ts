import { describe, expect, test } from 'bun:test'
import type { V4VDTO } from '@/lib/stores/cart'
import {
	addRecipientToShares,
	deriveInitialSharesFromStored,
	equalizeAllShares,
	normalizeShares,
	removeRecipientFromShares,
	scaleSharesByTotal,
	updateSharePercentage,
} from '@/lib/v4v/splits'

const sum = (s: V4VDTO[]) => s.reduce((acc, x) => acc + x.percentage, 0)
const share = (id: string, percentage: number, pubkey = `pk-${id}`): V4VDTO => ({
	id,
	name: '',
	pubkey,
	percentage,
})

describe('normalizeShares', () => {
	test('divides by the total so the array sums to 1', () => {
		const out = normalizeShares([share('a', 2), share('b', 2)])
		expect(sum(out)).toBeCloseTo(1, 10)
		expect(out[0].percentage).toBeCloseTo(0.5, 10)
	})

	test('returns a copy (not the same reference) when total is 0', () => {
		const input = [share('a', 0)]
		const out = normalizeShares(input)
		expect(out).toEqual(input)
		expect(out).not.toBe(input)
		expect(out[0]).not.toBe(input[0])
	})
})

describe('addRecipientToShares', () => {
	test('first recipient gets the whole pool', () => {
		const out = addRecipientToShares([], 'pk-new', 10)
		expect(out).toHaveLength(1)
		expect(out[0].pubkey).toBe('pk-new')
		expect(out[0].percentage).toBe(1)
	})

	test('scales existing recipients down so the array still sums to 1', () => {
		const start = [share('a', 0.5), share('b', 0.5)]
		const out = addRecipientToShares(start, 'pk-new', 20) // new takes 20%
		expect(out).toHaveLength(3)
		expect(sum(out)).toBeCloseTo(1, 10)
		expect(out.find((s) => s.pubkey === 'pk-new')!.percentage).toBeCloseTo(0.2, 10)
		// existing two each had 0.5 of 1.0; remaining 0.8 split proportionally -> 0.4 each
		expect(out.find((s) => s.id === 'a')!.percentage).toBeCloseTo(0.4, 10)
	})

	test('does not mutate the input array', () => {
		const start = [share('a', 1)]
		addRecipientToShares(start, 'pk-new', 10)
		expect(start).toHaveLength(1)
		expect(start[0].percentage).toBe(1)
	})
})

describe('removeRecipientFromShares', () => {
	test('removes and re-normalizes the remainder to sum to 1', () => {
		const start = [share('a', 0.25), share('b', 0.75)]
		const out = removeRecipientFromShares(start, 'a')
		expect(out).toHaveLength(1)
		expect(out[0].id).toBe('b')
		expect(out[0].percentage).toBeCloseTo(1, 10)
	})

	test('returns [] when the last recipient is removed', () => {
		const out = removeRecipientFromShares([share('a', 1)], 'a')
		expect(out).toEqual([])
	})

	test('returns input unchanged when id not found', () => {
		const start = [share('a', 1)]
		expect(removeRecipientFromShares(start, 'nope')).toEqual(start)
	})
})

describe('updateSharePercentage', () => {
	test('absorbs the delta into the others proportionally', () => {
		const start = [share('a', 0.5), share('b', 0.5)]
		const out = updateSharePercentage(start, 'a', 0.8)
		expect(sum(out)).toBeCloseTo(1, 10)
		expect(out.find((s) => s.id === 'a')!.percentage).toBeCloseTo(0.8, 10)
		expect(out.find((s) => s.id === 'b')!.percentage).toBeCloseTo(0.2, 10)
	})

	test('clamps when the increase would starve others below the minimum', () => {
		const start = [share('a', 0.5), share('b', 0.5)]
		const out = updateSharePercentage(start, 'a', 0.99) // only one other, min 0.01
		expect(sum(out)).toBeCloseTo(1, 10)
		expect(out.find((s) => s.id === 'a')!.percentage).toBeCloseTo(0.99, 10)
		expect(out.find((s) => s.id === 'b')!.percentage).toBeCloseTo(0.01, 10)
	})

	test('a single recipient is always pinned to 1', () => {
		const out = updateSharePercentage([share('a', 1)], 'a', 0.3)
		expect(out).toHaveLength(1)
		expect(out[0].percentage).toBe(1)
	})

	test('returns input unchanged when id not found', () => {
		const start = [share('a', 1)]
		expect(updateSharePercentage(start, 'nope', 0.5)).toEqual(start)
	})
})

describe('equalizeAllShares', () => {
	test('distributes equally', () => {
		const out = equalizeAllShares([share('a', 0.7), share('b', 0.2), share('c', 0.1)])
		expect(out).toHaveLength(3)
		expect(sum(out)).toBeCloseTo(1, 10)
		out.forEach((s) => expect(s.percentage).toBeCloseTo(1 / 3, 10))
	})

	test('empty in, empty out', () => {
		expect(equalizeAllShares([])).toEqual([])
	})
})

describe('scaleSharesByTotal', () => {
	test('multiplies each share by total/100', () => {
		const out = scaleSharesByTotal([share('a', 0.5), share('b', 0.5)], 10)
		expect(out.find((s) => s.id === 'a')!.percentage).toBeCloseTo(0.05, 10)
		expect(out.find((s) => s.id === 'b')!.percentage).toBeCloseTo(0.05, 10)
	})
})

describe('deriveInitialSharesFromStored', () => {
	test('defaults when there are no stored shares', () => {
		expect(deriveInitialSharesFromStored(undefined)).toEqual({ initialShares: [], initialTotalPercentage: 10 })
		expect(deriveInitialSharesFromStored([])).toEqual({ initialShares: [], initialTotalPercentage: 10 })
	})

	test('re-normalizes the pool to sum to 1 and reports the total as a percentage', () => {
		// stored as fractions of total sales, e.g. 7% + 3% = 10% total
		const stored = [share('a', 0.07), share('b', 0.03)]
		const out = deriveInitialSharesFromStored(stored)
		expect(out.initialTotalPercentage).toBeCloseTo(10, 10)
		expect(sum(out.initialShares)).toBeCloseTo(1, 10)
		expect(out.initialShares[0].percentage).toBeCloseTo(0.7, 10) // 0.07 / 0.10
		expect(out.initialShares[1].percentage).toBeCloseTo(0.3, 10)
	})

	test('returns empty shares and 0 total when all stored percentages are 0', () => {
		const stored = [share('a', 0), share('b', 0)]
		expect(deriveInitialSharesFromStored(stored)).toEqual({ initialShares: [], initialTotalPercentage: 0 })
	})
})
