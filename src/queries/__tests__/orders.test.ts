import { describe, test, expect, mock } from 'bun:test'
import { orderRequiresStockUpdate } from '../orders'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

// Mock the fetchProductByATag function
const mockFetchProductByATag = mock(async (pubkey: string, dTag: string) => {
	// Return different product types based on the dTag
	if (dTag === 'physical-product-1') {
		return {
			id: 'event1',
			pubkey: pubkey,
			kind: 30402,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', dTag],
				['title', 'Physical Product'],
				['type', 'simple', 'physical'],
			],
			content: 'Physical product description',
			sig: 'signature',
		} as NDKEvent
	} else if (dTag === 'digital-product-1') {
		return {
			id: 'event2',
			pubkey: pubkey,
			kind: 30402,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', dTag],
				['title', 'Digital Product'],
				['type', 'simple', 'digital'],
			],
			content: 'Digital product description',
			sig: 'signature',
		} as NDKEvent
	} else if (dTag === 'no-type-product') {
		return {
			id: 'event3',
			pubkey: pubkey,
			kind: 30402,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', dTag],
				['title', 'No Type Product'],
			],
			content: 'Product without type tag',
			sig: 'signature',
		} as NDKEvent
	}
	return null
})

// Mock the fetchProduct function
const mockFetchProduct = mock(async (id: string) => {
	if (id === 'event4') {
		return {
			id: id,
			pubkey: 'pubkey1',
			kind: 30402,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', 'legacy-product'],
				['title', 'Legacy Physical Product'],
				['type', 'simple', 'physical'],
			],
			content: 'Legacy physical product description',
			sig: 'signature',
		} as NDKEvent
	}
	return null
})

// Mock the module imports
mock.module('@/queries/products', () => ({
	fetchProductByATag: mockFetchProductByATag,
	fetchProduct: mockFetchProduct,
}))

describe('orderRequiresStockUpdate', () => {
	test('Item is a physical product -> returns true', async () => {
		const order = {
			order: {
				id: 'order1',
				pubkey: 'buyerPubkey',
				kind: 16,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['type', '1'],
					['order', 'order123'],
					['amount', '1000'],
					['item', '30402:pubkey1:physical-product-1', '1'],
				],
				content: 'Order with physical product',
				sig: 'signature',
			},
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		const result = await orderRequiresStockUpdate(order as any)
		expect(result).toBe(true)
	})

	test('Item is a digital product -> returns false', async () => {
		const order = {
			order: {
				id: 'order2',
				pubkey: 'buyerPubkey',
				kind: 16,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['type', '1'],
					['order', 'order124'],
					['amount', '500'],
					['item', '30402:pubkey1:digital-product-1', '1'],
				],
				content: 'Order with digital product',
				sig: 'signature',
			},
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		const result = await orderRequiresStockUpdate(order as any)
		expect(result).toBe(false)
	})

	test('2 Items, one digital, one physical -> returns true', async () => {
		const order = {
			order: {
				id: 'order3',
				pubkey: 'buyerPubkey',
				kind: 16,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['type', '1'],
					['order', 'order125'],
					['amount', '1500'],
					['item', '30402:pubkey1:digital-product-1', '1'],
					['item', '30402:pubkey1:physical-product-1', '2'],
				],
				content: 'Order with mixed products',
				sig: 'signature',
			},
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		const result = await orderRequiresStockUpdate(order as any)
		expect(result).toBe(true)
	})

	test('Item is not a recognized type -> default to true', async () => {
		const order = {
			order: {
				id: 'order4',
				pubkey: 'buyerPubkey',
				kind: 16,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['type', '1'],
					['order', 'order126'],
					['amount', '750'],
					['item', '30402:pubkey1:no-type-product', '1'],
				],
				content: 'Order with product without type tag',
				sig: 'signature',
			},
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		const result = await orderRequiresStockUpdate(order as any)
		expect(result).toBe(true)
	})

	test('Order with no items -> returns false', async () => {
		const order = {
			order: {
				id: 'order5',
				pubkey: 'buyerPubkey',
				kind: 16,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['type', '1'],
					['order', 'order127'],
					['amount', '0'],
				],
				content: 'Order with no items',
				sig: 'signature',
			},
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		const result = await orderRequiresStockUpdate(order as any)
		expect(result).toBe(false)
	})

	test('Order with invalid product reference -> defaults to false', async () => {
		const order = {
			order: {
				id: 'order6',
				pubkey: 'buyerPubkey',
				kind: 16,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['type', '1'],
					['order', 'order128'],
					['amount', '1000'],
					['item', 'invalid-ref', '1'],
				],
				content: 'Order with invalid product reference',
				sig: 'signature',
			},
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		const result = await orderRequiresStockUpdate(order as any)
		expect(result).toBe(false)
	})
})
