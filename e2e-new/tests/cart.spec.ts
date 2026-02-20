import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'

test.use({ scenario: 'marketplace' })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resilient navigation for SPA with TanStack Router.
 * Retries if the navigation is interrupted by a client-side redirect.
 */
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

/** Open the cart drawer via the basket icon in the header. */
async function openCart(page: Page): Promise<void> {
	await page
		.getByRole('button')
		.filter({ has: page.locator('.i-basket') })
		.click()
	await expect(page.getByRole('heading', { name: /your cart/i })).toBeVisible({ timeout: 5_000 })
}

/** Get the cart dialog locator. */
function cartDialog(page: Page) {
	return page.getByRole('dialog', { name: /your cart/i })
}

/** Add the "Bitcoin Hardware Wallet" (devUser1) to the cart from the /products page. */
async function addWalletToCart(page: Page): Promise<void> {
	const wallet = page.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
	await expect(wallet).toBeVisible({ timeout: 15_000 })
	await wallet.getByRole('button', { name: /add to cart/i }).click()
	// Wait for the button to change indicating item was added
	await expect(wallet.getByRole('button', { name: /add/i })).toBeVisible()
}

/** Add the "Lightning Node Setup Guide" (devUser2) to the cart from the /products page. */
async function addGuideToCart(page: Page): Promise<void> {
	const guide = page.locator('[data-testid="product-card"]').filter({ hasText: 'Lightning Node Setup Guide' })
	await expect(guide).toBeVisible({ timeout: 15_000 })
	await guide.getByRole('button', { name: /add to cart/i }).click()
	await expect(guide.getByRole('button', { name: /add/i })).toBeVisible()
}

/** Add the "Nostr T-Shirt" (devUser1) to the cart from the /products page. */
async function addTShirtToCart(page: Page): Promise<void> {
	const tshirt = page.locator('[data-testid="product-card"]').filter({ hasText: 'Nostr T-Shirt' })
	await expect(tshirt).toBeVisible({ timeout: 15_000 })
	await tshirt.getByRole('button', { name: /add to cart/i }).click()
	await expect(tshirt.getByRole('button', { name: /add/i })).toBeVisible()
}

/** Wait for the /products page to display products from both sellers. */
async function waitForProducts(page: Page): Promise<void> {
	await expect(async () => {
		const content = await page.locator('main').textContent()
		expect(content).toContain('Bitcoin Hardware Wallet')
		expect(content).toContain('Lightning Node Setup Guide')
	}).toPass({ timeout: 30_000 })
}

// ---------------------------------------------------------------------------
// A. Remove Items from Cart
// ---------------------------------------------------------------------------

