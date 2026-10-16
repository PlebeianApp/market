/**
 * ssr.test.ts — **the HTTP response itself carries the content.**
 *
 * `server.tsx` renders each route with `react-dom/server`, so this file renders the
 * same component tree to a string and holds the two properties the acceptance
 * screenshot is meant to prove: the served bytes carry the surface's own text (a
 * title, a price, an availability line), and the browser-owned cart ships as a
 * **skeleton** with no number at all rather than a guessed `0`.
 *
 * It also does the thing a rendered page can do and a source read cannot: it
 * **collects every product link the list emits and resolves each one through the
 * router**, which is the check that catches "the address a card hands out goes
 * nowhere" — a defect no module's own suite sees, because a suite exercises what it
 * mounts, not what the UI links to.
 *
 * The mutations that turn these cases red:
 * - rendering `<ProductList>` on the product route: the detail assertions fail
 *   (the page would carry five titles, not one).
 * - dropping the `data-skeleton` placeholder from the reading cart status: the
 *   skeleton assertion fails, and the page would show a `0` nobody measured.
 * - emitting `href={item.id}` on a row instead of `productPath(item.coordinates)`:
 *   the link-resolution case fails and names the address.
 * - deleting the `product-missing` member: an unresolvable address renders an empty
 *   region instead of a sentence.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { App, type DemoShopPageProps } from './App'
import { buildAssumptionRegister } from './assumptions'
import type { Cart } from './cartState'
import { buildCatalogEvents, DEMO_SELLER_PUBKEY, DEMO_SHIPPING_REF } from './catalog'
import { placeCheckout } from './checkoutView'
import { PLACED_ORDER_TRUTH } from './OrderDetail'
import { buildOrderView } from './orderView'
import { findProductDetail } from './productDetailView'
import { buildProductListView } from './productListView'
import { CART_PATH, CHECKOUT_PATH, PRODUCTS_PATH, coordinatesFromProductPath, isPagePath, orderPath } from './routes'
import { buildShippingRead } from './shippingSource'

const catalog = buildCatalogEvents()
const view = buildProductListView(catalog)
const shipping = buildShippingRead(catalog)

const shell = {
	instanceName: 'Demo Shop',
	instanceId: 'demo-shop',
	sourceKind: 'fixture' as const,
	view,
	shipping,
	assumptions: buildAssumptionRegister({ sourceKind: 'fixture', relayUrls: [], displayCurrency: 'BTC' }),
}

/** The cart this demo can actually place: one line, its seller's own published shipping ref. */
const placeableCart: Cart = {
	lines: [
		{
			productRef: `30402:${DEMO_SELLER_PUBKEY}:wool-coat`,
			id: 'wool-coat',
			sellerPubkey: DEMO_SELLER_PUBKEY,
			amount: 2,
			shippingMethodId: DEMO_SHIPPING_REF,
		},
	],
}

/** Place that cart through the app's own path, so the order under test is a real one. */
function placeTheDemoOrder() {
	const attempt = placeCheckout(placeableCart, {
		items: view.items,
		servicesByShippingRef: shipping.servicesByShippingRef,
		createdAtMs: 1_760_000_000_000,
	})
	if (attempt.outcome.status !== 'placed') throw new Error(`the demo cart should place: ${attempt.outcome.reason}`)
	return attempt.outcome.orders[0] as NonNullable<(typeof attempt.outcome.orders)[number]>
}

function render(props: DemoShopPageProps): string {
	return renderToString(createElement(App, props))
}

/** The named regions a page declares, so a route cannot lose one silently. */
function regionsOf(html: string): string[] {
	const found = new Set<string>()
	for (const match of html.matchAll(/class="[^"]*\bregion region-([a-z-]+)/g)) {
		if (match[1]) found.add(`region-${match[1]}`)
	}
	return [...found].sort()
}

