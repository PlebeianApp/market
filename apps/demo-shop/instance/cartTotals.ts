/**
 * instance/cartTotals.ts — the cart's lines joined to the read, and its totals.
 *
 * The aggregation is the SDK's. `aggregateCartDisplayTotals` takes one
 * `CartProductTotalsInput` per line and answers the totals a cart screen shows;
 * this module's job is to *produce* those inputs — one line's money, in the
 * currency its own listing tagged, and in sats — and to be honest about the parts
 * it cannot produce.
 *
 * WHAT IS HONESTLY MISSING, AND SAID SO RATHER THAN DEFAULTED:
 *
 * 1. **Shipping.** The read model hands a listing's `shipping_option` tags as
 *    `[ref, amount]` and declares no unit for the amount, so a cart that added
 *    them to a sats total would be inventing a currency. This module passes the
 *    SDK no shipping sats at all and reports `shipping: 'not-in-the-read-model'`,
 *    which the surface renders as words.
 * 2. **A line the read cannot answer.** A persisted ref whose listing is no longer
 *    in the read (a hidden or delisted listing, or another instance's cart) cannot
 *    be priced. It is kept in the view with `item: null` and a named state, not
 *    dropped and not priced at zero — a cart that silently forgives an unpriceable
 *    line is a cart that under-reports what it owes.
 * 3. **The sats side of a price.** `sdk/commerce/products` exports exactly one
 *    BTC→sats conversion — `resolvePublishPrice`, an *authoring* function — and no
 *    read-side converter, so this module composes that one rather than restating
 *    `* 100000000`. It is a borrow across the write/read line and is reported as a
 *    named need by the increment.
 */

import { aggregateCartDisplayTotals, type CartProductTotalsInput } from '@sdk/commerce/cart'
import { resolvePublishPrice } from '@sdk/commerce/products'

import type { Cart, CartLine } from './cartState'
import { formatProductPrice, type ProductListItem } from './productListView'

/** One cart line, joined to the read and priced. */
export interface CartLineView {
	readonly productRef: string
	readonly id: string
	readonly amount: number
	/** The listing this line points at, or `null` when the read cannot answer for the ref. */
	readonly item: ProductListItem | null
	/** The listing's own tagged price, as tagged. */
	readonly unitPrice: string | null
	/** The unit price multiplied by the quantity, formatted. */
	readonly lineTotal: string | null
	/** The currency the listing tagged. Never inferred. */
	readonly currency: string | null
}

export interface CartView {
	readonly lines: readonly CartLineView[]
	/** Sum of the line quantities — what "N items" means on this cart. */
	readonly itemCount: number
	/** How many lines could be priced at all. */
	readonly pricedCount: number
	/** Subtotal per currency, as the SDK aggregated it, formatted for display. */
	readonly subtotalByCurrency: Readonly<Record<string, string>>
	/** The SDK's own sats total. */
	readonly totalInSats: number
	/** Named, never a silent zero: the read model carries no shipping cost. */
	readonly shipping: 'not-in-the-read-model'
	readonly summaryLine: string
}

/** Where the SDK exposes no unit for a shipping amount. */
export function noShippingReason(): string {
	return 'The commerce read model carries no shipping record, so no shipping cost is added.'
}

/**
 * A decimal amount times an integer quantity, exactly.
 *
 * `0.00185 × 3` is `0.005550000000000001` in binary floating point, and a cart
 * that showed that would be showing its arithmetic rather than the price.
 * `toFixed` at the tagged precision is exact here because a multiplication by an
 * integer adds no fractional digits the tag did not already carry.
 */
export function scaleAmount(amount: string, factor: number): string | null {
	const value = Number(amount)
	if (!Number.isFinite(value)) return null
	const decimals = (amount.split('.')[1] ?? '').length
	return (value * factor).toFixed(decimals)
}

/**
 * The sats value of a tagged price, through the SDK's own conversion.
 *
 * `resolvePublishPrice` is the SDK's authoring-side resolver and answers `SATS`
 * for a `BTC`-tagged amount; a listing already denominated in `SATS` passes
 * through unchanged. Any other currency answers `null` — there is no rate here and
 * inventing one would put a number on the page that nothing converted.
 *
 * The answer is rounded to whole sats, which is what a satoshi is: the smallest
 * unit has no fractional part, and a total assembled from unrounded floats can
 * carry one.
 */
