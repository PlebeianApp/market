import { describe, expect, test } from 'bun:test'
import { isValidTopLevelComment, MAX_COMMENT_LENGTH, PRODUCT_COMMENT_KIND } from '@/lib/schemas/productComment'

const productCoords = `30402:${'a'.repeat(64)}:product-1`
const merchantPubkey = 'b'.repeat(64)

const createEvent = (overrides: Record<string, unknown> = {}) =>
	({
		kind: PRODUCT_COMMENT_KIND,
		content: 'Solid product',
		pubkey: 'c'.repeat(64),
		tags: [
			['A', productCoords],
			['K', '30402'],
			['P', merchantPubkey],
			['a', productCoords],
			['k', '30402'],
			['p', merchantPubkey],
		],
		...overrides,
	}) as any

describe('productComment schema', () => {
	test('accepts a valid top-level product comment', () => {
		expect(isValidTopLevelComment(createEvent(), productCoords, merchantPubkey)).toBe(true)
	})

	test('rejects empty and overlong content', () => {
		expect(isValidTopLevelComment(createEvent({ content: '   ' }), productCoords, merchantPubkey)).toBe(false)
		expect(isValidTopLevelComment(createEvent({ content: 'x'.repeat(MAX_COMMENT_LENGTH + 1) }), productCoords, merchantPubkey)).toBe(false)
	})

	test('rejects invalid or mismatched structural tags', () => {
		expect(
			isValidTopLevelComment(
				createEvent({
					tags: [
						['A', productCoords],
						['K', '30402'],
						['P', merchantPubkey],
						['a', productCoords],
						['k', '30402'],
					],
				}),
				productCoords,
				merchantPubkey,
			),
		).toBe(false)

		expect(
			isValidTopLevelComment(
				createEvent({
					tags: [
						['A', `${productCoords}-wrong`],
						['K', '30402'],
						['P', merchantPubkey],
						['a', productCoords],
						['k', '30402'],
						['p', merchantPubkey],
					],
				}),
				productCoords,
				merchantPubkey,
			),
		).toBe(false)

		expect(
			isValidTopLevelComment(
				createEvent({
					tags: [
						['A', productCoords],
						['K', '30402'],
						['P', merchantPubkey],
						['a', productCoords],
						['k', '30402'],
						['p', merchantPubkey],
						['e', 'unexpected'],
					],
				}),
				productCoords,
				merchantPubkey,
			),
		).toBe(false)
	})

	test('rejects duplicate structural tags', () => {
		expect(
			isValidTopLevelComment(
				createEvent({
					tags: [
						['A', productCoords],
						['A', productCoords],
						['K', '30402'],
						['P', merchantPubkey],
						['a', productCoords],
						['k', '30402'],
						['p', merchantPubkey],
					],
				}),
				productCoords,
				merchantPubkey,
			),
		).toBe(false)
	})
})
