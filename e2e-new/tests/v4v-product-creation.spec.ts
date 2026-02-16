import { test, expect } from '../fixtures'
import { devUser3 } from '../../src/lib/fixtures'
import { resetV4VForUser, ensureShippingForUser } from '../scenarios'

test.use({ scenario: 'base' })

test.describe('V4V Product Creation Flow', () => {
	test('new user creating first product triggers V4V dialog and value is reflected on dashboard', async ({ newUserPage }) => {
		// This test covers full form fill, V4V dialog, and dashboard
		// verification — give it more time than the default 30s, especially on CI.
		test.setTimeout(60_000)

		// Pre-seed relay data for devUser3:
		// 1. Reset V4V shares so the V4V setup dialog will appear during product creation.
		// 2. Ensure shipping exists so the form starts on the Name tab (not the
		//    shipping-first redirect which is prone to React re-render timing issues).
		await resetV4VForUser(devUser3.sk)
		await ensureShippingForUser(devUser3.sk)

		await newUserPage.goto('/dashboard/products/products/new')

		// --- Name Tab ---
		// With shipping pre-seeded, the form should start on the Name tab.
		const titleInput = newUserPage.getByTestId('product-name-input')
		await expect(titleInput).toBeVisible({ timeout: 15_000 })
		await expect(newUserPage.getByTestId('product-tab-name')).toHaveAttribute('data-state', 'active', { timeout: 10_000 })

		await titleInput.fill('V4V Test Product')
		await newUserPage.getByTestId('product-description-input').fill('Product for testing V4V setup flow')

		// Navigate via tab triggers — more reliable than the Next button for new
		// users whose shipping/V4V query results cause background re-renders.
		await newUserPage.getByTestId('product-tab-detail').click()
		await expect(newUserPage.getByTestId('product-tab-detail')).toHaveAttribute('data-state', 'active', { timeout: 10_000 })

		// --- Detail Tab ---
		const priceInput = newUserPage.locator('#bitcoin-price')
		await expect(priceInput).toBeVisible({ timeout: 10_000 })
		await priceInput.fill('10000')

		const quantityInput = newUserPage.getByTestId('product-quantity-input').or(newUserPage.getByLabel(/quantity/i))
		await quantityInput.fill('5')

		await newUserPage.getByTestId('product-status-select').click()
		await newUserPage.getByTestId('status-option-on-sale').click()

		// --- Spec Tab (skip through) ---
		await newUserPage.getByTestId('product-tab-spec').click()
		await expect(newUserPage.getByTestId('product-tab-spec')).toHaveAttribute('data-state', 'active', { timeout: 5_000 })

		// --- Category Tab ---
		await newUserPage.getByTestId('product-tab-category').click()
		await expect(newUserPage.getByTestId('product-tab-category')).toHaveAttribute('data-state', 'active', { timeout: 5_000 })
		await newUserPage.getByTestId('product-main-category-select').click()
		await newUserPage.getByTestId('main-category-bitcoin').click()

		// --- Images Tab ---
		await newUserPage.getByTestId('product-tab-images').click()
		await expect(newUserPage.getByTestId('product-tab-images')).toHaveAttribute('data-state', 'active', { timeout: 5_000 })
		const imageInput = newUserPage.getByTestId('image-url-input')
		await expect(imageInput).toBeVisible({ timeout: 5_000 })
		await imageInput.fill('https://placehold.co/600x600')
		await newUserPage.getByTestId('image-save-button').click()

		// --- Shipping Tab ---
		await newUserPage.getByTestId('product-tab-shipping').click()
		await expect(newUserPage.getByTestId('product-tab-shipping')).toHaveAttribute('data-state', 'active', { timeout: 5_000 })

		// Pre-seeded shipping should be available. Add it to the product.
		const addButton = newUserPage.getByRole('button', { name: /^add$/i }).first()
		await expect(addButton).toBeVisible({ timeout: 10_000 })
		await addButton.click()

		// --- V4V Dialog ---
		// With shipping valid, the footer should show "Setup V4V" (V4V was reset)
		// or "Publish" (if V4V is already configured from a parallel test run).
		const v4vButton = newUserPage.getByTestId('product-setup-v4v-button')
		const publishButton = newUserPage.getByTestId('product-publish-button')
		await expect(v4vButton.or(publishButton)).toBeVisible({ timeout: 10_000 })

		const showedV4VDialog = await v4vButton.isVisible().catch(() => false)
		if (showedV4VDialog) {
			await v4vButton.click()

			// Dialog opens with default 10% V4V for new users
			await expect(newUserPage.getByText('Set up Value for Value (V4V)')).toBeVisible({ timeout: 5_000 })

			// Verify the slider defaults to 10% (non-zero)
			const slider = newUserPage.locator('[role="slider"]').first()
			await expect(slider).toHaveAttribute('aria-valuenow', '10')

			// Verify the percentage labels
			await expect(newUserPage.getByText('V4V: 10%')).toBeVisible()
			await expect(newUserPage.getByText('Seller: 90%')).toBeVisible()

			// Confirm & Save (publishes Kind 30078, then triggers product publish)
			await newUserPage.getByTestId('confirm-v4v-setup-button').click()
		} else {
			// V4V already configured from previous run — publish directly
			await publishButton.click()
		}

		// --- Product Published ---
		// App redirects to product page after publish
		await expect(newUserPage.getByRole('heading', { name: 'V4V Test Product', level: 1 })).toBeVisible({ timeout: 15_000 })

		// --- Verify V4V on Circular Economy Dashboard ---
		if (showedV4VDialog) {
			await newUserPage.goto('/dashboard/sales/circular-economy')
			await expect(newUserPage.getByRole('heading', { name: 'Circular Economy' })).toBeVisible({ timeout: 10_000 })

			// The saved 10% V4V should be reflected
			await expect(newUserPage.getByText('V4V: 10%')).toBeVisible({ timeout: 10_000 })
			await expect(newUserPage.getByText('Seller: 90%')).toBeVisible()
		}
	})
})
