import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { finalizeEvent } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import { RELAY_URL, TEST_PORT } from '../test-config'
import { devUser1 } from '@/lib/fixtures'
import { OG_OWNED_META_SELECTORS } from '@/lib/ogTags'
import { seedProduct } from '../scenarios'
import type { VerifiedEvent } from 'nostr-tools'
import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Path to a local image fixture used to intercept external CDN requests in CI.
// Per e2e/AGENTS.md + ADR-0005, all external services (CDNs) must be mocked or
// intercepted — the browser must never issue a live request to
// cdn.satellite.earth from a test.
const __filename = fileURLToPath(import.meta.url)
const LOCAL_IMAGE_PATH = path.join(path.dirname(__filename), '..', 'fixtures', 'test-product-image.png')

/**
 * Intercepts requests to cdn.satellite.earth and serves a local fixture image.
 * The src attribute remains the original CDN URL, so src assertions still work.
 */
async function interceptCdnImages(page: Page) {
	await page.route('**/cdn.satellite.earth/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/png',
			path: LOCAL_IMAGE_PATH,
		})
	})
}

/**
 * E2E tests for server-rendered Open Graph (og:) meta tags on product pages.
 *
 * These tests verify the implementation from PR #459 / #1232:
 *   - NSFW products do not leak og: meta tags in the initial HTML
 *   - Unknown product IDs serve the SPA shell without og: tags
 *   - Client-side document.title updates after SPA hydration
 *   - Server-rendered og: meta tags survive SPA hydration (not clobbered)
 *   - Product price/currency meta tags are present in the initial HTML
 *
 * The server (src/index.tsx) intercepts /products/:productId, fetches the
 * kind 30402 event from the relay, and injects og:/twitter:/product: meta
 * tags into the initial HTML via src/lib/ogTags.ts + src/server/ogMeta.ts.
 * NSFW products (content-warning: nsfw) return null meta → shell served
 * untouched. Unknown/invalid IDs return null → shell served untouched.
 */

test.use({ scenario: 'base' })

// Feature Quality Gate: always record video for this gate spec so the happy
// path produces a viewable video on success (overrides the config default of
// retain-on-failure).
test.use({ video: 'on' })

// Per e2e/AGENTS.md + ADR-0005, intercept external CDN image requests so the
// browser never issues a live request to cdn.satellite.earth from a test.
test.beforeEach(async ({ unauthenticatedPage }) => {
	await interceptCdnImages(unauthenticatedPage)
})

// --- Shared state seeded once before all tests ---

let regularProductId: string
let regularProductEvent: VerifiedEvent
let nsfwProductId: string
let noImageProductId: string
let usdProductId: string

/**
 * Publish a kind 30402 product event with a content-warning: nsfw tag.
 * The scenarios helper (seedProduct) does not support arbitrary tags,
 * so we sign and publish directly.
 */
async function seedNsfwProduct(
	relay: Relay,
	skHex: string,
	opts: {
		title: string
		description: string
		price: string
		currency: string
		dTag: string
	},
): Promise<VerifiedEvent> {
	const skBytes = hexToBytes(skHex)
	const event = finalizeEvent(
		{
			kind: 30_402,
			created_at: Math.floor(Date.now() / 1000),
			content: opts.description,
			tags: [
				['d', opts.dTag],
				['title', opts.title],
				['price', opts.price, opts.currency],
				['status', 'on-sale'],
				['t', 'Bitcoin'],
				['content-warning', 'nsfw'],
				['image', 'https://cdn.satellite.earth/nsfw-test-image.png'],
			],
		},
		skBytes,
	)
	await relay.publish(event)
	return event as VerifiedEvent
}

/**
 * Publish a kind 30402 product event with NO image tag, so tests can cover
 * the A-with-image → B-without-image SPA transition (B must not inherit A's
 * og:image). seedProduct always adds an image, so we sign and publish directly.
 */