export function satsValueOf(amount: string, currency: string): number | null {
	if (currency !== 'BTC' && currency !== 'SATS') return null
	const resolved = resolvePublishPrice({
		currency,
		bitcoinUnit: currency,
		currencyMode: 'sats',
		fiatPrice: '',
		price: amount,
	})
	if (resolved.status !== 'ok') return null
	const sats = Number(resolved.price)
	return Number.isFinite(sats) ? Math.round(sats) : null
}

/** How many decimal places a listing's own price tag carries. */
function taggedPrecision(amount: string): number {
	return (amount.split('.')[1] ?? '').length
}

function toLineView(line: CartLine, item: ProductListItem | null): CartLineView {
	if (!item || !item.price) {
		return {
			productRef: line.productRef,
			id: line.id,
			amount: line.amount,
			item,
			unitPrice: null,
			lineTotal: null,
			currency: null,
		}
	}

	const total = scaleAmount(item.price.amount, line.amount)
	return {
		productRef: line.productRef,
		id: line.id,
		amount: line.amount,
		item,
		unitPrice: item.price.display,
		lineTotal: total === null ? null : formatProductPrice(total, item.price.currency),
		currency: item.price.currency,
	}
}

/**
 * Build the cart screen's view.
 *
 * The lines are joined to the read by their **coordinates** — the same string the
 * cart's refs are made of — so a line and its listing cannot disagree about which
 * listing a line is.
 */
export function buildCartView(cart: Cart, items: readonly ProductListItem[]): CartView {
	const byCoordinates = new Map(items.map((item) => [item.coordinates, item]))
	const lines = cart.lines.map((line) => toLineView(line, byCoordinates.get(line.productRef) ?? null))

	const totals: CartProductTotalsInput[] = []
	// The precision a currency's **sum** is presented at. A sum of binary floats is
	// not the decimal the shopper added up — `0.0001 + 0.0002` is
	// `0.00030000000000000003` — so each currency's subtotal is rounded back to the
	// most precise tag its own lines carry, which is the only precision the read
	// model ever stated.
	const precisionByCurrency = new Map<string, number>()
	for (const line of lines) {
		if (!line.item?.price || !line.currency) continue
		precisionByCurrency.set(
			line.currency,
			Math.max(precisionByCurrency.get(line.currency) ?? 0, taggedPrecision(line.item.price.amount)),
		)

		const lineAmount = scaleAmount(line.item.price.amount, line.amount)
		const sats = satsValueOf(lineAmount ?? '0', line.currency)
		totals.push({
			subtotalInSats: sats ?? 0,
			shippingInSats: 0,
			subtotalInCurrency: Number(lineAmount ?? '0'),
			shippingInCurrency: 0,
			currency: line.currency,
		})
	}

	// No shipping sats are supplied, for the reason `noShippingReason` states.
	const display = aggregateCartDisplayTotals(totals, [])

	const subtotalByCurrency: Record<string, string> = {}
	for (const [currency, amount] of Object.entries(display.subtotalByCurrency)) {
		const precision = precisionByCurrency.get(currency) ?? 0
		subtotalByCurrency[currency] = formatProductPrice(amount.toFixed(precision), currency)
	}

	const itemCount = lines.reduce((total, line) => total + line.amount, 0)
	const pricedCount = lines.filter((line) => line.lineTotal !== null).length
	const unpriced = lines.length - pricedCount
	const summaryLine = [
		`${lines.length} line${lines.length === 1 ? '' : 's'}`,
		`${itemCount} item${itemCount === 1 ? '' : 's'}`,
		unpriced > 0 ? `${unpriced} line${unpriced === 1 ? '' : 's'} the read cannot price` : '',
	]
		.filter((part) => part.length > 0)
		.join(' · ')

	return {
		lines,
		itemCount,
		pricedCount,
		subtotalByCurrency,
		totalInSats: display.totalInSats,
		shipping: 'not-in-the-read-model',
		summaryLine,
	}
}
