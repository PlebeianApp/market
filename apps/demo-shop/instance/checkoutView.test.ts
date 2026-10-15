/**
 * checkoutView.test.ts — the handoff, resolved through the SDK's checkout rules.
 *
 * The point of these cases is that the checkout entry **reports** rather than
 * pretends: the delivery requirements come out unresolved because no shipping
 * method was chosen, the invoice rule is asked over an empty list and says no
 * invoice is open, and the intent is the SDK's own builder output rather than a
 * hand-made payload.
 *
 * The mutations that turn these cases red:
 * - defaulting `shippingMethodId` to the listing's first shipping option: every line
 *   stops reporting `missing-shipping-method` and `isResolved` flips to true.
 * - inferring a service name from the shipping ref's last segment and feeding it to
 *   `servicesByShippingRef`: a line with a shipping ref resolves to a mode, which is
 *   the guess this module deliberately does not make.
 * - hand-building the intent object instead of calling `createCartIntent`: the refs
 *   stop carrying the seller pubkey and the version assertion fails.
 * - claiming a next invoice: `nextInvoiceIndex` stops being `-1`.
 * - dropping `payment: 'not-built'`: a surface could then imply a payment exists.
 */

import { describe, expect, test } from 'bun:test'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY } from './catalog'
import { buildCheckoutView } from './checkoutView'
import { EMPTY_CART, type Cart, type CartLine } from './cartState'
import { buildProductListView, type ProductListItem } from './productListView'

const items = buildProductListView(buildCatalogEvents()).items
const coat = items.find((item) => item.id === 'wool-coat') as ProductListItem
const notebook = items.find((item) => item.id === 'field-notebook') as ProductListItem

function lineOf(item: ProductListItem, amount: number, shippingMethodId: string | null = null): CartLine {
	return {
		productRef: item.coordinates,
		id: item.id,
		sellerPubkey: item.sellerPubkey,
		amount,
		shippingMethodId,
	}
}

const cartOf = (lines: CartLine[]): Cart => ({ lines })

describe('the intent is the SDK’s own cart→order preparation', () => {
	test('it carries every line as an addressable ref, stamped with the given clock', () => {
		const checkout = buildCheckoutView(cartOf([lineOf(coat, 2), lineOf(notebook, 1)]), {
			updatedAtMs: 1_760_000_000_000,
		})

		expect(checkout.intent.version).toBe(1)
		expect(checkout.intent.updatedAt).toBe(1_760_000_000)
		expect(checkout.intent.items).toEqual([
			{ productRef: `30402:${DEMO_SELLER_PUBKEY}:field-notebook`, quantity: 1, shippingRef: undefined },
			{ productRef: `30402:${DEMO_SELLER_PUBKEY}:wool-coat`, quantity: 2, shippingRef: undefined },
		])
		expect(checkout.lineCount).toBe(2)
		expect(checkout.itemCount).toBe(3)
	})
})

describe('what the checkout cannot resolve, it reports', () => {
	test('no shipping method chosen means the delivery requirements stay unresolved, by name', () => {
		const checkout = buildCheckoutView(cartOf([lineOf(coat, 1), lineOf(notebook, 2)]))

		expect(checkout.requirements.isResolved).toBe(false)
		expect(checkout.requirements.unresolvedShippingRefs).toEqual([
			'product:wool-coat:missing-shipping-method',
			'product:field-notebook:missing-shipping-method',
		])
		expect(checkout.requirements.needsPhysicalAddress).toBe(false)
		expect(checkout.summaryLine).toBe('2 lines · 3 items · 2 unresolved delivery refs')
	})

	test('a chosen shipping method is carried, and a ref the service map does not know stays unresolved', () => {
		// The cart can hold a selection (the SDK persists one), and the service map is
		// empty because the kind-30406 record is not read here — so a line with a ref
		// resolves as unresolved rather than being guessed into 'physical'.
		const shippingRef = `30406:${DEMO_SELLER_PUBKEY}:standard`
		const checkout = buildCheckoutView(cartOf([lineOf(coat, 1, shippingRef)]))

		expect(checkout.intent.items[0]?.shippingRef).toBe(shippingRef)
		expect(checkout.requirements.isResolved).toBe(false)
		expect(checkout.requirements.unresolvedShippingRefs).toEqual([shippingRef])
	})

	test('no invoice is open, from the SDK’s own progress rule over an empty list', () => {
		const checkout = buildCheckoutView(cartOf([lineOf(coat, 1)]))

		expect(checkout.nextInvoiceIndex).toBe(-1)
	})

	test('the payment is named as not built, so no surface can imply otherwise', () => {
		expect(buildCheckoutView(cartOf([lineOf(coat, 1)])).payment).toBe('not-built')
	})
})

describe('an empty cart', () => {
	test('resolves trivially — which is why the surface refuses to render a checkout for it', () => {
		const checkout = buildCheckoutView(EMPTY_CART, { updatedAtMs: 1_760_000_000_000 })

		expect(checkout.lineCount).toBe(0)
		expect(checkout.itemCount).toBe(0)
		expect(checkout.requirements.isResolved).toBe(true)
		expect(checkout.requirements.unresolvedShippingRefs).toEqual([])
		expect(checkout.intent.items).toEqual([])
		expect(checkout.summaryLine).toBe('0 lines · 0 items · delivery resolved')
	})
})
