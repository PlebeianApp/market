/**
 * orderView.test.ts — **the order details page reflects the order's own status, and says
 * what the order is not.**
 *
 * Two requirements, and this file holds both as facts about the value the page renders.
 *
 * ## 1. The status is the SDK's, derived from the event — never a label
 *
 * `buildOrderView` consumes the `orderStatus`/`shippingStatus` that
 * `placeBuyerOrdersFromCartIntent` derived from the tags of the event it built, and this
 * suite proves it is not a constant by **changing the event** and reading the view again:
 * a template carrying `['status','delivered']` yields a shipping status of `delivered`
 * while the order status stays `pending` (the two vocabularies are disjoint, and one tag
 * feeds both resolvers). The mutation that turns this red is hard-coding `'pending'`.
 *
 * ## 2. Built is not signed, published or paid — and the page cannot say otherwise
 *
 * The three claims are three labelled lines, and they are *separately* checked:
 * `not-requested` (the module's lifecycle **stage**, imported and never re-typed),
 * `not signed` (derived by inspecting the template's own envelope),
 * `not-published` (named, because this app composes no publish path — an arm below walks
 * every file the app owns and refuses a publishing symbol; signing symbols are allowed
 * because the demo signs its own orders before storing them).
 *
 * The mutations that turn these red:
 * - rendering a `paid` boolean beside the stage: the "no boolean" arm names the key.
 * - importing `executeSellerOrderPublishWorkflow` (or a signing helper) anywhere under
 *   `apps/demo-shop`: the source arm names the file.
 * - deriving the shipping status from the order status instead of the event: the
 *   `delivered`/`pending` arm fails, because the two are not the same question.
 */

import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { createBuyerOrderTemplate } from '@sdk/commerce/orders/orderEvents'
import { resolveBuyerOrderStatus, resolveBuyerShippingStatus } from '@sdk/commerce/orders/orderStatus'
import { PLACED_ORDER_PAYMENT_LIFECYCLE, type PlacedBuyerOrder } from '@sdk/commerce/orders/orderPlacement'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY, DEMO_SHIPPING_REF } from './catalog'
import type { Cart } from './cartState'
import { placeCheckout } from './checkoutView'
import {
	ORDER_PUBLICATION_STATE,
	PLACED_ORDER_PAYMENT_STAGE,
	buildOrderView,
	orderLifecycleLines,
	orderStatusExplanation,
} from './orderView'
import { PLACED_ORDER_TRUTH } from './OrderDetail'
import { buildProductListView } from './productListView'
import { buildShippingRead } from './shippingSource'

const APP_ROOT = resolve(import.meta.dir, '..')
const CLOCK = 1_760_000_000_000

const catalog = buildCatalogEvents()
const items = buildProductListView(catalog).items
const shipping = buildShippingRead(catalog)

const placeableCart: Cart = {
	lines: [
		{
			productRef: '30402:' + DEMO_SELLER_PUBKEY + ':wool-coat',
			id: 'wool-coat',
			sellerPubkey: DEMO_SELLER_PUBKEY,
			amount: 2,
			shippingMethodId: DEMO_SHIPPING_REF,
		},
	],
}

/** The demo's own order, placed through the app's own path. */
function demoOrder(): PlacedBuyerOrder {
	const attempt = placeCheckout(placeableCart, {
		items,
		servicesByShippingRef: shipping.servicesByShippingRef,
		createdAtMs: CLOCK,
	})
	if (attempt.outcome.status !== 'placed') throw new Error('the demo cart should place')
	return attempt.outcome.orders[0] as PlacedBuyerOrder
}

const viewOf = (placed: PlacedBuyerOrder) =>
	buildOrderView(placed, { items, servicesByShippingRef: shipping.servicesByShippingRef })

