/**
 * ADR-0009 confirmation run — products test-listing curation (PR #1266).
 *
 * WHY THIS FILE EXISTS
 *
 * The existing suite splits the user-facing flow across two tests, so neither
 * proves it end to end:
 *
 *   - `test-labels.spec.ts` scenario 1 asserts "hidden from /products" but
 *     seeds the kind-1985 label straight to the relay, bypassing the admin UI.
 *   - `test-labels.spec.ts` scenario 4 exercises the dashboard mark/unmark UI
 *     but only asserts optimistic state + relay contents; it never returns to
 *     the browse surface to confirm the product is actually gone.
 *
 * This test walks the whole path in one run as the admin account (devUser1,
 * published into the kind-30000 admin list by `e2e/seed-relay.ts`):
 *
 *   1. seed a product and confirm it IS visible on /products
 *   2. mark it as a test listing from the dashboard product edit page
 *   3. return to /products and confirm it is HIDDEN
 *   4. flip "Show test listings" and confirm it is revealed again
 *   5. unmark it from the dashboard
 *   6. reload /products and confirm it is visible again
 *
 * RECORDING NOTE
 *
 * The shared page fixtures build their contexts with `browser.newContext()`,
 * so Playwright's `video` test option never reaches them. This spec therefore
 * creates its own context with `recordVideo` and reuses `setupAuthContext`,
 * which is why it does not use the `merchantPage` fixture.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { finalizeEvent, getPublicKey, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { generateSecretKey } from 'nostr-tools'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { setupAuthContext, type TestUser } from '../fixtures/auth'
import { ensureScenario } from '../scenarios'
import { TEST_APP_PRIVATE_KEY } from '../test-config'

test.use({ launchOptions: { slowMo: 320 } })

const RELAY_URL = 'ws://localhost:10547'
const VIDEO_DIR = 'test-results/evidence'

// ---------------------------------------------------------------------------
// Relay helpers
// ---------------------------------------------------------------------------

async function publishEvent(skHex: string, template: EventTemplate): Promise<VerifiedEvent> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const event = finalizeEvent(template, hexToBytes(skHex))
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

/** Seed a minimal kind-30402 product listing owned by the given key. */
async function seedProduct(skHex: string, title: string): Promise<VerifiedEvent> {
	const now = Math.floor(Date.now() / 1000)
	const dTag = `admin-confirm-${now}-${Math.random().toString(36).substring(2, 8)}`
	return await publishEvent(skHex, {
		kind: 30402,
		created_at: now,
		content: 'Product used by the ADR-0009 admin confirmation run.',
		tags: [
			['d', dTag],
			['title', title],
			['price', '1000', 'SATS'],
			['status', 'on-sale'],
			['t', 'Bitcoin'],
			['stock', '10'],
			['image', 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png'],
		],
	})
}

// ---------------------------------------------------------------------------
// Navigation / readiness helpers (mirror test-labels.spec.ts)
// ---------------------------------------------------------------------------

/** Resilient SPA navigation — retries past interrupted navigations. */
async function safeGoto(page: Page, url: string): Promise<void> {
	const targetPath = url.split('?')[0]

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto(url)
		} catch (error) {
			const msg = String(error)
			if (!msg.includes('interrupted by another navigation') && !msg.includes('ERR_ABORTED')) throw error
			await page.waitForLoadState('networkidle').catch(() => {})
		}

		await page.waitForTimeout(1000)
		await page.waitForLoadState('networkidle').catch(() => {})

		const currentPath = new URL(page.url()).pathname
		if (currentPath === targetPath || currentPath.startsWith(targetPath)) {
			return
		}
	}

	await page.goto(url)
}

/**
 * Wait until the products feed has loaded — the seeded control product is
 * visible — before asserting on absence/presence of the target product.
 */
async function waitForProductsFeedLoaded(page: Page): Promise<void> {
	await expect(async () => {
		const content = await page.locator('main').textContent()
		expect(content).toContain('Bitcoin Hardware Wallet')
	}).toPass({ timeout: 30_000 })
}

/** Dismiss the root-level PII warning dialog if it intercepts pointer events. */
async function dismissPiiDialog(page: Page): Promise<void> {
	const piiDialog = page.getByRole('dialog', { name: 'Some of your personal data may be exposed' })
	if (await piiDialog.isVisible().catch(() => false)) {
		await piiDialog.getByRole('button', { name: 'Dismiss Warning' }).click()
		await expect(piiDialog).toBeHidden()
	}
}

/** Mark the product as a test listing from its dashboard edit page. */
async function markAsTestFromDashboard(page: Page, productEventId: string): Promise<void> {
	await safeGoto(page, `/dashboard/products/products/${productEventId}`)
	await dismissPiiDialog(page)

	const markButton = page.getByTestId('mark-test-label-product-button')
	await expect(markButton).toBeVisible({ timeout: 30_000 })
	await markButton.click()

	const dialog = page.getByRole('alertdialog')
	await expect(dialog).toBeVisible()
	await page.waitForTimeout(800)
	await dialog.getByRole('button', { name: 'Mark as Test' }).click()

	// Optimistic UI flip confirms the publish was accepted.
	await expect(page.getByTestId('unmark-test-label-product-button')).toBeVisible({ timeout: 15_000 })
}

