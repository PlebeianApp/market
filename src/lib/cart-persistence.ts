import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NormalizedCart } from '@/lib/stores/cart'
import { isExpectedCartSnapshot } from '@/lib/schemas/cartPersistence'
import {
	createCartIntent,
	normalizePersistedCart,
	normalizeShippingForRestore,
	parseCartPersistenceContent,
	type BuyerCartProductInput,
	type LiveProductRecord,
	type LiveShippingRecord,
	type PersistedCartContent,
} from '@sdk/commerce/cart/cartIntent'

export { normalizePersistedCart, normalizeShippingForRestore }

type ApplicationLiveProductRecord = LiveProductRecord
type ApplicationLiveShippingRecord = LiveShippingRecord

export interface RehydratedCart {
	cart: NormalizedCart
	updatedAt: number
}

function compareStrings(a: string, b: string): number {
	if (a < b) return -1
	if (a > b) return 1
	return 0
}

/** App-state adapter: converts the UI/store cart shape into an SDK cart intent. */
export function serializeCartIntent(cart: NormalizedCart): PersistedCartContent {
	const products: BuyerCartProductInput[] = Object.values(cart.products).map((product) => ({
		id: product.id,
		amount: product.amount,
		shippingMethodId: product.shippingMethodId,
		sellerPubkey: product.sellerPubkey,
	}))
	return createCartIntent(products)
}

/** Nostr event selection is kept in the application adapter, outside the SDK. */
export function chooseNewerCartSnapshot(events: Array<Pick<NDKEvent, 'kind' | 'tags' | 'content' | 'created_at' | 'id'>>): NDKEvent | null {
	const validEvents = events.filter((event): event is NDKEvent => {
		if (!isExpectedCartSnapshot(event)) return false
		return parseCartPersistenceContent(event.content) !== null
	})

	if (validEvents.length === 0) return null

	validEvents.sort((a, b) => {
		const byCreatedAt = (b.created_at || 0) - (a.created_at || 0)
		if (byCreatedAt !== 0) return byCreatedAt
		return compareStrings(b.id || '', a.id || '')
	})

	return validEvents[0] ?? null
}

/** Converts normalized SDK cart intent into the existing app store model. */
export function rehydrateCartFromLiveData(
	snapshot: PersistedCartContent,
	liveProducts: Record<string, ApplicationLiveProductRecord>,
	liveShipping: Record<string, ApplicationLiveShippingRecord>,
): RehydratedCart {
	const normalized = normalizePersistedCart(snapshot)
	const items = normalizeShippingForRestore(normalized.items, liveProducts, liveShipping)
	const cart: NormalizedCart = {
		sellers: {},
		products: {},
		orders: {},
		invoices: {},
	}

	for (const item of items) {
		const product = liveProducts[item.productRef]
		if (!product) continue

		cart.products[product.productId] = {
			id: product.productId,
			amount: item.quantity,
			shippingMethodId: item.shippingRef ?? null,
			shippingMethodName: null,
			shippingCost: 0,
			shippingCostCurrency: null,
			sellerPubkey: product.sellerPubkey,
		}

		if (!cart.sellers[product.sellerPubkey]) {
			cart.sellers[product.sellerPubkey] = {
				pubkey: product.sellerPubkey,
				productIds: [],
				currency: '',
				shippingMethodId: null,
				shippingMethodName: null,
				shippingCost: 0,
				shippingCostCurrency: null,
				v4vShares: [],
			}
		}

		cart.sellers[product.sellerPubkey].productIds.push(product.productId)
	}

	for (const seller of Object.values(cart.sellers)) {
		const shippingRefs = seller.productIds
			.map((productId) => cart.products[productId]?.shippingMethodId)
			.filter((shippingRef): shippingRef is string => !!shippingRef)
		const uniqueShippingRefs = Array.from(new Set(shippingRefs))
		if (uniqueShippingRefs.length === 1) seller.shippingMethodId = uniqueShippingRefs[0]
	}

	return { cart, updatedAt: normalized.updatedAt }
}
