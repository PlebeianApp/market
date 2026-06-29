import { beforeEach, describe, expect, test } from 'bun:test'
import { cartActions, cartStore, cartTestUtils, type NormalizedCart, type CartProduct } from '@/lib/stores/cart'

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

// ---------------------------------------------------------------------------
// Helpers shared across guest-cart tests
// ---------------------------------------------------------------------------

const seller = 'a'.repeat(64)
const seller2 = 'b'.repeat(64)

function makeProduct(id: string, amount: number, sellerPubkey = seller, shippingMethodId: string | null = null): CartProduct {
	return { id, amount, sellerPubkey, shippingMethodId, shippingMethodName: null, shippingCost: 0, shippingCostCurrency: null }
}

function makeCart(products: CartProduct[]): NormalizedCart {
	const cart: NormalizedCart = { sellers: {}, products: {}, orders: {}, invoices: {} }
	for (const p of products) {
		cart.products[p.id] = p
		if (!cart.sellers[p.sellerPubkey]) {
			cart.sellers[p.sellerPubkey] = {
				pubkey: p.sellerPubkey,
				productIds: [],
				currency: '',
				shippingMethodId: null,
				shippingMethodName: null,
				shippingCost: 0,
				shippingCostCurrency: null,
				v4vShares: [],
			}
		}
		cart.sellers[p.sellerPubkey].productIds.push(p.id)
	}
	return cart
}

// Shared dependency stubs for all guest-cart tests.
function guestTestDeps(fetchLatestCartSnapshot: () => Promise<any>) {
	return {
		now: () => 1000,
		fetchLatestCartSnapshot,
		publishCartSnapshot: async () => 'snap-id',
		getSigner: () => ({ user: async () => ({ pubkey: 'buyer' }) }) as any,
		getNDK: () => ({}) as any,
		// Product event: d-tag = id, two shipping options so tests can pick either.
		getProductEvent: async (id: string, sellerPubkey?: string) =>
			({
				pubkey: sellerPubkey ?? seller,
				tags: [
					['d', id],
					['price', '10', 'SATS'],
					['shipping_option', `30406:${sellerPubkey ?? seller}:ship-a`],
					['shipping_option', `30406:${sellerPubkey ?? seller}:ship-b`],
				],
			}) as any,
		getShippingEvent: async (ref: string) => {
			const parts = ref.split(':')
			return {
				pubkey: parts[1],
				tags: [
					['d', parts[2]],
					['price', '5', 'SATS'],
				],
			} as any
		},
	}
}

// ---------------------------------------------------------------------------
// mergeGuestWithRemote unit tests
// ---------------------------------------------------------------------------

describe('mergeGuestWithRemote', () => {
	test('guest-only products are kept unchanged', () => {
		const guest = makeCart([makeProduct('g-1', 2), makeProduct('g-2', 1)])
		const remote = makeCart([])
		const merged = cartActions.mergeGuestWithRemote(guest, remote)
		expect(Object.keys(merged.products)).toEqual(['g-1', 'g-2'])
		expect(merged.products['g-1'].amount).toBe(2)
		expect(merged.products['g-2'].amount).toBe(1)
	})

	test('remote-only products are not added to the merged cart', () => {
		const guest = makeCart([makeProduct('g-1', 2)])
		const remote = makeCart([makeProduct('g-1', 1), makeProduct('r-only', 5)])
		const merged = cartActions.mergeGuestWithRemote(guest, remote)
		expect(Object.keys(merged.products)).toEqual(['g-1'])
		expect(merged.products['r-only']).toBeUndefined()
	})

	test('overlapping product quantities are summed', () => {
		const guest = makeCart([makeProduct('shared', 2)])
		const remote = makeCart([makeProduct('shared', 3)])
		const merged = cartActions.mergeGuestWithRemote(guest, remote)
		expect(merged.products['shared'].amount).toBe(5)
	})

	test('guest shipping selection is preserved for overlapping products', () => {
		const guest = makeCart([makeProduct('shared', 2, seller, `30406:${seller}:ship-a`)])
		const remote = makeCart([makeProduct('shared', 3, seller, `30406:${seller}:ship-b`)])
		const merged = cartActions.mergeGuestWithRemote(guest, remote)
		expect(merged.products['shared'].shippingMethodId).toBe(`30406:${seller}:ship-a`)
	})

	test('sellers map is taken from guest, not remote', () => {
		const guest = makeCart([makeProduct('g-1', 1, seller)])
		const remote = makeCart([makeProduct('g-1', 1, seller2)])
		const merged = cartActions.mergeGuestWithRemote(guest, remote)
		expect(Object.keys(merged.sellers)).toContain(seller)
		expect(Object.keys(merged.sellers)).not.toContain(seller2)
	})
})

// ---------------------------------------------------------------------------
// reconcileRemoteCartForUser – guest session (wasLoggedOut = true)
// ---------------------------------------------------------------------------