test.describe('Cart - Remove Items', () => {
	test('can remove a single item from cart', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)
		await addWalletToCart(newUserPage)

		// Open cart and verify the item is present
		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })

		// Click the remove (trash) button — it's inside the CartItem for the wallet
		// The trash button is the last button in the quantity controls row
		const removeButton = dialog.locator('button:has(svg.lucide-trash-2)').first()
		await removeButton.click()

		// The cart should now be empty — the EmptyCartScreen appears
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).not.toBeVisible({ timeout: 5_000 })
	})

	test('removing one item from multi-item cart keeps others', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		// Add two products from different sellers
		await addWalletToCart(newUserPage)
		await addGuideToCart(newUserPage)

		// Open cart and verify both items are present
		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })
		await expect(dialog.getByText('Lightning Node Setup Guide')).toBeVisible()

		// Remove the first item (Bitcoin Hardware Wallet)
		// Locate the cart item container that has the wallet title, then find its trash button
		const walletItem = dialog.locator('li').filter({ hasText: 'Bitcoin Hardware Wallet' })
		await walletItem.locator('button:has(svg.lucide-trash-2)').click()

		// Bitcoin Hardware Wallet should be gone, Lightning Node Setup Guide should remain
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).not.toBeVisible({ timeout: 5_000 })
		await expect(dialog.getByText('Lightning Node Setup Guide')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// B. Change Quantity
// ---------------------------------------------------------------------------

test.describe('Cart - Change Quantity', () => {
	test('can increment product quantity using the plus button', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)
		await addWalletToCart(newUserPage)

		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })

		// The quantity input should show 1
		const quantityInput = dialog.locator('input[type="number"]').first()
		await expect(quantityInput).toHaveValue('1')

		// Click the increment (+) button
		const incrementButton = dialog.locator('button:has(svg.lucide-plus)').first()
		await incrementButton.click()

		// Quantity should now be 2
		await expect(quantityInput).toHaveValue('2')
	})

	test('can decrement product quantity using the minus button', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		// Add the wallet twice to start at quantity 2
		await addWalletToCart(newUserPage)
		const wallet = newUserPage.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
		await wallet.getByRole('button', { name: /add/i }).click()
		// Allow state update
		await newUserPage.waitForTimeout(500)

		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })

		const quantityInput = dialog.locator('input[type="number"]').first()
		await expect(quantityInput).toHaveValue('2')

		// Click decrement (-)
		const decrementButton = dialog.locator('button:has(svg.lucide-minus)').first()
		await decrementButton.click()

		// Quantity should now be 1
		await expect(quantityInput).toHaveValue('1')
	})

	test('decrement button is disabled at quantity 1', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)
		await addWalletToCart(newUserPage)

		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })

		// At quantity 1, the minus button should be disabled
		const decrementButton = dialog.locator('button:has(svg.lucide-minus)').first()
		await expect(decrementButton).toBeDisabled()
	})

	test('can add same product multiple times from product listing', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		const wallet = newUserPage.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
		// The button may show "Add to Cart" or "Add" depending on re-render timing.
		// Use a broad matcher that covers both states.
		const addButton = wallet.getByRole('button', { name: /add/i }).first()

		// First add
		await addButton.click()
		// Wait for the Adding… → Added cycle to complete before clicking again
		await expect(addButton).not.toHaveText(/adding/i, { timeout: 5_000 })
		await expect(addButton).not.toHaveText(/added/i, { timeout: 5_000 })

		// Second add
		await addButton.click()
		await expect(addButton).not.toHaveText(/adding/i, { timeout: 5_000 })
		await expect(addButton).not.toHaveText(/added/i, { timeout: 5_000 })

		// Third add
		await addButton.click()
		await expect(addButton).not.toHaveText(/adding/i, { timeout: 5_000 })

		// Open cart and verify quantity is 3
		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		const quantityInput = dialog.locator('input[type="number"]').first()
		await expect(quantityInput).toHaveValue('3')
	})
})

// ---------------------------------------------------------------------------
// C. Multi-Merchant Cart
// ---------------------------------------------------------------------------

