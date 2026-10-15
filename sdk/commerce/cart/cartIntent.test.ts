import { describe, expect, test } from 'bun:test'
import { createCartIntent, normalizePersistedCart, normalizeShippingForRestore } from './cartIntent'

const sellerA = 'a'.repeat(64)
const sellerB = 'b'.repeat(64)

describe('buyer cart intent', () => {
	test('serializes deterministically and excludes invalid products', () => {
		const intent = createCartIntent(
			[
				{ id: 'product-b', amount: 2, sellerPubkey: sellerB, shippingMethodId: `30406:${sellerB}:ship-1` },
				{ id: 'product-a', amount: 1, sellerPubkey: sellerA },
				{ id: 'invalid', amount: 1, sellerPubkey: '' },
			],
			15000,
		)

		expect(intent.version).toBe(1)
		expect(intent.updatedAt).toBe(15)
		expect(intent.items.map((item) => item.productRef)).toEqual([`30402:${sellerA}:product-a`, `30402:${sellerB}:product-b`])
		expect(intent.items[1]?.shippingRef).toBe(`30406:${sellerB}:ship-1`)
	})

	test('deduplicates, clamps and sorts persisted items', () => {
		const normalized = normalizePersistedCart({
			version: 1,
			updatedAt: 10,
			items: [
				{ productRef: `30402:${sellerB}:product-2`, quantity: 1 },
				{ productRef: `30402:${sellerA}:product-1`, quantity: 2, shippingRef: `30406:${sellerA}:ship-1` },
				{ productRef: `30402:${sellerA}:product-1`, quantity: 7 },
			],
		})

		expect(normalized.items).toHaveLength(2)
		expect(normalized.items[0]).toEqual({ productRef: `30402:${sellerA}:product-1`, quantity: 7, shippingRef: undefined })
		expect(normalized.items[1]?.productRef).toBe(`30402:${sellerB}:product-2`)
	})

	test('clears shipping that does not match product seller and option', () => {
		const productRef = `30402:${sellerA}:product-1`
		const badShippingRef = `30406:${sellerB}:ship-1`
		const [item] = normalizeShippingForRestore(
			[{ productRef, quantity: 2, shippingRef: badShippingRef }],
			{ [productRef]: { productRef, sellerPubkey: sellerA, productId: 'product-1', shippingRefs: [`30406:${sellerA}:ship-1`] } },
			{ [badShippingRef]: { shippingRef: badShippingRef, sellerPubkey: sellerB } },
		)

		expect(item?.shippingRef).toBeUndefined()
	})
})
