import { describe, expect, test } from 'bun:test'
import {
	chooseNewerCartSnapshot,
	normalizePersistedCart,
	normalizeShippingForRestore,
	rehydrateCartFromLiveData,
	serializeCartIntent,
} from '@/lib/cart-persistence'
import { CART_PERSISTENCE_D_TAG, CART_PERSISTENCE_KIND, type PersistedCartContent } from '@/lib/schemas/cartPersistence'
import type { NormalizedCart } from '@/lib/stores/cart'

const sellerA = 'a'.repeat(64)
const sellerB = 'b'.repeat(64)

describe('cart persistence helpers', () => {
	test('duplicate productRefs collapse deterministically', () => {
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
		expect(normalized.items[0]).toEqual({
			productRef: `30402:${sellerA}:product-1`,
			quantity: 7,
			shippingRef: undefined,
		})
		expect(normalized.items[1]?.productRef).toBe(`30402:${sellerB}:product-2`)
	})

	test('chooseNewerCartSnapshot picks highest created_at valid event', () => {
		const baseContent = JSON.stringify({
			version: 1,
			updatedAt: 1,
			items: [],
		})

		const chosen = chooseNewerCartSnapshot([
			{
				id: 'older',
				kind: CART_PERSISTENCE_KIND,
				tags: [['d', CART_PERSISTENCE_D_TAG]],
				content: baseContent,
				created_at: 100,
			} as any,
			{
				id: 'invalid',
				kind: CART_PERSISTENCE_KIND,
				tags: [['d', CART_PERSISTENCE_D_TAG]],
				content: '{"bad":true}',
				created_at: 999,
			} as any,
			{
				id: 'newer',
				kind: CART_PERSISTENCE_KIND,
				tags: [['d', CART_PERSISTENCE_D_TAG]],
				content: baseContent,
				created_at: 200,
			} as any,
		])

		expect(chosen?.id).toBe('newer')
	})

	test('invalid shipping clears while product remains', () => {
		const items = normalizeShippingForRestore(
			[
				{
					productRef: `30402:${sellerA}:product-1`,
					quantity: 2,
					shippingRef: `30406:${sellerB}:ship-1`,
				},
			],
			{
				[`30402:${sellerA}:product-1`]: {
					productRef: `30402:${sellerA}:product-1`,
					sellerPubkey: sellerA,
					productId: 'product-1',
					shippingRefs: [`30406:${sellerA}:ship-1`],
				},
			},
			{
				[`30406:${sellerB}:ship-1`]: {
					shippingRef: `30406:${sellerB}:ship-1`,
					sellerPubkey: sellerB,
				},
			},
		)

		expect(items[0]?.shippingRef).toBeUndefined()
	})

	test('missing products drop during rehydrate', () => {
		const snapshot: PersistedCartContent = {
			version: 1,
			updatedAt: 50,
			items: [
				{ productRef: `30402:${sellerA}:product-1`, quantity: 1 },
				{ productRef: `30402:${sellerB}:product-2`, quantity: 2 },
			],
		}

		const rehydrated = rehydrateCartFromLiveData(
			snapshot,
			{
				[`30402:${sellerA}:product-1`]: {
					productRef: `30402:${sellerA}:product-1`,
					sellerPubkey: sellerA,
					productId: 'product-1',
					shippingRefs: [],
				},
			},
			{},
		)

		expect(Object.keys(rehydrated.cart.products)).toEqual(['product-1'])
		expect(rehydrated.updatedAt).toBe(50)
	})

	test('serializeCartIntent sorts deterministically and excludes invalid products', () => {
		const cart: NormalizedCart = {
			sellers: {},
			products: {
				b: {
					id: 'product-b',
					amount: 2,
					shippingMethodId: `30406:${sellerB}:ship-1`,
					shippingMethodName: 'Ship B',
					shippingCost: 12,
					shippingCostCurrency: 'USD',
					sellerPubkey: sellerB,
				},
				a: {
					id: 'product-a',
					amount: 1,
					shippingMethodId: null,
					shippingMethodName: null,
					shippingCost: 0,
					shippingCostCurrency: null,
					sellerPubkey: sellerA,
				},
				invalid: {
					id: 'missing-seller',
					amount: 1,
					shippingMethodId: null,
					shippingMethodName: null,
					shippingCost: 0,
					shippingCostCurrency: null,
					sellerPubkey: '',
				},
			},
			orders: {},
			invoices: {},
		}

		const serialized = serializeCartIntent(cart)

		expect(serialized.version).toBe(1)
		expect(serialized.items.map((item) => item.productRef)).toEqual([
			`30402:${sellerA}:product-a`,
			`30402:${sellerB}:product-b`,
		])
		expect(serialized.items[1]?.shippingRef).toBe(`30406:${sellerB}:ship-1`)
	})
})
