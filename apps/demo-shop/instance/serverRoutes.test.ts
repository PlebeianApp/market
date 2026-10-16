/**
 * serverRoutes.test.ts — **the placement route, driven at the server.**
 *
 * Increment 1 landed the placement: the checkout submits this browser's cart record,
 * the instance places the order through `sdk/commerce/orders/orderPlacement.ts`, and it
 * answers `303` to a `/orders/<id>` address that is **server-rendered**. It was proven
 * live — a `curl` and a screenshot — and by nothing that drives the server:
 * `instance/ssr.test.ts` renders components to a string and
 * `instance/checkoutPlacement.test.ts` calls the placement module directly. Neither can
 * see the route. This file is the missing half: it starts the host on an **ephemeral
 * loopback port** and speaks to it over HTTP, so every claim here is about a **response**
 * — a status line, a header, the bytes — rather than about a function's return value.
 *
 * The instance boots on its injected fixture edge (`relayUrls: []`), so the run composes
 * no relay and reaches no socket but its own listener: nothing is put on the wire
 * (ADR-0005). The listener binds `127.0.0.1` and asks the kernel for a free port, so the
 * file cannot collide with another run and takes no operator's port. The server accepts
 * `port`/`hostname` as options for exactly this reason — writing `process.env` to
 * configure one test's socket would leak into every other module in the process.
 *
 * The order id is a digest of the cart plus the request time, so this file **derives it
 * from the `Location` header** and never types one. The cart record is built by the app's
 * own builder (`cartIntentOf`), so the bytes the server parses are the bytes the browser
 * would have stored; the form's field names come from the module that declares them.
 *
 * The mutations that turn these cases red:
 * - dropping the `303` redirect in the placement handler: case 1's status assertion fails
 *   (the browser would sit on the checkout page after a placement).
 * - deleting the `data-order-id` attribute from the order region: case 1's order-page
 *   assertion fails, and the page would carry no id a reader could address.
 * - seeding a shipping choice from the seller's first published option when the form
 *   carried none: case 2 stops refusing and answers `303`.
 * - accepting the bytes the SDK's parser refused (guessing at the record): case 3's
 *   `unreadable-cart` assertion fails, and the page would name the wrong gap.
 * - removing the method guard: case 4's `405` assertion fails — a write to a read-only
 *   address would be answered with the page.
 * - matching the order prefix alone in `orderIdFromOrderPath`: case 5's bare-prefix case
 *   fails — `/orders/` becomes an order address nobody named.
 * - dropping the server's published-ref guard: case 6 fails — a shipping ref the seller
 *   never published would be applied, and the refusal would name the shopper's ref rather
 *   than the checkout's own missing-shipping-method gap.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import {
	CART_FIELD_NAME,
	SHIPPING_CHOICE_FIELD_PREFIX,
} from './checkoutView'
import { cartIntentOf, cartLineFrom, type Cart } from './cartState'
import { DEMO_SELLER_PUBKEY, DEMO_SHIPPING_REF } from './catalog'
import { CART_PATH, CHECKOUT_PATH, ORDERS_PATH_PREFIX, orderIdFromOrderPath } from './routes'
import { startDemoShop, type StartedDemoShop } from '../server'

/** The clock the cart record is stamped with. Injected, so nothing reads a wall clock. */
const CLOCK = 1_760_000_000_000

/**
 * The run this file drives: the fixture edge and no relay set.
 *
 * Passed explicitly rather than resolved from `process.env`, so the test does not depend
 * on the environment it happens to run in — and so it cannot pick up relays from one.
 */
const FIXTURE_RUN = {
	instanceId: 'demo-shop',
	displayName: 'Demo Shop',
	displayCurrency: 'BTC',
	relayUrls: [],
} as const

/** A shipping ref shaped like a real one that this seller does **not** publish. */
const UNPUBLISHED_SHIPPING_REF = `30406:${DEMO_SELLER_PUBKEY}:standard-express`

let shop: StartedDemoShop

beforeAll(async () => {
	shop = await startDemoShop({ port: 0, hostname: '127.0.0.1', config: FIXTURE_RUN })
})

afterAll(() => {
	shop.server.stop(true)
})

/** An address on the listener this run bound. Loopback, and only this run's port. */
function address(path: string): string {
	return new URL(path, `http://127.0.0.1:${shop.server.port}`).toString()
}

/** The field name a shipping choice travels in: the prefix the module declares, then the seller. */
function shippingField(sellerPubkey: string): string {
	return `${SHIPPING_CHOICE_FIELD_PREFIX}${sellerPubkey}`
}

/** The wool coat, as the list this instance read holds it. */
function theWoolCoat() {
	const coat = shop.runtime.view.items.find((item) => item.id === 'wool-coat')
	if (!coat) throw new Error('the fixture catalogue should hold the wool coat')
	return coat
}

/**
 * This browser's cart record for one listing, built by the app's own builder.
 *
 * `cartLineFrom` leaves `shippingMethodId` null — the buy control does not ask for a
 * choice — so the record carries no shipping ref and the choice arrives in its own form
 * field, exactly as the checkout submits it.
 */
