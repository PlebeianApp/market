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
		await this.page.waitForTimeout(500)

		// --- Name Tab ---
		await this.page.fill('[data-testid="product-name-input"]', productData.name)
		await this.page.fill('[data-testid="product-description-input"]', productData.description)

		if (productData.collection) {
			await this.page.click('[data-testid="product-collection-select"]')
			await this.page.waitForTimeout(500)
			await this.page.click(`[data-testid="collection-option-${productData.collection.toLowerCase().replace(/\s+/g, '-')}"]`)
		}

		// Go to Detail tab
		await this.page.click('[data-testid="product-next-button"]')
		await this.page.waitForTimeout(500)

		// --- Detail Tab ---
		await this.page.fill('[data-testid="product-price-input"]', productData.price)
		await this.page.fill('[data-testid="product-quantity-input"]', productData.quantity)

		await this.page.click('[data-testid="product-status-select"]')
		await this.page.waitForTimeout(500)
		await this.page.click(`[data-testid="status-option-${productData.status.toLowerCase().replace(/\s+/g, '-')}"]`)

		// Skip Spec tab
		await this.page.click('[data-testid="product-next-button"]')
		await this.page.waitForTimeout(500)
		await this.page.click('[data-testid="product-next-button"]')
		await this.page.waitForTimeout(500)

		// --- Category Tab ---
		await this.page.click('[data-testid="product-main-category-select"]')
		await this.page.waitForTimeout(500)
		await this.page.click(`[data-testid="main-category-${productData.mainCategory.toLowerCase().replace(/\s+/g, '-')}"]`)

		// Go to Images tab
		await this.page.click('[data-testid="product-next-button"]')
		await this.page.waitForTimeout(500)

		// --- Images Tab ---
		if (productData.imageUrl) {
			await this.page.fill('[data-testid="image-url-input"]', productData.imageUrl)
			await this.page.click('[data-testid="image-save-button"]')
			await this.page.waitForTimeout(1000)
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
		await this.page.waitForTimeout(2000)
	}

	async editProduct(
		currentName: string,
		updates: {
			name?: string
			price?: string
		},
	) {
		// Find and click edit button for the product
		const productRow = this.page.locator(`text=${currentName}`).locator('..').locator('..')
		await productRow.locator('[aria-label*="Edit"]').click()
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
		// Find and click delete button for the product
		const productRow = this.page.locator(`text=${productName}`).locator('..').locator('..')

		// Handle the confirmation dialog
		this.page.on('dialog', (dialog) => dialog.accept())

		await productRow.locator('[aria-label*="Delete"]').click()
		await this.page.waitForTimeout(2000)
	}

	async verifyProductExists(productName: string) {
		await expect(this.page.getByText(productName).first()).toBeVisible({ timeout: 10000 })
	}

	async verifyProductNotExists(productName: string) {
		await expect(this.page.getByText(productName)).not.toBeVisible({ timeout: 5000 })
	}
}
