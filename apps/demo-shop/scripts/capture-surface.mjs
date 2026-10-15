/**
 * scripts/capture-surface.mjs — the acceptance harness for this app's surfaces.
 *
 * It serves nothing and mocks nothing: it points a real browser at a running
 * demo-shop instance, waits for the surface, **reads the page's own visible text
 * back out of the DOM**, records the computed styles a styling change has to move,
 * and writes a screenshot. The text is read as well as photographed so that
 * *exists but is empty* cannot pass, and the computed styles are read because a
 * grep of the served HTML says "the sheet is there" over a page that renders
 * unstyled — the page is the only witness (ADR-0021's three-part split makes the
 * stylesheet a request, not an import).
 *
 * Usage:
 *   bun run apps/demo-shop/scripts/capture-surface.mjs <url> <outDir> <name> \
 *     [width] [height] [waitSelector] [clickSelector] [thenUrl]
 *
 * `clickSelector` and `thenUrl` are how a two-step flow is captured: click (this
 * is where an add-to-cart lands), then navigate on. Both are optional and the
 * single-page case is the default.
 *
 * Examples:
 *   … capture-surface.mjs http://127.0.0.1:3411/ ../.capture product-list.png
 *   … capture-surface.mjs http://127.0.0.1:3411/cart ../.capture cart.png 1280 900 \
 *       '[data-testid="cart-lines"]' '[data-testid="add-to-cart"]' 'http://127.0.0.1:3411/cart'
 *
 * NOTE: this is a capture harness, not a repository e2e spec. AGENTS.md ("Feature
 * Quality Gate") requires a targeted Playwright spec under `e2e/` with published
 * video; that is a named follow-up, not something this file pretends to be.
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const [url, outDirArg, name, widthArg, heightArg, waitSelectorArg, clickSelector, thenUrl] = process.argv.slice(2)
if (!url || !outDirArg || !name) {
	console.error('usage: capture-surface.mjs <url> <outDir> <name> [w] [h] [waitSelector] [clickSelector] [thenUrl]')
	process.exit(2)
}

const outDir = resolve(outDirArg)
const width = Number(widthArg ?? 1280)
const height = Number(heightArg ?? 900)
const waitSelector = waitSelectorArg ?? '[data-testid]'

await mkdir(outDir, { recursive: true })

/** The selectors whose computed style a styling change has to move. */
const PROBE = ['body', '.ds-region', '.ds-row', '.ds-detail', '.ds-cart', '.ds-btn', '[data-slot="badge"]', '.ds-cart-status']

/** The page's own text, per named element, so a reader can quote it. */
const READ_TESTS = [
	'instance-name',
	'edge-line',
	'cart-status',
	'product-list-summary',
	'product-row',
	'product-title',
	'product-price',
	'product-coordinates',
	'product-detail-title',
	'product-detail-price',
	'product-detail-description',
	'product-detail-stock',
	'add-to-cart',
	'add-to-cart-status',
	'cart-summary',
	'cart-line',
	'cart-subtotal',
	'cart-total',
	'cart-checkout-link',
	'checkout-summary',
	'checkout-delivery',
	'checkout-outcome',
	'composition-path',
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })

const consoleErrors = []
page.on('console', (message) => {
	if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

const steps = [`goto ${url}`]
await page.goto(url, { waitUntil: 'networkidle' })

/**
 * Wait for the surface, then for the browser-owned cart read to land, BEFORE any
 * click. A click on a server-rendered control before hydration reaches nothing —
 * React has not attached the handler yet — so a capture taken that way reports a
 * working control as dead. This is also why the click sits after the wait rather
 * than before it.
 */
await page.waitForSelector(waitSelector, { timeout: 15_000 })
steps.push(`wait for ${waitSelector}`)

const cartSettled = () =>
	!document.querySelector('[data-testid="cart-status"][data-cart-state="reading"]')

await page.waitForFunction(cartSettled, { timeout: 15_000 }).catch(() => {
	consoleErrors.push('timed out waiting for the cart status to leave its reading state')
})

if (clickSelector) {
	await page.waitForSelector(clickSelector, { timeout: 15_000 })
	await page.click(clickSelector)
	steps.push(`click ${clickSelector}`)
	// A click that changes state must be given its effect before it is read: a
	// value that moves through a render is not there the instant it is clicked.
	await page.waitForTimeout(400)
}

if (thenUrl) {
	await page.goto(thenUrl, { waitUntil: 'networkidle' })
	steps.push(`goto ${thenUrl}`)
	await page.waitForSelector(waitSelector, { timeout: 15_000 })
	await page.waitForFunction(cartSettled, { timeout: 15_000 }).catch(() => {
		consoleErrors.push('timed out waiting for the cart status to leave its reading state')
	})
}

const readText = async (testId) => {
	const locator = page.locator(`[data-testid="${testId}"]`)
	const count = await locator.count()
	if (count === 0) return null
	return count === 1 ? await locator.innerText() : await locator.allInnerTexts()
}

const readTests = {}
for (const testId of READ_TESTS) readTests[testId] = await readText(testId)

const computed = await page.evaluate((selectors) => {
	const out = {}
	for (const selector of selectors) {
		const element = document.querySelector(selector)
		if (!element) {
			out[selector] = null
			continue
		}
		const style = getComputedStyle(element)
		out[selector] = {
			borderRadius: style.borderRadius,
			backgroundColor: style.backgroundColor,
			backgroundImage: style.backgroundImage === 'none' ? 'none' : 'linear-gradient',
			color: style.color,
			padding: style.padding,
		}
	}
	return out
}, PROBE)

const regions = await page.evaluate(() =>
	[...document.querySelectorAll('.region')].map((element) => ({
		className: element.className,
		ariaLabel: element.getAttribute('aria-label'),
	})),
)

const screenshotPath = resolve(outDir, name)
await page.screenshot({ path: screenshotPath, fullPage: true })

console.log(
	JSON.stringify(
		{
			screenshotPath,
			steps,
			url: page.url(),
			title: await page.title(),
			readTests,
			regions,
			computed,
			bodyText: await page.innerText('body'),
			consoleErrors,
		},
		null,
		2,
	),
)

await browser.close()
