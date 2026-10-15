/**
 * cartTotals.test.ts — the cart's lines joined to the read, and its money.
 *
 * Four things are held here that a page cannot show and a reader cannot check by
 * looking: the arithmetic is exact, **a sum is presented at the precision its own
 * tags carry** (binary floats do not add up to the decimal a shopper added up), the
 * sats side comes from the SDK's own conversion, and **no shipping cost is added**
 * because the read model carries no shipping record.
 *
 * The mutations that turn these cases red:
 * - dropping `toFixed` from `scaleAmount`: `'0.00185' × 3` becomes
 *   `'0.005550000000000001'` and the formatted line total stops equalling the price.
 * - formatting a currency subtotal without its tagged precision: two lines at
 *   `0.0001` and `0.0002` print `0.00030000000000000003` — the assertion below names
 *   that string, so the fix cannot be undone by accident.
 * - feeding the listing's `shipping_option` amount to `aggregateCartDisplayTotals`'s
 *   second argument: the sats total grows by 250 per line and stops being the
 *   subtotal.
 * - returning `lines.length` from `itemCount`: a line of quantity two counts once.
 * - pricing a line whose listing the read cannot answer for: `item: null` becomes a
 *   number instead of a named state.
 * - converting a non-bitcoin currency in `satsValueOf`: a `USD` price acquires a
 *   sats value nothing computed.
 */

import { describe, expect, test } from 'bun:test'

import { buildCatalogEvents } from './catalog'
import { buildCartView, satsValueOf, scaleAmount } from './cartTotals'
import { EMPTY_CART, type Cart, type CartLine } from './cartState'
import { buildProductListView, formatProductPrice, type ProductListItem } from './productListView'

const items = buildProductListView(buildCatalogEvents()).items
const coat = items.find((item) => item.id === 'wool-coat') as ProductListItem
const notebook = items.find((item) => item.id === 'field-notebook') as ProductListItem

function lineOf(item: ProductListItem, amount: number): CartLine {
	return {
		productRef: item.coordinates,
		id: item.id,
		sellerPubkey: item.sellerPubkey,
		amount,
		shippingMethodId: null,
	}
}

/** A listing shaped like the coat but priced to order, for the precision cases. */
function pricedAt(base: ProductListItem, id: string, amount: string): ProductListItem {
	const currency = base.price?.currency ?? 'BTC'
	return {
		...base,
		id,
		coordinates: `30402:${base.sellerPubkey}:${id}`,
		price: { amount, currency, display: formatProductPrice(amount, currency) },
	}
}

const cartOf = (lines: CartLine[]): Cart => ({ lines })

describe('a line’s money is exact', () => {
	test('a decimal amount times an integer quantity keeps the tagged precision', () => {
		expect(scaleAmount('0.00185', 3)).toBe('0.00555')
		expect(scaleAmount('0.00045', 2)).toBe('0.00090')
		expect(scaleAmount('not a number', 2)).toBeNull()
	})

	test('the sats value comes through the SDK’s own conversion, and only for bitcoin units', () => {
		expect(satsValueOf('0.00185', 'BTC')).toBe(185_000)
		expect(satsValueOf('185000', 'SATS')).toBe(185_000)
		expect(satsValueOf('12', 'USD')).toBeNull()
	})
})

describe('the cart view the surface renders', () => {
	test('two of one listing is one line and two items', () => {
		const view = buildCartView(cartOf([lineOf(coat, 2)]), items)

		expect(view.lines).toHaveLength(1)
		expect(view.lines[0]?.unitPrice).toBe('0.00185 BTC')
		expect(view.lines[0]?.lineTotal).toBe('0.00370 BTC')
		expect(view.itemCount).toBe(2)
		expect(view.pricedCount).toBe(1)
		expect(view.summaryLine).toBe('1 line · 2 items')
	})

	test('the subtotal is the SDK’s aggregation, and no shipping is added to it', () => {
		// The coat's listing tags a `shipping_option` of 250. If that amount were fed
		// to the aggregation, the total would be 379,250 rather than 379,000 — a cost
		// in a unit the read model never declared.
		const view = buildCartView(cartOf([lineOf(coat, 2), lineOf(notebook, 1)]), items)

		expect(view.subtotalByCurrency).toEqual({ BTC: '0.00379 BTC' })
		expect(view.totalInSats).toBe(379_000)
		expect(view.shipping).toBe('not-in-the-read-model')
	})

	test('a currency’s sum is presented at the precision its tags carry, not at float precision', () => {
		// The defect this pins, stated: this is what the sum of the two tagged
		// amounts is in binary floating point, and it is not what a cart may show.
		expect(String(0.0001 + 0.0002)).toBe('0.00030000000000000003')

		const a = pricedAt(coat, 'a', '0.0001')
		const b = pricedAt(coat, 'b', '0.0002')
		const view = buildCartView(cartOf([lineOf(a, 1), lineOf(b, 1)]), [a, b])

		expect(view.subtotalByCurrency).toEqual({ BTC: '0.0003 BTC' })
	})

	test('a line whose listing the read cannot answer for is named, never priced at zero', () => {
		const orphan: CartLine = {
			productRef: `30402:${coat.sellerPubkey}:delisted-since`,
			id: 'delisted-since',
			sellerPubkey: coat.sellerPubkey,
			amount: 1,
			shippingMethodId: null,
		}
		const view = buildCartView(cartOf([orphan, lineOf(coat, 1)]), items)

		expect(view.lines[0]?.item).toBeNull()
		expect(view.lines[0]?.lineTotal).toBeNull()
		expect(view.pricedCount).toBe(1)
		expect(view.summaryLine).toBe('2 lines · 2 items · 1 line the read cannot price')
	})

	test('an empty cart is zero of everything, with words rather than blanks', () => {
		const view = buildCartView(EMPTY_CART, items)

		expect(view.lines).toEqual([])
		expect(view.itemCount).toBe(0)
		expect(view.subtotalByCurrency).toEqual({})
		expect(view.totalInSats).toBe(0)
		expect(view.summaryLine).toBe('0 lines · 0 items')
	})
})
