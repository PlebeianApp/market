/**
 * checkoutPlacement.test.ts — **the checkout places, and it refuses by name.**
 *
 * The two halves of the increment's first requirement, held as facts:
 *
 * 1. **A placeable cart becomes an order**, through the module that owns placement
 *    (`placeBuyerOrdersFromCartIntent`), with the intent built by the SDK's own cart
 *    builder and the sats amount resolved by the read. Nothing here re-implements the
 *    `resolveCheckoutDeliveryRequirements` →
 *    `planSellerOrders` chain, and the order that comes back is the module's own value.
 * 2. **A gap still surfaces, naming the gap.** The cart's lines carry no shipping
 *    selection (the buy control does not ask for one), so the placement refuses with
 *    `unresolved_delivery` and the SDK's `product:<id>:missing-shipping-method`
 *    sentinels; a seller the read cannot price is left out of the terms and the module
 *    refuses with `unresolved-sats-price` naming the seller. Neither refusal is a
 *    generic failure sentence, and neither is swallowed into a "something went wrong".
 *
 * The mutations that turn these cases red:
 * - defaulting a line's shipping ref to the seller's first published option: the
 *   refusal arm stops refusing, and the "no choice was made" state disappears.
 * - supplying a seller's terms for a seller the read could not price (e.g. `?? 0`): the
 *   sats-price arm stops naming the seller and the order is placed at a wrong amount.
 * - reading the service out of the shipping ref's last segment instead of out of the
 *   kind-30406 read: the unresolved-ref arm resolves, which is the guess this module
 *   refuses to make.
 * - hand-building the order event instead of calling the module: the order's tags stop
 *   being the template's, and the status arm fails.
 */

import { describe, expect, test } from 'bun:test'

import { PLACED_ORDER_PAYMENT_LIFECYCLE, type PlacedBuyerOrder } from '@sdk/commerce/orders/orderPlacement'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY, DEMO_SHIPPING_REF } from './catalog'
import { EMPTY_CART, type Cart, type CartLine } from './cartState'
import { buildCheckoutView, buildCheckoutTerms, mintOrderId, placeCheckout } from './checkoutView'
import { buildProductListView, type ProductListItem } from './productListView'
import { buildShippingRead } from './shippingSource'

const catalog = buildCatalogEvents()
const items = buildProductListView(catalog).items
const shipping = buildShippingRead(catalog)

const coat = items.find((item) => item.id === 'wool-coat') as ProductListItem
const notebook = items.find((item) => item.id === 'field-notebook') as ProductListItem

/** A line as `readCart` builds one: the ref, its parts, and the selection the cart carries. */
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
const CLOCK = 1_760_000_000_000

const place = (cart: Cart, options: { shippingBySeller?: Record<string, string> } = {}) =>
	placeCheckout(cart, {
		items,
		servicesByShippingRef: shipping.servicesByShippingRef,
		createdAtMs: CLOCK,
		...(options.shippingBySeller ? { shippingBySeller: options.shippingBySeller } : {}),
	})

/** The demo's own placeable cart: one line, its seller's published shipping ref chosen. */
const placeable = () => cartOf([lineOf(coat, 2, DEMO_SHIPPING_REF)])

describe('the shipping read is what makes a chosen ref resolve', () => {
	test('the listing’s own ref is the ref the kind-30406 record resolves under', () => {
		expect(shipping.edge).toBe('fixture-catalog')
		expect(shipping.servicesByShippingRef[DEMO_SHIPPING_REF]).toBe('standard')
	})

	test('the delivery requirements resolve only because the map carries the record', () => {
		const withRecord = buildCheckoutView(placeable(), {
			updatedAtMs: CLOCK,
			servicesByShippingRef: shipping.servicesByShippingRef,
		})
		const withoutRecord = buildCheckoutView(placeable(), { updatedAtMs: CLOCK, servicesByShippingRef: {} })

		expect(withRecord.requirements.isResolved).toBe(true)
		// The same cart, the same ref, no record: unresolved — and the page can name the
		// ref that had no record rather than only that something did not resolve.
		expect(withoutRecord.requirements.isResolved).toBe(false)
		expect(withoutRecord.requirements.unresolvedShippingRefs).toEqual([DEMO_SHIPPING_REF])
		expect(withoutRecord.shippingRefsWithoutRecord).toEqual([DEMO_SHIPPING_REF])
	})

	test('a service is never read out of the ref’s own text', () => {
		// A ref shaped exactly like the real one but naming a different id resolves to
		// nothing, because the map is keyed by the ref the record built.
		const invented = `30406:${DEMO_SELLER_PUBKEY}:standard-express`
		const inventedCart = cartOf([lineOf(coat, 1, invented)])
		const attempt = place(inventedCart)

		expect(attempt.outcome.status).toBe('refused')
		if (attempt.outcome.status !== 'refused') return
		expect(attempt.outcome.reason).toBe('unresolved_delivery')
	})
})