describe('the product list’s own text is in the served bytes', () => {
	const html = render({ ...shell, route: 'products' })

	test('the titles, the prices and the summary line are all there', () => {
		expect(html).toContain('Merino Wool Coat')
		expect(html).toContain('Cast Iron Skillet')
		expect(html).toContain('0.00000099 BTC')
		expect(html).toContain('5 listings · 1 not on sale')
		expect(html).toContain('in stock · 3')
	})

	test('it is the products region, and the list is the only surface on it', () => {
		expect(regionsOf(html)).toEqual(['region-foot', 'region-instance', 'region-nav', 'region-products'])
		expect(html).toContain('aria-label="The product catalogue"')
	})

	test('the browser-owned cart ships as a skeleton, with no number in the markup', () => {
		expect(html).toContain('data-cart-state="reading"')
		expect(html).toContain('data-skeleton="1"')
		// The count element exists only once the browser has answered.
		expect(html).not.toContain('data-testid="cart-count"')
	})
})

describe('every product address the list emits resolves', () => {
	const html = render({ ...shell, route: 'products' })
	const hrefs = [...html.matchAll(/href="(\/products\/[^"]*)"/g)].map((match) => match[1] as string)

	test('the list emits one address per listing, and each parses to coordinates', () => {
		expect(hrefs).toHaveLength(view.items.length)
		for (const href of hrefs) {
			expect(coordinatesFromProductPath(href)).not.toBeNull()
		}
	})

	test('each address resolves to the listing that emitted it', () => {
		for (const href of hrefs) {
			const coordinates = coordinatesFromProductPath(href)
			const lookup = findProductDetail(catalog, coordinates ?? '')
			expect(lookup.found).toBe(true)
		}
	})
})

describe('a listing’s page carries its own fields', () => {
	const lookup = findProductDetail(catalog, `30402:${DEMO_SELLER_PUBKEY}:wool-coat`)
	if (!lookup.found) throw new Error('the coat should resolve')
	const html = render({ ...shell, route: 'product', detail: lookup.detail })

	test('the title, price, description, availability and specs are in the markup', () => {
		expect(html).toContain('Merino Wool Coat')
		expect(html).toContain('0.00000099 BTC')
		expect(html).toContain('A heavy merino coat cut for cold mornings.')
		expect(html).toContain('in stock · 3')
		expect(html).toContain('size')
		expect(html).toContain(`30406:${DEMO_SELLER_PUBKEY}:standard`)
	})

	test('it is the product region, and the buy control is there but disabled until the cart is read', () => {
		expect(regionsOf(html)).toEqual(['region-foot', 'region-instance', 'region-nav', 'region-product'])
		expect(html).toContain('data-testid="add-to-cart"')
		expect(html).toContain('data-buy-state="off"')
		expect(html).toMatch(/data-testid="add-to-cart"[^>]*disabled/)
	})
})

describe('the browser-owned surfaces ship a skeleton, because the server cannot know the cart', () => {
	test('the cart page: its own heading is in the bytes, and the cart itself is not', () => {
		const html = render({ ...shell, route: 'cart' })

		expect(html).toContain('Your cart')
		expect(html).toContain('data-cart-view="reading"')
		expect(html).toContain('data-skeleton="1"')
		// No lines: the server has no cart to render, and it says so rather than
		// shipping an empty cart that looks like an empty cart someone measured.
		expect(html).not.toContain('data-testid="cart-lines"')
		expect(regionsOf(html)).toEqual(['region-cart', 'region-foot', 'region-instance', 'region-nav'])
	})

	test('the checkout entry: its own heading is in the bytes, and the place region promises no payment', () => {
		const html = render({ ...shell, route: 'checkout' })

		expect(html).toContain('Checkout')
		expect(html).toContain('data-checkout-state="reading"')
		expect(html).toContain('data-skeleton="1"')
		// The place region is server-rendered — its honesty is in the served bytes, not
		// something hydration adds — and the control is off until the cart has been read.
		expect(html).toContain('data-testid="checkout-place-region"')
		expect(html).toContain('unsigned event template')
		expect(html).toContain('A placed order is not a paid order.')
		expect(html).toMatch(/data-testid="checkout-place"[^>]*data-place-state="off"/)
		// The shipping read this run performed is stated on the page, in its own line.
		expect(html).toContain(shipping.summaryLine)
		expect(regionsOf(html)).toEqual(['region-checkout', 'region-foot', 'region-instance', 'region-nav'])
	})
})

