import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NormalizedCart } from '@/lib/stores/cart'
import {
	CART_PERSISTENCE_KIND,
	CART_PERSISTENCE_VERSION,
	MAX_PERSISTED_CART_ITEMS,
	MAX_PERSISTED_CART_ITEM_QUANTITY,
	parseCartPersistenceContent,
	isExpectedCartSnapshot,
	isValidCartProductRef,
	isValidCartShippingRef,
	type PersistedCartContent,
	type PersistedCartItem,
} from '@/lib/schemas/cartPersistence'

type LiveProductRecord = {
	productRef: string
	sellerPubkey: string
	productId: string
	shippingRefs: string[]
}

type LiveShippingRecord = {
	shippingRef: string
	sellerPubkey: string
}

export interface RehydratedCart {
	cart: NormalizedCart
	updatedAt: number
}

function clampQuantity(quantity: number): number {
	return Math.min(Math.max(Math.floor(quantity), 1), MAX_PERSISTED_CART_ITEM_QUANTITY)
}

function compareStrings(a: string, b: string): number {
	if (a < b) return -1
	if (a > b) return 1
	return 0
}

export function serializeCartIntent(cart: NormalizedCart): PersistedCartContent {
	const items = Object.values(cart.products)
		.map((product) => {
			if (!product.id || !product.sellerPubkey) return null
			const productRef = `30402:${product.sellerPubkey}:${product.id}`
			if (!isValidCartProductRef(productRef)) return null
			const shippingRef =
				product.shippingMethodId && isValidCartShippingRef(product.shippingMethodId) ? product.shippingMethodId : undefined

			return {
				productRef,
				quantity: clampQuantity(product.amount),
				...(shippingRef ? { shippingRef } : {}),
			} satisfies PersistedCartItem
		})
		.filter((item): item is PersistedCartItem => item !== null)
		.sort((a, b) => compareStrings(a.productRef, b.productRef))
		.slice(0, MAX_PERSISTED_CART_ITEMS)

	return {
		version: CART_PERSISTENCE_VERSION,
		updatedAt: Math.floor(Date.now() / 1000),
		items,
	}
}

export function normalizePersistedCart(content: PersistedCartContent): PersistedCartContent {
	const deduped = new Map<string, PersistedCartItem>()

	for (const rawItem of content.items) {
		if (!isValidCartProductRef(rawItem.productRef)) continue

		deduped.set(rawItem.productRef, {
			productRef: rawItem.productRef,
			quantity: clampQuantity(rawItem.quantity),
			shippingRef: rawItem.shippingRef && isValidCartShippingRef(rawItem.shippingRef) ? rawItem.shippingRef : undefined,
		})
	}

	const items = Array.from(deduped.values())
		.sort((a, b) => compareStrings(a.productRef, b.productRef))
		.slice(0, MAX_PERSISTED_CART_ITEMS)

	return {
		version: CART_PERSISTENCE_VERSION,
		updatedAt: Math.max(1, Math.floor(content.updatedAt)),
		items,
	}
}

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

export function normalizeShippingForRestore(
	items: PersistedCartItem[],
	liveProducts: Record<string, LiveProductRecord>,
	liveShipping: Record<string, LiveShippingRecord>,
): PersistedCartItem[] {
	const sellerSelections = new Map<string, string | null>()

	const prelim = items.map((item) => {
		const product = liveProducts[item.productRef]
		if (!product) return { ...item, shippingRef: undefined }

		const shippingRef = item.shippingRef
		if (!shippingRef) return { ...item, shippingRef: undefined }

		const shipping = liveShipping[shippingRef]
		const validForProduct = product.shippingRefs.includes(shippingRef)
		const sameSeller = shipping?.sellerPubkey === product.sellerPubkey

		if (!shipping || !validForProduct || !sameSeller) {
			return { ...item, shippingRef: undefined }
		}

		const existing = sellerSelections.get(product.sellerPubkey)
		if (existing === undefined) {
			sellerSelections.set(product.sellerPubkey, shippingRef)
		} else if (existing !== shippingRef) {
			sellerSelections.set(product.sellerPubkey, null)
		}

		return { ...item, shippingRef }
	})

	return prelim.map((item) => {
		const product = liveProducts[item.productRef]
		if (!product || !item.shippingRef) return item
		if (sellerSelections.get(product.sellerPubkey) === null) {
			return { ...item, shippingRef: undefined }
		}
		return item
	})
}

export function rehydrateCartFromLiveData(
	snapshot: PersistedCartContent,
	liveProducts: Record<string, LiveProductRecord>,
	liveShipping: Record<string, LiveShippingRecord>,
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
			amount: clampQuantity(item.quantity),
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
		const sellerShippingRefs = seller.productIds
			.map((productId) => cart.products[productId]?.shippingMethodId)
			.filter((shippingRef): shippingRef is string => !!shippingRef)

		const uniqueShippingRefs = Array.from(new Set(sellerShippingRefs))
		if (uniqueShippingRefs.length === 1) {
			seller.shippingMethodId = uniqueShippingRefs[0]
		}
	}

	return {
		cart,
		updatedAt: normalized.updatedAt,
	}
}