describe('a placeable cart becomes an order, through the module that owns placement', () => {
	const attempt = place(placeable())

	test('it places, and the order carries the module’s own fields', () => {
		expect(attempt.outcome.status).toBe('placed')
		if (attempt.outcome.status !== 'placed') return

		const order = attempt.outcome.orders[0] as PlacedBuyerOrder
		expect(attempt.outcome.orders).toHaveLength(1)
		expect(order.sellerPubkey).toBe(DEMO_SELLER_PUBKEY)
		expect(order.items).toEqual([{ productRef: coat.coordinates, quantity: 2 }])
		expect(order.shippingRef).toBe(DEMO_SHIPPING_REF)
		expect(order.requiresPrivateDelivery).toBe(true)
		// The status is the module's derivation over the event it built — and a placed
		// order is not a paid order: the lifecycle is a stage, never a boolean.
		expect(order.orderStatus).toBe('pending')
		expect(order.shippingStatus).toBeNull()
		expect(order.payment).toBe(PLACED_ORDER_PAYMENT_LIFECYCLE)
		expect(order.payment).toBe('not-requested')
	})

	test('the amount in sats is the read’s own conversion of the lines’ prices', () => {
		// 0.00185 BTC × 2 = 185,000 sats each, through the SDK's own BTC→sats conversion.
		expect(attempt.terms.sellers).toHaveLength(1)
		expect(attempt.terms.sellers[0]?.amountSats).toBe(370_000)
		expect(attempt.terms.sellerTerms[DEMO_SELLER_PUBKEY]?.amountSats).toBe(370_000)
	})

	test('the order event is the template the module builds, not a hand-built one', () => {
		if (attempt.outcome.status !== 'placed') return
		const order = attempt.outcome.orders[0] as PlacedBuyerOrder

		expect(order.order.kind).toBe(16)
		expect(order.order.tags).toEqual([
			['p', DEMO_SELLER_PUBKEY],
			['subject', 'order-info'],
			['type', '1'],
			['order', order.orderId],
			['amount', '370000'],
			['item', coat.coordinates, '2'],
			['shipping', DEMO_SHIPPING_REF],
		])
		// Unplaced-adjacent claims the event must NOT carry: no status, no payment, no
		// settlement marker of any kind.
		const names = order.order.tags.map((tag) => tag[0])
		expect(names).not.toContain('status')
		expect(names).not.toContain('payment')
		expect(names).not.toContain('sig')
	})

	test('the order id is derived from the order’s own terms, not random', () => {
		if (attempt.outcome.status !== 'placed') return
		const order = attempt.outcome.orders[0] as PlacedBuyerOrder

		expect(order.orderId).toBe(attempt.terms.sellers[0]?.orderId)
		expect(order.orderId).toMatch(/^order-[0-9a-f]{8}$/)
		// The same inputs mint the same id — which is what makes `/orders/<id>` an address.
		expect(
			mintOrderId({ sellerPubkey: DEMO_SELLER_PUBKEY, amountSats: 370_000, intent: attempt.terms.intent }),
		).toBe(order.orderId)
		// A different amount is a different order, and so a different id.
		expect(
			mintOrderId({ sellerPubkey: DEMO_SELLER_PUBKEY, amountSats: 370_001, intent: attempt.terms.intent }),
		).not.toBe(order.orderId)
	})

	test('the order id is minted once per seller, so two sellers are two orders', () => {
		// A second seller with its own ref and its own priced listing, so both groups
		// resolve and the grouping is the thing under test.
		const otherSeller = 'a1'.repeat(32)
		const otherRef = '30406:' + otherSeller + ':standard'
		const otherCoordinates = '30402:' + otherSeller + ':mug'
		const twoSellerCart = cartOf([
			lineOf(coat, 1, DEMO_SHIPPING_REF),
			{
				productRef: otherCoordinates,
				id: 'mug',
				sellerPubkey: otherSeller,
				amount: 1,
				shippingMethodId: otherRef,
			},
		])

		const terms = buildCheckoutTerms(twoSellerCart, {
			items: [
				...items,
				{
					...coat,
					id: 'mug',
					coordinates: otherCoordinates,
					sellerPubkey: otherSeller,
					price: { amount: '0.00018', currency: 'BTC', display: '0.00018 BTC' },
				},
			],
			createdAtMs: CLOCK,
			shippingBySeller: { [DEMO_SELLER_PUBKEY]: DEMO_SHIPPING_REF, [otherSeller]: otherRef },
		})

		expect(terms.sellers.map((seller) => seller.sellerPubkey).sort()).toEqual(
			[DEMO_SELLER_PUBKEY, otherSeller].sort(),
		)
		// One order id per seller, and no two orders share one.
		expect(new Set(terms.sellers.map((seller) => seller.orderId)).size).toBe(2)
		expect(terms.sellers.find((seller) => seller.sellerPubkey === otherSeller)?.amountSats).toBe(18_000)
		expect(terms.sellers.find((seller) => seller.sellerPubkey === otherSeller)?.shippingRef).toBe(otherRef)
	})
})

