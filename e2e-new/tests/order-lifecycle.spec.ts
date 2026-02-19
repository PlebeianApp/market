import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'
import { queryRelayEvents, filterByTag, getTagValue } from '../utils/relay-query'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import type { Page } from '@playwright/test'

test.use({ scenario: 'merchant' })

/**
 * Shared helper: add a product to cart, fill shipping, and proceed to payment step.
 * Call AFTER LightningMock.setup() but navigates to /products internally.
 */
async function checkoutToPaymentStep(page: Page) {
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

	// Wait for invoices to be generated
	await expect(page.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })
}

test.describe('Order Lifecycle', () => {
	test('partial payment: pay merchant, skip V4V, then complete from order detail', async ({ buyerPage }) => {
		test.setTimeout(120_000)
		const testStartTime = Math.floor(Date.now() / 1000) - 5
		const lnMock = await LightningMock.setup(buyerPage)

		// ─── 1. Checkout with partial payment ─────────────────────────
		await checkoutToPaymentStep(buyerPage)

		// Pay invoice 1 (merchant share) with WebLN
		const webLnButton = buyerPage.getByRole('button', { name: 'Pay with WebLN' })
		await expect(webLnButton).toBeVisible({ timeout: 30_000 })
		await expect(webLnButton).toBeEnabled({ timeout: 10_000 })
		await webLnButton.click()

		// Wait for first payment confirmation (invoice count varies with V4V config)
		await expect(buyerPage.getByText(/1 of \d+ completed/)).toBeVisible({ timeout: 15_000 })

		// Skip all remaining V4V invoices (count varies with V4V config)
		while (
			(await buyerPage
				.getByText('Checkout completed!')
				.isVisible()
				.catch(() => false)) === false
		) {
			const skipButton = buyerPage.getByRole('button', { name: /Pay Later/i })
			await expect(skipButton).toBeVisible({ timeout: 10_000 })
			await skipButton.click()
			await buyerPage.waitForTimeout(1_000)
		}

		// Verify checkout completed (skipped counts as complete for checkout flow)
		await expect(buyerPage.getByText('Checkout completed!')).toBeVisible({ timeout: 20_000 })
		expect(lnMock.paidInvoices.length).toBe(1)

		// Verify only 1 payment receipt on relay
		const receiptsAfterCheckout = await queryRelayEvents({
			kinds: [17],
			authors: [devUser2.pk],
			since: testStartTime,
		})
		expect(receiptsAfterCheckout.length).toBe(1)

		// ─── 2. Navigate to order detail and pay remaining invoice ────
		await buyerPage.getByRole('button', { name: 'View Your Purchases' }).click()
		await expect(buyerPage.getByRole('heading', { name: 'Your Purchases' })).toBeVisible({ timeout: 15_000 })

		// Click the first (most recent) visible order link (dual mobile/desktop layout)
		const orderLink = buyerPage.locator('a[href^="/dashboard/orders/"]:visible').first()
		await expect(orderLink).toBeVisible({ timeout: 15_000 })
		await orderLink.click()

		// Wait for order detail page to load
		await expect(buyerPage.getByText('Order ID:')).toBeVisible({ timeout: 15_000 })

		// Find the first unpaid V4V invoice and click Pay (multiple may exist)
		const payButton = buyerPage.getByRole('button', { name: /Pay.*sats/i }).first()
		await expect(payButton).toBeVisible({ timeout: 15_000 })
		await payButton.click()

		// PaymentDialog opens — pay with WebLN
		// The dialog reuses LightningPaymentProcessor, so "Pay with WebLN" appears
		const dialogWebLn = buyerPage.getByRole('button', { name: 'Pay with WebLN' })
		await expect(dialogWebLn).toBeVisible({ timeout: 15_000 })
		await expect(dialogWebLn).toBeEnabled({ timeout: 10_000 })
		await dialogWebLn.click()

		// Verify both invoices now paid
		expect(lnMock.paidInvoices.length).toBe(2)

		// Give the receipt event time to propagate
		await buyerPage.waitForTimeout(3_000)

		// ─── 3. Verify relay events ───────────────────────────────────
		// Order creation (Kind 16 type 1)
		const allKind16 = await queryRelayEvents({
			kinds: [16],
			'#p': [devUser1.pk],
			since: testStartTime,
		})
		const orderCreations = filterByTag(allKind16, 'type', '1')
		expect(orderCreations.length).toBeGreaterThanOrEqual(1)

		// Payment receipts (Kind 17) — both merchant and V4V should now exist
		const allReceipts = await queryRelayEvents({
			kinds: [17],
			authors: [devUser2.pk],
			since: testStartTime,
		})
		expect(allReceipts.length).toBe(2)
	})

	test('full order lifecycle: pending → confirmed → shipped → completed', async ({ buyerPage, merchantPage }) => {
		test.setTimeout(120_000)
		const testStartTime = Math.floor(Date.now() / 1000) - 5
		const lnMock = await LightningMock.setup(buyerPage)

		// ─── 1. Complete checkout (pay all invoices) ──────────────────
		await checkoutToPaymentStep(buyerPage)

		// Pay all invoices (merchant + V4V shares — count varies with V4V config)
		const webLnButton = buyerPage.getByRole('button', { name: 'Pay with WebLN' })
		await expect(webLnButton).toBeVisible({ timeout: 30_000 })
		while (
			(await buyerPage
				.getByText('All payments completed successfully!')
				.isVisible()
				.catch(() => false)) === false
		) {
			await expect(webLnButton).toBeEnabled({ timeout: 10_000 })
			await webLnButton.click()
			await buyerPage.waitForTimeout(1_000)
		}

		await expect(buyerPage.getByText('All payments completed successfully!')).toBeVisible({ timeout: 20_000 })
		expect(lnMock.paidInvoices.length).toBeGreaterThanOrEqual(2)

		// ─── 2. Merchant: navigate to order detail ────────────────────
		await merchantPage.goto('/dashboard/sales/sales')
		await expect(merchantPage.getByRole('heading', { name: 'Sales' })).toBeVisible({ timeout: 15_000 })

		// Wait for order with Pending status
		await merchantPage.waitForFunction(() => document.body.innerText.includes('sats') && document.body.innerText.includes('Pending'), {
			timeout: 15_000,
		})

		// Click the first (most recent) order link
		const merchantOrderLink = merchantPage.locator('a[href^="/dashboard/orders/"]:visible').first()
		await expect(merchantOrderLink).toBeVisible({ timeout: 10_000 })
		await merchantOrderLink.click()

		// Wait for order detail page
		await expect(merchantPage.getByText('Order ID:')).toBeVisible({ timeout: 15_000 })

		// ─── 3. Merchant confirms order ───────────────────────────────
		const confirmBtn = merchantPage.getByRole('button', { name: 'Confirm', exact: true })
		await expect(confirmBtn).toBeVisible({ timeout: 10_000 })
		await confirmBtn.click()

		// Confirm dialog: click "Confirm Payment Received"
		const confirmDialogBtn = merchantPage.getByRole('button', { name: 'Confirm Payment Received' })
		await expect(confirmDialogBtn).toBeVisible({ timeout: 5_000 })
		await confirmDialogBtn.click()

		// Wait for status to change — Process button appears when status is Confirmed
		await expect(merchantPage.getByRole('button', { name: 'Process', exact: true })).toBeVisible({ timeout: 15_000 })

		// ─── 4. Merchant processes order ──────────────────────────────
		await merchantPage.getByRole('button', { name: 'Process', exact: true }).click()

		// Wait for Ship button to appear (status is now Processing)
		await expect(merchantPage.getByRole('button', { name: 'Ship', exact: true })).toBeVisible({ timeout: 15_000 })

		// ─── 5. Merchant ships order ──────────────────────────────────
		await merchantPage.getByRole('button', { name: 'Ship', exact: true }).click()

		// Shipping dialog: enter tracking URL and save
		await expect(merchantPage.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 5_000 })
		await merchantPage.locator('#tracking').fill('https://tracking.test/e2e-123')
		await merchantPage.getByRole('button', { name: 'Save' }).click()

		// StockUpdateDialog opens automatically after shipping — dismiss it
		await expect(merchantPage.getByText('Update Product Stock')).toBeVisible({ timeout: 10_000 })
		await merchantPage.getByRole('button', { name: 'Cancel' }).click()

		// Verify "Shipped" label appears in the status badge
		await expect(merchantPage.getByText('Shipped', { exact: true })).toBeVisible({ timeout: 15_000 })

		// ─── 6. Buyer marks order as received ─────────────────────────
		await buyerPage.goto('/dashboard/account/your-purchases')
		await expect(buyerPage.getByRole('heading', { name: 'Your Purchases' })).toBeVisible({ timeout: 15_000 })

		// Click the first (most recent) order link
		const buyerOrderLink = buyerPage.locator('a[href^="/dashboard/orders/"]:visible').first()
		await expect(buyerOrderLink).toBeVisible({ timeout: 15_000 })
		await buyerOrderLink.click()

		// Wait for order detail — should show Shipped status and Received button
		await expect(buyerPage.getByText('Order ID:')).toBeVisible({ timeout: 15_000 })
		await expect(buyerPage.getByText('Shipped', { exact: true })).toBeVisible({ timeout: 15_000 })

		const receivedBtn = buyerPage.getByRole('button', { name: 'Received' })
		await expect(receivedBtn).toBeVisible({ timeout: 10_000 })
		await receivedBtn.click()

		// Verify status changes to Completed
		await expect(buyerPage.getByText('Completed', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

		// Give status update events time to propagate to relay
		await buyerPage.waitForTimeout(3_000)

		// ─── 7. Relay verification ────────────────────────────────────
		const allKind16 = await queryRelayEvents({
			kinds: [16],
			since: testStartTime,
		})

		// Status updates (type 3): expect confirmed, processing, completed
		const statusUpdates = filterByTag(allKind16, 'type', '3')
		const statusValues = statusUpdates.map((e) => getTagValue(e, 'status')).filter(Boolean)
		expect(statusValues).toContain('confirmed')
		expect(statusValues).toContain('processing')
		expect(statusValues).toContain('completed')

		// Shipping updates (type 4): expect at least 1 with tracking info
		const shippingUpdates = filterByTag(allKind16, 'type', '4')
		expect(shippingUpdates.length).toBeGreaterThanOrEqual(1)

		const trackingValue = getTagValue(shippingUpdates[0], 'tracking')
		expect(trackingValue).toBe('https://tracking.test/e2e-123')

		// Payment receipts (Kind 17): 2 from buyer (merchant + V4V)
		const receiptEvents = await queryRelayEvents({
			kinds: [17],
			authors: [devUser2.pk],
			since: testStartTime,
		})
		expect(receiptEvents.length).toBeGreaterThanOrEqual(2)
	})
})
