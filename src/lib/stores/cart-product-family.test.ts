import { beforeEach, describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { ndkActions } from '@/lib/stores/ndk'
import { cartActions, cartStore, cartTestUtils, type CartProduct, type NormalizedCart } from '@/lib/stores/cart'

class MemoryStorage {
	private store = new Map<string, string>()
	getItem(key: string) {
		return this.store.get(key) ?? null
	}
	setItem(key: string, value: string) {
		this.store.set(key, value)
	}
	removeItem(key: string) {
		this.store.delete(key)
	}
}

const SELLER = 'a'.repeat(64)
const CHILD_D_TAG = 'shirt-small'
const PARENT_D_TAG = 'shirt'
const HEX_D_TAG = 'b'.repeat(64)
const SHIPPING_REF = `30406:${SELLER}:standard`

const child = {
	id: 'child-event',
	kind: 30402,
	pubkey: SELLER,
	created_at: 2,
	content: '',
	tags: [
		['d', CHILD_D_TAG],
		['type', 'variation', 'physical'],
		['a', `30402:${SELLER}:${PARENT_D_TAG}`],
		['price', '800', 'SAT'],
		['stock', '2'],
	],
} as any

const parent = {
	id: 'parent-event',
	kind: 30402,
	pubkey: SELLER,
	created_at: 1,
	content: '',
	tags: [
		['d', PARENT_D_TAG],
		['type', 'variable', 'physical'],
		['price', '999', 'SAT'],
		['stock', '0'],
		['shipping_option', SHIPPING_REF],
		['image', 'https://example.com/parent.jpg'],
	],
} as any

const shipping = {
	id: 'shipping-event',
	kind: 30406,
	pubkey: SELLER,
	created_at: 1,
	content: '',
	tags: [
		['d', 'standard'],
		['title', 'Standard shipping'],
		['price', '50', 'SAT'],
		['country', 'US'],
		['service', 'standard'],
	],
} as any

const cartProduct: CartProduct = {
	id: CHILD_D_TAG,
	amount: 1,
	shippingMethodId: null,
	shippingMethodName: null,
	shippingCost: 0,
	shippingCostCurrency: null,
	sellerPubkey: SELLER,
}

const cart: NormalizedCart = {
	sellers: {
		[SELLER]: {
			pubkey: SELLER,
			productIds: [CHILD_D_TAG],
			currency: '',
			shippingMethodId: null,
			shippingMethodName: null,
			shippingCost: 0,
			shippingCostCurrency: null,
			v4vShares: [],
		},
	},
	products: { [CHILD_D_TAG]: cartProduct },
	orders: {},
	invoices: {},
}

describe('cart product-family fallback', () => {
	beforeEach(() => {
		;(globalThis as any).sessionStorage = new MemoryStorage()
		cartTestUtils.resetSyncDependencies()
		cartTestUtils.resetStore()
		cartStore.setState((state) => ({
			...state,
			cart,
			productsBySeller: { [SELLER]: [cartProduct] },
		}))
		cartTestUtils.setSyncDependencies({
			getProductEvent: async (id, sellerPubkey) => {
				if (sellerPubkey !== SELLER) return null
				if (id === CHILD_D_TAG) return child
				if (id === PARENT_D_TAG) return parent
				return null
			},
			getShippingEvent: async (reference) => (reference === SHIPPING_REF ? shipping : null),
		})
	})

	test('inherits parent-only shipping while retaining the child cart key', async () => {
		const options = await cartActions.fetchAvailableShippingOptions(CHILD_D_TAG)

		expect(options).toHaveLength(1)
		expect(options[0]).toMatchObject({ id: SHIPPING_REF, name: 'Standard shipping', cost: 50, currency: 'SAT' })
		expect(Object.keys(cartStore.state.cart.products)).toEqual([CHILD_D_TAG])

		await cartActions.fetchAndSetSellerShippingOptions()
		expect(cartStore.state.sellerShippingOptions[SELLER]?.[0]).toMatchObject({ id: SHIPPING_REF, cost: 50 })
	})

	test('cart selection resolves a 64-hex d-tag by exact seller coordinate', async () => {
		const product = {
			id: 'c'.repeat(64),
			kind: 30402,
			pubkey: SELLER,
			created_at: 3,
			content: '',
			tags: [
				['d', HEX_D_TAG],
				['type', 'simple', 'physical'],
				['stock', '1'],
			],
		} as unknown as NDKEvent
		const requestedAddresses: unknown[] = []
		const realGetNDK = ndkActions.getNDK

		try {
			;(ndkActions as { getNDK: () => unknown }).getNDK = () => ({
				fetchEvent: async (address: unknown) => {
					requestedAddresses.push(address)
					return product
				},
			})
			cartTestUtils.resetSyncDependencies()

			const selection = await cartTestUtils.getProductSelection(HEX_D_TAG, SELLER)

			expect(requestedAddresses).toHaveLength(1)
			expect(requestedAddresses[0]).not.toBe(HEX_D_TAG)
			expect(String(requestedAddresses[0]).startsWith('naddr1')).toBe(true)
			expect(selection?.selected.pubkey).toBe(SELLER)
			expect(selection?.selected.kind).toBe(30402)
			expect(selection?.selected.tags.find((tag) => tag[0] === 'd')?.[1]).toBe(HEX_D_TAG)
		} finally {
			;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
		}
	})

	test('does not add a variation when its declared parent cannot be fetched', async () => {
		cartStore.setState((state) => ({
			...state,
			cart: { sellers: {}, products: {}, orders: {}, invoices: {} },
			productsBySeller: {},
		}))
		cartTestUtils.setSyncDependencies({
			getProductEvent: async (id, sellerPubkey) => (id === CHILD_D_TAG && sellerPubkey === SELLER ? child : null),
		})

		const added = await cartActions.addProduct({ ...cartProduct })

		expect(added).toBe(false)
		expect(cartStore.state.cart.products).toEqual({})
		expect(cartStore.state.cart.sellers).toEqual({})
	})

	test('does not add a variation when its declared parent read fails', async () => {
		cartStore.setState((state) => ({
			...state,
			cart: { sellers: {}, products: {}, orders: {}, invoices: {} },
			productsBySeller: {},
		}))
		cartTestUtils.setSyncDependencies({
			getProductEvent: async (id, sellerPubkey) => {
				if (id === CHILD_D_TAG && sellerPubkey === SELLER) return child
				if (id === PARENT_D_TAG && sellerPubkey === SELLER) throw new Error('synthetic parent read failure')
				return null
			},
		})

		const added = await cartActions.addProduct({ ...cartProduct })

		expect(added).toBe(false)
		expect(cartStore.state.cart.products).toEqual({})
		expect(await cartActions.fetchAvailableShippingOptions(CHILD_D_TAG)).toEqual([])
	})

	test('does not add a variable container as a purchasable cart item', async () => {
		cartStore.setState((state) => ({
			...state,
			cart: { sellers: {}, products: {}, orders: {}, invoices: {} },
			productsBySeller: {},
		}))

		const added = await cartActions.addProduct({
			...cartProduct,
			id: PARENT_D_TAG,
		})

		expect(added).toBe(false)
		expect(cartStore.state.cart.products).toEqual({})
		expect(cartStore.state.cart.sellers).toEqual({})
	})
})
