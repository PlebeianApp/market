import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'
import { payAllInvoicesWithWebLn } from '../utils/payment-waits'
import { queryRelayEvents, filterByTag } from '../utils/relay-query'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import type { Page } from '@playwright/test'

test.use({ scenario: 'merchant' })

async function addProductAndOpenCart(page: Page, productName: string) {
	await page.goto('/products')

	const productCard = page.locator('[data-testid="product-card"]').filter({ hasText: productName })
	await expect(productCard).toBeVisible({ timeout: 15_000 })
	await productCard.getByRole('button', { name: /Add to Cart/i }).click()
	await expect(productCard.getByRole('button', { name: /Add/i })).toBeVisible()

	await page
		.getByRole('button')
		.filter({ has: page.locator('.i-basket') })
		.click()
}

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

		// Cart shows "Select shipping at checkout" per item (shipping deferred to checkout page)
		await expect(buyerPage.getByText('Select shipping at checkout', { exact: true })).toBeVisible({ timeout: 10_000 })

		// Proceed to checkout
		const checkoutButton = buyerPage.getByRole('button', { name: /Checkout/i })
		await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
		await checkoutButton.click()

		// Wait for checkout page to load
		await expect(buyerPage.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 10_000 })

		// Auto-selection happens in checkout sidebar (single "Digital Delivery" option)
		// Verify the shipping selector shows Digital Delivery in the sidebar
		await expect(buyerPage.getByRole('combobox')).toContainText('Digital Delivery', { timeout: 10_000 })

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
		await payAllInvoicesWithWebLn(buyerPage)

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

		await expect(buyerPage.locator('[data-slot="card-title"]', { hasText: 'Digital Delivery' })).toBeVisible({ timeout: 10_000 })

		// ─── 9. Relay verification ───────────────────────────────────
		const allKind16 = await queryRelayEvents({
			kinds: [16],
			'#p': [devUser1.pk],
			since: testStartTime,
		})
		const orderCreations = filterByTag(allKind16, 'type', '1')
		expect(orderCreations.length).toBeGreaterThanOrEqual(1)

		const ebookOrder = orderCreations.find((e) => e.tags.some((t: string[]) => t[0] === 'item' && t[1]?.includes('bitcoin-e-book')))
		expect(ebookOrder).toBeTruthy()

		if (ebookOrder) {
			const shippingTag = ebookOrder.tags.find((t: string[]) => t[0] === 'shipping')
			expect(shippingTag).toBeTruthy()
			expect(shippingTag?.[1]).toContain('digital-delivery')

			const addressTag = ebookOrder.tags.find((t: string[]) => t[0] === 'address')
			expect(addressTag).toBeFalsy()
		}
	})

	test('local pickup checkout shows pickup address and hides shipping form', async ({ buyerPage }) => {
		const testStartTime = Math.floor(Date.now() / 1000) - 5
		await LightningMock.setup(buyerPage)

		// ─── 1. Add pickup-only product to cart ──────────────────────
		await addProductAndOpenCart(buyerPage, 'Bitcoin Conference Ticket')

		// Cart shows "Select shipping at checkout" per item (shipping deferred)
		await expect(buyerPage.getByText('Select shipping at checkout', { exact: true })).toBeVisible({ timeout: 10_000 })

		// Proceed to checkout
		const checkoutButton = buyerPage.getByRole('button', { name: /Checkout/i })
		await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
		await checkoutButton.click()

		// Wait for checkout page to load
		await expect(buyerPage.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 10_000 })

		// Auto-selection happens in checkout sidebar (single "Local Pickup" option)
		await expect(buyerPage.getByRole('combobox')).toContainText('Local Pickup', { timeout: 10_000 })

		// ─── 2. Verify pickup notification shown ─────────────────────
		await expect(buyerPage.getByText('Pickup Order')).toBeVisible({ timeout: 15_000 })
		await expect(buyerPage.getByText('All items in your order are for pickup. No shipping address is required.')).toBeVisible()

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
		await payAllInvoicesWithWebLn(buyerPage)

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

		await expect(buyerPage.getByText('Pickup Information')).toBeVisible({ timeout: 10_000 })
		await expect(buyerPage.getByText('Delivery Address')).not.toBeVisible()

		// ─── 9. Relay verification ───────────────────────────────────
		const allKind16 = await queryRelayEvents({
			kinds: [16],
			'#p': [devUser1.pk],
			since: testStartTime,
		})
		const orderCreations = filterByTag(allKind16, 'type', '1')
		expect(orderCreations.length).toBeGreaterThanOrEqual(1)

		const ticketOrder = orderCreations.find((e) =>
			e.tags.some((t: string[]) => t[0] === 'item' && t[1]?.includes('bitcoin-conference-ticket')),
		)
		expect(ticketOrder).toBeTruthy()

		if (ticketOrder) {
			const shippingTag = ticketOrder.tags.find((t: string[]) => t[0] === 'shipping')
			expect(shippingTag).toBeTruthy()
			expect(shippingTag?.[1]).toContain('local-pickup---bitcoin-store')

			const addressTag = ticketOrder.tags.find((t: string[]) => t[0] === 'address')
			expect(addressTag).toBeFalsy()
		}
	})
})
