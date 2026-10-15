import { describe, expect, test } from 'bun:test'
import { isProductInStock } from './productAvailability'

describe('isProductInStock', () => {
	test('treats preorder as available even without stock', () => {
		expect(isProductInStock({ tags: [['visibility', 'pre-order']] })).toBe(true)
	})

	test('requires a positive parseable stock tag for on-sale items', () => {
		expect(
			isProductInStock({
				tags: [
					['visibility', 'on-sale'],
					['stock', '3'],
				],
			}),
		).toBe(true)
		expect(isProductInStock({ tags: [['stock', '0']] })).toBe(false)
		expect(isProductInStock({ tags: [] })).toBe(false)
		expect(isProductInStock({ tags: [['stock', 'unknown']] })).toBe(false)
	})
})
