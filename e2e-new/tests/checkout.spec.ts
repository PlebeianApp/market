import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'
import { queryRelayEvents, filterByTag } from '../utils/relay-query'
import { devUser1, devUser2 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

test.describe('Checkout', () => {
	test('buyer can complete a full purchase with shipping', async ({ buyerPage, merchantPage }) => {
		test.setTimeout(90_000)
		const testStartTime = Math.floor(Date.now() / 1000) - 5

		// ─── 1. Setup ───────────────────────────────────────────────
		// LightningMock must be set up BEFORE navigating to the app.
		// It intercepts LNURL HTTP requests, injects window.webln,
		// and bridges WebLN payments to zap receipt publishing.
		const lnMock = await LightningMock.setup(buyerPage)

		// ─── 2. Add product to cart ─────────────────────────────────
		await buyerPage.goto('/products')

		const productCard = buyerPage.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
		await expect(productCard).toBeVisible({ timeout: 15_000 })

		await productCard.getByRole('button', { name: /Add to Cart/i }).click()
		// Wait for cart confirmation (button text changes)
		await expect(productCard.getByRole('button', { name: /Add/i })).toBeVisible()

		// ─── 3. Open cart, select shipping, proceed to checkout ─────
		await buyerPage
			.getByRole('button')
			.filter({ has: buyerPage.locator('.i-basket') })
			.click()

		const shippingTrigger = buyerPage.getByText('Select shipping method')
		await expect(shippingTrigger).toBeVisible({ timeout: 10_000 })
		await shippingTrigger.click()
		await buyerPage.getByText(/Worldwide Standard/).click()

		// Wait for checkout button to be enabled (shipping selected)
		const checkoutButton = buyerPage.getByRole('button', { name: /Checkout/i })
		await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
		await checkoutButton.click()

		// ─── 4. Fill shipping form (step: shipping) ─────────────────
		await expect(buyerPage.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 10_000 })

		// Required fields
		await buyerPage.locator('#name').fill('E2E Test Buyer')
		await buyerPage.locator('#firstLineOfAddress').fill('123 Test Street, Apt 4B')
		await buyerPage.locator('#zipPostcode').fill('SW1A 1AA')

		// Country combobox: type and select from dropdown to set valid value
		await buyerPage.locator('#country').fill('United Kingdom')
		await buyerPage.locator('[data-country-item]').filter({ hasText: 'United Kingdom' }).first().click()

		// City combobox: type the city name (no strict list validation required)
		await buyerPage.locator('#city').fill('London')
		// Close dropdown if it appeared
		await buyerPage.keyboard.press('Escape')

		// Submit shipping form → moves to summary step
		await buyerPage.locator('button[form="shipping-form"]').click()

		// ─── 5. Order summary (step: summary) ───────────────────────
		await expect(buyerPage.getByText('Order Summary')).toBeVisible({ timeout: 10_000 })

		// Verify shipping address appears in summary
		await expect(buyerPage.getByText('E2E Test Buyer')).toBeVisible()
		await expect(buyerPage.getByText('123 Test Street')).toBeVisible()

		// Click "Continue to Payment" on summary step.
		// This publishes order events (Kind 16 type 1 + type 2) and transitions to payment.
		const continueToPayment = buyerPage.getByRole('button', { name: /Continue to Payment/ })
		await expect(continueToPayment).toBeEnabled()
		await continueToPayment.click()

		// ─── 6. Pay invoices (step: payment) ─────────────────────────
		// Wait for the payment step to load and invoices to be generated
		await expect(buyerPage.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })

		// Wait for invoice generation to complete
		// "Generating Lightning invoices..." disappears once invoices are ready
		const webLnButton = buyerPage.getByRole('button', { name: 'Pay with WebLN' })

		// Pay all invoices (merchant + V4V shares — count varies with V4V config)
		await expect(webLnButton).toBeVisible({ timeout: 30_000 })
		while (
			(await buyerPage
				.getByText('All payments completed successfully!')
				.isVisible()
				.catch(() => false)) === false
		) {
			await expect(webLnButton).toBeEnabled({ timeout: 10_000 })
			await webLnButton.click()
			// Wait for payment to register before attempting the next
			await buyerPage.waitForTimeout(1_000)
		}

		// ─── 7. Verify completion (step: complete) ───────────────────
		await expect(buyerPage.getByText('All payments completed successfully!')).toBeVisible({ timeout: 20_000 })
		await expect(buyerPage.getByRole('button', { name: 'View Your Purchases' })).toBeVisible()

		// Verify the mock recorded the expected payments (merchant + V4V)
		expect(lnMock.paidInvoices.length).toBeGreaterThanOrEqual(2)

		// ─── 8. Verify relay events ──────────────────────────────────
		// Query the relay for order events published during this test

		// Order creation events (Kind 16, type 1) — #p = merchant
		const orderCreationEvents = await queryRelayEvents({
			kinds: [16],
			'#p': [devUser1.pk],
			since: testStartTime,
		})
		const orderCreations = filterByTag(orderCreationEvents, 'type', '1')
		expect(orderCreations.length).toBeGreaterThanOrEqual(1)

		// Payment request events (Kind 16, type 2) — #p = buyer (sent TO buyer)
		const paymentRequestEvents = await queryRelayEvents({
			kinds: [16],
			'#p': [devUser2.pk],
			since: testStartTime,
		})
		const paymentRequests = filterByTag(paymentRequestEvents, 'type', '2')
		expect(paymentRequests.length).toBeGreaterThanOrEqual(1)

		// Payment receipt events (Kind 17) — #p = merchant (sent TO merchant)
		const receiptEvents = await queryRelayEvents({
			kinds: [17],
			'#p': [devUser1.pk],
			since: testStartTime,
		})
		expect(receiptEvents.length).toBeGreaterThanOrEqual(1)

		// ─── 9. Verify seller sees the order ─────────────────────────
		await merchantPage.goto('/dashboard/sales/sales')
		await expect(merchantPage.getByRole('heading', { name: 'Sales' })).toBeVisible({ timeout: 15_000 })
		// Wait for order rows to render (innerText only returns visible text,
		// avoiding the hidden mobile-layout duplicates)
		await merchantPage.waitForFunction(() => document.body.innerText.includes('sats') && document.body.innerText.includes('Pending'), {
			timeout: 15_000,
		})
	})
})