test.describe('Cart - Multiple Merchants', () => {
	test('products from different sellers are grouped separately', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		await addWalletToCart(newUserPage)
		await addGuideToCart(newUserPage)

		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)

		// Both products should be visible
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })
		await expect(dialog.getByText('Lightning Node Setup Guide')).toBeVisible()

		// Each seller group gets its own shipping selector,
		// so there should be 2 "Select shipping method" triggers
		const shippingTriggers = dialog.getByText('Select shipping method')
		await expect(shippingTriggers).toHaveCount(2, { timeout: 10_000 })
	})

	test('can add multiple products from same seller', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		// Add two products from devUser1
		await addWalletToCart(newUserPage)
		await addTShirtToCart(newUserPage)

		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)

		// Both products should appear
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })
		await expect(dialog.getByText('Nostr T-Shirt')).toBeVisible()

		// They're grouped under the same seller, so only 1 shipping selector
		const shippingTriggers = dialog.getByText('Select shipping method')
		await expect(shippingTriggers).toHaveCount(1, { timeout: 10_000 })
	})

	test('removing all items from one seller keeps other seller items', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		await addWalletToCart(newUserPage)
		await addGuideToCart(newUserPage)

		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })
		await expect(dialog.getByText('Lightning Node Setup Guide')).toBeVisible()

		// Remove the wallet (devUser1's product)
		const walletItem = dialog.locator('li').filter({ hasText: 'Bitcoin Hardware Wallet' })
		await walletItem.locator('button:has(svg.lucide-trash-2)').click()

		// Wallet gone, guide stays
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).not.toBeVisible({ timeout: 5_000 })
		await expect(dialog.getByText('Lightning Node Setup Guide')).toBeVisible()

		// Only 1 shipping selector should remain (for the remaining seller)
		const shippingTriggers = dialog.getByText('Select shipping method')
		await expect(shippingTriggers).toHaveCount(1, { timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// D. Cart Persistence Across Page Reloads
// ---------------------------------------------------------------------------

test.describe('Cart - Persistence', () => {
	test('cart items persist after page reload', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		// Add a product
		await addWalletToCart(newUserPage)

		// Add another product from a different seller
		await addGuideToCart(newUserPage)

		// Reload the page
		await newUserPage.reload()
		await newUserPage.waitForLoadState('networkidle')

		// Open the cart and verify both items survived the reload
		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })
		await expect(dialog.getByText('Lightning Node Setup Guide')).toBeVisible()
	})

	test('cart quantity persists after page reload', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		// Add a product and increment its quantity
		await addWalletToCart(newUserPage)

		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })

		// Increment quantity to 3
		const incrementButton = dialog.locator('button:has(svg.lucide-plus)').first()
		await incrementButton.click()
		await incrementButton.click()

		const quantityInput = dialog.locator('input[type="number"]').first()
		await expect(quantityInput).toHaveValue('3')

		// Close dialog and reload
		await newUserPage.keyboard.press('Escape')
		await newUserPage.reload()
		await newUserPage.waitForLoadState('networkidle')

		// Verify quantity is still 3 after reload
		await openCart(newUserPage)
		const dialogAfter = cartDialog(newUserPage)
		const quantityAfter = dialogAfter.locator('input[type="number"]').first()
		await expect(quantityAfter).toHaveValue('3', { timeout: 10_000 })
	})

	test('cart persists after navigating to another page and back', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)
		await addWalletToCart(newUserPage)

		// Navigate away to a different page
		await safeGoto(newUserPage, '/')
		await newUserPage.waitForLoadState('networkidle')

		// Navigate back to products
		await safeGoto(newUserPage, '/products')
		await newUserPage.waitForLoadState('networkidle')

		// Cart should still have the item
		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })
	})

	test('clearing cart removes all items after reload', async ({ newUserPage }) => {
		await safeGoto(newUserPage, '/products')
		await waitForProducts(newUserPage)

		await addWalletToCart(newUserPage)
		await addGuideToCart(newUserPage)

		// Open cart and clear it
		await openCart(newUserPage)
		const dialog = cartDialog(newUserPage)
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })

		// Click the "Clear" button at the bottom of the cart
		const clearButton = dialog.getByRole('button', { name: /^clear$/i })
		await clearButton.click()

		// Cart should now show empty state
		await expect(dialog.getByText('Bitcoin Hardware Wallet')).not.toBeVisible({ timeout: 5_000 })
		await expect(dialog.getByText('Lightning Node Setup Guide')).not.toBeVisible()

		// Close and reload to confirm persistence of the cleared state
		await newUserPage.keyboard.press('Escape')
		await newUserPage.reload()
		await newUserPage.waitForLoadState('networkidle')

		// Re-open cart — should still be empty (no phantom items)
		await openCart(newUserPage)
		const dialogAfter = cartDialog(newUserPage)
		// Cart should not contain these products
		await expect(dialogAfter.getByText('Bitcoin Hardware Wallet')).not.toBeVisible({ timeout: 3_000 })
	})
})
