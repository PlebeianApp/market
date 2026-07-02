import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'
import { devUser2 } from '../../src/lib/fixtures'
import { nip19 } from 'nostr-tools'

test.use({ scenario: 'marketplace' })

// ---------------------------------------------------------------------------
// Helper: resilient navigation for SPA with TanStack Router
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

// ---------------------------------------------------------------------------
// Helper: add products from both sellers to cart (for newUserPage)
// ---------------------------------------------------------------------------

async function addProductsFromBothSellers(page: Page): Promise<void> {
	// Navigate to products page
	await safeGoto(page, '/products')

	// Wait for products from both sellers to be visible
	await expect(async () => {
		const content = await page.locator('main').textContent()
		expect(content).toContain('Bitcoin Hardware Wallet')
		expect(content).toContain('Lightning Node Setup Guide')
	}).toPass({ timeout: 30_000 })

	// --- Add devUser1's product ---
	const wallet = page.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
	await wallet.getByRole('button', { name: /add to cart/i }).click()
	// Wait for the button to confirm addition
	await expect(wallet.getByRole('button', { name: /add/i })).toBeVisible()

	// --- Add devUser2's product ---
	const guide = page.locator('[data-testid="product-card"]').filter({ hasText: 'Lightning Node Setup Guide' })
	await guide.getByRole('button', { name: /add to cart/i }).click()
	await expect(guide.getByRole('button', { name: /add/i })).toBeVisible()
}

// ---------------------------------------------------------------------------
// Helper: open cart drawer
// ---------------------------------------------------------------------------

async function openCart(page: Page): Promise<void> {
	await page
		.getByRole('button')
		.filter({ has: page.locator('.i-basket') })
		.click()
	await expect(page.getByRole('heading', { name: /your cart/i })).toBeVisible({ timeout: 5_000 })
}

// ---------------------------------------------------------------------------
// Helper: navigate through checkout steps to the payment step
// ---------------------------------------------------------------------------

/**
 * After clicking Checkout in the cart, the checkout flow goes through:
 * 1. Shipping Address step — select a shipping method per product (sidebar),
 *    then fill the (digital-delivery) contact and submit "Continue to Review".
 * 2. Order Summary step
 * 3. Payment step (invoices)
 *
 * Post-redesign (#1045): shipping methods are no longer chosen in the cart.
 * They are selected on the checkout sidebar, one "Select shipping method"
 * trigger per product. This helper selects Digital Delivery (free) for every
 * product before submitting the shipping form.
 */
async function proceedToPaymentStep(page: Page): Promise<void> {
	// Wait for checkout page to load (shipping step appears first)
	await expect(page.getByText('Shipping Address', { exact: true }).or(page.getByText('Order Summary'))).toBeVisible({
		timeout: 30_000,
	})

	// Step 1: Handle shipping step
	if (
		await page
			.getByText('Shipping Address', { exact: true })
			.isVisible()
			.catch(() => false)
	) {
		// 1a. Select a shipping method for each product on the checkout sidebar.
		// The redesign renders one "Select shipping method" trigger per product.
		const methodTriggers = page.getByText('Select shipping method')
		await expect(methodTriggers.first()).toBeVisible({ timeout: 15_000 })
		const methodCount = await methodTriggers.count()
		for (let i = 0; i < methodCount; i++) {
			await page.getByText('Select shipping method').first().click()
			const option = page.getByRole('option', { name: /digital delivery/i })
			await expect(option).toBeVisible({ timeout: 5_000 })
			await option.click()
			await page.waitForTimeout(500)
		}

		// 1b. Wait for the async shipping-type check to complete.
		// For digital delivery, the "Digital Delivery" notice appears once
		// the form detects all items use digital shipping (noAddressRequired = true).
		// This also enables the submit button by removing required field validators.
		await expect(page.getByRole('heading', { name: 'Digital Delivery' })).toBeVisible({ timeout: 10_000 })

		// Fill name to satisfy any validators — even though digital delivery makes
		// name optional, TanStack Form may still hold stale validation state from
		// initial render when noAddressRequired was briefly false.
		const nameInput = page.getByRole('textbox', { name: /full name/i })
		await nameInput.fill('E2E Test Buyer')

		const digitalDeliveryContact = page.getByLabel(/digital delivery contact/i)
		await digitalDeliveryContact.fill('buyer@example.com')

		// Click the form submit button (has form="shipping-form" attribute)
		const submitButton = page.locator('button[form="shipping-form"]')
		await expect(submitButton).toBeEnabled({ timeout: 5_000 })
		await submitButton.click()

		// Wait for navigation away from shipping step
		await expect(page.getByText('Shipping Address', { exact: true })).not.toBeVisible({ timeout: 10_000 })
	}

	// Step 2: Handle summary step
	await expect(page.getByText('Order Summary').or(page.getByText('Invoices', { exact: true }))).toBeVisible({
		timeout: 30_000,
	})

	if (
		await page
			.getByText('Order Summary')
			.isVisible()
			.catch(() => false)
	) {
		const continueButton = page.getByRole('button', { name: /continue to payment/i })
		await expect(continueButton).toBeEnabled({ timeout: 5_000 })
		await continueButton.click()
	}

	// Wait for the payment step
	await expect(page.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })
}

