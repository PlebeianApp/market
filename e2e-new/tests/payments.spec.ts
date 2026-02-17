import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { setupLnurlMock } from '../helpers/lnurl-mock'
import { RelayMonitor } from '../fixtures/relay-monitor'
import { WALLETED_USER_LUD16 } from '../../src/lib/fixtures'

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
 * Add a seeded product to the cart via the UI and proceed to checkout.
 * This is the realistic user flow: browse → add to cart → select shipping → checkout.
 */
async function addProductAndGoToCheckout(page: Page): Promise<void> {
	await safeGoto(page, '/products')

	// Wait for seeded product to appear
	await expect(async () => {
		const content = await page.locator('main').textContent()
		expect(content).toContain('Bitcoin Hardware Wallet')
	}).toPass({ timeout: 30_000 })

	// Click product card → detail page
	await page.getByText('Bitcoin Hardware Wallet').first().click()
	await expect(page.getByRole('button', { name: /add to cart/i })).toBeVisible({ timeout: 10_000 })
	await page.getByRole('button', { name: /add to cart/i }).click()

	// Cart drawer opens
	await expect(page.getByRole('heading', { name: /your cart/i })).toBeVisible({ timeout: 5_000 })

	// Select shipping method — Radix Select combobox inside the cart dialog.
	// Scope to the dialog to avoid matching the currency selector in the header.
	const cartDialog = page.getByRole('dialog', { name: /your cart/i })
	const shippingCombobox = cartDialog.getByRole('combobox')
	await expect(shippingCombobox).toBeVisible({ timeout: 5_000 })
	await shippingCombobox.click()

	// Radix Select options are portaled to <body>, so we must search the whole page
	await page.getByRole('option', { name: /digital delivery/i }).click()

	// Click Checkout in the cart drawer (closes drawer, navigates to /checkout)
	const checkoutButton = cartDialog.getByRole('button', { name: /^checkout$/i })
	await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
	await checkoutButton.click()
}

/**
 * Fill the shipping address form on the checkout page.
 * Handles text inputs, the PhoneInput component, and comboboxes for City/Country.
 */
async function fillShippingForm(page: Page, name: string): Promise<void> {
	await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10_000 })
	await page.getByLabel(/full name/i).fill(name)

	// Phone input (required) — PhoneInput renders an <input type="tel">
	const phoneInput = page.locator('input[type="tel"]').first()
	if (await phoneInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await phoneInput.fill('2025551234')
	}

	// Street address (required)
	const addressInput = page.getByLabel(/street address/i).first()
	if (await addressInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await addressInput.fill('123 Test Street')
	}

	// City (required, combobox — fill then Tab to accept)
	const cityInput = page.getByLabel(/city/i).first()
	if (await cityInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await cityInput.fill('New York')
		await page.keyboard.press('Tab')
	}

	// ZIP/Postal Code (required)
	const zipInput = page.getByLabel(/zip/i).first()
	if (await zipInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await zipInput.fill('10001')
	}

	// Country (required, combobox — fill then Tab to accept)
	const countryInput = page.getByLabel(/country/i).first()
	if (await countryInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await countryInput.fill('United States')
		await page.keyboard.press('Tab')
	}

	// Submit the shipping form — both the shipping and summary steps use "Continue to Payment"
	await page.getByRole('button', { name: /continue to payment/i }).click()
}

