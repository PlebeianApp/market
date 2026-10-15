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
import { buildCatalogEvents, DEMO_SELLER_PUBKEY } from './catalog'
import { findProductDetail } from './productDetailView'
import { buildProductListView } from './productListView'
import { CART_PATH, CHECKOUT_PATH, PRODUCTS_PATH, coordinatesFromProductPath, isPagePath } from './routes'

const catalog = buildCatalogEvents()
const view = buildProductListView(catalog)

const shell = {
	instanceName: 'Demo Shop',
	instanceId: 'demo-shop',
	sourceKind: 'fixture' as const,
	view,
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
		expect(html).toContain('0.00185 BTC')
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
		expect(html).toContain('0.00185 BTC')
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

	test('the checkout entry: its own heading is in the bytes, and it promises no payment', () => {
		const html = render({ ...shell, route: 'checkout' })

		expect(html).toContain('Checkout')
		expect(html).toContain('data-checkout-state="reading"')
		expect(html).toContain('data-skeleton="1"')
		expect(html).not.toContain('data-testid="checkout-outcome"')
		expect(regionsOf(html)).toEqual(['region-checkout', 'region-foot', 'region-instance', 'region-nav'])
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