// ---------------------------------------------------------------------------
// A. Marketplace Display
// ---------------------------------------------------------------------------

test.describe('Marketplace Display', () => {
	test('shows products from multiple sellers', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')

		// Wait for products from both merchants to load
		await expect(async () => {
			const content = await newUserPage.locator('main').textContent()
			expect(content).toContain('Bitcoin Hardware Wallet')
			expect(content).toContain('Lightning Node Setup Guide')
		}).toPass({ timeout: 30_000 })

		// Verify product cards are visible
		const walletCard = newUserPage.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
		await expect(walletCard).toBeVisible()

		const guideCard = newUserPage.locator('[data-testid="product-card"]').filter({ hasText: 'Lightning Node Setup Guide' })
		await expect(guideCard).toBeVisible()

		// Navigate to each product detail page and verify "Sold by"
		await walletCard.click()
		await expect(newUserPage.getByText('Sold by:')).toBeVisible({ timeout: 10_000 })

		// Go back and check the second product
		await safeGoto(newUserPage, '/products')
		await expect(guideCard).toBeVisible({ timeout: 15_000 })
		await guideCard.click()
		await expect(newUserPage.getByText('Sold by:')).toBeVisible({ timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// B. Multi-Merchant Cart
// ---------------------------------------------------------------------------

test.describe('Multi-Merchant Cart', () => {
	test('can add products from two different sellers to cart', async ({ newUserPage }) => {
		await addProductsFromBothSellers(newUserPage)

		// Open cart drawer
		await openCart(newUserPage)

		// Cart should show items grouped by seller.
		// Each seller group has a UserWithAvatar component.
		// Verify both product names appear in the cart.
		const cartDialog = newUserPage.getByRole('dialog', { name: /your cart/i })
		await expect(cartDialog.getByText('Bitcoin Hardware Wallet')).toBeVisible()
		await expect(cartDialog.getByText('Lightning Node Setup Guide')).toBeVisible()

		// Post-redesign (#1045): shipping selection moved from the cart to the
		// checkout sidebar. The cart defers shipping — each product renders a
		// "Select shipping at checkout" notice (exact), one per product.
		const shippingNotices = cartDialog.getByText('Select shipping at checkout', { exact: true })
		await expect(shippingNotices).toHaveCount(2, { timeout: 10_000 })
	})

	test('checkout requires a shipping method for every product before review', async ({ newUserPage }) => {
		await addProductsFromBothSellers(newUserPage)
		await openCart(newUserPage)

		const cartDialog = newUserPage.getByRole('dialog', { name: /your cart/i })

		// Post-redesign (#1045): the cart defers shipping to checkout. The cart
		// shows a banner prompting the buyer, and the Checkout button is always
		// enabled (the shipping gate now lives on the checkout page).
		await expect(cartDialog.getByText(/Select shipping at checkout for 2 items\./)).toBeVisible({ timeout: 10_000 })
		const checkoutButton = cartDialog.getByRole('button', { name: /^checkout$/i })
		await expect(checkoutButton).toBeEnabled()
		await checkoutButton.click()

		// On the checkout shipping step, "Continue to Review" stays disabled until
		// every product has a shipping method selected.
		await expect(newUserPage.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 30_000 })
		const continueButton = newUserPage.locator('button[form="shipping-form"]')
		await expect(continueButton).toBeDisabled()

		// Select a method for the first product only.
		await newUserPage.getByText('Select shipping method').first().click()
		await newUserPage.getByRole('option', { name: /digital delivery/i }).click()
		await newUserPage.waitForTimeout(500)

		// Still disabled — the second product has no method yet.
		await expect(continueButton).toBeDisabled()

		// Select a method for the second product.
		await newUserPage.getByText('Select shipping method').first().click()
		await newUserPage.getByRole('option', { name: /digital delivery/i }).click()

		// Now "Continue to Review" is enabled.
		await expect(continueButton).toBeEnabled({ timeout: 5_000 })
	})
})

// ---------------------------------------------------------------------------
// C. Multi-Seller Checkout with V4V
// ---------------------------------------------------------------------------

test.describe('Multi-Seller Checkout with V4V', () => {
	test('cart shows V4V payment breakdown per seller', async ({ newUserPage }) => {
		// Both merchants already have V4V configured (10% to TEST_APP_PUBLIC_KEY)
		// from the marketplace scenario seeding.

		await addProductsFromBothSellers(newUserPage)
		await openCart(newUserPage)

		const cartDialog = newUserPage.getByRole('dialog', { name: /your cart/i })

		// Wait for payment breakdown to appear
		await expect(cartDialog.getByText('Payment Breakdown').first()).toBeVisible({ timeout: 10_000 })

		// Should show "Payment Breakdown" for each seller group
		const breakdowns = cartDialog.getByText('Payment Breakdown')
		await expect(breakdowns).toHaveCount(2, { timeout: 10_000 })

		// Each seller should show "Merchant:" and "Community Share:" labels
		const merchantLabels = cartDialog.getByText(/^Merchant:/)
		await expect(merchantLabels).toHaveCount(2, { timeout: 5_000 })

		const communityLabels = cartDialog.getByText(/^Community Share:/)
		await expect(communityLabels).toHaveCount(2, { timeout: 5_000 })

		// Verify percentage displays (90% seller, 10% community)
		await expect(cartDialog.getByText(/90\.00%/).first()).toBeVisible()
		await expect(cartDialog.getByText(/10\.00%/).first()).toBeVisible()
	})

	test.skip('multi-seller checkout generates correct invoice count', async ({ newUserPage }) => {
		test.setTimeout(120_000)

		// Setup LightningMock BEFORE navigating (required by the mock)
		const lnMock = await LightningMock.setup(newUserPage)

		await addProductsFromBothSellers(newUserPage)
		await openCart(newUserPage)

		// Click checkout
		const cartDialog = newUserPage.getByRole('dialog', { name: /your cart/i })
		const checkoutButton = cartDialog.getByRole('button', { name: /^checkout$/i })
		await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
		await checkoutButton.click()

		// Navigate through shipping → summary → payment
		// (proceedToPaymentStep selects a shipping method per product on the
		// checkout sidebar — post-redesign, #1045.)
		await proceedToPaymentStep(newUserPage)

		// With 2 sellers × (1 merchant + 1 V4V) = 4 invoices.
		// The sidebar should show "All Payments (4)"
		await expect(newUserPage.getByText(/All Payments \(4\)/)).toBeVisible({ timeout: 15_000 })

		// Should show both invoice types
		await expect(newUserPage.getByText('Merchant Payment').first()).toBeVisible()
		await expect(newUserPage.getByText('V4V Payment').first()).toBeVisible()
	})

	test('can complete multi-seller checkout with all invoices', async ({ newUserPage }) => {
		test.setTimeout(120_000)

		const lnMock = await LightningMock.setup(newUserPage)

		await addProductsFromBothSellers(newUserPage)
		await openCart(newUserPage)

		// Checkout
		const cartDialog = newUserPage.getByRole('dialog', { name: /your cart/i })
		await cartDialog.getByRole('button', { name: /^checkout$/i }).click()

		// Navigate through shipping → summary → payment
		// (proceedToPaymentStep selects a shipping method per product on the
		// checkout sidebar — post-redesign, #1045.)
		await proceedToPaymentStep(newUserPage)

		// Pay all 4 invoices using WebLN
		const webLnButton = newUserPage.getByRole('button', { name: 'Pay with WebLN' })

		for (let i = 0; i < 4; i++) {
			await expect(webLnButton).toBeVisible({ timeout: 30_000 })
			await expect(webLnButton).toBeEnabled({ timeout: 10_000 })
			await webLnButton.click()

			if (i < 3) {
				// Wait for progress indicator before clicking next
				await expect(newUserPage.getByText(`${i + 1} of 4 completed`)).toBeVisible({ timeout: 15_000 })
			}
		}

		// Should reach completion
		await expect(newUserPage.getByText('All payments completed successfully!')).toBeVisible({ timeout: 20_000 })
		await expect(newUserPage.getByRole('button', { name: 'View Your Purchases' })).toBeVisible()

		// Verify mock recorded 4 payments
		expect(lnMock.paidInvoices.length).toBe(4)
	})
})

// ---------------------------------------------------------------------------
// D. V4V Dashboard Management
// ---------------------------------------------------------------------------

test.describe('V4V Dashboard Management', () => {
	test('circular economy page shows V4V configuration', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/dashboard/sales/circular-economy')

		// Wait for auth and page to load
		await expect(merchantPage.getByRole('heading', { name: /circular economy/i })).toBeVisible({ timeout: 15_000 })

		// V4V Manager should show the slider with percentage labels.
		// devUser1 has 10% V4V configured (from scenario seeding).
		await expect(merchantPage.getByText(/^Seller: \d+(\.\d+)?%$/)).toBeVisible({ timeout: 10_000 })
		await expect(merchantPage.getByText(/^V4V: \d+(\.\d+)?%$/)).toBeVisible({ timeout: 10_000 })

		// Save button should be visible
		await expect(merchantPage.getByTestId('save-v4v-button')).toBeVisible()
	})

	test('can add a V4V recipient and save', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await safeGoto(merchantPage, '/dashboard/sales/circular-economy')
		await expect(merchantPage.getByRole('heading', { name: /circular economy/i })).toBeVisible({ timeout: 15_000 })

		// Wait for V4V manager to load
		await expect(merchantPage.getByTestId('add-v4v-recipient-form-button')).toBeVisible({ timeout: 10_000 })

		// Click "Add Recipient" to open the form
		await merchantPage.getByTestId('add-v4v-recipient-form-button').click()

		// The ProfileSearch input should appear
		const searchInput = merchantPage.getByPlaceholder('Search profiles or paste npub...')
		await expect(searchInput).toBeVisible({ timeout: 5_000 })

		// Paste devUser2's npub (has seeded profile with lud16, so canReceiveZaps = true)
		const devUser2Npub = nip19.npubEncode(devUser2.pk)
		await searchInput.fill(devUser2Npub)

		// Wait for the profile to resolve and the "Add" button to become enabled
		await expect(merchantPage.getByTestId('add-v4v-recipient-button')).toBeEnabled({ timeout: 15_000 })

		// Click "Add" to confirm
		await merchantPage.getByTestId('add-v4v-recipient-button').click()

		// The recipient should now appear in the list
		// The V4V split section shows recipients with UserWithAvatar
		await expect(merchantPage.getByText(/V4V split between recipients/i)).toBeVisible({ timeout: 5_000 })

		// Click "Save Changes"
		await merchantPage.getByTestId('save-v4v-button').click()

		// Wait for save to complete — button text changes to "Saved"
		await expect(merchantPage.getByText('Saved')).toBeVisible({ timeout: 10_000 })

		// Reload and verify persistence
		await safeGoto(merchantPage, '/dashboard/sales/circular-economy')
		await expect(merchantPage.getByRole('heading', { name: /circular economy/i })).toBeVisible({ timeout: 15_000 })

		// The recipient should still be visible after reload
		await expect(merchantPage.getByText(/V4V split between recipients/i)).toBeVisible({ timeout: 10_000 })
	})
})
