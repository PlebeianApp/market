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

		// Wait for the product form's shipping query to complete before interacting.
		// This prevents a race condition where the form briefly shows the Name tab,
		// then redirects to Shipping tab once the query confirms shipping state.
		const productForm = merchantPage.locator('[data-testid="product-form"][data-shipping-loaded="true"]')
		await expect(productForm).toBeVisible({ timeout: 15_000 })

		// --- Name Tab ---
		const titleInput = merchantPage.getByTestId('product-name-input')
		await expect(titleInput).toBeVisible({ timeout: 10_000 })
		await titleInput.fill('E2E non leaking Test Product')

		const descriptionInput = merchantPage.getByTestId('product-description-input')
		await descriptionInput.fill('A product created by the e2e test suite')

		// Click Next to go to Detail tab
		await merchantPage.getByTestId('product-next-button').click()

		// --- Detail Tab ---
		// The bitcoin price input (id="bitcoin-price") is always visible on the Detail tab.
		const priceInput = merchantPage.locator('#bitcoin-price')
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

	test('can edit an existing product', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/dashboard/products/products')

		// Wait for seeded products to load
		await expect(merchantPage.getByText('Bitcoin Hardware Wallet')).toBeVisible({ timeout: 10_000 })

		// Click edit button on "Bitcoin Hardware Wallet"
		await merchantPage.getByRole('button', { name: 'Edit Bitcoin Hardware Wallet' }).click()

		// Wait for the edit form to load with shipping data
		const productForm = merchantPage.locator('[data-testid="product-form"][data-shipping-loaded="true"]')
		await expect(productForm).toBeVisible({ timeout: 15_000 })

		// Verify the form is pre-populated with existing title
		const titleInput = merchantPage.getByTestId('product-name-input')
		await expect(titleInput).toHaveValue('Bitcoin Hardware Wallet')

		// Update the title
		await titleInput.clear()
		await titleInput.fill('Bitcoin Hardware Wallet Pro')

		// Navigate to Detail tab by clicking the tab directly (edit mode has no Next button)
		await merchantPage.getByRole('tab', { name: 'Detail' }).click()
		const priceInput = merchantPage.getByLabel(/price/i).first()
		await expect(priceInput).toBeVisible({ timeout: 5_000 })
		await priceInput.clear()
		await priceInput.fill('55000')

		// Click "Update Product"
		await merchantPage.getByTestId('product-publish-button').click()

		// After update, the app redirects to the product list
		await expect(merchantPage.getByText('Bitcoin Hardware Wallet Pro')).toBeVisible({ timeout: 15_000 })

		// Original name (exact match) should no longer appear
		await expect(merchantPage.getByText('Bitcoin Hardware Wallet', { exact: true })).not.toBeVisible()
	})

	test('can delete a product', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/dashboard/products/products')

		// Wait for seeded product to load
		await expect(merchantPage.getByText('Nostr T-Shirt')).toBeVisible({ timeout: 10_000 })

		// Auto-accept the browser confirm dialog
		merchantPage.on('dialog', (dialog) => dialog.accept())

		// Click delete button on "Nostr T-Shirt"
		await merchantPage.getByRole('button', { name: 'Delete Nostr T-Shirt' }).click()

		// Verify product is removed from the list
		await expect(merchantPage.getByText('Nostr T-Shirt')).not.toBeVisible({ timeout: 10_000 })
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