async function seedProductWithoutImage(
	relay: Relay,
	skHex: string,
	opts: {
		title: string
		description: string
		price: string
		currency: string
		dTag: string
	},
): Promise<VerifiedEvent> {
	const skBytes = hexToBytes(skHex)
	const event = finalizeEvent(
		{
			kind: 30_402,
			created_at: Math.floor(Date.now() / 1000),
			content: opts.description,
			tags: [
				['d', opts.dTag],
				['title', opts.title],
				['price', opts.price, opts.currency],
				['status', 'on-sale'],
				['stock', '10'],
				['t', 'Bitcoin'],
			],
		},
		skBytes,
	)
	await relay.publish(event)
	return event as VerifiedEvent
}

test.beforeAll(async () => {
	const relay = await Relay.connect(RELAY_URL)
	try {
		// Seed a regular product for tests 3, 4, 5 and the happy path.
		regularProductEvent = await seedProduct(relay, devUser1.sk, {
			title: 'OG Meta Test Product',
			description: 'A product for OG meta tag E2E testing.',
			price: '50000',
			currency: 'SATS',
			status: 'on-sale',
			category: 'Bitcoin',
			stock: '10',
			dTag: 'og-meta-test-' + Date.now(),
		})
		regularProductId = regularProductEvent.id

		// Seed an image-less product for the A-with-image → B-without-image
		// SPA ownership test.
		const noImageEvent = await seedProductWithoutImage(relay, devUser1.sk, {
			title: 'OG Meta No Image Product',
			description: 'A product with no image for OG meta ownership testing.',
			price: '2500',
			currency: 'SATS',
			dTag: 'og-meta-no-image-' + Date.now(),
		})
		noImageProductId = noImageEvent.id

		// Seed a product with a DIFFERENT currency so the currency-selector
		// staleness check is discriminating: A→C(SATS→USD) must rewrite
		// product:price:currency, and a leftover A tag would keep saying SATS.
		const usdEvent = await seedProduct(relay, devUser1.sk, {
			title: 'OG Meta USD Product',
			description: 'A product priced in USD for currency ownership testing.',
			price: '100',
			currency: 'USD',
			status: 'on-sale',
			category: 'Bitcoin',
			stock: '10',
			dTag: 'og-meta-usd-' + Date.now(),
		})
		usdProductId = usdEvent.id

		// Seed an NSFW product (content-warning: nsfw tag).
		const nsfwEvent = await seedNsfwProduct(relay, devUser1.sk, {
			title: 'NSFW OG Test Product',
			description: 'This should not leak into OG meta tags.',
			price: '10000',
			currency: 'SATS',
			dTag: 'og-meta-nsfw-' + Date.now(),
		})
		nsfwProductId = nsfwEvent.id
	} finally {
		relay.close()
	}
})

// ==========================================
// == SECTION: 5 OG Meta Tag E2E Tests     ==
// ==========================================