describe('a gap still surfaces, naming the gap', () => {
	test('no shipping method chosen: the SDK’s own sentinel per line, and no order', () => {
		const attempt = place(cartOf([lineOf(coat, 1), lineOf(notebook, 2)]))

		expect(attempt.outcome.status).toBe('refused')
		if (attempt.outcome.status !== 'refused') return
		expect(attempt.outcome.reason).toBe('unresolved_delivery')
		if (attempt.outcome.reason !== 'unresolved_delivery') return
		expect(attempt.outcome.unresolvedShippingRefs).toEqual([
			// The refs are the SDK's own sentinels, in the order the intent carries the
			// lines — `createCartIntent` sorts by ref, so the page and the module agree.
			'product:field-notebook:missing-shipping-method',
			'product:wool-coat:missing-shipping-method',
		])
	})

	test('the checkout’s own choice closes the gap without the cart having to carry one', () => {
		const unchosen = cartOf([lineOf(coat, 1)])

		expect(place(unchosen).outcome.status).toBe('refused')
		const chosen = place(unchosen, { shippingBySeller: { [DEMO_SELLER_PUBKEY]: DEMO_SHIPPING_REF } })
		expect(chosen.outcome.status).toBe('placed')
		// …and the choice lands in the intent the instance submitted, not only in a
		// local variable: the record is the SDK's own builder output.
		expect(chosen.terms.intent.items[0]?.shippingRef).toBe(DEMO_SHIPPING_REF)
	})

	test('a line the read cannot price is left out of the terms, and the module names the seller', () => {
		const unknownSeller = 'b2'.repeat(32)
		const cart = cartOf([
			{
				productRef: `30402:${unknownSeller}:ghost`,
				id: 'ghost',
				sellerPubkey: unknownSeller,
				amount: 1,
				shippingMethodId: DEMO_SHIPPING_REF,
			},
		])
		const attempt = place(cart)

		expect(attempt.terms.sellers[0]?.amountSats).toBeNull()
		expect(attempt.terms.sellers[0]?.unpricedProductRefs).toEqual(['30402:' + unknownSeller + ':ghost'])
		expect(attempt.terms.sellerTerms[unknownSeller]).toBeUndefined()

		expect(attempt.outcome.status).toBe('refused')
		if (attempt.outcome.status !== 'refused') return
		expect(attempt.outcome.reason).toBe('unresolved-sats-price')
		if (attempt.outcome.reason !== 'unresolved-sats-price') return
		expect(attempt.outcome.sellerPubkeys).toEqual([unknownSeller])
	})

	test('an empty cart is refused as an empty cart, in the module’s words', () => {
		const attempt = place(EMPTY_CART)

		expect(attempt.outcome.status).toBe('refused')
		if (attempt.outcome.status !== 'refused') return
		expect(attempt.outcome.reason).toBe('empty_cart')
	})

	test('a refused attempt places nothing at all — there is no order to hold', () => {
		const attempt = place(cartOf([lineOf(coat, 1)]))

		expect(attempt.outcome).not.toHaveProperty('orders')
	})
})
