/**
 * scripts/capture-order-flow.mjs — the acceptance harness for **the placement flow**.
 *
 * `capture-surface.mjs` captures one surface (with an optional click-then-navigate pair).
 * This one captures the flow this increment is about, which is longer than that: a listing
 * is added to the cart, the checkout is opened, the shipping method the checkout needs is
 * chosen, the order is **placed**, and the instance answers with the order's own page.
 *
 * It is a capture harness, not a repository e2e spec (AGENTS.md's Feature Quality Gate
 * wants a Playwright spec under `e2e/` with published video; that is a named follow-up).
 * Like `capture-surface.mjs` it reads the page's own visible text per `data-testid` as
 * well as photographing it, so *exists but is empty* cannot pass.
 *
 * Usage:
 *   bun run apps/demo-shop/scripts/capture-order-flow.mjs <baseUrl> <outDir> <productCoordinates>
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const [baseUrl, outDirArg, coordinates] = process.argv.slice(2)
if (!baseUrl || !outDirArg || !coordinates) {
	console.error('usage: capture-order-flow.mjs <baseUrl> <outDir> <productCoordinates>')
	process.exit(2)
}

const outDir = resolve(outDirArg)
await mkdir(outDir, { recursive: true })

/** The identifiers the pages carry, so the text can be read back per named element. */
const CHECKOUT_READS = [
	'checkout-summary',
	'checkout-delivery',
	'checkout-delivery-badge',
	'checkout-invoice',
	'checkout-outcome',
	'checkout-place-truth',
	'checkout-shipping-read',
	'checkout-shipping-select',
	'checkout-place',
	'checkout-place-status',
	'checkout-refusal',
	'checkout-refusal-refs',
	'assumption-summary',
]

const ORDER_READS = [
	'order-id',
	'order-status-badge',
	'order-merchant',
	'order-amount',
	'order-truth',
	'order-stage-order-status',
	'order-stage-shipping-status',
	'order-stage-payment-lifecycle',
	'order-stage-signature',
	'order-stage-publication',
	'order-status-source',
	'order-invoice',
	'order-item',
	'order-shipping',
	'order-event-header',
	'order-event-tags',
	'order-memory-note',
	'order-missing',
	'assumption-summary',
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 })

const consoleErrors = []
page.on('console', (message) => {
	if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

const steps = []

const readTests = async (ids) => {
	const out = {}
	for (const id of ids) {
		const locator = page.locator(`[data-testid="${id}"]`)
		const count = await locator.count()
		out[id] = count === 0 ? null : count === 1 ? await locator.innerText() : await locator.allInnerTexts()
	}
	return out
}

// 1. a listing, and the buy control — after the browser has read its cart.
await page.goto(`${baseUrl}/products/${encodeURIComponent(coordinates)}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="add-to-cart"]', { timeout: 15_000 })
await page.waitForFunction(() => !document.querySelector('[data-testid="add-to-cart"]')?.disabled, { timeout: 15_000 })
await page.click('[data-testid="add-to-cart"]')
await page.waitForTimeout(300)
steps.push('add the listing to the cart')
const buyStatus = await page.innerText('[data-testid="add-to-cart-status"]')

// 2. the checkout, with the place control enabled only once the cart has been read.
await page.goto(`${baseUrl}/checkout`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="checkout-place"]', { timeout: 15_000 })
await page.waitForFunction(() => !document.querySelector('[data-testid="checkout-place"]')?.disabled, { timeout: 15_000 })
steps.push('open the checkout, with the cart read and the place control enabled')

const checkoutReadsBefore = await readTests(CHECKOUT_READS)
const placeStateBefore = await page.getAttribute('[data-testid="checkout-place"]', 'data-place-state')
const shippingOptions = await page.$$eval('[data-testid="checkout-shipping-option"]', (options) =>
	options.map((option) => ({ value: option.value, label: option.textContent })),
)
const checkoutScreenshot = resolve(outDir, 'checkout-handoff.png')
await page.screenshot({ path: checkoutScreenshot, fullPage: true })

// 3. the shipping method the checkout needs, then place.
const chosenShippingRef = shippingOptions[0]?.value ?? ''
if (chosenShippingRef) {
	await page.selectOption('[data-testid="checkout-shipping-select"]', chosenShippingRef)
	await page.waitForTimeout(200)
	steps.push(`choose the shipping method ${chosenShippingRef}`)
}

await Promise.all([
	page.waitForURL((url) => url.pathname.startsWith('/orders/'), { timeout: 20_000 }),
	page.click('[data-testid="checkout-place"]'),
])
await page.waitForLoadState('networkidle')
steps.push('place the order and land on the order page')

const orderUrl = page.url()
const orderReads = await readTests(ORDER_READS)
const orderScreenshot = resolve(outDir, 'order-details.png')
await page.screenshot({ path: orderScreenshot, fullPage: true })

// 4. an address this instance holds nothing under is its own page.
await page.goto(`${baseUrl}/orders/order-does-not-exist`, { waitUntil: 'networkidle' })
const missingReads = await readTests(['order-missing', 'order-missing-title', 'order-missing-reason'])
const missingScreenshot = resolve(outDir, 'order-missing.png')
await page.screenshot({ path: missingScreenshot, fullPage: true })
steps.push('open an order address this instance holds nothing under')

console.log(
	JSON.stringify(
		{
			steps,
			buyStatus,
			checkoutScreenshot,
			checkoutReadsBefore,
			placeStateBefore,
			shippingOptions,
			chosenShippingRef,
			orderUrl,
			orderScreenshot,
			orderReads,
			missingScreenshot,
			missingReads,
			consoleErrors,
		},
		null,
		2,
	),
)

await browser.close()