describe('the status the page renders is the one the SDK derived from the event', () => {
	test('a placed demo order is pending, with no shipping status and no payment begun', () => {
		const view = viewOf(demoOrder())

		expect(view.status).toBe('pending')
		expect(view.shippingStatus).toBeNull()
		expect(view.payment).toBe(PLACED_ORDER_PAYMENT_LIFECYCLE)
		expect(view.payment).toBe('not-requested')
		// The event really carries no `status` tag — which is *why* the answer is pending.
		expect(view.statusTagPresent).toBe(false)
		expect(orderStatusExplanation(view)).toContain('carries no `status` tag')
	})

	test('the page follows the event, not a constant: a status tag changes what is shown', () => {
		const placed = demoOrder()

		// The same order, with the event carrying a status the shipping vocabulary owns.
		const delivered = createBuyerOrderTemplate({
			merchantPubkey: DEMO_SELLER_PUBKEY,
			orderId: placed.orderId,
			amountSats: placed.amountSats,
			items: [{ productRef: placed.items[0]?.productRef ?? '', quantity: 2 }],
			shippingRef: DEMO_SHIPPING_REF,
			createdAt: placed.order.created_at,
		})
		delivered.tags.push(['status', 'delivered'])

		const moved: PlacedBuyerOrder = {
			...placed,
			order: delivered,
			orderStatus: resolveBuyerOrderStatus(delivered.tags),
			shippingStatus: resolveBuyerShippingStatus(delivered.tags),
		}
		const view = viewOf(moved)

		// Shipping moved; the order status did not, because `delivered` is not an order
		// status — the two states are separate questions over one tag.
		expect(view.shippingStatus).toBe('delivered')
		expect(view.status).toBe('pending')
		expect(view.statusTagPresent).toBe(true)
		expect(orderStatusExplanation(view)).toContain('a `status` tag')

		// And an order status the order vocabulary owns moves the order status instead.
		const completed = createBuyerOrderTemplate({
			merchantPubkey: DEMO_SELLER_PUBKEY,
			orderId: placed.orderId,
			amountSats: placed.amountSats,
			items: [],
			createdAt: placed.order.created_at,
		})
		completed.tags.push(['status', 'completed'])
		const completedView = viewOf({
			...placed,
			order: completed,
			orderStatus: resolveBuyerOrderStatus(completed.tags),
			shippingStatus: resolveBuyerShippingStatus(completed.tags),
		})

		expect(completedView.status).toBe('completed')
		expect(completedView.shippingStatus).toBeNull()
	})
})

describe('the five stages are separate, and none of them is a settlement', () => {
	const view = viewOf(demoOrder())
	const lines = orderLifecycleLines(view)

	test('there are five, each labelled, each with its own words', () => {
		expect(lines.map((line) => line.label)).toEqual([
			'Order status',
			'Shipping status',
			'Payment lifecycle',
			'Signature',
			'Publication',
		])
		for (const line of lines) expect(line.value.trim().length).toBeGreaterThan(5)
	})

	test('the payment line is a stage, and it says no payment was requested', () => {
		const payment = lines.find((line) => line.label === 'Payment lifecycle')

		expect(payment?.value).toContain('not-requested')
		expect(payment?.value).toContain('no payment has been requested')
		// A stage that has not begun is not a success — the tone says so rather than
		// painting an unsettled order green.
		expect(payment?.tone).toBe('warn')
	})

	test('the view has no boolean that could stand in for settlement', () => {
		const keys = Object.keys(view)

		for (const forbidden of ['paid', 'settled', 'complete', 'paymentReceived', 'isPaid']) {
			expect(keys).not.toContain(forbidden)
		}
		// The view's *only* booleans are two facts about the order's shape — whether a
		// private delivery is required, and whether the built event carries a `status`
		// tag. Neither is a money claim, and neither could stand in for one.
		const booleans = (Object.keys(view) as (keyof typeof view)[]).filter((key) => typeof view[key] === 'boolean')
		expect(booleans.sort()).toEqual(['requiresPrivateDelivery', 'statusTagPresent'])
		// The lifecycle is the module's own closed value.
		expect(PLACED_ORDER_PAYMENT_STAGE).toBe('not-requested')
	})

	test('the shipping status is not the order status wearing another name', () => {
		expect(view.shippingStatus).toBeNull()
		expect(view.status).toBe('pending')
		expect(JSON.stringify(view)).not.toContain('"shippingStatus":"pending"')
	})
})