test.describe('OG Meta Tags - Server-Rendered Social Previews', () => {
	// Test 1: NSFW product does not leak OG meta tags in initial HTML.
	// The server's buildOgProductMeta() returns null for NSFW products,
	// so renderProductPageHtml() serves the untouched SPA shell.
	test('NSFW product page does NOT leak OG meta tags in initial HTML', async ({ unauthenticatedPage }) => {
		const response = await unauthenticatedPage.request.get(`/products/${nsfwProductId}`)
		expect(response.status()).toBe(200)

		const html = await response.text()
		// No og: tags should be present — NSFW content is gated.
		expect(html).not.toContain('og:title')
		expect(html).not.toContain('og:image')
		expect(html).not.toContain('og:description')
		expect(html).not.toContain('og:type')
	})

	// Test 2: Unknown product ID serves shell without OG tags (graceful degradation).
	// The server's getProductOgMeta() rejects non-event-id inputs (regex check)
	// and returns null for relay misses, serving the untouched SPA shell.
	test('unknown product ID serves shell without OG tags', async ({ unauthenticatedPage }) => {
		const response = await unauthenticatedPage.request.get('/products/nonexistent-id-12345')
		expect(response.status()).toBe(200)

		const html = await response.text()
		// Shell served without og: tags — graceful degradation.
		expect(html).not.toContain('og:title')
	})

	// Test 3: Client-side document.title updates after SPA load.
	// The useDocumentMeta hook sets document.title to "{title} | Plebeian Market"
	// after the product loads via the SPA.
	test('client-side document.title updates after SPA load', async ({ unauthenticatedPage }) => {
		await unauthenticatedPage.goto(`/products/${regularProductId}`)

		// Wait for the product hero to render (indicates product data loaded).
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })

		// useDocumentMeta sets document.title to "{title} | Plebeian Market".
		await expect(unauthenticatedPage).toHaveTitle(/OG Meta Test Product/, { timeout: 10_000 })
		await expect(unauthenticatedPage).toHaveTitle(/Plebeian Market/)
	})

	// Test 4: Meta tags persist after SPA hydration.
	// The server injects og: meta tags into the initial HTML. The client-side
	// useDocumentMeta hook reuses existing meta elements (querySelector) instead
	// of creating duplicates, so server-rendered tags survive hydration.
	test('meta tags persist after SPA hydration', async ({ unauthenticatedPage }) => {
		await unauthenticatedPage.goto(`/products/${regularProductId}`)

		// Wait for product to load and useDocumentMeta effect to run.
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })
		await expect(unauthenticatedPage).toHaveTitle(/OG Meta Test Product/, { timeout: 10_000 })

		// Server-rendered og:title should still be in the DOM after hydration.
		const ogTitle = unauthenticatedPage.locator('meta[property="og:title"]')
		await expect(ogTitle).toHaveCount(1)
		await expect(ogTitle).toHaveAttribute('content', 'OG Meta Test Product')

		// Server-rendered og:image should also persist.
		const ogImage = unauthenticatedPage.locator('meta[property="og:image"]')
		await expect(ogImage).toHaveCount(1)
		await expect(ogImage).toHaveAttribute('content', /cdn\.satellite\.earth/)
	})

	// Test 5: Product price/currency meta tags present in initial HTML.
	// The server's buildOgMetaTagsHtml() emits product:price:amount and
	// product:price:currency when the product has a valid price tag.
	test('product price/currency meta tags present in initial HTML', async ({ unauthenticatedPage }) => {
		const response = await unauthenticatedPage.request.get(`/products/${regularProductId}`)
		expect(response.status()).toBe(200)

		const html = await response.text()
		expect(html).toContain('product:price:amount')
		expect(html).toContain('product:price:currency')
		// The seeded product has price 50000 SATS.
		expect(html).toContain('50000')
		expect(html).toContain('SATS')
	})
})

// ==========================================
// == SECTION: Happy Path (Video Recording) ==
// ==========================================

test.describe('OG Meta Tags - Happy Path (Video)', () => {
	/**
	 * Single-flow happy path test for Playwright video recording.
	 * Walks through: raw HTML fetch → OG tag verification → browser load →
	 * SPA hydration → document.title update → meta tag persistence.
	 * Produces one coherent video for PR comment evidence.
	 *
	 * This test runs on Playwright's built-in `page` fixture rather than the
	 * shared unauthenticatedPage fixture. unauthenticatedPage builds its own
	 * context with `browser.newContext()` and no options, which silently drops
	 * the file-level `test.use({ video: 'on' })` — the run was green but no
	 * video artifact was ever written, so the evidence this test exists for was
	 * missing. The built-in fixture creates the context from the resolved
	 * `use` options, so the happy path is really recorded
	 * (test-results/<test>/video.webm).
	 */
	test.beforeEach(async ({ page }) => {
		await interceptCdnImages(page)
	})

	test('full OG meta tags happy path', async ({ page }) => {
		// Step 1: Fetch raw HTML (what crawlers/link-unfurlers receive).
		const response = await page.request.get(`/products/${regularProductId}`)
		expect(response.status()).toBe(200)
		const html = await response.text()

		// Step 2: Verify all OG meta tags in the initial HTML.
		expect(html).toContain('<meta property="og:type" content="product" />')
		expect(html).toContain('<meta property="og:title" content="OG Meta Test Product" />')
		expect(html).toContain('<meta property="og:description"')
		expect(html).toContain('<meta property="og:url"')
		expect(html).toContain('<meta property="og:site_name" content="Plebeian Market" />')
		expect(html).toContain('<meta property="og:image"')
		expect(html).toContain('product:price:amount')
		expect(html).toContain('product:price:currency')

		// Step 3: Load the page in the browser (SPA navigation).
		await page.goto(`/products/${regularProductId}`)

		// Step 4: Wait for SPA hydration — product hero renders.
		await expect(page.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })

		// Step 5: Verify document.title updated client-side.
		await expect(page).toHaveTitle(/OG Meta Test Product/, { timeout: 10_000 })
		await expect(page).toHaveTitle(/Plebeian Market/)

		// Step 6: Verify server-rendered meta tags persist after hydration.
		const ogTitle = page.locator('meta[property="og:title"]')
		await expect(ogTitle).toHaveCount(1)
		await expect(ogTitle).toHaveAttribute('content', 'OG Meta Test Product')

		const ogImage = page.locator('meta[property="og:image"]')
		await expect(ogImage).toHaveCount(1)
		await expect(ogImage).toHaveAttribute('content', /cdn\.satellite\.earth/)
	})
})