describe('the order details page is server-rendered, with the order’s own status in the served bytes', () => {
	const placed = placeTheDemoOrder()
	const order = buildOrderView(placed, { items: view.items, servicesByShippingRef: shipping.servicesByShippingRef })
	const html = render({ ...shell, route: 'order', order })

	test('the order id and the status the SDK derived are both in the markup', () => {
		expect(html).toContain(`data-order-id="${order.orderId}"`)
		expect(html).toContain('data-testid="order-id"')
		expect(html).toContain(order.orderId)
		// The status is the module's derivation over the built event's own tags: the
		// template writes no `status`, so the resolver answers `pending`.
		expect(order.status).toBe('pending')
		expect(html).toContain('data-testid="order-status-badge"')
		expect(html).toContain('pending')
	})

	test('it is the order region, and the assumption register is in its bytes too', () => {
		expect(regionsOf(html)).toEqual(['region-foot', 'region-instance', 'region-nav', 'region-order'])
		expect(html).toContain('data-testid="assumption-register"')
		expect(html).toContain(shell.assumptions.summaryLine)
	})

	test('the three claims are separate, and none of them says this order was paid', () => {
		expect(html).toContain('data-testid="order-stage-payment-lifecycle"')
		expect(html).toContain('not-requested — no invoice was raised and no payment has been requested')
		expect(html).toContain('data-testid="order-stage-shipping-status"')
		expect(html).toContain('none recorded')
		expect(html).toContain('data-testid="order-stage-signature"')
		expect(html).toContain('not signed — this is an unsigned event template; the demo holds no key')
		expect(html).toContain('data-testid="order-stage-publication"')
		expect(html).toContain('not-published — nothing was sent to a relay')
		expect(html).toContain(PLACED_ORDER_TRUTH)
		// There is no field that could say it was settled: the page has the stage, and
		// no boolean beside it.
		expect(html).not.toContain('data-testid="order-paid"')
		expect(html).not.toContain('"paid":true')
	})

	test('the order’s own fields are rendered: merchant, amount, the line, and the shipping ref', () => {
		expect(html).toContain('data-testid="order-merchant"')
		expect(html).toContain('data-testid="order-amount"')
		expect(html).toContain('data-testid="order-item"')
		expect(html).toContain('Merino Wool Coat')
		expect(html).toContain(DEMO_SHIPPING_REF)
		expect(html).toContain('standard')
	})

	test('the event it was built as is readable, so the derivation can be checked against it', () => {
		expect(html).toContain('data-testid="order-event-kind"')
		// React separates the literal `kind ` from the number with a comment node.
		expect(html).toContain('kind <!-- -->16')
		expect(html).toContain('data-testid="order-event-tag"')
		expect(html).toContain('subject · order-info')
		// …and the register that the order status tag is absent travels with it.
		expect(html).toContain('carries no `status` tag')
	})

	test('an order address that holds nothing is a surface with its own words', () => {
		const missing = render({ ...shell, route: 'order-missing', orderId: 'order-00000000' })

		expect(missing).toContain('No order here')
		expect(missing).toContain('order-00000000')
		expect(regionsOf(missing)).toEqual(['region-foot', 'region-instance', 'region-nav', 'region-order'])
	})

	test('the nav marks the checkout section on an order page, and only that one', () => {
		expect(html).toContain(`href="${CHECKOUT_PATH}" aria-current="page"`)
		expect(html.match(/aria-current="page"/g)).toHaveLength(1)
	})
})

