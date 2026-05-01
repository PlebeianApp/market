import { describe, expect, test } from 'bun:test'
import { dedupeAndParseShippingRefs } from '@/lib/auctionShippingUtils'

describe('dedupeAndParseShippingRefs', () => {
	test('removes exact duplicates (same ref + same extraCost)', () => {
		const input = [
			{ shippingRef: '30406:pk1:d1', extraCost: '0' },
			{ shippingRef: '30406:pk1:d1', extraCost: '0' },
		]
		const result = dedupeAndParseShippingRefs(input)
		expect(result).toHaveLength(1)
		expect(result[0].shippingRef).toBe('30406:pk1:d1')
		expect(result[0].extraCost).toBe('0')
	})

	test('keeps entries with different extraCost for same ref', () => {
		const input = [
			{ shippingRef: '30406:pk1:d1', extraCost: '0' },
			{ shippingRef: '30406:pk1:d1', extraCost: '100' },
		]
		const result = dedupeAndParseShippingRefs(input)
		expect(result).toHaveLength(2)
		expect(result[0].extraCost).toBe('0')
		expect(result[1].extraCost).toBe('100')
	})

	test('preserves first occurrence order', () => {
		const input = [
			{ shippingRef: '30406:pk3:d3', extraCost: '' },
			{ shippingRef: '30406:pk1:d1', extraCost: '' },
			{ shippingRef: '30406:pk3:d3', extraCost: '' },
		]
		const result = dedupeAndParseShippingRefs(input)
		expect(result).toHaveLength(2)
		expect(result[0].pubkey).toBe('pk3')
		expect(result[1].pubkey).toBe('pk1')
	})

	test('classifies valid vs invalid refs', () => {
		const input = [
			{ shippingRef: '30406:pk1:d1', extraCost: '' },
			{ shippingRef: 'not-a-ref', extraCost: '' },
		]
		const result = dedupeAndParseShippingRefs(input)
		expect(result).toHaveLength(2)
		expect(result[0]).toMatchObject({ isValid: true, pubkey: 'pk1', dTag: 'd1' })
		expect(result[1]).toMatchObject({ isValid: false, pubkey: '', dTag: '' })
	})

	test('empty input returns empty', () => {
		expect(dedupeAndParseShippingRefs([])).toEqual([])
	})

	test('all duplicates returns single entry', () => {
		const input = [
			{ shippingRef: '30406:pk1:d1', extraCost: '0' },
			{ shippingRef: '30406:pk1:d1', extraCost: '0' },
			{ shippingRef: '30406:pk1:d1', extraCost: '0' },
		]
		const result = dedupeAndParseShippingRefs(input)
		expect(result).toHaveLength(1)
	})

	test('preserves extraCost in output', () => {
		const input = [{ shippingRef: '30406:pk1:d1', extraCost: '500' }]
		const result = dedupeAndParseShippingRefs(input)
		expect(result).toHaveLength(1)
		expect(result[0].extraCost).toBe('500')
	})
})
