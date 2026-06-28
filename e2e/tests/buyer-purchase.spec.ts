import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

// ---------------------------------------------------------------------------
// Helper: select a shipping method for every product on the checkout page
// ---------------------------------------------------------------------------

/**
 * Shipping selection moved from the cart drawer to the checkout page
 * (commits 067ead3c / eabe0597). On the checkout shipping step the CartSummary
 * sidebar renders one ShippingSelector per product, so we iterate over every
 * visible "Select shipping method" trigger and pick the requested option.
 */
async function selectShippingAtCheckout(page: Page, option: RegExp): Promise<void> {
	// Wait for at least one selector to render (shipping options load from the relay).
	await expect(page.getByText('Select shipping method').first()).toBeVisible({ timeout: 15_000 })

	let guard = 0
	// Selecting an option replaces the trigger's placeholder text, so re-querying
	// first() each pass naturally advances to the next unselected product.
	while ((await page.getByText('Select shipping method').count()) > 0) {
		if (++guard > 12) throw new Error('selectShippingAtCheckout: too many shipping selectors')

		const trigger = page.getByText('Select shipping method').first()
		await trigger.click()

		const opt = page.getByRole('option', { name: option })
		await expect(opt).toBeVisible({ timeout: 5_000 })
		await opt.click()

		// Let the select close and cart state settle before the next click.
		await page.waitForTimeout(400)
	}
}

test.describe('Buyer Purchase Flow', () => {
	test('buyer adds two products to cart and totals are correct', async ({ buyerPage }) => {
		test.setTimeout(60_000)

		await buyerPage.goto('/products')

		// Wait for seeded products to load from relay
		const walletCard = buyerPage.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
		const tshirtCard = buyerPage.locator('[data-testid="product-card"]').filter({ hasText: 'Nostr T-Shirt' })

		await expect(walletCard).toBeVisible({ timeout: 15_000 })
		await expect(tshirtCard).toBeVisible()

		// Add Bitcoin Hardware Wallet (50,000 SATS) to cart
		await walletCard.getByRole('button', { name: /Add to Cart/i }).click()
		await expect(walletCard.getByRole('button', { name: /Add/i })).toBeVisible()

		// Add Nostr T-Shirt (15,000 SATS) to cart
		await tshirtCard.getByRole('button', { name: /Add to Cart/i }).click()
		await expect(tshirtCard.getByRole('button', { name: /Add/i })).toBeVisible()

		// Verify cart badge shows 2 items
		const cartBadge = buyerPage.locator('header').locator('span').filter({ hasText: '2' })
		await expect(cartBadge).toBeVisible({ timeout: 5_000 })

		// Open cart drawer
		await buyerPage
			.getByRole('button')
			.filter({ has: buyerPage.locator('.i-basket') })
			.click()

		// The cart no longer holds shipping selectors — it defers shipping to
		// checkout and shows a notice for the unshipped items.
		await expect(buyerPage.getByText(/Select shipping at checkout for 2 items/i)).toBeVisible({ timeout: 10_000 })

		// With no shipping selected yet, the cart total equals the product subtotal
		// (50,000 + 15,000 = 65,000 sat).
		await expect(buyerPage.getByText('65,000 sat').first()).toBeVisible({ timeout: 10_000 })

		// Checkout is reachable straight from the cart (no longer gated on shipping).
		const checkoutButton = buyerPage.getByRole('button', { name: /Checkout/i })
		await expect(checkoutButton).toBeEnabled()
		await checkoutButton.click()

		// Checkout loads on the shipping step.
		await expect(buyerPage.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 15_000 })

		// Select "Worldwide Standard" shipping (5,000 sats) for each product on the
		// checkout page. Shipping is now chosen here, not in the cart drawer.
		await selectShippingAtCheckout(buyerPage, /Worldwide Standard/i)

		// Totals now reflect shipping.
		// Subtotal: 50,000 + 15,000 = 65,000 sat
		// Shipping: 5,000 x 2 products = 10,000 sat (shipping applies per product)
		// Total: 75,000 sat
		await expect(buyerPage.getByText('10,000 sat').first()).toBeVisible({ timeout: 10_000 })
		await expect(buyerPage.getByText('75,000 sat').first()).toBeVisible({ timeout: 10_000 })

		// Verify V4V payment breakdown (merchant seeded with 10% V4V).
		// V4V applies to product subtotal only (65,000 sats), not shipping.
		// Community Share: 10% of 65,000 = 6,500 sat
		// Merchant: 90% of 65,000 + 10,000 shipping = 68,500 sat
		await expect(buyerPage.getByText('Payment Breakdown').first()).toBeVisible()
		await expect(buyerPage.getByText(/Community Share/).first()).toBeVisible()
		await expect(buyerPage.getByText('6,500 sat').first()).toBeVisible()
		await expect(buyerPage.getByText('68,500 sat').first()).toBeVisible()
	})
})
