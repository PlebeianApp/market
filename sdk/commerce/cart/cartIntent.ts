import { z } from 'zod'

export const CART_PERSISTENCE_VERSION = 1 as const
export const MAX_PERSISTED_CART_ITEMS = 100
export const MAX_PERSISTED_CART_ITEM_QUANTITY = 999

const PRODUCT_REF_REGEX = /^30402:[a-f0-9]{64}:[^\s]+$/i
const SHIPPING_REF_REGEX = /^30406:[a-f0-9]{64}:[^\s]+$/i
const HEX_64_REGEX = /^[a-f0-9]{64}$/i

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

export interface BuyerCartProductInput {
	id: string
	amount: number
	shippingMethodId?: string | null
	sellerPubkey: string
}

export interface LiveProductRecord {
	productRef: string
	sellerPubkey: string
	productId: string
	shippingRefs: string[]
}

export interface LiveShippingRecord {
	shippingRef: string
	sellerPubkey: string
}

function clampQuantity(quantity: number): number {
	return Math.min(Math.max(Math.floor(quantity), 1), MAX_PERSISTED_CART_ITEM_QUANTITY)
}

function compareStrings(a: string, b: string): number {
	if (a < b) return -1
	if (a > b) return 1
	return 0
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

export function parseCartPersistenceContent(content: string): PersistedCartContent | null {
	try {
		return PersistedCartContentSchema.parse(JSON.parse(content))
	} catch {
		return null
	}
}

export function createCartIntent(products: readonly BuyerCartProductInput[], updatedAtMs = Date.now()): PersistedCartContent {
	const items: PersistedCartItem[] = []
	for (const product of products) {
		if (!product.id || !product.sellerPubkey) continue
		const productRef = `30402:${product.sellerPubkey}:${product.id}`
		if (!isValidCartProductRef(productRef)) continue
		const shippingRef = product.shippingMethodId && isValidCartShippingRef(product.shippingMethodId) ? product.shippingMethodId : undefined

		items.push({
			productRef,
			quantity: clampQuantity(product.amount),
			...(shippingRef ? { shippingRef } : {}),
		})
	}
	items.sort((a, b) => compareStrings(a.productRef, b.productRef))
	items.splice(MAX_PERSISTED_CART_ITEMS)

	return {
		version: CART_PERSISTENCE_VERSION,
		updatedAt: Math.floor(updatedAtMs / 1000),
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
		if (existing === undefined) sellerSelections.set(product.sellerPubkey, shippingRef)
		else if (existing !== shippingRef) sellerSelections.set(product.sellerPubkey, null)

		return { ...item, shippingRef }
	})

	return prelim.map((item) => {
		const product = liveProducts[item.productRef]
		if (!product || !item.shippingRef) return item
		if (sellerSelections.get(product.sellerPubkey) === null) return { ...item, shippingRef: undefined }
		return item
	})
}
