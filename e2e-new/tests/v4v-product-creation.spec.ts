import { test, expect } from '../fixtures'
import { devUser3 } from '../../src/lib/fixtures'
import { resetV4VForUser } from '../scenarios'

test.use({ scenario: 'base' })

test.describe('V4V Product Creation Flow', () => {
	test('configured-zero user can publish first product without V4V setup blocker', async ({ newUserPage }) => {
		// This test covers the PR 5 semantic-gating contract only:
		// configured-zero must not block first-product publish.
		// Give it more time than the default 30s, especially on CI.
		test.setTimeout(60_000)

		// Reset V4V shares by publishing an empty event. Under the semantic split,
		// this is a valid configured-zero state rather than "never configured".
		await resetV4VForUser(devUser3.sk)

		await newUserPage.goto('/dashboard/products/products/new')

		// Wait for the product form's shipping query to complete before interacting.
		// Without this, the form briefly shows the Name tab (default) while the shipping
		// query is loading, then redirects to the Shipping tab once it confirms no
		// shipping options exist. This race condition causes flaky failures on CI.
		const productForm = newUserPage.locator('[data-testid="product-form"][data-shipping-loaded="true"]')
		await expect(productForm).toBeVisible({ timeout: 15_000 })

		const titleInput = newUserPage.getByTestId('product-name-input')
		const digitalDeliveryButton = newUserPage.getByRole('button', { name: /Digital Delivery/i })

		// Now that shipping data is loaded, the form is in its final tab state:
		// - Shipping tab (no shipping options) → need to quick-create
		// - Name tab (has shipping from a previous run) → proceed directly
		if (await digitalDeliveryButton.isVisible().catch(() => false)) {
			// No shipping options — create Digital Delivery via quick-create template
			await digitalDeliveryButton.click()
			// After quick-create, the form auto-adds the shipping option and
			// navigates to the Name tab. Wait for the name input.
			await expect(titleInput).toBeVisible({ timeout: 15_000 })
		}

		// --- Name Tab ---
		const descriptionInput = newUserPage.getByTestId('product-description-input')
		await expect(descriptionInput).toBeVisible({ timeout: 10_000 })

		await titleInput.fill('V4V Zero Test Product')
		await descriptionInput.fill('Product for testing configured-zero V4V publish flow')

		// Verify values stuck before navigating (guards against form re-renders clearing values)
		await expect(titleInput).toHaveValue('V4V Zero Test Product')

		await newUserPage.getByTestId('product-next-button').click()

		// --- Detail Tab ---
		const priceInput = newUserPage.getByLabel(/price/i).first()
		await expect(priceInput).toBeVisible({ timeout: 10_000 })
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

		// --- Publish Without V4V Blocker ---
		// Configured-zero is a valid configured state, so product creation should
		// not be blocked by the V4V setup button.
		const v4vButton = newUserPage.getByTestId('product-setup-v4v-button')
		const publishButton = newUserPage.getByTestId('product-publish-button')
		await expect(newUserPage.getByTestId('product-tab-shipping')).toHaveAttribute('data-state', 'active')
		await expect(newUserPage.getByTestId('product-next-button')).not.toBeVisible()
		await expect(v4vButton).not.toBeVisible()
		await expect(publishButton).toBeVisible({ timeout: 20_000 })
		await publishButton.click()

		// --- Product Published ---
		// App redirects to product page after publish
		await expect(newUserPage.getByRole('heading', { name: 'V4V Zero Test Product', level: 1 })).toBeVisible({ timeout: 15_000 })
	})
})