describe('reconcileRemoteCartForUser – guest session', () => {
	beforeEach(() => {
		;(globalThis as any).sessionStorage = new MemoryStorage()
		cartTestUtils.resetSyncDependencies()
		cartTestUtils.setPublishDebounceMs(0)
		cartTestUtils.resetStore()
	})

	test('guest cart is preserved when remote is empty', async () => {
		const guestCart = makeCart([makeProduct('g-1', 2)])
		cartStore.setState((s) => ({ ...s, cart: guestCart, lastCartIntentUpdatedAt: 500 }))
		cartTestUtils.setSyncDependencies(guestTestDeps(async () => null))

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, true)

		expect(cartStore.state.cart.products['g-1'].amount).toBe(2)
		expect(cartStore.state.hasRemoteCartHydrated).toBe(true)
	})

	test('empty guest cart adopts remote when wasLoggedOut', async () => {
		cartTestUtils.setSyncDependencies(
			guestTestDeps(async () => ({
				version: 1,
				updatedAt: 300,
				items: [{ productRef: `30402:${seller}:remote-p`, quantity: 4 }],
			})),
		)

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, true)

		expect(cartStore.state.cart.products['remote-p']?.amount).toBe(4)
	})

	test('overlapping product quantities are summed on login', async () => {
		const guestCart = makeCart([makeProduct('shared', 2)])
		cartStore.setState((s) => ({ ...s, cart: guestCart, lastCartIntentUpdatedAt: 100 }))

		cartTestUtils.setSyncDependencies(
			guestTestDeps(async () => ({
				version: 1,
				updatedAt: 999,
				items: [{ productRef: `30402:${seller}:shared`, quantity: 3 }],
			})),
		)

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, true)

		expect(cartStore.state.cart.products['shared'].amount).toBe(5)
	})

	test('remote-only products are not added to the guest cart', async () => {
		const guestCart = makeCart([makeProduct('g-only', 1)])
		cartStore.setState((s) => ({ ...s, cart: guestCart, lastCartIntentUpdatedAt: 100 }))

		cartTestUtils.setSyncDependencies(
			guestTestDeps(async () => ({
				version: 1,
				updatedAt: 999,
				items: [
					{ productRef: `30402:${seller}:g-only`, quantity: 1 },
					{ productRef: `30402:${seller}:remote-only`, quantity: 5 },
				],
			})),
		)

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, true)

		expect(cartStore.state.cart.products['g-only']).toBeDefined()
		expect(cartStore.state.cart.products['remote-only']).toBeUndefined()
	})

	test('guest shipping selection is not overwritten by remote shipping', async () => {
		const guestCart = makeCart([makeProduct('shared', 1, seller, `30406:${seller}:ship-a`)])
		cartStore.setState((s) => ({ ...s, cart: guestCart, lastCartIntentUpdatedAt: 100 }))

		cartTestUtils.setSyncDependencies(
			guestTestDeps(async () => ({
				version: 1,
				updatedAt: 999,
				items: [{ productRef: `30402:${seller}:shared`, quantity: 2, shippingRef: `30406:${seller}:ship-b` }],
			})),
		)

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, true)

		expect(cartStore.state.cart.products['shared'].shippingMethodId).toBe(`30406:${seller}:ship-a`)
	})

	test('guest cart is published after login even when remote has a newer timestamp', async () => {
		const published: any[] = []
		const guestCart = makeCart([makeProduct('g-1', 1)])
		cartStore.setState((s) => ({ ...s, cart: guestCart, lastCartIntentUpdatedAt: 50 }))

		cartTestUtils.setSyncDependencies({
			...guestTestDeps(async () => ({
				version: 1,
				updatedAt: 9999, // remote is much newer
				items: [{ productRef: `30402:${seller}:remote-p`, quantity: 10 }],
			})),
			publishCartSnapshot: async (snapshot) => {
				published.push(snapshot)
				return 'snap-id'
			},
		})

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, true)
		await new Promise((r) => setTimeout(r, 1))

		// Guest cart was published (not silently discarded)
		expect(published.length).toBeGreaterThan(0)
		// Guest item still present; remote-only item absent
		expect(cartStore.state.cart.products['g-1']).toBeDefined()
		expect(cartStore.state.cart.products['remote-p']).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// reconcileRemoteCartForUser – auto-login (wasLoggedOut = false, default)
// ---------------------------------------------------------------------------

describe('reconcileRemoteCartForUser – auto-login', () => {
	beforeEach(() => {
		;(globalThis as any).sessionStorage = new MemoryStorage()
		cartTestUtils.resetSyncDependencies()
		cartTestUtils.setPublishDebounceMs(0)
		cartTestUtils.resetStore()
	})

	test('newer remote cart is adopted when local is older', async () => {
		const localCart = makeCart([makeProduct('local-p', 1)])
		cartStore.setState((s) => ({ ...s, cart: localCart, lastCartIntentUpdatedAt: 100 }))

		cartTestUtils.setSyncDependencies(
			guestTestDeps(async () => ({
				version: 1,
				updatedAt: 999, // remote is newer
				items: [{ productRef: `30402:${seller}:remote-p`, quantity: 7 }],
			})),
		)

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, false)

		expect(cartStore.state.cart.products['remote-p']?.amount).toBe(7)
	})

	test('local cart is kept when it is newer than remote', async () => {
		const localCart = makeCart([makeProduct('local-p', 3)])
		cartStore.setState((s) => ({ ...s, cart: localCart, lastCartIntentUpdatedAt: 9999 }))

		cartTestUtils.setSyncDependencies(
			guestTestDeps(async () => ({
				version: 1,
				updatedAt: 100, // remote is older
				items: [{ productRef: `30402:${seller}:remote-p`, quantity: 1 }],
			})),
		)

		await cartActions.reconcileRemoteCartForUser('buyer', {} as any, {} as any, false)

		expect(cartStore.state.cart.products['local-p']?.amount).toBe(3)
		expect(cartStore.state.cart.products['remote-p']).toBeUndefined()
	})
})
