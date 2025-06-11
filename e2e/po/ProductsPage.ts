import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class ProductsPage extends BasePage {
	constructor(page: Page) {
		super(page)
	}

	async createProduct(productData: {
		name: string
		description: string
		collection?: string
		price: string
		quantity: string
		status: string
		mainCategory: string
		imageUrl?: string
		shippingOptions?: string[]
	}) {
		// Click Add A Product button
		await this.page.click('[data-testid="add-product-button"]')

		// --- Name Tab ---
		await this.page.fill('[data-testid="product-name-input"]', productData.name)
		await this.page.fill('[data-testid="product-description-input"]', productData.description)

		if (productData.collection) {
			await this.page.click('[data-testid="product-collection-select"]')
			await this.page.click(`[data-testid="collection-option-${productData.collection.toLowerCase().replace(/\s+/g, '-')}"]`)
		}

		// Go to Detail tab
		await this.page.click('[data-testid="product-next-button"]')

		// --- Detail Tab ---
		await this.page.fill('[data-testid="product-price-input"]', productData.price)
		await this.page.fill('[data-testid="product-quantity-input"]', productData.quantity)

		await this.page.click('[data-testid="product-status-select"]')
		await this.page.click(`[data-testid="status-option-${productData.status.toLowerCase().replace(/\s+/g, '-')}"]`)

		// Skip Spec tab
		await this.page.click('[data-testid="product-next-button"]')
		await this.page.click('[data-testid="product-next-button"]')

		// --- Category Tab ---
		await this.page.click('[data-testid="product-main-category-select"]')
		await this.page.click(`[data-testid="main-category-${productData.mainCategory.toLowerCase().replace(/\s+/g, '-')}"]`)

		// Go to Images tab
		await this.page.click('[data-testid="product-next-button"]')

		// --- Images Tab ---
		if (productData.imageUrl) {
			await this.page.fill('[data-testid="image-url-input"]', productData.imageUrl)
			await this.page.click('[data-testid="image-save-button"]')
			// Wait for the image to be saved - look for the image to appear or edit button to show
			await this.page.waitForSelector('[data-testid="image-edit-button"]', { timeout: 200 }).catch(() => {
				console.log('Image save may have failed, continuing...')
			})
		}

		// Go to Shipping tab
		await this.page.click('[data-testid="product-next-button"]')
		await this.page.waitForTimeout(500)

		// --- Shipping Tab ---
		if (productData.shippingOptions) {
			for (const option of productData.shippingOptions) {
				await this.page.click(`[data-testid="add-shipping-option-${option.toLowerCase().replace(/\s+/g, '-')}"]`)
				await this.page.waitForTimeout(500)
			}
		}

		// Save the product
		await this.page.click('[data-testid="product-save-button"]')
		await this.page.waitForTimeout(1000)

		// After creation, we get redirected to the product page
		// Navigate back to products list for next creation
		await this.navigateToProductsList()
	}

	async navigateToProductsList() {
		// Navigate back to the products dashboard
		await this.page.click('[data-testid="dashboard-link"]')
		await this.page.waitForTimeout(500)
		await this.page.click('a:has-text("📦 Products")')
		await this.page.waitForTimeout(1000)
	}

	async editProduct(
		currentName: string,
		updates: {
			name?: string
			price?: string
		},
	) {
		// Find and click edit button for the specific product using a more precise selector
		await this.page
			.getByRole('button', { name: `Edit ${currentName}` })
			.first()
			.click()
		await this.page.waitForTimeout(1000)

		// Update name (on Name tab)
		if (updates.name) {
			await this.page.fill('[data-testid="product-name-input"]', updates.name)
		}

		// Update price (on Detail tab)
		if (updates.price) {
			// Click on Detail tab
			await this.page.click('[data-testid="product-tab-detail"]')
			await this.page.waitForTimeout(500)
			await this.page.fill('[data-testid="product-price-input"]', updates.price)
		}

		// Save the updated product using the correct test ID
		await this.page.click('[data-testid="product-save-button"]')
		await this.page.waitForTimeout(2000)
	}

	async deleteProduct(productName: string) {
		// Set up dialog handler BEFORE clicking the delete button
		this.page.on('dialog', (dialog) => dialog.accept())

		// Find and click delete button for the specific product using a more precise selector
		await this.page
			.getByRole('button', { name: `Delete ${productName}` })
			.first()
			.click()

		await this.page.waitForTimeout(2000)
	}

	async verifyProductExists(productName: string) {
		// Look for the product title span in the products list
		const productTitle = this.page.locator('span.text-sm.font-medium.text-gray-800').filter({ hasText: productName })
		await expect(productTitle).toBeVisible({ timeout: 10000 })
	}

	async verifyProductNotExists(productName: string) {
		// Check that the product title is not in the products list
		const productTitle = this.page.locator('span.text-sm.font-medium.text-gray-800').filter({ hasText: productName })
		await expect(productTitle).not.toBeVisible({ timeout: 5000 })
	}

	async getProductCount() {
		// Count the number of product list items
		return await this.page
			.locator('li')
			.filter({ has: this.page.locator('span.text-sm.font-medium.text-gray-800') })
			.count()
	}

	async verifyProductCountIs(expectedCount: number) {
		// Verify the exact number of products by counting list items with product titles
		const productItems = this.page.locator('li').filter({ has: this.page.locator('span.text-sm.font-medium.text-gray-800') })
		await expect(productItems).toHaveCount(expectedCount, { timeout: 10000 })
	}
}
