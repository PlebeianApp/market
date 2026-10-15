import { isValidCartPubkey, MAX_PERSISTED_CART_ITEM_QUANTITY } from './cartIntent'

export interface CartProductEntry {
	id: string
	amount: number
	sellerPubkey: string
}

export type CartQuantityAction = 'increment' | 'decrement' | 'setAmount' | 'remove'

export interface CartProductTotalsInput {
	subtotalInSats: number
	shippingInSats: number
	totalInSats?: number
	subtotalInCurrency: number
	shippingInCurrency: number
	totalInCurrency?: number
	currency: string
}

export interface BuyerCartTotals {
	subtotalInSats: number
	shippingInSats: number
	totalInSats: number
	currencyTotals: Record<string, { subtotal: number; shipping: number; total: number }>
}

export interface CartDisplayTotals {
	totalInSats: number
	totalShippingInSats: number
	subtotalByCurrency: Record<string, number>
	shippingByCurrency: Record<string, number>
	totalByCurrency: Record<string, number>
}

/** Normalize a requested quantity to an integer in the supported cart range. */
export function normalizeCartQuantity(quantity: number): number | null {
	if (!Number.isFinite(quantity)) return null
	return Math.min(Math.max(Math.floor(quantity), 0), MAX_PERSISTED_CART_ITEM_QUANTITY)
}

/** Add a product or increase the existing product's quantity, preserving its other fields. */
export function addCartProduct<T extends CartProductEntry>(products: Record<string, T>, product: T): Record<string, T> {
	const increment = normalizeCartQuantity(product.amount)
	if (!product.id || !product.sellerPubkey || increment === null || increment === 0) return products

	const existing = products[product.id]
	const nextQuantity = Math.min((existing?.amount ?? 0) + increment, MAX_PERSISTED_CART_ITEM_QUANTITY)
	if (existing && nextQuantity === existing.amount) return products
	return {
		...products,
		[product.id]: existing ? { ...existing, amount: nextQuantity } : { ...product, amount: nextQuantity },
	}
}

/** Set a product quantity; zero or a negative amount removes it; invalid values leave the cart unchanged. */
export function setCartProductQuantity<T extends CartProductEntry>(
	products: Record<string, T>,
	productId: string,
	quantity: number,
): Record<string, T> {
	const normalized = normalizeCartQuantity(quantity)
	if (normalized === null || !products[productId]) return products
	if (normalized === 0) return removeCartProduct(products, productId)
	return { ...products, [productId]: { ...products[productId]!, amount: normalized } }
}

/** Apply one of the existing cart UI quantity actions as a pure transformation. */
export function updateCartProductQuantity<T extends CartProductEntry>(
	products: Record<string, T>,
	productId: string,
	action: CartQuantityAction,
	amount?: number,
): Record<string, T> {
	const product = products[productId]
	if (!product) return products

	switch (action) {
		case 'increment':
			return setCartProductQuantity(products, productId, product.amount + 1)
		case 'decrement':
			return setCartProductQuantity(products, productId, product.amount - 1)
		case 'setAmount':
			return amount === undefined ? products : setCartProductQuantity(products, productId, amount)
		case 'remove':
			return removeCartProduct(products, productId)
	}
}

export function removeCartProduct<T extends CartProductEntry>(products: Record<string, T>, productId: string): Record<string, T> {
	if (!products[productId]) return products
	const nextProducts = { ...products }
	delete nextProducts[productId]
	return nextProducts
}

/** Group cart products by valid seller pubkey; preserves product insertion order within each seller. */
export function groupCartProductsBySeller<T extends CartProductEntry>(products: Record<string, T>): Record<string, T[]> {
	const grouped: Record<string, T[]> = {}
	for (const product of Object.values(products)) {
		if (!isValidCartPubkey(product.sellerPubkey)) continue
		;(grouped[product.sellerPubkey] ??= []).push(product)
	}
	return grouped
}

function finiteOrZero(value: number): number {
	return Number.isFinite(value) ? value : 0
}

/**
 * Aggregate per-product totals for checkout. Inputs are expected to have already
 * resolved product prices, shipping, and currency conversion in the host app.
 */
export function aggregateBuyerCartTotals(productTotals: readonly CartProductTotalsInput[]): BuyerCartTotals {
	let subtotalInSats = 0
	let shippingInSats = 0
	const currencyTotals: BuyerCartTotals['currencyTotals'] = {}

	for (const line of productTotals) {
		subtotalInSats += finiteOrZero(line.subtotalInSats)
		shippingInSats += finiteOrZero(line.shippingInSats)
		if (!line.currency) continue
		const current = (currencyTotals[line.currency] ??= { subtotal: 0, shipping: 0, total: 0 })
		current.subtotal += finiteOrZero(line.subtotalInCurrency)
		current.shipping += finiteOrZero(line.shippingInCurrency)
		current.total += finiteOrZero(line.totalInCurrency ?? line.subtotalInCurrency + line.shippingInCurrency)
	}

	return {
		subtotalInSats,
		shippingInSats,
		totalInSats: productTotals.reduce(
			(total, line) => total + finiteOrZero(line.totalInSats ?? line.subtotalInSats + line.shippingInSats),
			0,
		),
		currencyTotals,
	}
}

/**
 * Aggregate the cart store's display totals. Shipping sats come from seller
 * breakdowns, matching the current store calculation; per-currency shipping
 * uses the converted per-product calculation supplied by the host.
 */
export function aggregateCartDisplayTotals(
	productTotals: readonly CartProductTotalsInput[],
	sellerShippingSats: readonly number[],
): CartDisplayTotals {
	let subtotalInSats = 0
	let totalShippingInSats = 0
	const subtotalByCurrency: Record<string, number> = {}
	const shippingByCurrency: Record<string, number> = {}
	const totalByCurrency: Record<string, number> = {}

	for (const line of productTotals) {
		subtotalInSats += finiteOrZero(line.subtotalInSats)
		if (!line.currency) continue
		subtotalByCurrency[line.currency] = (subtotalByCurrency[line.currency] ?? 0) + finiteOrZero(line.subtotalInCurrency)
		if (line.shippingInCurrency > 0) {
			shippingByCurrency[line.currency] = (shippingByCurrency[line.currency] ?? 0) + finiteOrZero(line.shippingInCurrency)
		}
	}

	for (const shippingSats of sellerShippingSats) {
		if (shippingSats > 0) totalShippingInSats += Math.round(finiteOrZero(shippingSats))
	}

	for (const currency of Object.keys(subtotalByCurrency)) {
		totalByCurrency[currency] = (subtotalByCurrency[currency] ?? 0) + (shippingByCurrency[currency] ?? 0)
	}

	return {
		totalInSats: subtotalInSats + totalShippingInSats,
		totalShippingInSats,
		subtotalByCurrency,
		shippingByCurrency,
		totalByCurrency,
	}
}
