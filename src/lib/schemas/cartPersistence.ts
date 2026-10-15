import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	CART_PERSISTENCE_VERSION,
	MAX_PERSISTED_CART_ITEMS,
	MAX_PERSISTED_CART_ITEM_QUANTITY,
	PersistedCartContentSchema,
	PersistedCartItemSchema,
	ProductRefSchema,
	ShippingRefSchema,
	parseCartPersistenceContent,
	isValidCartProductRef,
	isValidCartShippingRef,
	isValidCartPubkey,
	type PersistedCartContent,
	type PersistedCartItem,
} from '@sdk/commerce/cart/cartIntent'

export const CART_PERSISTENCE_KIND = 30078
export const CART_PERSISTENCE_D_TAG = 'plebeian-market-cart'

export {
	CART_PERSISTENCE_VERSION,
	MAX_PERSISTED_CART_ITEMS,
	MAX_PERSISTED_CART_ITEM_QUANTITY,
	PersistedCartContentSchema,
	PersistedCartItemSchema,
	ProductRefSchema,
	ShippingRefSchema,
	parseCartPersistenceContent,
	isValidCartProductRef,
	isValidCartShippingRef,
	isValidCartPubkey,
}
export type { PersistedCartContent, PersistedCartItem }

export function getCartPersistenceDTag(event: Pick<NDKEvent, 'tags'> | null | undefined): string | undefined {
	return event?.tags.find((tag) => tag[0] === 'd')?.[1]
}

export function isCartPersistenceEvent(event: Pick<NDKEvent, 'kind' | 'tags'> | null | undefined): boolean {
	return event?.kind === CART_PERSISTENCE_KIND
}

export function isExpectedCartSnapshot(event: Pick<NDKEvent, 'kind' | 'tags'> | null | undefined): boolean {
	return isCartPersistenceEvent(event) && getCartPersistenceDTag(event) === CART_PERSISTENCE_D_TAG
}

export { normalizePersistedCart, normalizeShippingForRestore, createCartIntent } from '@sdk/commerce/cart/cartIntent'
