import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { finalizeEvent } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import { RELAY_URL, BASE_URL } from '../test-config'
import { devUser1 } from '@/lib/fixtures'
import { seedProduct } from '../scenarios'
import type { VerifiedEvent } from 'nostr-tools'

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
 * NSFW products (content_warning: nsfw) return null meta → shell served
 * untouched. Unknown/invalid IDs return null → shell served untouched.
 */

test.use({ scenario: 'base' })

// --- Shared state seeded once before all tests ---

let regularProductId: string
let regularProductEvent: VerifiedEvent
let nsfwProductId: string

/**
 * Publish a kind 30402 product event with a content_warning: nsfw tag.
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
				['content_warning', 'nsfw'],
				['image', 'https://cdn.satellite.earth/nsfw-test-image.png'],
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

		// Seed an NSFW product (content_warning: nsfw tag).
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
	 */
	test('full OG meta tags happy path', async ({ unauthenticatedPage }) => {
		// Step 1: Fetch raw HTML (what crawlers/link-unfurlers receive).
		const response = await unauthenticatedPage.request.get(`/products/${regularProductId}`)
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
		await unauthenticatedPage.goto(`/products/${regularProductId}`)

		// Step 4: Wait for SPA hydration — product hero renders.
		await expect(unauthenticatedPage.locator('.hero-content-product')).toBeVisible({ timeout: 30_000 })

		// Step 5: Verify document.title updated client-side.
		await expect(unauthenticatedPage).toHaveTitle(/OG Meta Test Product/, { timeout: 10_000 })
		await expect(unauthenticatedPage).toHaveTitle(/Plebeian Market/)

		// Step 6: Verify server-rendered meta tags persist after hydration.
		const ogTitle = unauthenticatedPage.locator('meta[property="og:title"]')
		await expect(ogTitle).toHaveCount(1)
		await expect(ogTitle).toHaveAttribute('content', 'OG Meta Test Product')

		const ogImage = unauthenticatedPage.locator('meta[property="og:image"]')
		await expect(ogImage).toHaveCount(1)
		await expect(ogImage).toHaveAttribute('content', /cdn\.satellite\.earth/)
	})
})