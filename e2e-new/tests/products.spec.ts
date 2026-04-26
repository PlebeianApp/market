import type { Browser, Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { setupAuthContext } from '../fixtures/auth'
import { ensureScenario } from '../scenarios'
import { bytesToHex } from '@noble/hashes/utils'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

test.use({ scenario: 'merchant' })

async function waitForProductForm(page: Page) {
	const productForm = page.locator('[data-testid="product-form"][data-shipping-loaded="true"]')
	await expect(productForm).toBeVisible({ timeout: 15_000 })
	return productForm
}

async function addProductImage(page: Page, imageUrl = 'https://placehold.co/600x600') {
	const imageInput = page.getByTestId('image-url-input')
	await expect(imageInput).toBeVisible({ timeout: 5_000 })
	await imageInput.fill(imageUrl)
	await page.getByTestId('image-save-button').click()
}

async function fillRequiredStepsUntilShipping(page: Page, productName = 'Workflow Product') {
	await page.getByTestId('product-name-input').fill(productName)
	await page.getByTestId('product-description-input').fill('Workflow test description')
	await page.getByTestId('product-next-button').click()

	await page.getByLabel(/price/i).first().fill('10000')
	await page
		.getByTestId('product-quantity-input')
		.or(page.getByLabel(/quantity/i))
		.fill('5')
	await page.getByTestId('product-next-button').click()

	await page.getByTestId('product-next-button').click()

	await page.getByTestId('product-main-category-select').click()
	await page.getByTestId('main-category-bitcoin').click()
	await page.getByTestId('product-next-button').click()

	await addProductImage(page)
	await page.getByTestId('product-next-button').click()
}

async function createFreshUserPage(browser: Browser) {
	await ensureScenario('base')

	const sk = generateSecretKey()
	const user = {
		sk: bytesToHex(sk),
		pk: getPublicKey(sk),
	}

	const context = await browser.newContext()
	await setupAuthContext(context, user)

	const page = await context.newPage()
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

	return { context, page }
}

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

	test('cannot advance from name tab when title is missing', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)

		await merchantPage.getByTestId('product-description-input').fill('Description without a title')

		await expect(merchantPage.getByTestId('product-next-button')).toBeDisabled()
		await expect(merchantPage.getByTestId('product-name-input')).toBeVisible()
		await expect(merchantPage.getByLabel(/price/i).first()).not.toBeVisible()
	})

	test('new account starts on the correct first step', async ({ browser }) => {
		const { context, page } = await createFreshUserPage(browser)

		try {
			await page.goto('/dashboard/products/products/new')
			await waitForProductForm(page)

			await expect(page.getByTestId('product-name-input')).toBeVisible({ timeout: 10_000 })
			await expect(page.getByTestId('product-tab-name')).toHaveAttribute('data-state', 'active')
			await expect(page.getByRole('button', { name: /Digital Delivery/i })).not.toBeVisible()
		} finally {
			await context.close()
		}
	})

	test('required indicators match the workflow validation model', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)

		await expect(merchantPage.getByTestId('product-tab-name')).toContainText('*')
		await expect(merchantPage.getByTestId('product-tab-detail')).toContainText('*')
		await expect(merchantPage.getByTestId('product-tab-spec')).not.toContainText('*')
		await expect(merchantPage.getByTestId('product-tab-category')).toContainText('*')
		await expect(merchantPage.getByTestId('product-tab-images')).toContainText('*')
		await expect(merchantPage.getByTestId('product-tab-shipping')).toContainText('*')
	})

	test('cannot click forward to later tabs when earlier required tabs are incomplete', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)

		await merchantPage.getByRole('tab', { name: 'Images' }).click()

		await expect(merchantPage.getByText('Complete Name before moving to Images').first()).toBeVisible({ timeout: 5_000 })
		await expect(merchantPage.getByTestId('product-name-input')).toBeVisible()
		await expect(merchantPage.getByTestId('image-url-input')).not.toBeVisible()
	})

	test('missing required fields block progression on detail and category steps', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)

		await merchantPage.getByTestId('product-name-input').fill('Step Blocking Product')
		await merchantPage.getByTestId('product-description-input').fill('Step validation should block progress')
		await merchantPage.getByTestId('product-next-button').click()

		await expect(merchantPage.getByTestId('product-next-button')).toBeDisabled()
		await merchantPage.getByLabel(/price/i).first().fill('10000')
		await expect(merchantPage.getByTestId('product-next-button')).toBeDisabled()
		await merchantPage
			.getByTestId('product-quantity-input')
			.or(merchantPage.getByLabel(/quantity/i))
			.fill('5')
		await expect(merchantPage.getByTestId('product-next-button')).toBeEnabled()

		await merchantPage.getByTestId('product-next-button').click()
		await merchantPage.getByTestId('product-next-button').click()

		await expect(merchantPage.getByTestId('product-next-button')).toBeDisabled()
		await merchantPage.getByTestId('product-main-category-select').click()
		await merchantPage.getByTestId('main-category-bitcoin').click()
		await expect(merchantPage.getByTestId('product-next-button')).toBeEnabled()
	})

	test('backward navigation still works', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)

		await merchantPage.getByTestId('product-name-input').fill('Back Nav Product')
		await merchantPage.getByTestId('product-description-input').fill('Back navigation should still work')
		await merchantPage.getByTestId('product-next-button').click()

		await expect(merchantPage.getByLabel(/price/i).first()).toBeVisible({ timeout: 5_000 })

		await merchantPage.getByTestId('product-back-button').click()

		await expect(merchantPage.getByTestId('product-name-input')).toBeVisible()
		await expect(merchantPage.getByTestId('product-name-input')).toHaveValue('Back Nav Product')
	})

	test('publish remains disabled until the full required set is valid', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)

		await fillRequiredStepsUntilShipping(merchantPage, 'Publish Guard Product')

		const publishButton = merchantPage.getByTestId('product-publish-button')
		await expect(publishButton).toBeDisabled()

		const addButton = merchantPage.getByRole('button', { name: /^add$/i }).first()
		await expect(addButton).toBeVisible({ timeout: 5_000 })
		await addButton.click()

		await expect(publishButton).toBeEnabled({ timeout: 5_000 })
	})

	test('last step uses final action semantics instead of wrapping to the first tab', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)
		await fillRequiredStepsUntilShipping(merchantPage, 'Terminal Step Product')

		await expect(merchantPage.getByTestId('product-tab-shipping')).toHaveAttribute('data-state', 'active')
		await expect(merchantPage.getByTestId('product-next-button')).not.toBeVisible()
		await expect(merchantPage.getByTestId('product-publish-button')).toBeVisible()
		await expect(merchantPage.getByTestId('product-name-input')).not.toBeVisible()
	})

	test('images tab uses a single effective scroll container', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')
		await waitForProductForm(merchantPage)
		await fillRequiredStepsUntilShipping(merchantPage, 'Images Scroll Product')

		await merchantPage.getByTestId('product-back-button').click()
		await expect(merchantPage.getByTestId('product-images-tab-panel')).toBeVisible()

		const scrollInfo = await merchantPage.evaluate(() => {
			const panel = document.querySelector('[data-testid="product-images-tab-panel"]') as HTMLElement | null
			const scrollContainer = document.querySelector('[data-testid="product-form-scroll-container"]') as HTMLElement | null

			if (!panel || !scrollContainer) {
				return null
			}

			const nestedScrollableDescendants = Array.from(panel.querySelectorAll<HTMLElement>('*')).filter((element) => {
				const style = window.getComputedStyle(element)
				return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight
			})

			return {
				outerOverflowY: window.getComputedStyle(scrollContainer).overflowY,
				nestedScrollableCount: nestedScrollableDescendants.length,
			}
		})

		expect(scrollInfo).not.toBeNull()
		expect(scrollInfo?.outerOverflowY).toBe('auto')
		expect(scrollInfo?.nestedScrollableCount).toBe(0)
	})

	test('can create a new product', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard/products/products/new')

		// Wait for product-form initialization to settle before interacting.
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
		const priceInput = merchantPage.getByLabel(/price/i).first()
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
