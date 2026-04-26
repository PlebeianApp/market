import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'

test.use({ scenario: 'merchant' })

test.describe('Lightning Zaps', () => {
	test('buyer can zap a merchant product via WebLN', async ({ buyerPage }) => {
		test.setTimeout(60_000)

		// Set up lightning mock BEFORE navigating to the product page.
		// This intercepts LNURL HTTP requests, injects window.webln,
		// and bridges WebLN payments to zap receipt publishing.
		const lnMock = await LightningMock.setup(buyerPage)

		// Navigate to the public products listing
		await buyerPage.goto('/products')

		// Wait for any product card to appear (previous tests may have modified seeded products)
		const firstProductHeading = buyerPage.locator('main h2').first()
		await expect(firstProductHeading).toBeVisible({ timeout: 15_000 })

		// Click the first product card to go to its detail page
		const productName = (await firstProductHeading.textContent()) || ''
		await firstProductHeading.click()

		// Wait for the product detail page to load (h1 heading)
		await expect(buyerPage.getByRole('heading', { level: 1, name: productName })).toBeVisible({
			timeout: 10_000,
		})

		// Click the Zap button (lightning bolt icon)
		// The ZapButton renders inside the header next to the product title
		const zapButton = buyerPage.locator('button:has(.i-lightning)').first()
		await expect(zapButton).toBeVisible({ timeout: 10_000 })
		await expect(zapButton).toBeEnabled({ timeout: 10_000 })
		await zapButton.click()

		// ZapDialog should open — wait for the amount selection step
		await expect(buyerPage.getByText('Continue to payment')).toBeVisible({ timeout: 10_000 })

		// Default amount is 21 sats — keep it and click "Continue to payment"
		await buyerPage.getByRole('button', { name: 'Continue to payment' }).click()

		// Wait for invoice generation (LNURL calls intercepted by mock)
		// The "Pay with WebLN" button appears once the invoice is ready
		const webLnButton = buyerPage.getByRole('button', { name: 'Pay with WebLN' })
		await expect(webLnButton).toBeVisible({ timeout: 15_000 })
		await expect(webLnButton).toBeEnabled()

		// Click "Pay with WebLN" — triggers the mock payment + zap receipt
		await webLnButton.click()

		// Wait for success confirmation
		// The ZapDialog shows a toast "Zap successful!" and closes after 1.5s
		await expect(buyerPage.getByText('Zap successful!')).toBeVisible({ timeout: 15_000 })

		// Verify the mock recorded the payment
		expect(lnMock.paidInvoices.length).toBe(1)
	})
})