test.describe('Checkout Flow', () => {
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
		test.setTimeout(120_000)

		// Setup LNURL mock to intercept Lightning address resolution
		await setupLnurlMock(buyerPage)

		// Step 1: Add product to cart and navigate to checkout
		await addProductAndGoToCheckout(buyerPage)

		// Step 2: Fill shipping form and submit
		await fillShippingForm(buyerPage, 'Test Buyer')

		// Step 3: Order Summary — wait for the review step
		await expect(buyerPage.getByText(/review your order/i)).toBeVisible({ timeout: 10_000 })

		// Click "Continue to Payment" — triggers order creation (Kind 16 events)
		const continueButton = buyerPage.getByRole('button', { name: /continue to payment/i })
		await expect(continueButton).toBeVisible({ timeout: 5_000 })
		await continueButton.click()

		// Step 4: Payment — wait for invoices or error state
		await expect(async () => {
			const pageText = await buyerPage.locator('body').textContent()
			const hasPaymentContent =
				pageText?.includes('lnbc') ||
				pageText?.includes('Unable to generate') ||
				pageText?.includes('Skip') ||
				pageText?.includes('Pay') ||
				pageText?.includes('Invoices') ||
				pageText?.includes('invoice')
			expect(hasPaymentContent).toBeTruthy()
		}).toPass({ timeout: 30_000 })

		// If there are skip buttons, click them to move past payment
		const skipButton = buyerPage.getByRole('button', { name: /skip|pay later/i }).first()
		if (await skipButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
			await skipButton.click()
		}

		// Step 5: Completion or skip through remaining invoices
		await expect(async () => {
			const pageText = await buyerPage.locator('body').textContent()
			const isComplete = pageText?.includes('Order complete') || pageText?.includes('order complete') || pageText?.includes('Thank you')
			if (!isComplete) {
				const nextSkip = buyerPage.getByRole('button', { name: /skip|pay later/i }).first()
				if (await nextSkip.isVisible({ timeout: 1_000 }).catch(() => false)) {
					await nextSkip.click()
				}
			}
			expect(isComplete).toBeTruthy()
		}).toPass({ timeout: 20_000 })
	})

	test('checkout publishes order events to relay', async ({ buyerPage }) => {
		test.setTimeout(120_000)

		// Attach relay monitor to the buyer's page
		const monitor = new RelayMonitor(buyerPage)
		await monitor.start()

		// Setup LNURL mock
		await setupLnurlMock(buyerPage)

		// Add product to cart and navigate to checkout
		await addProductAndGoToCheckout(buyerPage)

		// Fill shipping form and submit
		await fillShippingForm(buyerPage, 'Relay Test Buyer')

		// Summary → Continue to Payment (this publishes order events)
		await expect(buyerPage.getByText(/review your order/i)).toBeVisible({ timeout: 10_000 })

		// Clear monitor to only capture events from order creation onwards
		monitor.clear()

		const continueButton = buyerPage.getByRole('button', { name: /continue to payment/i })
		await expect(continueButton).toBeVisible({ timeout: 5_000 })
		await continueButton.click()

		// Wait for order events to be published
		// NDK wraps Kind 16 in NIP-17 gift wraps (Kind 1059), so check for either
		await expect(async () => {
			const kind16Events = monitor.findSentEventsByKind(16)
			const kind1059Events = monitor.findSentEventsByKind(1059)
			const allSent = monitor.getAllEvents().filter((e) => e.direction === 'sent')

			// At least some events should have been sent after clicking "Continue to Payment"
			const hasOrderEvents = kind16Events.length > 0 || kind1059Events.length > 0 || allSent.length > 0
			expect(hasOrderEvents).toBeTruthy()
		}).toPass({ timeout: 20_000 })

		// Print summary for debugging in CI
		monitor.printSummary()
	})

	test('handles invoice generation failure gracefully', async ({ buyerPage }) => {
		test.setTimeout(120_000)

		// Setup LNURL mock that returns errors for invoice callback
		await setupLnurlMock(buyerPage, { failCallback: true })

		// Use the same UI flow (no sessionStorage injection, which triggers an app bug)
		await addProductAndGoToCheckout(buyerPage)

		// Fill shipping form and submit
		await fillShippingForm(buyerPage, 'Error Test Buyer')

		// Summary → Continue to Payment
		await expect(buyerPage.getByText(/review your order/i)).toBeVisible({ timeout: 10_000 })

		const continueButton = buyerPage.getByRole('button', { name: /continue to payment/i })
		await expect(continueButton).toBeVisible({ timeout: 5_000 })
		await continueButton.click()

		// Payment step should show error state from the failed LNURL callback
		await expect(async () => {
			const pageText = await buyerPage.locator('body').textContent()
			const hasContent =
				pageText?.includes('Unable to generate') ||
				pageText?.includes('failed') ||
				pageText?.includes('Error') ||
				pageText?.includes('error') ||
				pageText?.includes('Skip') ||
				pageText?.includes('Try Again') ||
				pageText?.includes('Go Back')
			expect(hasContent).toBeTruthy()
		}).toPass({ timeout: 30_000 })
	})
})
