import { describe, expect, test } from 'bun:test'
import {
	CART_PERSISTENCE_D_TAG,
	CART_PERSISTENCE_KIND,
	CART_PERSISTENCE_VERSION,
	MAX_PERSISTED_CART_ITEMS,
	MAX_PERSISTED_CART_ITEM_QUANTITY,
	getCartPersistenceDTag,
	isCartPersistenceEvent,
	isExpectedCartSnapshot,
	parseCartPersistenceContent,
} from '@/lib/schemas/cartPersistence'

describe('cartPersistence schema helpers', () => {
	test('valid snapshot parses', () => {
		const parsed = parseCartPersistenceContent(
			JSON.stringify({
				version: CART_PERSISTENCE_VERSION,
				updatedAt: 1774300000,
				items: [
					{
						productRef: `30402:${'a'.repeat(64)}:nested:product-1`,
						quantity: 2,
						shippingRef: `30406:${'a'.repeat(64)}:shipping:1`,
						extraField: 'ignored',
					},
				],
				extraRoot: true,
			}),
		)

		expect(parsed).not.toBeNull()
		expect(parsed?.items[0]?.productRef).toBe(`30402:${'a'.repeat(64)}:nested:product-1`)
		expect((parsed?.items[0] as any).extraField).toBeUndefined()
		expect((parsed as any)?.extraRoot).toBeUndefined()
	})

	test('malformed json rejected', () => {
		expect(parseCartPersistenceContent('{nope')).toBeNull()
	})

	test('item caps enforced by schema', () => {
		const parsed = parseCartPersistenceContent(
			JSON.stringify({
				version: CART_PERSISTENCE_VERSION,
				updatedAt: 1774300000,
				items: Array.from({ length: MAX_PERSISTED_CART_ITEMS + 1 }, (_, index) => ({
					productRef: `30402:${'a'.repeat(64)}:product-${index}`,
					quantity: 1,
				})),
			}),
		)

		expect(parsed).toBeNull()
	})

	test('quantity caps enforced by schema', () => {
		const parsed = parseCartPersistenceContent(
			JSON.stringify({
				version: CART_PERSISTENCE_VERSION,
				updatedAt: 1774300000,
				items: [
					{
						productRef: `30402:${'a'.repeat(64)}:product-1`,
						quantity: MAX_PERSISTED_CART_ITEM_QUANTITY + 1,
					},
				],
			}),
		)

		expect(parsed).toBeNull()
	})

	test('kind and d-tag helpers reject wrong event shape', () => {
		const event = {
			kind: CART_PERSISTENCE_KIND,
			tags: [['d', CART_PERSISTENCE_D_TAG]],
		} as any
		const wrongKind = {
			kind: 1,
			tags: [['d', CART_PERSISTENCE_D_TAG]],
		} as any
		const wrongTag = {
			kind: CART_PERSISTENCE_KIND,
			tags: [['d', 'something-else']],
		} as any

		expect(isCartPersistenceEvent(event)).toBe(true)
		expect(getCartPersistenceDTag(event)).toBe(CART_PERSISTENCE_D_TAG)
		expect(isExpectedCartSnapshot(event)).toBe(true)
		expect(isExpectedCartSnapshot(wrongKind)).toBe(false)
		expect(isExpectedCartSnapshot(wrongTag)).toBe(false)
	})
})
