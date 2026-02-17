import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'
import { queryRelayEvents, filterByTag } from '../utils/relay-query'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import type { Page } from '@playwright/test'

test.use({ scenario: 'merchant' })

/**
 * Helper: find a specific product by name, add to cart, and open the cart.
 */
async function addProductAndOpenCart(page: Page, productName: string) {
	await page.goto('/products')

	// Find the specific product card by name
	const productCard = page.locator('[data-testid="product-card"]').filter({ hasText: productName })
	await expect(productCard).toBeVisible({ timeout: 15_000 })
	await productCard.getByRole('button', { name: /Add to Cart/i }).click()
	await expect(productCard.getByRole('button', { name: /Add/i })).toBeVisible()

	// Open cart
	await page
		.getByRole('button')
		.filter({ has: page.locator('.i-basket') })
		.click()
}

async function payAllInvoices(page: Page) {
	await expect(page.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })
	const webLnButton = page.getByRole('button', { name: 'Pay with WebLN' })
	await expect(webLnButton).toBeVisible({ timeout: 30_000 })
	await expect(webLnButton).toBeEnabled({ timeout: 10_000 })
	await webLnButton.click()

	// Wait for first payment, then pay second (V4V)
	await expect(page.getByText('1 of 2 completed')).toBeVisible({ timeout: 15_000 })
	await expect(webLnButton).toBeEnabled({ timeout: 10_000 })
	await webLnButton.click()

	await expect(page.getByText('All payments completed successfully!')).toBeVisible({ timeout: 20_000 })
}

/**
 * Helper: dismiss persistent Sonner toast notifications that may overlay buttons.
 * The "Could not load wallets" error toast appears because the test buyer has no NWC wallet.
 */
async function dismissToasts(page: Page) {
	await page.evaluate(() => {
		document.querySelectorAll('[data-sonner-toast]').forEach((el) => el.remove())
	})
}

