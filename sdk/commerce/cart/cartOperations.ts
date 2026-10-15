import { isValidCartPubkey, MAX_PERSISTED_CART_ITEM_QUANTITY } from './cartIntent'
import { fromMinorUnits, minorUnitSum, type MinorUnitSum } from './money'

export interface CartProductEntry {
	id: string
	amount: number
	sellerPubkey: string
	/** When `false` the cart refuses the product without adding it — an out-of-stock listing cannot be put in the cart. */
	inStock?: boolean
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
	if (product.inStock === false) return products
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

/**
 * The currency the `*InSats` fields are denominated in.
 *
 * Sats are a currency like any other here, with a declared precision of 0 decimal
 * places (`./money`), so the sats side of these totals is integer arithmetic too
 * and not a special case. The three-letter notation this SDK writes into a
 * `price` tag is decided in `sdk/commerce/products`; this constant is only the key
 * into the precision table.
 */
const SATS_CURRENCY = 'SAT'

/** The running sums held for one currency of the cart. */
interface CurrencyTotalsSums {
	readonly subtotal: MinorUnitSum
	readonly shipping: MinorUnitSum
}

/** The same, plus the total a buyer total carries beside them. */
interface BuyerCurrencyTotalsSums extends CurrencyTotalsSums {
	readonly total: MinorUnitSum
}

function displayCurrencySums(byCurrency: Map<string, CurrencyTotalsSums>, currency: string): CurrencyTotalsSums {
	const existing = byCurrency.get(currency)
	if (existing) return existing
	const created: CurrencyTotalsSums = { subtotal: minorUnitSum(currency), shipping: minorUnitSum(currency) }
	byCurrency.set(currency, created)
	return created
}

function buyerCurrencySums(byCurrency: Map<string, BuyerCurrencyTotalsSums>, currency: string): BuyerCurrencyTotalsSums {
	const existing = byCurrency.get(currency)
	if (existing) return existing
	const created: BuyerCurrencyTotalsSums = {
		subtotal: minorUnitSum(currency),
		shipping: minorUnitSum(currency),
		total: minorUnitSum(currency),
	}
	byCurrency.set(currency, created)
	return created
}

/**
 * Aggregate per-product totals for checkout. Inputs are expected to have already
 * resolved product prices, shipping, and currency conversion in the host app.
 *
 * Every sum is made in the currency's **integer minor units** (`./money`): sats at
 * 0 decimal places, `BTC` at 8. Each currency is converted back to a decimal
 * **once**, when the answer is assembled — never between two additions.
 */
export function aggregateBuyerCartTotals(productTotals: readonly CartProductTotalsInput[]): BuyerCartTotals {
	const subtotalInSats = minorUnitSum(SATS_CURRENCY)
	const shippingInSats = minorUnitSum(SATS_CURRENCY)
	const totalInSats = minorUnitSum(SATS_CURRENCY)
	const byCurrency = new Map<string, BuyerCurrencyTotalsSums>()

	for (const line of productTotals) {
		subtotalInSats.add(line.subtotalInSats)
		shippingInSats.add(line.shippingInSats)
		totalInSats.add(line.totalInSats ?? line.subtotalInSats + line.shippingInSats)
		if (!line.currency) continue
		const sums = buyerCurrencySums(byCurrency, line.currency)
		sums.subtotal.add(line.subtotalInCurrency)
		sums.shipping.add(line.shippingInCurrency)
		sums.total.add(line.totalInCurrency ?? line.subtotalInCurrency + line.shippingInCurrency)
	}

	const currencyTotals: BuyerCartTotals['currencyTotals'] = {}
	for (const [currency, sums] of byCurrency) {
		currencyTotals[currency] = { subtotal: sums.subtotal.total(), shipping: sums.shipping.total(), total: sums.total.total() }
	}

	return {
		subtotalInSats: subtotalInSats.total(),
		shippingInSats: shippingInSats.total(),
		totalInSats: totalInSats.total(),
		currencyTotals,
	}
}

/**
 * Aggregate the cart store's display totals. Shipping sats come from seller
 * breakdowns, matching the current store calculation; per-currency shipping
 * uses the converted per-product calculation supplied by the host.
 *
 * Money is summed in integer minor units here too, so `0.0001 + 0.0002` of a
 * currency with 8 decimal places is `0.0003` and not `0.00030000000000000003`.
 */
export function aggregateCartDisplayTotals(
	productTotals: readonly CartProductTotalsInput[],
	sellerShippingSats: readonly number[],
): CartDisplayTotals {
	const subtotalInSats = minorUnitSum(SATS_CURRENCY)
	const totalShippingInSats = minorUnitSum(SATS_CURRENCY)
	const byCurrency = new Map<string, CurrencyTotalsSums>()

	for (const line of productTotals) {
		subtotalInSats.add(line.subtotalInSats)
		if (!line.currency) continue
		const sums = displayCurrencySums(byCurrency, line.currency)
		sums.subtotal.add(line.subtotalInCurrency)
		if (line.shippingInCurrency > 0) sums.shipping.add(line.shippingInCurrency)
	}

	for (const shippingSats of sellerShippingSats) {
		if (shippingSats > 0) totalShippingInSats.add(shippingSats)
	}

	const subtotalByCurrency: Record<string, number> = {}
	const shippingByCurrency: Record<string, number> = {}
	const totalByCurrency: Record<string, number> = {}
	for (const [currency, sums] of byCurrency) {
		subtotalByCurrency[currency] = sums.subtotal.total()
		// A currency is named in the shipping breakdown only when one of its lines
		// carried shipping, which is what `shippingInCurrency > 0` above gates.
		if (sums.shipping.minorUnits() !== 0) shippingByCurrency[currency] = sums.shipping.total()
		// `subtotal + shipping` is an addition **in this currency**, so it is made in
		// minor units and converted once, not as a sum of two decimals.
		totalByCurrency[currency] = fromMinorUnits(
			sums.subtotal.minorUnits() + sums.shipping.minorUnits(),
			sums.subtotal.precision,
		)
	}

	return {
		totalInSats: fromMinorUnits(subtotalInSats.minorUnits() + totalShippingInSats.minorUnits(), subtotalInSats.precision),
		totalShippingInSats: totalShippingInSats.total(),
		subtotalByCurrency,
		shippingByCurrency,
		totalByCurrency,
	}
}
