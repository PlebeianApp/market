import { beforeEach, describe, expect, test } from 'bun:test'
import { cartActions, cartStore, cartTestUtils, type NormalizedCart } from '@/lib/stores/cart'

class MemoryStorage {
	private store = new Map<string, string>()

	getItem(key: string) {
		return this.store.has(key) ? this.store.get(key)! : null
	}

	setItem(key: string, value: string) {
		this.store.set(key, value)
	}

	removeItem(key: string) {
		this.store.delete(key)
	}

	clear() {
		this.store.clear()
	}
}

const sellerPubkey = 'a'.repeat(64)

function buildCart(productId: string = 'product-1'): NormalizedCart {
	return {
		sellers: {
			[sellerPubkey]: {
				pubkey: sellerPubkey,
				productIds: [productId],
				currency: '',
				shippingMethodId: null,
				shippingMethodName: null,
				shippingCost: 0,
				shippingCostCurrency: null,
				v4vShares: [],
			},
		},
		products: {
			[productId]: {
				id: productId,
				amount: 1,
				shippingMethodId: null,
				shippingMethodName: null,
				shippingCost: 0,
				shippingCostCurrency: null,
				sellerPubkey,
			},
		},
		orders: {},
		invoices: {},
	}
}

describe('cart store persistence orchestration', () => {
	beforeEach(() => {
		;(globalThis as any).sessionStorage = new MemoryStorage()
		cartTestUtils.resetSyncDependencies()
		cartTestUtils.setPublishDebounceMs(0)
		cartTestUtils.resetStore()
		cartTestUtils.setSyncDependencies({
			now: () => 100,
			getSigner: () => ({ user: async () => ({ pubkey: 'buyer' }) }) as any,
			getNDK: () => ({}) as any,
			getProductEvent: async (id, seller) =>
				({
					pubkey: seller ?? sellerPubkey,
					tags: [
						['d', id],
						['price', '10', 'SATS'],
						['shipping_option', `30406:${seller ?? sellerPubkey}:ship:1`],
					],
				}) as any,
			getShippingEvent: async (shippingRef) => {
				const firstSeparator = shippingRef.indexOf(':')
				const secondSeparator = shippingRef.indexOf(':', firstSeparator + 1)
				const pubkey = shippingRef.slice(firstSeparator + 1, secondSeparator)
				const dTag = shippingRef.slice(secondSeparator + 1)
				return {
					pubkey,
					tags: [
						['d', dTag],
						['price', '5', 'SATS'],
						['service', 'standard'],
					],
				} as any
			},
		})
	})

	test('local boot with no remote snapshot keeps local cart', async () => {
		const localCart = buildCart()
		;(globalThis as any).sessionStorage.setItem(
			'cart',
			JSON.stringify({
				version: 1,
				updatedAt: 200,
				cart: localCart,
			}),
		)
		cartStore.setState((state) => ({
			...state,
			cart: localCart,
			productsBySeller: {
				[sellerPubkey]: [localCart.products['product-1']],
			},
			lastCartIntentUpdatedAt: 200,
		}))

		cartTestUtils.setSyncDependencies({
			fetchLatestCartSnapshot: async () => null,
		})

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any)

		expect(Object.keys(cartStore.state.cart.products)).toEqual(['product-1'])
		expect(cartStore.state.hasRemoteCartHydrated).toBe(true)
	})

	test('empty local plus valid remote restores remote cart', async () => {
		cartTestUtils.setSyncDependencies({
			now: () => 500,
			fetchLatestCartSnapshot: async () => ({
				version: 1,
				updatedAt: 300,
				items: [
					{
						productRef: `30402:${sellerPubkey}:remote:product`,
						quantity: 2,
						shippingRef: `30406:${sellerPubkey}:ship:1`,
					},
				],
			}),
		})

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any)

		expect(cartStore.state.cart.products['remote:product']?.amount).toBe(2)
		expect(cartStore.state.cart.products['remote:product']?.shippingMethodId).toBe(`30406:${sellerPubkey}:ship:1`)
		expect(cartStore.state.lastCartIntentUpdatedAt).toBe(300)
	})

	test('user mutation schedules debounced publish', async () => {
		const published: any[] = []
		cartTestUtils.setSyncDependencies({
			publishCartSnapshot: async (snapshot) => {
				published.push(snapshot)
				return 'event-id'
			},
		})

		await cartActions.addProduct('buyer', {
			id: 'product-1',
			amount: 1,
			shippingMethodId: null,
			shippingMethodName: null,
			shippingCost: 0,
			shippingCostCurrency: null,
			sellerPubkey,
		})

		await new Promise((resolve) => setTimeout(resolve, 1))

		expect(published).toHaveLength(1)
		expect(published[0]?.items).toEqual([
			{
				productRef: `30402:${sellerPubkey}:product-1`,
				quantity: 1,
			},
		])
	})

	test('remote reconciliation does not publish', async () => {
		let publishCount = 0
		cartTestUtils.setSyncDependencies({
			fetchLatestCartSnapshot: async () => ({
				version: 1,
				updatedAt: 300,
				items: [{ productRef: `30402:${sellerPubkey}:remote-product`, quantity: 1 }],
			}),
			publishCartSnapshot: async () => {
				publishCount += 1
				return 'event-id'
			},
		})

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any)
		await new Promise((resolve) => setTimeout(resolve, 1))

		expect(publishCount).toBe(0)
	})

	test('logout clear does not publish', async () => {
		let publishCount = 0
		cartStore.setState((state) => ({
			...state,
			cart: buildCart(),
		}))
		cartTestUtils.setSyncDependencies({
			publishCartSnapshot: async () => {
				publishCount += 1
				return 'event-id'
			},
		})

		cartActions.clear({ publishRemote: false, reason: 'logout' })
		await new Promise((resolve) => setTimeout(resolve, 1))

		expect(publishCount).toBe(0)
		expect(Object.keys(cartStore.state.cart.products)).toHaveLength(0)
	})

	test('explicit clear publishes empty snapshot', async () => {
		const published: any[] = []
		cartStore.setState((state) => ({
			...state,
			cart: buildCart(),
		}))
		cartTestUtils.setSyncDependencies({
			publishCartSnapshot: async (snapshot) => {
				published.push(snapshot)
				return 'event-id'
			},
		})

		cartActions.clearForUserIntent()
		await new Promise((resolve) => setTimeout(resolve, 1))

		expect(published).toHaveLength(1)
		expect(published[0]?.items).toEqual([])
	})

	test('clear is local-only by default', async () => {
		let publishCount = 0
		cartStore.setState((state) => ({
			...state,
			cart: buildCart(),
		}))
		cartTestUtils.setSyncDependencies({
			publishCartSnapshot: async () => {
				publishCount += 1
				return 'event-id'
			},
		})

		cartActions.clear()
		await new Promise((resolve) => setTimeout(resolve, 1))

		expect(publishCount).toBe(0)
	})
})
