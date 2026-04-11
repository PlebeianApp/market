import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { setupLnurlMock } from '../helpers/lnurl-mock'
import { queryRelayEvents, filterByTag } from '../utils/relay-query'
import { WALLETED_USER_LUD16, devUser1, devUser2 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

// ---------------------------------------------------------------------------
// Helper: resilient navigation for SPA with TanStack Router
// ---------------------------------------------------------------------------

/**
 * Navigate to a URL with retry logic to handle the intermittent
 * "Navigation interrupted by another navigation" error from TanStack Router.
 *
 * This happens when Playwright's `goto()` races with the SPA's client-side
 * router hydration. The function retries up to 3 times and verifies the URL
 * after each attempt to detect silent SPA redirects.
 */
async function safeGoto(page: Page, url: string): Promise<void> {
	const targetPath = url.split('?')[0]

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto(url)
		} catch (error) {
			const msg = String(error)
			if (!msg.includes('interrupted by another navigation') && !msg.includes('ERR_ABORTED')) throw error
			// Wait for whatever navigation the SPA triggered to finish
			await page.waitForLoadState('networkidle').catch(() => {})
		}

		// Wait for SPA router to settle after any potential redirects
		await page.waitForTimeout(1000)
		await page.waitForLoadState('networkidle').catch(() => {})

		// Check if we're on the right page
		const currentPath = new URL(page.url()).pathname
		if (currentPath === targetPath || currentPath.startsWith(targetPath)) {
			return // Success — we're on the correct page
		}
		// SPA silently redirected us. Retry.
	}

	// Last resort: final navigation attempt (let it throw naturally if it fails)
	await page.goto(url)
}

/**
 * The buyer has no NWC wallet configured, so checkout shows a persistent Sonner
 * toast that can overlap CTA buttons. Keep the toast visible for debugging, but
 * make it non-blocking so button clicks stay deterministic.
 */
async function neutralizeBlockingToasts(page: Page): Promise<void> {
	await page.evaluate(() => {
		const styleId = 'e2e-sonner-pointer-guard'
		if (!document.getElementById(styleId)) {
			const style = document.createElement('style')
			style.id = styleId
			style.textContent = `
				[data-sonner-toast],
				[data-sonner-toast] *,
				[data-sonner-toaster],
				[data-sonner-toaster] * {
					pointer-events: none !important;
				}
			`
			document.head.appendChild(style)
		}

		document.querySelectorAll('[data-sonner-toast]').forEach((toast) => {
			;(toast as HTMLElement).style.pointerEvents = 'none'
		})
	})
}

// ---------------------------------------------------------------------------
// A. Receiving Payments Configuration (merchant dashboard)
// ---------------------------------------------------------------------------