describe('the assumption register is in the served bytes, not added later', () => {
	const routes = ['products', 'cart', 'checkout'] as const

	test('every route carries the register, with its heading and its count', () => {
		for (const route of routes) {
			const html = render({ ...shell, route })
			expect(html).toContain('data-testid="assumption-register"')
			expect(html).toContain('Assumptions this instance is running under')
			expect(html).toContain(shell.assumptions.summaryLine)
		}
	})

	test('the register is rendered once per page, and carries every entry', () => {
		const html = render({ ...shell, route: 'products' })
		const entries = html.match(/data-testid="assumption-entry"/g) ?? []

		expect(entries).toHaveLength(shell.assumptions.entries.length)
		for (const entry of shell.assumptions.entries) {
			// The id travels in the markup, so a missing entry is named by its id
			// rather than only counted.
			expect(html).toContain(`data-assumption-id="${entry.id}"`)
		}
	})

	test('the entries that are the app’s own are readable on the page, with their falsifiers', () => {
		const html = render({ ...shell, route: 'products' })

		for (const id of [
			'app-listing-edge',
			'app-no-live-relay-read-performed',
			'app-catalog-authored-in-btc',
			'app-unlabelled-price-is-refused',
			'app-cvm-rate-is-a-dependency',
		]) {
			expect(html).toContain(`data-assumption-id="${id}"`)
		}

		// The instance's own edge, as words a reader can quote.
		expect(html).toContain('an injected fixture, not a live relay read')
		expect(html).toContain('No live relay read has ever been performed by this demo')
		// …and the falsifier travels beside the statement, not in a comment.
		expect(html).toContain('falsified by')
	})

	test('the register never claims the edge this run did not take', () => {
		const relayRegister = buildAssumptionRegister({
			sourceKind: 'relay',
			relayUrls: ['wss://relay.example.test'],
			displayCurrency: 'BTC',
		})
		const html = render({ ...shell, route: 'products', sourceKind: 'relay' as const, assumptions: relayRegister })

		expect(html).toContain('came from a live relay read')
		expect(html).not.toContain('an injected fixture, not a live relay read')
	})
})

describe('every page link the nav emits resolves to a page route', () => {
	const html = render({ ...shell, route: 'products' })
	const navHrefs = [...html.matchAll(/class="ds-nav-link"[^>]*href="([^"]+)"/g)].map((match) => match[1] as string)

	test('the nav is drawn from the one declared list, in order', () => {
		expect(navHrefs).toEqual([PRODUCTS_PATH, CART_PATH, CHECKOUT_PATH])
	})

	test('each href is a path some branch of the server answers', () => {
		for (const href of navHrefs) expect(isPagePath(href)).toBe(true)
	})

	test('the nav marks the section the route belongs to, and only that one', () => {
		expect(render({ ...shell, route: 'products' })).toContain(`href="${PRODUCTS_PATH}" aria-current="page"`)
		expect(render({ ...shell, route: 'cart' })).toContain(`href="${CART_PATH}" aria-current="page"`)
		expect(render({ ...shell, route: 'checkout' })).toContain(`href="${CHECKOUT_PATH}" aria-current="page"`)

		for (const route of ['products', 'cart', 'checkout'] as const) {
			const page = render({ ...shell, route })
			expect(page.match(/aria-current="page"/g)).toHaveLength(1)
		}
	})
})

describe('an address that resolves to nothing is a surface with its own words', () => {
	const html = render({
		...shell,
		route: 'product-missing',
		missing: { coordinates: `30402:${DEMO_SELLER_PUBKEY}:not-a-listing`, reason: 'not-admitted' },
	})

	test('the reason is rendered, not an empty region', () => {
		expect(html).toContain('This instance never admitted a listing at that address.')
		expect(regionsOf(html)).toEqual(['region-foot', 'region-instance', 'region-nav', 'region-product'])
	})

	test('the hidden listing gets its own sentence', () => {
		const hidden = render({
			...shell,
			route: 'product-missing',
			missing: { coordinates: `30402:${DEMO_SELLER_PUBKEY}:hidden-draft`, reason: 'not-on-sale' },
		})
		expect(hidden).toContain('That listing is not on sale')
	})
})
