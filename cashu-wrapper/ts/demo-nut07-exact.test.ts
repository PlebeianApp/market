import { describe, expect, test } from 'bun:test'

import { exactDemoNut07Result } from './demo-nut07-exact'

const point = (value: number): string => `${value % 2 === 0 ? '02' : '03'}${value.toString(16).padStart(64, '0')}`

describe('exact NUT-07 response binding', () => {
	test('orders the exact unique response set by requested proof Y', () => {
		const requested = [point(1), point(2)]
		const result = exactDemoNut07Result(requested, { states: [
			{ Y: point(2).toUpperCase(), state: 'spent', witness: null },
			{ Y: point(1), state: 'UNSPENT', witness: null },
		] })
		expect(result.states).toEqual(['UNSPENT', 'SPENT'])
		expect(result.exactInputMatch).toBe(true)
		expect(result.proofSetDigest).toMatch(/^[0-9a-f]{64}$/)
	})

	test('rejects a same-length alternate set, duplicate Y, and extra fields', () => {
		const requested = [point(1), point(2)]
		expect(() => exactDemoNut07Result(requested, { states: [
			{ Y: point(1), state: 'SPENT', witness: null }, { Y: point(3), state: 'SPENT', witness: null },
		] })).toThrow(/proof set differs/)
		expect(() => exactDemoNut07Result(requested, { states: [
			{ Y: point(1), state: 'SPENT', witness: null }, { Y: point(1), state: 'SPENT', witness: null },
		] })).toThrow(/count or uniqueness/)
		expect(() => exactDemoNut07Result(requested, { states: [
			{ Y: point(1), state: 'SPENT', witness: null, extra: 'unexpected' }, { Y: point(2), state: 'SPENT', witness: null },
		] })).toThrow(/non-exact shape/)
		expect(() => exactDemoNut07Result(requested, { states: [
			{ Y: point(1), state: 'UNSPENT', witness: 'unexpected' }, { Y: point(2), state: 'SPENT', witness: null },
		] })).toThrow(/malformed/)
	})
})