test.describe('Receiving Payments Configuration', () => {
	test('displays existing seeded payment details', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/dashboard/account/receiving-payments')

		// Wait for auth to complete — the page heading only renders when authenticated
		await expect(merchantPage.getByRole('heading', { name: /receiving payments/i })).toBeVisible({ timeout: 15_000 })

		// The seeded Lightning address should appear on the page (multiple elements may match
		// since the address shows in both the profile card and payment detail list items)
		await expect(merchantPage.getByText(WALLETED_USER_LUD16).first()).toBeVisible({ timeout: 10_000 })

		// Payment method label should show "Lightning Address"
		await expect(merchantPage.getByText(/lightning address/i).first()).toBeVisible()
	})

	test('can add a new Lightning payment method', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/dashboard/account/receiving-payments')

		// Wait for auth + page load
		await expect(merchantPage.getByRole('heading', { name: /receiving payments/i })).toBeVisible({ timeout: 15_000 })

		// Click "Add Payment Method" button
		const addButton = merchantPage.getByRole('button', { name: /add payment method/i }).first()
		await addButton.click()

		// The form should appear — fill in the Lightning address
		const detailsInput = merchantPage.getByTestId('payment-details-input')
		await expect(detailsInput).toBeVisible({ timeout: 5_000 })
		await detailsInput.fill('testmerchant@getalby.com')

		// Click save
		await merchantPage.getByTestId('save-payment-button').click()

		// The new payment detail should appear in the list
		await expect(merchantPage.getByText('testmerchant@getalby.com')).toBeVisible({ timeout: 10_000 })
	})

	test('can delete a payment method', async ({ merchantPage }) => {
		await safeGoto(merchantPage, '/dashboard/account/receiving-payments')

		// Wait for auth + the seeded payment detail to load
		await expect(merchantPage.getByRole('heading', { name: /receiving payments/i })).toBeVisible({ timeout: 15_000 })
		await expect(merchantPage.getByText(WALLETED_USER_LUD16).first()).toBeVisible({ timeout: 10_000 })

		// Count delete buttons before deletion
		const deleteButtons = merchantPage.getByRole('button', { name: /delete payment detail/i })
		const countBefore = await deleteButtons.count()
		expect(countBefore).toBeGreaterThan(0)

		// Click the first delete button (trash icon with aria-label)
		await deleteButtons.first().click()

		// After deletion, one fewer delete button should remain
		await expect(deleteButtons).toHaveCount(countBefore - 1, { timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// B. NWC Wallet Management (buyer dashboard)
// ---------------------------------------------------------------------------

test.describe('NWC Wallet Management', () => {
	test('empty state shows add wallet prompt', async ({ buyerPage }) => {
		await safeGoto(buyerPage, '/dashboard/account/making-payments')

		// Wait for auth — the heading only shows when authenticated
		await expect(buyerPage.getByRole('heading', { name: /making payments/i })).toBeVisible({ timeout: 15_000 })

		// Should show empty state with prompt to add wallet
		await expect(buyerPage.getByText(/no wallets configured/i)).toBeVisible({ timeout: 10_000 })

		// Add Wallet button should be visible
		await expect(buyerPage.getByRole('button', { name: /add wallet/i })).toBeVisible()
	})

	test('can add NWC wallet via manual fields', async ({ buyerPage }) => {
		await safeGoto(buyerPage, '/dashboard/account/making-payments')

		// Wait for auth
		await expect(buyerPage.getByRole('heading', { name: /making payments/i })).toBeVisible({ timeout: 15_000 })

		// Click "Add Wallet" to open the form
		await buyerPage
			.getByRole('button', { name: /add wallet/i })
			.first()
			.click()

		// The add-wallet form should appear
		await expect(buyerPage.getByText(/add nostr wallet connect/i)).toBeVisible({ timeout: 5_000 })

		// Fill the manual fields (using exact label text from the form)
		const testPubkey = 'a'.repeat(64)
		const testRelay = 'wss://relay.test.example'
		const testSecret = 'b'.repeat(64)

		await buyerPage.getByLabel(/wallet connect pubkey/i).fill(testPubkey)
		await buyerPage.getByLabel(/wallet connect relays/i).fill(testRelay)
		await buyerPage.getByLabel(/wallet connect secret/i).fill(testSecret)

		// Click "Save Wallet"
		await buyerPage.getByRole('button', { name: /save wallet/i }).click()

		// The form should close and show the wallet card with "Stored locally"
		await expect(buyerPage.getByText(/stored locally/i)).toBeVisible({ timeout: 5_000 })
	})

	test('can delete an NWC wallet', async ({ buyerPage }) => {
		// Navigate to the making-payments page first, then inject wallet via localStorage.
		// This avoids the "Execution context destroyed" race condition from evaluate()
		// running while the SPA router is still hydrating on the home page.
		await safeGoto(buyerPage, '/dashboard/account/making-payments')

		// Wait for auth — the heading only shows when authenticated
		await expect(buyerPage.getByRole('heading', { name: /making payments/i })).toBeVisible({ timeout: 15_000 })

		// Now inject the test wallet into localStorage and reload
		await buyerPage.evaluate(() => {
			const testWallet = {
				id: 'test-wallet-1',
				name: 'Test Wallet To Delete',
				nwcUri: 'nostr+walletconnect://aaaa?relay=wss://relay.test&secret=bbbb',
				pubkey: 'a'.repeat(64),
				relays: ['wss://relay.test'],
				storedOnNostr: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}
			localStorage.setItem('nwc_wallets', JSON.stringify([testWallet]))
		})

		// Reload so the app picks up the injected wallet
		await safeGoto(buyerPage, '/dashboard/account/making-payments')

		// Wait for auth
		await expect(buyerPage.getByRole('heading', { name: /making payments/i })).toBeVisible({ timeout: 15_000 })

		// The pre-seeded wallet should be visible
		await expect(buyerPage.getByText('Test Wallet To Delete')).toBeVisible({ timeout: 10_000 })

		// Click the delete button (trash icon with aria-label="Delete wallet")
		await buyerPage
			.getByRole('button', { name: /delete wallet/i })
			.first()
			.click()

		// The wallet should be removed
		await expect(buyerPage.getByText('Test Wallet To Delete')).not.toBeVisible({ timeout: 5_000 })
	})
})

// ---------------------------------------------------------------------------
// C. Checkout Flow
// ---------------------------------------------------------------------------

/**
 * Add a seeded product to the cart via the public marketplace and proceed to checkout.
 * This mirrors the stable path used by the dedicated checkout specs.
 */
async function addProductAndGoToCheckout(page: Page): Promise<void> {
	await safeGoto(page, '/products')
	await neutralizeBlockingToasts(page)

	const productCard = page.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
	await expect(productCard).toBeVisible({ timeout: 30_000 })
	await productCard.getByRole('button', { name: /add to cart/i }).click()
	await expect(productCard.getByRole('button', { name: /add/i })).toBeVisible({ timeout: 10_000 })

	await page
		.getByRole('button')
		.filter({ has: page.locator('.i-basket') })
		.click()

	await expect(page.getByRole('heading', { name: /your cart/i })).toBeVisible({ timeout: 10_000 })
	const cartDialog = page.getByRole('dialog', { name: /your cart/i })
	const shippingCombobox = cartDialog.getByRole('combobox')
	await expect(shippingCombobox).toBeVisible({ timeout: 5_000 })
	await shippingCombobox.click()
	await page.getByRole('option', { name: /worldwide standard/i }).click()

	const checkoutButton = cartDialog.getByRole('button', { name: /^checkout$/i })
	await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
	await checkoutButton.click()

	await expect(page.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 15_000 })
}

/**
 * Fill the checkout shipping form using the field ids defined by ShippingAddressForm.
 * This keeps the test aligned with the real form validation rules.
 */
async function fillShippingForm(page: Page, name: string): Promise<void> {
	await expect(page.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 15_000 })
	await page.locator('#name').fill(name)
	await page.locator('#firstLineOfAddress').fill('123 Test Street, Apt 4B')
	await page.locator('#zipPostcode').fill('SW1A 1AA')
	await page.locator('#country').fill('United Kingdom')
	await page.locator('[data-country-item]').filter({ hasText: 'United Kingdom' }).first().click()
	await page.locator('#city').fill('London')
	await page.keyboard.press('Escape')

	await neutralizeBlockingToasts(page)
	const submitButton = page.locator('button[form="shipping-form"]')
	await expect(submitButton).toBeEnabled({ timeout: 10_000 })
	await submitButton.click()
	await expect(page.getByText('Order Summary')).toBeVisible({ timeout: 15_000 })
}

async function continueFromSummaryToPayment(page: Page): Promise<void> {
	await expect(page.getByText('Order Summary')).toBeVisible({ timeout: 15_000 })
	await neutralizeBlockingToasts(page)
	const continueButton = page.getByRole('button', { name: /continue to payment/i })
	await expect(continueButton).toBeEnabled({ timeout: 10_000 })
	await continueButton.click()
}

async function skipAllInvoices(page: Page): Promise<void> {
	await expect(page.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })

	while (
		(await page
			.getByText('Checkout completed!')
			.isVisible()
			.catch(() => false)) === false
	) {
		const skipButton = page.getByRole('button', { name: /skip payment|pay later/i })
		await expect(skipButton.first()).toBeVisible({ timeout: 10_000 })
		await neutralizeBlockingToasts(page)
		await skipButton.first().click()
		await page.waitForTimeout(500)
	}
}

test.describe('Checkout Flow', () => {
	test.describe.configure({ timeout: 120_000 })

	test('empty cart shows redirect message', async ({ buyerPage }) => {
		// Navigate directly to checkout with no items in cart
		await safeGoto(buyerPage, '/checkout')
		await buyerPage.waitForLoadState('networkidle')

		// Should show empty cart message
		await expect(buyerPage.getByText(/your cart is empty/i)).toBeVisible({ timeout: 15_000 })

		// Should show "Continue Shopping" button
		await expect(buyerPage.getByRole('button', { name: /continue shopping/i })).toBeVisible()
	})

	test('full checkout flow with mocked Lightning invoices', async ({ buyerPage }) => {
		await setupLnurlMock(buyerPage)

		await test.step('Add product and proceed to checkout', async () => {
			await addProductAndGoToCheckout(buyerPage)
		})

		await test.step('Fill shipping step and advance to summary', async () => {
			await fillShippingForm(buyerPage, 'Test Buyer')
		})

		await test.step('Create the order and open the payment step', async () => {
			await continueFromSummaryToPayment(buyerPage)
			await expect(buyerPage.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })
		})

		await test.step('Skip all mocked invoices and finish checkout', async () => {
			await skipAllInvoices(buyerPage)
			await expect(buyerPage.getByText('Checkout completed!')).toBeVisible({ timeout: 20_000 })
			await expect(buyerPage.getByRole('button', { name: /view your purchases/i })).toBeVisible()
		})
	})

	test('checkout publishes order events to relay', async ({ buyerPage }) => {
		const testStartTime = Math.floor(Date.now() / 1000) - 5

		await setupLnurlMock(buyerPage)

		await addProductAndGoToCheckout(buyerPage)
		await fillShippingForm(buyerPage, 'Relay Test Buyer')
		await continueFromSummaryToPayment(buyerPage)
		await expect(buyerPage.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })

		await expect(async () => {
			const orderCreationEvents = filterByTag(
				await queryRelayEvents({
					kinds: [16],
					'#p': [devUser1.pk],
					since: testStartTime,
				}),
				'type',
				'1',
			)
			const paymentRequestEvents = filterByTag(
				await queryRelayEvents({
					kinds: [16],
					'#p': [devUser2.pk],
					since: testStartTime,
				}),
				'type',
				'2',
			)

			expect(orderCreationEvents.length).toBeGreaterThan(0)
			expect(paymentRequestEvents.length).toBeGreaterThan(0)
		}).toPass({ timeout: 20_000 })
	})

	test('allows buyer to defer an invoice and continue checkout', async ({ buyerPage }) => {
		await setupLnurlMock(buyerPage)

		await addProductAndGoToCheckout(buyerPage)
		await fillShippingForm(buyerPage, 'Error Test Buyer')
		await continueFromSummaryToPayment(buyerPage)

		await expect(buyerPage.getByText('Invoices', { exact: true })).toBeVisible({ timeout: 30_000 })
		const payLaterButton = buyerPage.getByRole('button', { name: /pay later/i })
		await expect(payLaterButton).toBeVisible({ timeout: 10_000 })
		await neutralizeBlockingToasts(buyerPage)
		await payLaterButton.click()

		await expect(buyerPage.getByText(/1 of \d+ completed/i)).toBeVisible({ timeout: 15_000 })
		await expect(buyerPage.getByText(/skipped/i).first()).toBeVisible({ timeout: 10_000 })
		await expect(buyerPage.getByRole('button', { name: /pay later/i })).toBeVisible({ timeout: 10_000 })
	})
})