/** Unmark the product from its dashboard edit page. */
async function unmarkAsTestFromDashboard(page: Page, productEventId: string): Promise<void> {
	await safeGoto(page, `/dashboard/products/products/${productEventId}`)
	await dismissPiiDialog(page)

	const unmarkButton = page.getByTestId('unmark-test-label-product-button')
	await expect(unmarkButton).toBeVisible({ timeout: 30_000 })
	await unmarkButton.click()

	const dialog = page.getByRole('alertdialog')
	await expect(dialog).toBeVisible()
	await page.waitForTimeout(800)
	await dialog.getByRole('button', { name: 'Unmark as Test' }).click()

	await expect(page.getByTestId('mark-test-label-product-button')).toBeVisible({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// The confirmation test
// ---------------------------------------------------------------------------

test.describe('ADR-0009 confirmation — admin marks a product as test, then it is hidden from the products home page', () => {
	test('mark via the admin dashboard hides the product from /products; unmark restores it', async ({ browser }) => {
		test.setTimeout(240_000)

		await ensureScenario('merchant')

		// Own context so video recording actually applies.
		let context: BrowserContext | null = null
		let videoPath: string | undefined

		try {
			context = await browser.newContext({
				viewport: { width: 1440, height: 900 },
				recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
			})
			await setupAuthContext(context, devUser1)

			// Test isolation (AGENTS.md): external CDNs must be mocked rather
			// than fetched. The seeded products point at an external image CDN
			// that is unreachable from local/CI runs, so serve a local
			// placeholder instead of rendering a broken image on every card.
			await context.route('**/*', async (route) => {
				const request = route.request()
				if (request.resourceType() !== 'image') return route.continue()
				const { hostname } = new URL(request.url())
				if (hostname === 'localhost' || hostname === '127.0.0.1') return route.continue()
				return route.fulfill({ path: 'public/images/Plebeian_Logo_OpenGraph.png' })
			})

			const page = await context.newPage()

			await page.goto('/')
			await page.waitForLoadState('domcontentloaded')
			await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 15_000 })

			const title = `Admin Confirmation Test Product ${Date.now()}`
			const product = await seedProduct(devUser1.sk, title)

			// Keep the top of the products grid in frame while dwelling, so the
			// recording shows the first card position clearly.
			const dwell = async (ms: number) => {
				await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {})
				await page.waitForTimeout(ms)
			}

			// --- Step 1: baseline — the product IS visible on the products home page
			await safeGoto(page, '/products')
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
			await dwell(3000)

			// --- Step 2: admin marks it as a test listing from the dashboard
			await markAsTestFromDashboard(page, product.id)

			// --- Step 3: back to products home — it must now be HIDDEN
			await safeGoto(page, '/products')
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toHaveCount(0)
			await dwell(3500)

			// --- Step 4: the "Show test listings" toggle reveals it (still on home)
			await page.getByRole('checkbox', { name: 'Show test listings' }).check()
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
			await dwell(3500)

			// --- Step 5: unmark from the dashboard
			await unmarkAsTestFromDashboard(page, product.id)

			// --- Step 6: fresh load of products home — visible again without the toggle
			await safeGoto(page, '/products')
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
			await dwell(3500)

			videoPath = await page.video()?.path()
		} finally {
			if (context) await context.close()
		}

		if (videoPath) {
			console.log(`\n>>> RECORDING: ${videoPath}\n`)
		}
	})

	/**
	 * Admin moderation of ANOTHER seller's listing, from the public product
	 * page — the surface added alongside the owner-edit-page control.
	 *
	 * This is the case maximotodev's blocking finding #4 called out: the owner
	 * edit route resolves the product from the logged-in user's own products,
	 * so a moderator could not previously reach a listing they did not own.
	 * The `EntityActionsMenu` on the public page is gated on admin-set
	 * membership, so a moderator can now curate any listing.
	 */
	test('admin marks ANOTHER seller’s product as test from the public product page, and it is hidden', async ({ browser }) => {
		test.setTimeout(240_000)

		await ensureScenario('merchant')

		let context: BrowserContext | null = null

		try {
			// Product owned by devUser2 — the admin below is devUser1, so this
			// is genuinely someone else's listing.
			const title = `Cross-User Moderation Product ${Date.now()}`
			const product = await seedProduct(devUser2.sk, title)

			context = await browser.newContext({
				viewport: { width: 1440, height: 900 },
				recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
			})
			await setupAuthContext(context, devUser1)

			await context.route('**/*', async (route) => {
				const request = route.request()
				if (request.resourceType() !== 'image') return route.continue()
				const { hostname } = new URL(request.url())
				if (hostname === 'localhost' || hostname === '127.0.0.1') return route.continue()
				return route.fulfill({ path: 'public/images/Plebeian_Logo_OpenGraph.png' })
			})

			const page = await context.newPage()
			await page.goto('/')
			await page.waitForLoadState('domcontentloaded')
			await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 15_000 })

			// Baseline: the other seller's product is visible in the feed
			await safeGoto(page, '/products')
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
			await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {})
			await page.waitForTimeout(2500)

			// Open the other seller's PUBLIC product page (not the owner dashboard)
			await safeGoto(page, `/products/${product.id}`)
			await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
			await page.waitForTimeout(1500)

			// Admin-only moderation entry point
			await page.getByRole('button', { name: 'Open menu' }).click()
			const markItem = page.getByTestId('mark-test-label-menu-item')
			await expect(markItem).toBeVisible({ timeout: 15_000 })
			await page.waitForTimeout(1200)
			await markItem.click()

			const dialog = page.getByRole('alertdialog')
			await expect(dialog).toBeVisible()
			await page.waitForTimeout(1000)
			await dialog.getByRole('button', { name: 'Mark as Test' }).click()

			// Back to the feed — the other seller's product must now be HIDDEN
			await safeGoto(page, '/products')
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toHaveCount(0)
			await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {})
			await page.waitForTimeout(3000)

			// And revealed by the toggle
			await page.getByRole('checkbox', { name: 'Show test listings' }).check()
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
			await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {})
			await page.waitForTimeout(2500)

			const videoPath = await page.video()?.path()
			if (videoPath) console.log(`\n>>> CROSS-USER RECORDING: ${videoPath}\n`)
		} finally {
			if (context) await context.close()
		}
	})

	/**
	 * Authorized labelers are editors UNION admins (ADR-0009). This test proves
	 * the EDITOR half independently: the labeler below is neither an admin, nor
	 * the app owner, nor the product's author — it is enrolled ONLY in the
	 * kind-30000 `d=editors` list — and must still be able to curate another
	 * seller's listing.
	 *
	 * The editors list is authored by the app key (the author
	 * `fetchEditorSettings` reads) and contains only a freshly generated key,
	 * so no other test's identity gains editor rights.
	 */
	test('editor (not an admin) marks another seller’s product from the public product page', async ({ browser }) => {
		test.setTimeout(240_000)
		await ensureScenario('merchant')

		// Fresh editor identity, unique to this test.
		const editorSk = bytesToHex(generateSecretKey())
		const editorPk = getPublicKey(hexToBytes(editorSk))
		const editor: TestUser = { sk: editorSk, pk: editorPk }

		// Enroll the editor in the app's editors list.
		await publishEvent(TEST_APP_PRIVATE_KEY, {
			kind: 30000,
			created_at: Math.floor(Date.now() / 1000),
			content: 'e2e editors list',
			tags: [
				['d', 'editors'],
				['p', editorPk],
			],
		})

		// Guard the premise: the labeler is not an admin and not the app owner.
		expect(editorPk).not.toBe(devUser1.pk)
		expect(editorPk).not.toBe(devUser2.pk)

		// The curated listing belongs to a plain seller (devUser2), not the editor.
		const title = `Editor-Curated Product ${Date.now()}`
		const product = await seedProduct(devUser2.sk, title)

		let context: BrowserContext | null = null

		try {
			context = await browser.newContext({
				viewport: { width: 1440, height: 900 },
				recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
			})
			await setupAuthContext(context, editor)

			await context.route('**/*', async (route) => {
				const request = route.request()
				if (request.resourceType() !== 'image') return route.continue()
				const { hostname } = new URL(request.url())
				if (hostname === 'localhost' || hostname === '127.0.0.1') return route.continue()
				return route.fulfill({ path: 'public/images/Plebeian_Logo_OpenGraph.png' })
			})

			const page = await context.newPage()
			await page.goto('/')
			await page.waitForLoadState('domcontentloaded')
			await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 15_000 })

			// Baseline: visible in the feed
			await safeGoto(page, '/products')
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
			await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {})
			await page.waitForTimeout(2000)

			// The editor opens the seller's public product page and curates it
			await safeGoto(page, `/products/${product.id}`)
			await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
			await page.waitForTimeout(1500)

			await page.getByRole('button', { name: 'Open menu' }).click()
			const markItem = page.getByTestId('mark-test-label-menu-item')
			await expect(markItem).toBeVisible({ timeout: 15_000 })
			await page.waitForTimeout(1000)
			await markItem.click()

			const dialog = page.getByRole('alertdialog')
			await expect(dialog).toBeVisible()
			await page.waitForTimeout(800)
			await dialog.getByRole('button', { name: 'Mark as Test' }).click()

			// Editor-authored label must actually hide the listing
			await safeGoto(page, '/products')
			await waitForProductsFeedLoaded(page)
			await expect(page.getByText(title)).toHaveCount(0)
			await page.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {})
			await page.waitForTimeout(2500)

			const videoPath = await page.video()?.path()
			if (videoPath) console.log(`\n>>> EDITOR RECORDING: ${videoPath}\n`)
		} finally {
			if (context) await context.close()
		}
	})
})
