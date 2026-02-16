import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class BrowsePage extends BasePage {
	private readonly productsPage = this.page.locator('[data-testid="products-page"]')
	private readonly productGrid = this.page.locator('[data-testid="infinite-product-list"]')
	private readonly productCards = this.page.locator('[data-testid="product-card"]')
	private readonly loadMoreButton = this.page.locator('[data-testid="load-more-button"]')
	private readonly categoryFilterBar = this.page.locator('[data-testid="category-filter-bar"]')
	private readonly categoryAll = this.page.locator('[data-testid="category-all"]')

	// Product detail page
	private readonly productDetailPage = this.page.locator('[data-testid="product-detail-page"]')
	private readonly productTitle = this.page.locator('[data-testid="product-title"]')
	private readonly productPrice = this.page.locator('[data-testid="product-price"]')
	private readonly addToCartButton = this.page.locator('[data-testid="add-to-cart-button"]')
	private readonly quantityInput = this.page.locator('[data-testid="quantity-input"]')
	private readonly minusQuantityButton = this.page.locator('[data-testid="minus-quantity-button"]')
	private readonly plusQuantityButton = this.page.locator('[data-testid="plus-quantity-button"]')

	async goToProducts() {
		await this.goto('/products')
		await expect(this.productsPage).toBeVisible({ timeout: 10000 })
	}

	async expectProductsVisible() {
		await expect(this.productCards.first()).toBeVisible({ timeout: 15000 })
	}

	async getProductCount() {
		return await this.productCards.count()
	}

	async clickProduct(index: number) {
		await this.productCards.nth(index).click()
		await expect(this.productDetailPage).toBeVisible({ timeout: 10000 })
	}

	async clickProductByName(name: string) {
		const card = this.productCards.filter({ hasText: name }).first()
		await card.click()
		await expect(this.productDetailPage).toBeVisible({ timeout: 10000 })
	}

	async expectProductDetailVisible() {
		await expect(this.productDetailPage).toBeVisible({ timeout: 10000 })
	}

	async getProductDetailTitle() {
		return await this.productTitle.textContent()
	}

	async expectProductDetailPrice() {
		await expect(this.productPrice).toBeVisible()
	}

	async setQuantity(qty: number) {
		await this.quantityInput.fill(String(qty))
	}

	async increaseQuantity() {
		await this.plusQuantityButton.click()
	}

	async decreaseQuantity() {
		await this.minusQuantityButton.click()
	}

	async addToCart() {
		await this.addToCartButton.click()
	}

	async expectAddToCartVisible() {
		await expect(this.addToCartButton).toBeVisible()
	}

	async expectAddToCartDisabled() {
		await expect(this.addToCartButton).toBeDisabled()
	}

	async filterByCategory(category: string) {
		const badge = this.categoryFilterBar.locator(`text="${category}"`).first()
		await badge.click()
	}

	async clearCategoryFilter() {
		await this.categoryAll.click()
	}

	async expectCategoryFilterVisible() {
		await expect(this.categoryFilterBar).toBeVisible()
	}

	async loadMore() {
		await expect(this.loadMoreButton).toBeVisible()
		await this.loadMoreButton.click()
	}

	async expectNoMoreProducts() {
		await expect(this.loadMoreButton).not.toBeVisible()
	}
}
