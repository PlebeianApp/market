/**
 * scripts/capture-product-list.mjs — the acceptance harness for this slice.
 *
 * It serves nothing and mocks nothing: it points a real browser at a running
 * demo-shop instance, waits for the rendered rows, reads the page's own visible
 * text back out of the DOM, and writes a screenshot. The point is that the
 * screenshot is taken of a page whose text was *also read*, so "exists but is
 * empty" cannot pass.
 *
 * Usage:
 *   TMPDIR=/home/admin_maxime/work/.tmp bun run apps/demo-shop/scripts/capture-product-list.mjs [url] [outDir] [width] [height] [name]
 *
 * Defaults: http://127.0.0.1:3400/, ../.capture, 1280, 900, product-list.png.
 * A second call at a narrow viewport is how the same page is shown holding at
 * phone width:
 *   … capture-product-list.mjs http://127.0.0.1:3400/ ../.capture 430 932 product-list-narrow.png
 *
 * NOTE: this is a capture harness, not a repository e2e spec. AGENTS.md ("Feature
 * Quality Gate") requires a targeted Playwright spec under `e2e/` with published
 * video; that is a named follow-up, not something this file pretends to be.
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:3400/'
const outDir = resolve(process.argv[3] ?? new URL('../.capture', import.meta.url).pathname)
const width = Number(process.argv[4] ?? 1280)
const height = Number(process.argv[5] ?? 900)
const name = process.argv[6] ?? 'product-list.png'

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })

const consoleErrors = []
page.on('console', (message) => {
	if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="product-row"]', { timeout: 15_000 })

const summary = {
	url: page.url(),
	title: await page.title(),
	instanceName: await page.innerText('[data-testid="instance-name"]'),
	edgeLine: await page.innerText('[data-testid="edge-line"]'),
	listSummary: await page.innerText('[data-testid="product-list-summary"]'),
	compositionPath: await page.innerText('[data-testid="composition-path"]'),
	rowCount: await page.locator('[data-testid="product-row"]').count(),
	rows: await page.$$eval('[data-testid="product-row"]', (rows) =>
		rows.map((row) => ({
			id: row.getAttribute('data-product-id'),
			inStock: row.getAttribute('data-in-stock'),
			visibility: row.getAttribute('data-visibility'),
			title: row.querySelector('[data-testid="product-title"]')?.textContent ?? null,
			price: row.querySelector('[data-testid="product-price"]')?.textContent ?? null,
			stockBadge: row.querySelector('[data-testid="product-stock-badge"]')?.textContent ?? null,
			coordinates: row.querySelector('[data-testid="product-coordinates"]')?.textContent ?? null,
		})),
	),
	bodyText: await page.innerText('body'),
	consoleErrors,
}

const screenshotPath = resolve(outDir, name)
await page.screenshot({ path: screenshotPath, fullPage: true })

console.log(JSON.stringify({ screenshotPath, ...summary }, null, 2))

await browser.close()