test.describe('Shipping Special Cases', () => {
	test.describe.configure({ timeout: 120_000 })

	test('digital delivery checkout completes without shipping cost', async ({ buyerPage }) => {
		const testStartTime = Math.floor(Date.now() / 1000) - 5
		await LightningMock.setup(buyerPage)

		// ─── 1. Add digital-only product to cart ──────────────────────
		await addProductAndOpenCart(buyerPage, 'Bitcoin E-Book')

		// Shipping should auto-select "Digital Delivery" (only option)
		await expect(buyerPage.getByText(/Digital Delivery/)).toBeVisible({ timeout: 10_000 })

		// Proceed to checkout
		const checkoutButton = buyerPage.getByRole('button', { name: /Checkout/i })
		await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
		await checkoutButton.click()

		// ─── 2. Verify digital delivery notification shown ────────────
		const digitalNotification = buyerPage.locator('.bg-purple-50')
		await expect(digitalNotification.getByText('Digital Delivery')).toBeVisible({ timeout: 15_000 })
		await expect(digitalNotification.getByText(/All items in your order will be delivered digitally/)).toBeVisible()

		// ─── 3. Verify address fields are NOT visible ────────────────
		await expect(buyerPage.locator('#firstLineOfAddress')).not.toBeVisible()
		await expect(buyerPage.locator('#zipPostcode')).not.toBeVisible()
		await expect(buyerPage.locator('#country')).not.toBeVisible()
		await expect(buyerPage.locator('#city')).not.toBeVisible()

		// ─── 4. Submit form (no required fields for digital delivery) ─
		await dismissToasts(buyerPage)
		await buyerPage.locator('button[form="shipping-form"]').click()

		// ─── 5. Order Summary ────────────────────────────────────────
		await expect(buyerPage.getByText('Order Summary')).toBeVisible({ timeout: 10_000 })
		const continueToPayment = buyerPage.getByRole('button', { name: /Continue to Payment/ })
		await expect(continueToPayment).toBeEnabled()
		await continueToPayment.click()

		// ─── 6. Pay invoices ─────────────────────────────────────────
		await payAllInvoices(buyerPage)

		// ─── 7. Navigate to order detail ─────────────────────────────
		await buyerPage.getByRole('button', { name: 'View Your Purchases' }).click()
		await expect(buyerPage.getByRole('heading', { name: 'Your Purchases' })).toBeVisible({ timeout: 15_000 })

		const orderLink = buyerPage.locator('a[href^="/dashboard/orders/"]:visible').first()
		await expect(orderLink).toBeVisible({ timeout: 15_000 })
		await orderLink.click()

		await expect(buyerPage.getByText('Order ID:')).toBeVisible({ timeout: 30_000 })

		// ─── 8. Verify order detail ──────────────────────────────────
		await expect(buyerPage.getByText('5000 sats')).toBeVisible({ timeout: 10_000 })
		await expect(buyerPage.getByText('Bitcoin E-Book')).toBeVisible()

		// Verify "Digital Delivery" heading appears on order detail (scoped to card title)
		await expect(buyerPage.locator('[data-slot="card-title"]', { hasText: 'Digital Delivery' })).toBeVisible({ timeout: 10_000 })

		// ─── 9. Relay verification ───────────────────────────────────
		const allKind16 = await queryRelayEvents({
			kinds: [16],
			'#p': [devUser1.pk],
			since: testStartTime,
		})
		const orderCreations = filterByTag(allKind16, 'type', '1')
		expect(orderCreations.length).toBeGreaterThanOrEqual(1)

		// Verify at least one order has an item referencing the e-book product
		const ebookOrder = orderCreations.find((e) => e.tags.some((t: string[]) => t[0] === 'item' && t[1]?.includes('bitcoin-e-book')))
		expect(ebookOrder).toBeTruthy()

		// Verify the order has a shipping tag referencing the digital-delivery option
		if (ebookOrder) {
			const shippingTag = ebookOrder.tags.find((t: string[]) => t[0] === 'shipping')
			expect(shippingTag).toBeTruthy()
			expect(shippingTag?.[1]).toContain('digital-delivery')

			// Digital orders should NOT have an address tag
			const addressTag = ebookOrder.tags.find((t: string[]) => t[0] === 'address')
			expect(addressTag).toBeFalsy()
		}
	})

	test('local pickup checkout shows pickup address and hides shipping form', async ({ buyerPage }) => {
		const testStartTime = Math.floor(Date.now() / 1000) - 5
		await LightningMock.setup(buyerPage)

		// ─── 1. Add pickup-only product to cart ──────────────────────
		await addProductAndOpenCart(buyerPage, 'Bitcoin Conference Ticket')

		// Shipping should auto-select "Local Pickup - Bitcoin Store" (only option)
		await expect(buyerPage.getByText(/Local Pickup/)).toBeVisible({ timeout: 10_000 })

		// Proceed to checkout
		const checkoutButton = buyerPage.getByRole('button', { name: /Checkout/i })
		await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
		await checkoutButton.click()

		// ─── 2. Verify pickup notification shown ─────────────────────
		await expect(buyerPage.getByText('Pickup Order')).toBeVisible({ timeout: 15_000 })
		await expect(buyerPage.getByText('All items in your order are for pickup. No shipping address is required.')).toBeVisible()

		// Verify pickup address is displayed in the notification
		// (text also appears in the shipping selector, so scope to the notification container)
		const pickupNotification = buyerPage.locator('.bg-blue-50')
		await expect(pickupNotification.getByText('Local Pickup - Bitcoin Store')).toBeVisible()
		await expect(pickupNotification.getByText('456 Satoshi Lane, Austin, TX, 78701, US')).toBeVisible()

		// ─── 3. Verify address fields are NOT visible ────────────────
		await expect(buyerPage.locator('#firstLineOfAddress')).not.toBeVisible()
		await expect(buyerPage.locator('#zipPostcode')).not.toBeVisible()
		await expect(buyerPage.locator('#country')).not.toBeVisible()
		await expect(buyerPage.locator('#city')).not.toBeVisible()

		// ─── 4. Submit form (no required fields for pickup) ──────────
		await dismissToasts(buyerPage)
		await buyerPage.locator('button[form="shipping-form"]').click()

		// ─── 5. Order Summary ────────────────────────────────────────
		await expect(buyerPage.getByText('Order Summary')).toBeVisible({ timeout: 10_000 })
		const continueToPayment = buyerPage.getByRole('button', { name: /Continue to Payment/ })
		await expect(continueToPayment).toBeEnabled()
		await continueToPayment.click()

		// ─── 6. Pay invoices ─────────────────────────────────────────
		await payAllInvoices(buyerPage)

		// ─── 7. Navigate to order detail ─────────────────────────────
		await buyerPage.getByRole('button', { name: 'View Your Purchases' }).click()
		await expect(buyerPage.getByRole('heading', { name: 'Your Purchases' })).toBeVisible({ timeout: 15_000 })

		const orderLink = buyerPage.locator('a[href^="/dashboard/orders/"]:visible').first()
		await expect(orderLink).toBeVisible({ timeout: 15_000 })
		await orderLink.click()

		await expect(buyerPage.getByText('Order ID:')).toBeVisible({ timeout: 30_000 })

		// ─── 8. Verify order detail ──────────────────────────────────
		await expect(buyerPage.getByText('10000 sats')).toBeVisible({ timeout: 10_000 })
		await expect(buyerPage.getByText('Bitcoin Conference Ticket')).toBeVisible()

		// Verify "Pickup Information" heading appears on order detail
		await expect(buyerPage.getByText('Pickup Information')).toBeVisible({ timeout: 10_000 })

		// Verify no delivery address is shown (pickup orders don't send address)
		await expect(buyerPage.getByText('Delivery Address')).not.toBeVisible()

		// ─── 9. Relay verification ───────────────────────────────────
		const allKind16 = await queryRelayEvents({
			kinds: [16],
			'#p': [devUser1.pk],
			since: testStartTime,
		})
		const orderCreations = filterByTag(allKind16, 'type', '1')
		expect(orderCreations.length).toBeGreaterThanOrEqual(1)

		// Verify at least one order references the conference ticket product
		const ticketOrder = orderCreations.find((e) =>
			e.tags.some((t: string[]) => t[0] === 'item' && t[1]?.includes('bitcoin-conference-ticket')),
		)
		expect(ticketOrder).toBeTruthy()

		if (ticketOrder) {
			// Verify the order has a shipping tag referencing the pickup option
			const shippingTag = ticketOrder.tags.find((t: string[]) => t[0] === 'shipping')
			expect(shippingTag).toBeTruthy()
			expect(shippingTag?.[1]).toContain('local-pickup---bitcoin-store')

			// Verify pickup order does NOT have an address tag
			const addressTag = ticketOrder.tags.find((t: string[]) => t[0] === 'address')
			expect(addressTag).toBeFalsy()
		}
	})
})