describe('unsigned and unpublished are stated, not implied', () => {
	test('signature is derived from the template’s own envelope', () => {
		const placed = demoOrder()
		expect(viewOf(placed).signature).toBe('unsigned')

		// A template that carries a signature reports one — the derivation reads the
		// envelope, so it cannot be a constant either.
		const signed = { ...placed, order: { ...placed.order, sig: 'deadbeef' } }
		expect(viewOf(signed).signature).toBe('signed')
	})

	test('publication is named, and the app composes no path that could publish', async () => {
		expect(viewOf(demoOrder()).publication).toBe(ORDER_PUBLICATION_STATE)
		expect(ORDER_PUBLICATION_STATE).toBe('not-published')

		const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
		const SKIP = new Set(['node_modules', '.capture', 'dist'])
		const TEST_FILE = /\.test\.(ts|tsx)$/
		const FORBIDDEN = [
			'executeSellerOrderPublishWorkflow',
			'finalizeEvent',
			'createSellerOrderPublishFailure',
		]

		async function listFiles(directory: string): Promise<string[]> {
			const entries = await readdir(directory, { withFileTypes: true })
			const nested = await Promise.all(
				entries.map(async (entry) => {
					if (SKIP.has(entry.name)) return []
					if (TEST_FILE.test(entry.name)) return []
					const full = join(directory, entry.name)
					if (entry.isDirectory()) return listFiles(full)
					return SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.'))) ? [full] : []
				}),
			)
			return nested.flat()
		}

		// Prose is stripped before the sweep, exactly as `theme.test.ts` does for its
		// palette: a module's header *naming* the publish workflow it does not call is a
		// comment, not a call site. What is swept is what the app would run.
		const violations: string[] = []
		for (const path of await listFiles(APP_ROOT)) {
			const applied = (await readFile(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
			for (const needle of FORBIDDEN) {
				if (applied.includes(needle)) violations.push(`${path.slice(APP_ROOT.length + 1)} carries ${needle}`)
			}
		}

		expect(violations).toEqual([])
	})

	test('the page’s one-line truth names all three claims', () => {
		expect(PLACED_ORDER_TRUTH).toContain('not signed')
		expect(PLACED_ORDER_TRUTH).toContain('not published')
		expect(PLACED_ORDER_TRUTH).toContain('no payment has been requested')
	})
})

describe('the order’s own fields come from the placed order', () => {
	test('the id, the amount and the merchant are the order’s, not the page’s', () => {
		const placed = demoOrder()
		const view = viewOf(placed)

		expect(view.orderId).toBe(placed.orderId)
		expect(view.amountSats).toBe(placed.amountSats)
		expect(view.sellerPubkey).toBe(placed.sellerPubkey)
		expect(view.sellerLabel).toBe('7e7c3b5a…0f12')
	})

	test('each line is named by the read where the read answers, and by its ref where it does not', () => {
		const placed = demoOrder()
		const view = viewOf(placed)
		const line = view.items[0]

		expect(line?.productRef).toBe('30402:' + DEMO_SELLER_PUBKEY + ':wool-coat')
		expect(line?.productId).toBe('wool-coat')
		expect(line?.quantity).toBe(2)
		expect(line?.title).toBe('Merino Wool Coat')

		// A read that does not carry the listing names the ref and admits it cannot.
		const unread = buildOrderView(placed, { items: [], servicesByShippingRef: {} })
		expect(unread.items[0]?.title).toBeNull()
		expect(unread.items[0]?.productId).toBe('wool-coat')
	})

	test('the shipping ref and the service the read resolved for it are both shown', () => {
		const view = viewOf(demoOrder())

		expect(view.shippingRef).toBe(DEMO_SHIPPING_REF)
		expect(view.shippingService).toBe('standard')
		expect(view.requiresPrivateDelivery).toBe(true)

		// With no record read, the service is `null` — not the ref's text.
		const unread = buildOrderView(demoOrder(), { items, servicesByShippingRef: {} })
		expect(unread.shippingService).toBeNull()
	})

	test('no invoice is open, from the SDK’s own rule over the invoices that exist', () => {
		expect(viewOf(demoOrder()).nextInvoiceIndex).toBe(-1)
	})

	test('the event under the page is readable: its tags are carried for a reader to check', () => {
		const view = viewOf(demoOrder())

		expect(view.eventKind).toBe(16)
		expect(view.eventCreatedAt).toBe(Math.floor(CLOCK / 1000))
		expect(view.eventContent).toBe('Order created')
		expect(view.eventTags.map((tag) => tag[0])).toEqual([
			'p',
			'subject',
			'type',
			'order',
			'amount',
			'item',
			'shipping',
		])
	})
})
