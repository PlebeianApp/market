import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

/**
 * ADR-0009 — what a REGULAR (non-labeler) user sees when an item carries an
 * active test label.
 *
 * The expected matrix, from the ADR decision ("Browsing-only gating"):
 *
 *   hidden   home feed / paginated browse / search / collections
 *   visible  direct link (detail-by-id, detail-by-a-tag)
 *   visible  the seller's profile
 *   visible  the owner's dashboard
 *
 * plus the user-facing explainer: a direct-link visitor sees a listing that is
 * missing from the feed, so the detail page must say why and offer an appeal
 * contact.
 *
 * These assertions are the contract for the browsing-only design — the gating
 * is deliberately NOT "hide the item everywhere", so a regression that starts
 * hiding it from profiles or dashboards is a bug, not a tightening.
 */

const RELAY_URL = 'ws://localhost:10547'

// ---------------------------------------------------------------------------
// Relay helpers (mirrors test-labels.spec.ts)
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

async function seedProduct(skHex: string, title: string): Promise<VerifiedEvent> {
	const now = Math.floor(Date.now() / 1000)
	const dTag = `visibility-${now}-${Math.random().toString(36).substring(2, 8)}`
	return await publishEvent(skHex, {
		kind: 30402,
		created_at: now,
		content: 'Product used by the ADR-0009 user-visibility e2e suite.',
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

/** Publish a NIP-32 test label (kind 1985) for an item coordinate. */
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

const productCoordinate = (product: VerifiedEvent): string => `30402:${product.pubkey}:${product.tags.find((t) => t[0] === 'd')?.[1]}`

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
		if (currentPath === targetPath || currentPath.startsWith(targetPath)) return
	}

	await page.goto(url)
}

async function waitForProductsFeedLoaded(page: Page): Promise<void> {
	await expect(async () => {
		const content = await page.locator('main').textContent()
		expect(content).toContain('Bitcoin Hardware Wallet')
	}).toPass({ timeout: 30_000 })
}

/** Dismiss the root-level PII warning dialog when it intercepts pointer events. */
async function dismissPiiDialogIfPresent(page: Page): Promise<void> {
	const piiDialog = page.getByRole('dialog', { name: 'Some of your personal data may be exposed' })
	if (await piiDialog.isVisible().catch(() => false)) {
		await piiDialog.getByRole('button', { name: 'Dismiss Warning' }).click()
		await expect(piiDialog).toBeHidden()
	}
}

test.describe('Test-label visibility for a regular user (ADR-0009)', () => {
	test('labeled item: hidden in browse, visible via direct link and on the seller profile, explainer shown', async ({
		unauthenticatedPage,
	}) => {
		const title = `Visibility Matrix Product ${Date.now()}`
		const product = await seedProduct(devUser1.sk, title)
		await seedTestLabel(devUser1.sk, productCoordinate(product))

		// (a) Browse / discovery feed → hidden by default
		await safeGoto(unauthenticatedPage, '/products')
		await waitForProductsFeedLoaded(unauthenticatedPage)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// (b) Direct link → the item is reachable and the page explains the label
		await safeGoto(unauthenticatedPage, `/products/${product.id}`)
		await expect(unauthenticatedPage.getByText(title).first()).toBeVisible({ timeout: 15_000 })

		const notice = unauthenticatedPage.getByTestId('test-listing-notice')
		await expect(notice).toBeVisible({ timeout: 15_000 })

		// The explainer modal states the effect and gives an appeal contact
		await notice.click()
		const noticeDialog = unauthenticatedPage.getByTestId('test-listing-notice-dialog')
		await expect(noticeDialog).toBeVisible()
		await expect(noticeDialog).toContainText('marked as a test listing')
		await expect(noticeDialog).toContainText('hidden from browsing, search and collections')
		await expect(unauthenticatedPage.getByTestId('test-listing-notice-contact')).toContainText('npub1')
		// The radix DialogContent ships its own X close button that also answers
		// to the accessible name "Close", so target ours by test id.
		await noticeDialog.getByTestId('test-listing-notice-close').click()
		await expect(noticeDialog).toBeHidden()

		// (c) The seller's profile is a by-pubkey read path → item stays visible
		await safeGoto(unauthenticatedPage, `/profile/${devUser1.pk}`)
		await expect(unauthenticatedPage.getByText(title).first()).toBeVisible({ timeout: 30_000 })

		// (d) "Show test listings" reveals it in browse, marked with the icon badge
		await safeGoto(unauthenticatedPage, '/products')
		await unauthenticatedPage.getByRole('checkbox', { name: 'Show test listings' }).check()
		await waitForProductsFeedLoaded(unauthenticatedPage)
		await expect(unauthenticatedPage.getByText(title).first()).toBeVisible({ timeout: 30_000 })
		await expect(unauthenticatedPage.getByTestId('test-listing-notice-icon').first()).toBeVisible()
	})

	test('labeled item stays listed in the owner dashboard while hidden from the public feed', async ({
		unauthenticatedPage,
		merchantPage,
	}) => {
		const title = `Dashboard Visibility Product ${Date.now()}`
		const product = await seedProduct(devUser1.sk, title)
		await seedTestLabel(devUser1.sk, productCoordinate(product))

		// Public browse: gone
		await safeGoto(unauthenticatedPage, '/products')
		await waitForProductsFeedLoaded(unauthenticatedPage)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// Owner dashboard (by-pubkey, includeHidden) → still listed
		await safeGoto(merchantPage, '/dashboard/products/products')
		await dismissPiiDialogIfPresent(merchantPage)
		await expect(merchantPage.getByText(title).first()).toBeVisible({ timeout: 30_000 })

		// Owner edit page shows both the explainer and the labeler action
		await safeGoto(merchantPage, `/dashboard/products/products/${product.id}`)
		await dismissPiiDialogIfPresent(merchantPage)
		await expect(merchantPage.getByTestId('unmark-test-label-product-button')).toBeVisible({ timeout: 30_000 })
		await expect(merchantPage.getByTestId('test-listing-notice')).toBeVisible({ timeout: 15_000 })
	})

	test('an unlabeled item shows no test-listing notice', async ({ unauthenticatedPage }) => {
		const title = `Control Product ${Date.now()}`
		const product = await seedProduct(devUser1.sk, title)

		await safeGoto(unauthenticatedPage, `/products/${product.id}`)
		await expect(unauthenticatedPage.getByText(title).first()).toBeVisible({ timeout: 15_000 })
		await expect(unauthenticatedPage.getByTestId('test-listing-notice')).toHaveCount(0)
	})

	test('mark confirmation states the real effect (browse-only) and the appeal path', async ({ merchantPage }) => {
		const product = await seedProduct(devUser1.sk, `Copy Check Product ${Date.now()}`)

		await safeGoto(merchantPage, `/dashboard/products/products/${product.id}`)
		await dismissPiiDialogIfPresent(merchantPage)

		const markButton = merchantPage.getByTestId('mark-test-label-product-button')
		await expect(markButton).toBeVisible({ timeout: 30_000 })
		await markButton.click()

		const dialog = merchantPage.getByRole('alertdialog')
		await expect(dialog).toBeVisible()

		const description = dialog.getByTestId('test-label-mark-description-product')
		// The labeler must be told exactly what the label does…
		await expect(description).toContainText('hidden from browsing, search and collections')
		await expect(description).toContainText('stays reachable by direct link')
		// …and must NOT be told it removes the item from detail views (the bug
		// this copy replaced).
		await expect(description).not.toContainText('detail views')

		// The published appeal message names a concrete escalation path
		await expect(dialog.getByTestId('test-label-content-product')).toContainText('Plebeian team')

		await dialog.getByRole('button', { name: 'Cancel' }).click()
		await expect(dialog).toBeHidden()
	})
})
