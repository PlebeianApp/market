import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

test.describe('Product Management', () => {
	test('products list page shows seeded products', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products')

		// Seeded products should appear in the list
		await expect(merchantPage.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })
		await expect(merchantPage.getByText('Nostr T-Shirt')).toBeVisible()
	})

	test('can navigate to create product page', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products')

		// Click "Add A Product" button
		await merchantPage.getByRole('button', { name: /add.*product/i }).click()

		// The product form should open with a name input
		await expect(merchantPage.getByTestId('product-name-input')).toBeVisible({ timeout: 5_000 })
	})

	test('can create a new product', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')

		// --- Name Tab ---
		const titleInput = merchantPage.getByTestId('product-name-input')
		await expect(titleInput).toBeVisible({ timeout: 10_000 })
		await titleInput.fill('E2E non leaking Test Product')

		const descriptionInput = merchantPage.getByTestId('product-description-input')
		await descriptionInput.fill('A product created by the e2e test suite')

		// Click Next to go to Detail tab
		await merchantPage.getByTestId('product-next-button').click()

		// --- Detail Tab ---
		const priceInput = merchantPage.getByTestId('product-price-input').or(merchantPage.getByLabel(/price/i).first())
		await expect(priceInput).toBeVisible({ timeout: 5_000 })
		await priceInput.fill('10000')

		const quantityInput = merchantPage.getByTestId('product-quantity-input').or(merchantPage.getByLabel(/quantity/i))
		await quantityInput.fill('5')

		// Set status to "On Sale"
		await merchantPage.getByTestId('product-status-select').click()
		await merchantPage.getByTestId('status-option-on-sale').click()

		// Click Next to go to Spec tab, then Next again to skip it
		await merchantPage.getByTestId('product-next-button').click()
		await merchantPage.getByTestId('product-next-button').click()

		// --- Category Tab ---
		await merchantPage.getByTestId('product-main-category-select').click()
		await merchantPage.getByTestId('main-category-bitcoin').click()

		// Click Next to go to Images tab
		await merchantPage.getByTestId('product-next-button').click()

		// --- Images Tab ---
		// Enter a remote image URL (required field)
		const imageInput = merchantPage.getByTestId('image-url-input')
		await expect(imageInput).toBeVisible({ timeout: 5_000 })
		await imageInput.fill('https://placehold.co/600x600')
		// Click Save to add the image
		await merchantPage.getByTestId('image-save-button').click()

		// Click Next to go to Shipping tab
		await merchantPage.getByTestId('product-next-button').click()

		// --- Shipping Tab ---
		// If shipping options are available from seeding, add one
		const addButton = merchantPage.getByRole('button', { name: /^add$/i }).first()
		const hasShippingOptions = await addButton.isVisible().catch(() => false)
		if (hasShippingOptions) {
			await addButton.click()
		} else {
			// Create a quick shipping option via template
			const digitalDelivery = merchantPage.getByText('Digital Delivery')
			const hasTemplate = await digitalDelivery.isVisible().catch(() => false)
			if (hasTemplate) {
				await digitalDelivery.click()
				// Wait for it to be created and then add it
				await expect(merchantPage.getByRole('button', { name: /^add$/i }).first()).toBeVisible({ timeout: 5_000 })
				await merchantPage.getByRole('button', { name: /^add$/i }).first().click()
			}
		}

		// --- Publish ---
		// The app may show "Publish Product" or "Setup V4V First" depending on V4V state.
		const v4vButton = merchantPage.getByTestId('product-setup-v4v-button')
		const publishButton = merchantPage.getByTestId('product-publish-button')

		if (await v4vButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
			await v4vButton.click()
			// V4V dialog: confirm with defaults (0% V4V = user keeps 100%)
			// This also triggers product publish via callback
			await merchantPage.getByTestId('confirm-v4v-setup-button').click({ timeout: 5_000 })
		} else {
			await publishButton.click()
		}

		// Verify: the product page should show the product title (app redirects after publish)
		await expect(merchantPage.getByRole('heading', { name: 'E2E non leaking Test Product', level: 1 })).toBeVisible({ timeout: 15_000 })
	})

	test('seeded products appear in public marketplace', async ({ page }) => {
		// Use unauthenticated page
		await page.goto('/products')

		// Wait for products to load from relay
		await expect(page.locator('main')).toBeVisible()

		// At least one product should be visible (from seeding)
		// Look for any product card/listing element
		await expect(async () => {
			const content = await page.locator('main').textContent()
			// Check that some product-related content loaded
			expect(content?.length).toBeGreaterThan(100)
		}).toPass({ timeout: 10_000 })
	})
})