// ==========================================
// == SECTION: Hostile Host Regression      ==
// ==========================================
// Blocker 1: the shell fetch destination must be server-controlled, never
// derived from the incoming Host header. A forged Host must neither redirect
// the fetch nor poison og:url/og:image, and the page must still serve 200.

test.describe('OG Meta Tags - Hostile Host Regression', () => {
	test('forged Host header never redirects shell fetch or poisons og:url', async ({ unauthenticatedPage }) => {
		// Override the Host header — Playwright's request.get allows this.
		const response = await unauthenticatedPage.request.get(`http://localhost:${TEST_PORT}/products/${regularProductId}`, {
			headers: { Host: 'evil.example' },
		})
		expect(response.status()).toBe(200)

		const html = await response.text()
		// og:url names the server-controlled loopback origin, not the forged host.
		expect(html).toContain(`og:url" content="http://localhost:${TEST_PORT}/products/${regularProductId}`)
		expect(html).not.toContain('evil.example')
		// The enrichment still ran (a real product emits og:title).
		expect(html).toContain('og:title')
	})

	test('forged failing port Host still serves 200 with og tags', async ({ unauthenticatedPage }) => {
		// Host: 127.0.0.1:1 — a port that would refuse a connection. If the
		// shell fetch had followed this host it would fail (and, without the
		// fix, 503). With the server-controlled origin it serves 200 + og tags.
		const response = await unauthenticatedPage.request.get(`http://localhost:${TEST_PORT}/products/${regularProductId}`, {
			headers: { Host: '127.0.0.1:1' },
		})
		expect(response.status()).toBe(200)

		const html = await response.text()
		expect(html).toContain(`og:url" content="http://localhost:${TEST_PORT}/products/${regularProductId}`)
		expect(html).not.toContain('127.0.0.1:1')
		expect(html).toContain('og:title')
	})
})

// ==========================================
// == SECTION: SPA Nav Ownership Matrix     ==
// ==========================================
// Blocker 2: the product route owns every og/twitter selector while mounted
// and removes them all on unmount (no restore of remembered content), so no
// tag from a previous product leaks onto the next route. The matrix covers
// A→B, A-with-image→B-without-image, product→non-product, A→B→A, and a
// currency-changing A→C.
//
// The matrix is pinned by an explicit, hand-written selector list
// (SPA_OWNED_CLEANUP_MATRIX) that names every selector the product route owns
// — including `meta[property="product:price:currency"]`, the selector the
// review finding called out. An explicit list is the point: a matrix that only
// derives from a shared constant cannot catch an omission from that constant.
// A drift test inside the describe asserts the literal matrix and
// OG_OWNED_META_SELECTORS (the exact list removeOwnedOgMetaTags() removes) are
// equal in both directions, so neither side can silently drift from the other.
// meta[name="description"] was also missing from the previous hand-written
// list and is now covered.

