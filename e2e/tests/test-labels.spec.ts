import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { queryRelayEvents } from '../utils/relay-query'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'

// ---------------------------------------------------------------------------
// Relay helpers — publish kind 1985 label events and kind 5 deletions
// ---------------------------------------------------------------------------

async function connectRelay(): Promise<Relay> {
	return await Relay.connect(RELAY_URL)
}

async function publishEvent(skHex: string, template: EventTemplate): Promise<VerifiedEvent> {
	const relay = await connectRelay()
	try {
		const event = finalizeEvent(template, hexToBytes(skHex))
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

/**
 * Seed a minimal kind-30402 product listing.
 * Returns the published event (id + d-tag are needed for labeling).
 */
async function seedProduct(skHex: string, title: string): Promise<VerifiedEvent> {
	const now = Math.floor(Date.now() / 1000)
	const dTag = `test-label-${now}-${Math.random().toString(36).substring(2, 8)}`
	return await publishEvent(skHex, {
		kind: 30402,
		created_at: now,
		content: 'Product used by the ADR-0009 test-label e2e suite.',
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

/**
 * Publish a NIP-32 test label (kind 1985) for an item coordinate.
 * Tags: L/l in com.plebeian.market namespace + a single a-tag target.
 * No p tag (would label the user — out of ADR-0009 scope).
 */
async function seedTestLabel(
	skHex: string,
	coordinate: string,
	content = 'Marked as test listing by the e2e suite.',
): Promise<VerifiedEvent> {
	return await publishEvent(skHex, {
		kind: 1985,
		created_at: Math.floor(Date.now() / 1000),
		content,
		tags: [
			['L', 'com.plebeian.market'],
			['l', 'test', 'com.plebeian.market'],
			['a', coordinate],
		],
	})
}

/**
 * Publish a NIP-09 deletion (kind 5) for a label event.
 * Tags: e (label event id) + k (1985). No a tag — kind 1985 is not replaceable.
 */
async function seedTestLabelDeletion(skHex: string, labelEventId: string, content = 'Unmarking test label.'): Promise<VerifiedEvent> {
	return await publishEvent(skHex, {
		kind: 5,
		created_at: Math.floor(Date.now() / 1000),
		content,
		tags: [
			['e', labelEventId],
			['k', '1985'],
		],
	})
}

const productCoordinate = (productEvent: VerifiedEvent): string =>
	`30402:${productEvent.pubkey}:${productEvent.tags.find((t) => t[0] === 'd')?.[1]}`
const auctionCoordinate = (auctionEvent: VerifiedEvent): string =>
	`30408:${auctionEvent.pubkey}:${auctionEvent.tags.find((t) => t[0] === 'd')?.[1]}`

// ---------------------------------------------------------------------------
// Navigation helper — resilient navigation for the SPA (mirrors marketplace.spec.ts)
// ---------------------------------------------------------------------------

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
 * Wait until the products feed has loaded (the seeded control product is
 * visible) before asserting on absence/presence of other products.
 */
async function waitForProductsFeedLoaded(page: Page): Promise<void> {
	await expect(async () => {
		const content = await page.locator('main').textContent()
		expect(content).toContain('Bitcoin Hardware Wallet')
	}).toPass({ timeout: 30_000 })
}

// ---------------------------------------------------------------------------
// Scenario 1: labeled product is hidden from the feed but reachable via link
// ---------------------------------------------------------------------------

test.describe('Test listing labels (ADR-0009)', () => {
	test('product with an active test label is hidden from the feed but reachable via direct link', async ({ unauthenticatedPage }) => {
		const title = `Test Label Hidden Product ${Date.now()}`
		const product = await seedProduct(devUser1.sk, title)
		const coordinate = productCoordinate(product)

		// Label it with an authorized labeler key (devUser1 is in the admin set)
		await seedTestLabel(devUser1.sk, coordinate)

		await safeGoto(unauthenticatedPage, '/products')
		await waitForProductsFeedLoaded(unauthenticatedPage)

		// The labeled product must not appear in the browse feed (default hidden)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// Detail view: the item is still reachable via direct link (no "not found")
		await safeGoto(unauthenticatedPage, `/products/${product.id}`)
		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 15_000 })

		// Toggling "Show test listings" reveals the item in the browse feed
		await safeGoto(unauthenticatedPage, '/products')
		await unauthenticatedPage.getByRole('checkbox', { name: 'Show test listings' }).check()
		await waitForProductsFeedLoaded(unauthenticatedPage)
		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 30_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 2: un-labeled product reappears after the NIP-09 deletion
	// -----------------------------------------------------------------------

	test('product reappears in the feed after the test label is deleted via NIP-09', async ({ unauthenticatedPage }) => {
		const title = `Test Label Reappear Product ${Date.now()}`
		const product = await seedProduct(devUser1.sk, title)
		const coordinate = productCoordinate(product)

		const labelEvent = await seedTestLabel(devUser1.sk, coordinate)

		await safeGoto(unauthenticatedPage, '/products')
		await waitForProductsFeedLoaded(unauthenticatedPage)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// Un-label: NIP-09 deletion signed by the SAME labeler (devUser1)
		await seedTestLabelDeletion(devUser1.sk, labelEvent.id)

		// Reload → fresh store/cache → the item reappears
		await safeGoto(unauthenticatedPage, '/products')
		await waitForProductsFeedLoaded(unauthenticatedPage)
		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 30_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 3: unauthorized labels are ignored
	// -----------------------------------------------------------------------

	test('label from an unauthorized key does not hide the product', async ({ unauthenticatedPage }) => {
		const title = `Unauthorized Label Product ${Date.now()}`
		// Product by devUser2, label also signed by devUser2 — who is NOT in
		// the admin set, so the label must be ignored.
		const product = await seedProduct(devUser2.sk, title)
		await seedTestLabel(devUser2.sk, productCoordinate(product))

		await safeGoto(unauthenticatedPage, '/products')
		await waitForProductsFeedLoaded(unauthenticatedPage)

		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 30_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 4: auction labels work (kind 30408 coordinates)
	// -----------------------------------------------------------------------

	test('auction with an active test label is excluded from the auctions feed', async ({ unauthenticatedPage }) => {
		const now = Math.floor(Date.now() / 1000)
		const suffix = `${now}-${Math.random().toString(36).substring(2, 8)}`

		// Two auctions: a control (visible) and one that gets labeled (hidden)
		const seedAuctionEvent = async (title: string, dTag: string): Promise<VerifiedEvent> =>
			await publishEvent(devUser1.sk, {
				kind: 30408,
				created_at: now,
				content: 'Auction used by the ADR-0009 test-label e2e suite.',
				tags: [
					['d', dTag],
					['title', title],
					['summary', 'E2E test auction'],
					['auction_type', 'english'],
					['start_at', String(now)],
					['end_at', String(now + 86400)],
					['currency', 'SAT'],
					['price', '1000', 'SAT'],
					['starting_bid', '1000', 'SAT'],
					['bid_increment', '100'],
					['reserve', '0'],
					['mint', 'http://localhost:3338'],
					['escrow_pubkey', '02' + '00'.repeat(32)],
					['key_scheme', 'hd_p2pk'],
					['p2pk_xpub', 'xpub' + '0'.repeat(100)],
					['settlement_policy', 'cashu_p2pk_v1'],
					['schema', 'auction_v1'],
					['image', 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png'],
					['t', 'Bitcoin'],
				],
			})

		const controlAuction = await seedAuctionEvent(`Control Auction ${suffix}`, `test-label-auction-control-${suffix}`)
		const labeledAuction = await seedAuctionEvent(`Labeled Auction ${suffix}`, `test-label-auction-labeled-${suffix}`)

		await seedTestLabel(devUser1.sk, auctionCoordinate(labeledAuction))

		await safeGoto(unauthenticatedPage, '/auctions')
		await expect(unauthenticatedPage.getByText(controlAuction.tags.find((t) => t[0] === 'title')?.[1] ?? '')).toBeVisible({
			timeout: 30_000,
		})

		await expect(unauthenticatedPage.getByText(labeledAuction.tags.find((t) => t[0] === 'title')?.[1] ?? '')).toHaveCount(0)
	})

	// -----------------------------------------------------------------------
	// Scenario 5: dashboard actions (mark / unmark) for authorized labelers
	// -----------------------------------------------------------------------

	test('admin sees the mark/unmark dashboard actions and publishing lands on the relay', async ({ merchantPage }) => {
		const product = await seedProduct(devUser1.sk, `Dashboard Label Product ${Date.now()}`)
		const coordinate = productCoordinate(product)

		// Open the product edit page (productId = event id)
		await safeGoto(merchantPage, `/dashboard/products/products/${product.id}`)

		// The PII exposure warning (root-level dialog for users with seeded
		// order events) intercepts pointer events — dismiss it if it appears.
		const piiDialog = merchantPage.getByRole('dialog', { name: 'Some of your personal data may be exposed' })
		if (await piiDialog.isVisible().catch(() => false)) {
			await piiDialog.getByRole('button', { name: 'Dismiss Warning' }).click()
			await expect(piiDialog).toBeHidden()
		}

		const markButton = merchantPage.getByTestId('mark-test-label-product-button')
		await expect(markButton).toBeVisible({ timeout: 30_000 })

		// Mark as test: confirm dialog with pre-filled, editable content
		await markButton.click()
		const dialog = merchantPage.getByRole('alertdialog')
		await expect(dialog).toBeVisible()
		const contentTextarea = dialog.getByTestId('test-label-content-product')
		await expect(contentTextarea).toContainText('Marked as test listing')
		await dialog.getByRole('button', { name: 'Mark as Test' }).click()

		// Optimistic UI: the button flips to "Unmark as Test Product"
		const unmarkButton = merchantPage.getByTestId('unmark-test-label-product-button')
		await expect(unmarkButton).toBeVisible({ timeout: 15_000 })

		// Relay is the source of truth: a kind-1985 label for the coordinate exists
		let labelEventIdOnRelay = ''
		await expect(async () => {
			const labels = await queryRelayEvents({ kinds: [1985], '#a': [coordinate], authors: [devUser1.pk] })
			expect(labels.length).toBeGreaterThan(0)
			labelEventIdOnRelay = labels[0].id
		}).toPass({ timeout: 15_000 })

		// Unmark as test: confirm dialog, then the label deletion lands on the relay
		await unmarkButton.click()
		const unmarkDialog = merchantPage.getByRole('alertdialog')
		await expect(unmarkDialog).toBeVisible()
		await unmarkDialog.getByRole('button', { name: 'Unmark as Test' }).click()

		await expect(merchantPage.getByTestId('mark-test-label-product-button')).toBeVisible({ timeout: 15_000 })

		// The NIP-09 deletion event referencing the label id lands on the relay.
		// (nak actively purges deleted events, so the label itself may be gone —
		// the deletion event is the durable artifact to assert on.)
		await expect(async () => {
			const deletions = await queryRelayEvents({ kinds: [5], '#e': [labelEventIdOnRelay], authors: [devUser1.pk] })
			expect(deletions.length).toBeGreaterThan(0)
		}).toPass({ timeout: 15_000 })
	})

	test('non-admin does not see the test-label dashboard actions', async ({ buyerPage }) => {
		// Seed a product by devUser2 (the buyer IS the seller of this product)
		const product = await seedProduct(devUser2.sk, `Non-admin Label Product ${Date.now()}`)

		await safeGoto(buyerPage, `/dashboard/products/products/${product.id}`)

		// Wait for the edit page to settle, then confirm no label actions
		await expect(buyerPage.getByTestId('mark-test-label-product-button')).toHaveCount(0, { timeout: 15_000 })
		await expect(buyerPage.getByTestId('unmark-test-label-product-button')).toHaveCount(0)
	})
})
