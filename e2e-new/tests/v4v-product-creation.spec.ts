import { test, expect } from '../fixtures'
import { devUser3 } from '../../src/lib/fixtures'
import { resetV4VForUser } from '../scenarios'

test.use({ scenario: 'base' })

test.describe('V4V Product Creation Flow', () => {
	test('new user creating first product triggers V4V dialog and value is reflected on dashboard', async ({ newUserPage }) => {
		// Reset V4V shares so the V4V setup dialog will appear during product creation.
		// This is needed because previous test runs may have saved V4V shares for devUser3.
		await resetV4VForUser(devUser3.sk)

		await newUserPage.goto('/dashboard/products/products/new')

		// The form may auto-redirect to the Shipping tab (no shipping options)
		// or stay on the Name tab (has shipping from a previous run).
		const titleInput = newUserPage.getByTestId('product-name-input')
		const digitalDeliveryButton = newUserPage.getByRole('button', { name: /Digital Delivery/i })

		// Wait for either the Name tab or the Shipping tab quick-create templates
		await expect(titleInput.or(digitalDeliveryButton)).toBeVisible({ timeout: 15_000 })

		if (await digitalDeliveryButton.isVisible().catch(() => false)) {
			// No shipping options — create Digital Delivery via quick-create template
			await digitalDeliveryButton.click()
			// After quick-create, the form auto-adds the shipping option and
			// navigates to the Name tab. Wait for the name input.
			await expect(titleInput).toBeVisible({ timeout: 15_000 })
		}

		// --- Name Tab ---
		await titleInput.fill('V4V Test Product')
		await newUserPage.getByTestId('product-description-input').fill('Product for testing V4V setup flow')
		await newUserPage.getByTestId('product-next-button').click()

		// --- Detail Tab ---
		const priceInput = newUserPage.getByTestId('product-price-input').or(newUserPage.getByLabel(/price/i).first())
		await expect(priceInput).toBeVisible({ timeout: 5_000 })
		await priceInput.fill('10000')

		const quantityInput = newUserPage.getByTestId('product-quantity-input').or(newUserPage.getByLabel(/quantity/i))
		await quantityInput.fill('5')

		await newUserPage.getByTestId('product-status-select').click()
		await newUserPage.getByTestId('status-option-on-sale').click()

		// Next through Spec tab (skip), then to Category tab
		await newUserPage.getByTestId('product-next-button').click()
		await newUserPage.getByTestId('product-next-button').click()

		// --- Category Tab ---
		await newUserPage.getByTestId('product-main-category-select').click()
		await newUserPage.getByTestId('main-category-bitcoin').click()
		await newUserPage.getByTestId('product-next-button').click()

		// --- Images Tab ---
		const imageInput = newUserPage.getByTestId('image-url-input')
		await expect(imageInput).toBeVisible({ timeout: 5_000 })
		await imageInput.fill('https://placehold.co/600x600')
		await newUserPage.getByTestId('image-save-button').click()
		await newUserPage.getByTestId('product-next-button').click()

		// --- Shipping Tab ---
		// Either shipping options already exist (from relay data / previous runs) or we just
		// created one via quick-create. We need at least one shipping option added to the product.
		const addButton = newUserPage.getByRole('button', { name: /^add$/i }).first()
		const hasAddButton = await addButton.isVisible({ timeout: 5_000 }).catch(() => false)
		if (hasAddButton) {
			await addButton.click()
		}

		// --- V4V Dialog ---
		// Since we reset V4V shares, "Setup V4V First" button should appear
		const v4vButton = newUserPage.getByTestId('product-setup-v4v-button')
		await expect(v4vButton).toBeVisible({ timeout: 10_000 })
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

		// --- Product Published ---
		// App redirects to product page after publish
		await expect(newUserPage.getByRole('heading', { name: 'V4V Test Product', level: 1 })).toBeVisible({ timeout: 15_000 })

		// --- Verify V4V on Circular Economy Dashboard ---
		await newUserPage.goto('/dashboard/sales/circular-economy')
		await expect(newUserPage.getByRole('heading', { name: 'Circular Economy' })).toBeVisible({ timeout: 10_000 })

		// The saved 10% V4V should be reflected
		await expect(newUserPage.getByText('V4V: 10%')).toBeVisible({ timeout: 10_000 })
		await expect(newUserPage.getByText('Seller: 90%')).toBeVisible()
	})
})
