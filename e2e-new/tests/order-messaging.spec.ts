import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'
import { queryRelayEvents, getTagValue } from '../utils/relay-query'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import type { Page } from '@playwright/test'

test.use({ scenario: 'merchant' })

/**
 * Shared helper: complete a full checkout with both invoices paid.
 * Reuses the same pattern as order-lifecycle.spec.ts.
 */
async function completeCheckout(page: Page) {
	// Add product to cart
	await page.goto('/products')
	const productCard = page.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
	await expect(productCard).toBeVisible({ timeout: 15_000 })
	await productCard.getByRole('button', { name: /Add to Cart/i }).click()
	await expect(productCard.getByRole('button', { name: /Add/i })).toBeVisible()

	// Open cart, select shipping
	await page
		.getByRole('button')
		.filter({ has: page.locator('.i-basket') })
		.click()
	const shippingTrigger = page.getByText('Select shipping method')
	await expect(shippingTrigger).toBeVisible({ timeout: 10_000 })
	await shippingTrigger.click()
	await page.getByText(/Worldwide Standard/).click()

	// Proceed to checkout
	const checkoutButton = page.getByRole('button', { name: /Checkout/i })
	await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
	await checkoutButton.click()

	// Fill shipping form
	await expect(page.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 10_000 })
	await page.locator('#name').fill('E2E Test Buyer')
	await page.locator('#firstLineOfAddress').fill('123 Test Street, Apt 4B')
	await page.locator('#zipPostcode').fill('SW1A 1AA')
	await page.locator('#country').fill('United Kingdom')
	await page.locator('[data-country-item]').filter({ hasText: 'United Kingdom' }).first().click()
	await page.locator('#city').fill('London')
	await page.keyboard.press('Escape')
	await page.locator('button[form="shipping-form"]').click()

	// Order summary → Continue to Payment
	await expect(page.getByText('Order Summary')).toBeVisible({ timeout: 10_000 })
	const continueToPayment = page.getByRole('button', { name: /Continue to Payment/ })
	await expect(continueToPayment).toBeEnabled()
	await continueToPayment.click()

	// Wait for invoices
	await expect(page.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })

	// Pay all invoices (merchant + V4V shares — count varies with V4V config)
	const webLnButton = page.getByRole('button', { name: 'Pay with WebLN' })
	await expect(webLnButton).toBeVisible({ timeout: 30_000 })
	while (
		(await page
			.getByText('All payments completed successfully!')
			.isVisible()
			.catch(() => false)) === false
	) {
		await expect(webLnButton).toBeEnabled({ timeout: 10_000 })
		await webLnButton.click()
		await page.waitForTimeout(1_000)
	}

	await expect(page.getByText('All payments completed successfully!')).toBeVisible({ timeout: 20_000 })
}

test.describe('Order Messaging', () => {
	test('after checkout, buyer and merchant can exchange messages', async ({ buyerPage, merchantPage }) => {
		test.setTimeout(120_000)
		const testStartTime = Math.floor(Date.now() / 1000) - 5
		await LightningMock.setup(buyerPage)

		// ─── 1. Complete checkout ────────────────────────────────────
		await completeCheckout(buyerPage)

		// Give order events time to propagate
		await buyerPage.waitForTimeout(2_000)

		// ─── 2. Merchant opens messages — should see buyer conversation ─
		await merchantPage.goto('/dashboard/sales/messages')

		// The conversation list should contain an entry for the buyer
		// (populated from Kind 16/17 events created during checkout)
		const merchantConvoLink = merchantPage.locator(`a[href="/dashboard/sales/messages/${devUser2.pk}"]`)
		await expect(merchantConvoLink).toBeVisible({ timeout: 15_000 })
		await merchantConvoLink.click()

		// ─── 3. Verify structured order events in conversation ───────
		// The conversation shows Kind 14/16/17 events between these users.
		// Use .first() since there may be accumulated events from prior tests.
		// ChatMessageBubble renders Kind 16 type 1 (order creation) as "Order Placed"
		await expect(merchantPage.getByText('Order Placed').first()).toBeVisible({ timeout: 15_000 })

		// ─── 4. Merchant sends a message ─────────────────────────────
		const merchantInput = merchantPage.getByPlaceholder('Type your message...')
		await expect(merchantInput).toBeVisible({ timeout: 5_000 })
		await merchantInput.fill('Your order is being prepared!')
		await merchantPage.getByRole('button', { name: 'Send message' }).click()

		// Verify merchant sees their own message in the conversation
		// Use .first() since NDK may return duplicates from overlapping filters
		await expect(merchantPage.getByText('Your order is being prepared!').first()).toBeVisible({ timeout: 10_000 })

		// ─── 5. Buyer opens messages — should see merchant conversation ─
		await buyerPage.goto('/dashboard/sales/messages')

		const buyerConvoLink = buyerPage.locator(`a[href="/dashboard/sales/messages/${devUser1.pk}"]`)
		await expect(buyerConvoLink).toBeVisible({ timeout: 15_000 })
		await buyerConvoLink.click()

		// Buyer should see the merchant's message
		await expect(buyerPage.getByText('Your order is being prepared!').first()).toBeVisible({ timeout: 15_000 })

		// ─── 6. Buyer replies ────────────────────────────────────────
		const buyerInput = buyerPage.getByPlaceholder('Type your message...')
		await expect(buyerInput).toBeVisible({ timeout: 5_000 })
		await buyerInput.fill('Thanks, looking forward to receiving it!')
		await buyerPage.getByRole('button', { name: 'Send message' }).click()

		// Buyer sees their own reply
		await expect(buyerPage.getByText('Thanks, looking forward to receiving it!').first()).toBeVisible({ timeout: 10_000 })

		// ─── 7. Merchant sees buyer's reply ──────────────────────────
		// Navigate merchant back to the conversation to trigger a fresh fetch
		await merchantPage.goto(`/dashboard/sales/messages/${devUser2.pk}`)
		await expect(merchantPage.getByText('Thanks, looking forward to receiving it!').first()).toBeVisible({ timeout: 15_000 })

		// ─── 8. Relay verification ───────────────────────────────────
		// Verify Kind 14 messages from merchant to buyer
		const merchantMessages = await queryRelayEvents({
			kinds: [14],
			authors: [devUser1.pk],
			since: testStartTime,
		})
		const merchantToBuyer = merchantMessages.filter((e) => getTagValue(e, 'p') === devUser2.pk)
		expect(merchantToBuyer.length).toBeGreaterThanOrEqual(1)
		expect(merchantToBuyer.some((e) => e.content === 'Your order is being prepared!')).toBe(true)

		// Verify Kind 14 messages from buyer to merchant
		const buyerMessages = await queryRelayEvents({
			kinds: [14],
			authors: [devUser2.pk],
			since: testStartTime,
		})
		const buyerToMerchant = buyerMessages.filter((e) => getTagValue(e, 'p') === devUser1.pk)
		expect(buyerToMerchant.length).toBeGreaterThanOrEqual(1)
		expect(buyerToMerchant.some((e) => e.content === 'Thanks, looking forward to receiving it!')).toBe(true)
	})
})
