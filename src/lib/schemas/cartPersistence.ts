import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { z } from 'zod'

export const CART_PERSISTENCE_KIND = 30078
export const CART_PERSISTENCE_D_TAG = 'plebeian-market-cart'
export const CART_PERSISTENCE_VERSION = 1 as const

export const MAX_PERSISTED_CART_ITEMS = 100
export const MAX_PERSISTED_CART_ITEM_QUANTITY = 999

const HEX_64_REGEX = /^[a-f0-9]{64}$/i
const PRODUCT_REF_REGEX = /^30402:[a-f0-9]{64}:[^\s]+$/i
const SHIPPING_REF_REGEX = /^30406:[a-f0-9]{64}:[^\s]+$/i

export const ProductRefSchema = z.string().trim().regex(PRODUCT_REF_REGEX, 'Invalid product reference')
export const ShippingRefSchema = z.string().trim().regex(SHIPPING_REF_REGEX, 'Invalid shipping reference')

export const PersistedCartItemSchema = z
	.object({
		productRef: ProductRefSchema,
		quantity: z.number().int().min(1).max(MAX_PERSISTED_CART_ITEM_QUANTITY),
		shippingRef: ShippingRefSchema.nullish(),
	})
	.strip()

export const PersistedCartContentSchema = z
	.object({
		version: z.literal(CART_PERSISTENCE_VERSION),
		updatedAt: z.number().int().positive(),
		items: z.array(PersistedCartItemSchema).max(MAX_PERSISTED_CART_ITEMS),
	})
	.strip()

export type PersistedCartItem = z.infer<typeof PersistedCartItemSchema>
export type PersistedCartContent = z.infer<typeof PersistedCartContentSchema>

export function getCartPersistenceDTag(event: Pick<NDKEvent, 'tags'> | null | undefined): string | undefined {
	return event?.tags.find((tag) => tag[0] === 'd')?.[1]
}

export function isCartPersistenceEvent(event: Pick<NDKEvent, 'kind' | 'tags'> | null | undefined): boolean {
	return event?.kind === CART_PERSISTENCE_KIND
}

export function isExpectedCartSnapshot(event: Pick<NDKEvent, 'kind' | 'tags'> | null | undefined): boolean {
	return isCartPersistenceEvent(event) && getCartPersistenceDTag(event) === CART_PERSISTENCE_D_TAG
}

export function parseCartPersistenceContent(content: string): PersistedCartContent | null {
	try {
		return PersistedCartContentSchema.parse(JSON.parse(content))
	} catch {
		return null
	}
}

export function isValidCartProductRef(value: string): boolean {
	return ProductRefSchema.safeParse(value).success
}

export function isValidCartShippingRef(value: string): boolean {
	return ShippingRefSchema.safeParse(value).success
}

export function isValidCartPubkey(value: string): boolean {
	return HEX_64_REGEX.test(value)
}