function cartRecord(amount = 2): string {
	const cart: Cart = { lines: [cartLineFrom(theWoolCoat(), amount)] }
	return JSON.stringify(cartIntentOf(cart, CLOCK))
}

/** Submit the checkout the way the form does, without following the redirect. */
function submitCheckout(fields: Record<string, string>): Promise<Response> {
	const body = new URLSearchParams()
	for (const [field, value] of Object.entries(fields)) body.append(field, value)
	return fetch(address(CHECKOUT_PATH), { method: 'POST', body, redirect: 'manual' })
}

describe('the placement answers where the order lives, and that address serves it', () => {
	test('POST /checkout places, answers 303 to a /orders/<id>, and the page carries the order', async () => {
		const response = await submitCheckout({
			[CART_FIELD_NAME]: cartRecord(),
			[shippingField(DEMO_SELLER_PUBKEY)]: DEMO_SHIPPING_REF,
		})

		expect(response.status).toBe(303)

		const location = response.headers.get('location')
		expect(location).not.toBeNull()

		// The id is a digest of the cart plus the request time, so it is read out of the
		// header the instance wrote and never typed here. The header is resolved against
		// this listener's own origin, so the case holds whether the instance writes the
		// address absolute or relative.
		const path = new URL(location as string, address('/')).pathname
		expect(path.startsWith(ORDERS_PATH_PREFIX)).toBe(true)
		const orderId = orderIdFromOrderPath(path)
		expect(orderId).not.toBeNull()

		// The instance remembers the order it just placed, under that same id.
		expect(shop.placedOrders.ids()).toContain(orderId as string)

		const page = await fetch(address(path))
		const html = await page.text()

		expect(page.status).toBe(200)
		expect(html).toContain(`data-order-id="${orderId}"`)

		// The status is the SDK's derivation over the built event's own tags, and the
		// badge's text is that derivation — not a label the page chose.
		const badge = /data-testid="order-status-badge"[^>]*>([^<]*)</.exec(html)
		expect(badge?.[1]).toBe('pending')

		// The whole assumption register is in the served bytes: 24 entries on this run.
		expect(html.match(/data-assumption-id=/g) ?? []).toHaveLength(24)

		// The order is now signed by the demo's own key, generated at boot.
		expect(html).toContain('signed — the event carries a signature')
	})
})

describe('a submission the instance cannot place says so in its own words', () => {
	test('a cart with no shipping choice is refused as unresolved delivery, naming the gap', async () => {
		const response = await submitCheckout({ [CART_FIELD_NAME]: cartRecord() })
		const html = await response.text()

		expect(response.status).toBe(200)
		expect(html).toContain('data-refusal-reason="unresolved_delivery"')
		// The checkout's own sentinel for the line whose shipping method is missing — the
		// module's words, not a sentence this page composed.
		expect(html).toContain('product:wool-coat:missing-shipping-method')
	})

	test('a body that is not a cart record is refused as unreadable, before any placement', async () => {
		const response = await submitCheckout({ [CART_FIELD_NAME]: '{"not":"a cart"}' })
		const html = await response.text()

		expect(response.status).toBe(200)
		expect(html).toContain('data-refusal-reason="unreadable-cart"')
	})
})

describe('the instance reads everything here, and the one address that also places', () => {
	test('a write to a read-only address is answered 405, not with the page', async () => {
		const response = await fetch(address(CART_PATH), {
			method: 'POST',
			body: new URLSearchParams({ anything: 'at all' }),
		})

		expect(response.status).toBe(405)
		expect(response.headers.get('allow')).toBe('GET, HEAD')
	})
})

describe('an order address resolves exactly or not at all', () => {
	test('an address the instance holds no order under is its own page, answered 404', async () => {
		const response = await fetch(address('/orders/order-does-not-exist'))
		const html = await response.text()

		expect(response.status).toBe(404)
		expect(html).toContain('data-testid="order-missing"')
	})

	test('a prefix with no child is not an order, and not swallowed by its parent', async () => {
		const response = await fetch(address(ORDERS_PATH_PREFIX))
		const html = await response.text()

		expect(response.status).toBe(404)
		// Not the order-missing surface either: `/orders/` names no order, so the router
		// must answer "not found" rather than a page for an order nobody named.
		expect(html).not.toContain('data-testid="order-missing"')
	})
})

describe('a shipping ref the seller never published is not applied', () => {
	test('the placement refuses, names the checkout’s own gap, and places nothing', async () => {
		const before = [...shop.placedOrders.ids()]

		const response = await submitCheckout({
			[CART_FIELD_NAME]: cartRecord(),
			[shippingField(DEMO_SELLER_PUBKEY)]: UNPUBLISHED_SHIPPING_REF,
		})
		const html = await response.text()

		expect(response.status).toBe(200)
		expect(html).toContain('data-refusal-reason="unresolved_delivery"')
		// The choice was dropped, so the line still has no shipping method: the gap named
		// is the checkout's own sentinel, not the ref the shopper sent.
		expect(html).toContain('product:wool-coat:missing-shipping-method')
		expect(html).not.toContain(UNPUBLISHED_SHIPPING_REF)
		// And nothing was placed at all.
		expect([...shop.placedOrders.ids()]).toEqual(before)
	})
})