test.describe('OG Meta Tags - SPA Nav Ownership Matrix', () => {
	// Helper: SPA-navigate to a product by clicking its card in the
	// "More from this seller" grid (a TanStack Link → client-side nav).
	async function spaNavTo(page: Page, productId: string) {
		const link = page.locator('a[href="/products/' + productId + '"]').first()
		await expect(link).toBeVisible({ timeout: 30_000 })
		await link.click()
		await expect(page.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })
	}

	/**
	 * The selectors this matrix pins, written out by name. `product:price:currency`
	 * is listed here explicitly (it is the reviewed selector), and the literal
	 * list is deliberately NOT derived from the implementation constant: a matrix
	 * that only derives cannot catch an omission from the thing it derives from.
	 * The drift test below keeps this list and OG_OWNED_META_SELECTORS equal in
	 * both directions.
	 */
	const SPA_OWNED_CLEANUP_MATRIX = [
		'meta[property="og:type"]',
		'meta[property="og:title"]',
		'meta[property="og:description"]',
		'meta[property="og:url"]',
		'meta[property="og:site_name"]',
		'meta[property="og:image"]',
		'meta[property="product:price:amount"]',
		'meta[property="product:price:currency"]',
		'meta[name="twitter:card"]',
		'meta[name="twitter:title"]',
		'meta[name="twitter:description"]',
		'meta[name="twitter:image"]',
		'meta[name="description"]',
	] as const

	/** Selectors that exist only while the current product has an image. */
	const imageOwnedSelectors = ['meta[property="og:image"]', 'meta[name="twitter:image"]'] as const

	// The literal matrix and the route's implementation list must agree exactly.
	// A selector the route owns but the matrix omits (the reviewed defect), or a
	// matrix entry the route no longer owns, fails here before any nav runs.
	test('cleanup matrix matches the product route owned-selector list', () => {
		expect([...SPA_OWNED_CLEANUP_MATRIX].sort()).toEqual([...OG_OWNED_META_SELECTORS].sort())
		// Belt and braces: the reviewed selector is named in the literal matrix.
		expect([...SPA_OWNED_CLEANUP_MATRIX]).toContain('meta[property="product:price:currency"]')
	})

	/** No owned selector may remain (nothing stale survives the unmount). */
	async function expectNoOwnedMeta(page: Page) {
		for (const sel of SPA_OWNED_CLEANUP_MATRIX) {
			await expect(page.locator(sel), `${sel} must be removed by cleanup`).toHaveCount(0)
		}
	}

	/** No owned selector may appear more than once (no duplicates). */
	async function expectNoDuplicateOwnedMeta(page: Page) {
		for (const sel of SPA_OWNED_CLEANUP_MATRIX) {
			expect(await page.locator(sel).count(), `${sel} must not be duplicated`).toBeLessThanOrEqual(1)
		}
	}

	/** A product with an image and a price owns exactly one of every selector. */
	async function expectAllOwnedMetaOnce(page: Page) {
		for (const sel of SPA_OWNED_CLEANUP_MATRIX) {
			await expect(page.locator(sel), `${sel} must exist exactly once`).toHaveCount(1)
		}
	}

	test('SPA nav A→B: B tags replace A tags, no stale og:title', async ({ unauthenticatedPage }) => {
		await unauthenticatedPage.goto(`/products/${regularProductId}`)
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })
		// A (image + price) owns every selector before the nav.
		await expectAllOwnedMetaOnce(unauthenticatedPage)

		await spaNavTo(unauthenticatedPage, noImageProductId)

		// B's values replaced A's; nothing of A survives.
		const ogTitle = unauthenticatedPage.locator('meta[property="og:title"]')
		await expect(ogTitle).toHaveCount(1)
		await expect(ogTitle).toHaveAttribute('content', 'OG Meta No Image Product')
		await expect(unauthenticatedPage.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			new RegExp(`/products/${noImageProductId}$`),
		)
		// B has no image, so the image selectors must be gone entirely.
		for (const sel of imageOwnedSelectors) {
			await expect(unauthenticatedPage.locator(sel), `${sel} must not leak from A`).toHaveCount(0)
		}
		await expectNoDuplicateOwnedMeta(unauthenticatedPage)
	})

	test('SPA nav A-with-image→B-without-image: no stale og:image', async ({ unauthenticatedPage }) => {
		await unauthenticatedPage.goto(`/products/${regularProductId}`)
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })
		await expect(unauthenticatedPage.locator('meta[property="og:image"]')).toHaveCount(1)

		await spaNavTo(unauthenticatedPage, noImageProductId)

		// B has no image: og:image must be gone entirely, and the card is summary.
		await expect(unauthenticatedPage.locator('meta[property="og:image"]')).toHaveCount(0)
		await expect(unauthenticatedPage.locator('meta[name="twitter:image"]')).toHaveCount(0)
		await expect(unauthenticatedPage.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary')
		// Every non-image owned tag was rewritten for B, not left at A's value.
		await expect(unauthenticatedPage.locator('meta[property="og:title"]')).toHaveAttribute('content', 'OG Meta No Image Product')
		await expect(unauthenticatedPage.locator('meta[name="description"]')).toHaveAttribute(
			'content',
			'A product with no image for OG meta ownership testing.',
		)
	})

	test('product→non-product route removes all owned tags', async ({ unauthenticatedPage }) => {
		await unauthenticatedPage.goto(`/products/${regularProductId}`)
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })

		// Client-side nav to the homepage via the header home link.
		const homeLink = unauthenticatedPage.getByTestId('home-link')
		await expect(homeLink).toBeVisible()
		await homeLink.click()
		await expect(unauthenticatedPage).toHaveURL(/\/$/)

		// EVERY owned selector — og:, twitter:, product:price:* (currency
		// included, the reviewed one) and meta[name="description"] — must be
		// gone. The matrix is the literal SPA_OWNED_CLEANUP_MATRIX, and the
		// drift test proves it names exactly what the route owns, so a newly
		// owned selector cannot be silently uncovered here either.
		await expectNoOwnedMeta(unauthenticatedPage)
		// document.title restored to the static default.
		await expect(unauthenticatedPage).toHaveTitle('Plebeian Market')
	})

	test('A→B→A produces no duplicate tags', async ({ unauthenticatedPage }) => {
		await unauthenticatedPage.goto(`/products/${regularProductId}`)
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })

		await spaNavTo(unauthenticatedPage, noImageProductId)
		await spaNavTo(unauthenticatedPage, regularProductId)

		// Each owned selector appears exactly once, with the current product's data.
		await expectAllOwnedMetaOnce(unauthenticatedPage)
		await expectNoDuplicateOwnedMeta(unauthenticatedPage)
		const ogTitle = unauthenticatedPage.locator('meta[property="og:title"]')
		await expect(ogTitle).toHaveAttribute('content', 'OG Meta Test Product')
		await expect(unauthenticatedPage.locator('meta[property="og:image"]')).toHaveAttribute('content', /cdn\.satellite\.earth/)
		const ogCurrency = unauthenticatedPage.locator('meta[property="product:price:currency"]')
		await expect(ogCurrency).toHaveAttribute('content', 'SATS')
	})

	test('SPA nav A(SATS)→C(USD): currency tag follows the product, no stale value', async ({ unauthenticatedPage }) => {
		const currencyTag = unauthenticatedPage.locator('meta[property="product:price:currency"]')

		await unauthenticatedPage.goto(`/products/${regularProductId}`)
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })
		await expect(currencyTag).toHaveCount(1)
		await expect(currencyTag).toHaveAttribute('content', 'SATS')

		await spaNavTo(unauthenticatedPage, usdProductId)

		// The reviewed selector must be rewritten for C: a stale A tag would
		// still read SATS here, or duplicate rather than replace.
		await expect(currencyTag).toHaveCount(1)
		await expect(currencyTag).toHaveAttribute('content', 'USD')
		await expectNoDuplicateOwnedMeta(unauthenticatedPage)
	})
})
