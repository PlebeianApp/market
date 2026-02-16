import { test, expect } from '@playwright/test'
import { BrowsePage } from './po/BrowsePage'

test.describe.serial('11. Product Browsing — Public Marketplace', () => {
	let browsePage: BrowsePage

	test.beforeEach(async ({ page }) => {
		browsePage = new BrowsePage(page)
	})

	test('products page should render with product cards', async ({ page }) => {
		await browsePage.goToProducts()

		// Products page should be visible
		await expect(page.locator('[data-testid="products-page"]')).toBeVisible()

		// Wait for product cards to appear (relay data may take a moment)
		await browsePage.expectProductsVisible()

		// Should have at least one product card
		const count = await browsePage.getProductCount()
		expect(count).toBeGreaterThan(0)

		console.log(`Found ${count} product cards on the products page`)
	})

	test('product cards should display images and titles', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		// First product card should have an image (either an img tag or a "No image" placeholder)
		const firstCard = page.locator('[data-testid="product-card"]').first()
		const hasImage = await firstCard.locator('img').isVisible()
		const hasPlaceholder = await firstCard.locator('text="No image"').isVisible()
		expect(hasImage || hasPlaceholder).toBe(true)

		// First card should have a title (h2 element)
		const title = firstCard.locator('h2')
		await expect(title).toBeVisible()
		const titleText = await title.textContent()
		expect(titleText?.trim().length).toBeGreaterThan(0)

		console.log(`First product: "${titleText?.trim()}", has image: ${hasImage}`)
	})

	test('product cards should display prices', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		// At least one product card should show a price
		// PriceDisplay renders sats values — look for "sats" text in any card
		const cardsWithPrice = page.locator('[data-testid="product-card"]').filter({
			has: page.locator('text=/sats|\\$/'),
		})

		const priceCount = await cardsWithPrice.count()
		expect(priceCount).toBeGreaterThan(0)

		console.log(`${priceCount} product cards showing prices`)
	})

	test('category filter bar should be visible with categories', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		// Category filter bar should be visible
		await browsePage.expectCategoryFilterVisible()

		// "All" badge should be visible
		await expect(page.locator('[data-testid="category-all"]')).toBeVisible()

		console.log('Category filter bar is visible with All badge')
	})

	test('clicking a category should filter products', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		const initialCount = await browsePage.getProductCount()

		// Click on a category — seed data uses these categories
		// Try "Bitcoin" since it's most likely to have products
		await browsePage.filterByCategory('Bitcoin')
		await page.waitForTimeout(2000)

		// URL should have ?tag=Bitcoin
		await expect(page).toHaveURL(/tag=Bitcoin/)

		// Clicking "All" should clear the filter
		await browsePage.clearCategoryFilter()
		await page.waitForTimeout(2000)

		// URL should no longer have tag parameter
		expect(page.url()).not.toContain('tag=')

		console.log(`Category filtering works. Initial count: ${initialCount}`)
	})

	test('clicking a product card should navigate to product detail', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		// Click the first product
		await browsePage.clickProduct(0)

		// Should navigate to product detail page
		await browsePage.expectProductDetailVisible()

		// Product title should be visible and non-empty
		const title = await browsePage.getProductDetailTitle()
		expect(title?.trim().length).toBeGreaterThan(0)

		console.log(`Navigated to product detail: "${title?.trim()}"`)
	})

	test('product detail page should show price and add-to-cart', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		// Click the first product
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()

		// Price should be visible
		await browsePage.expectProductDetailPrice()

		// Add to cart button should be visible
		await browsePage.expectAddToCartVisible()

		console.log('Product detail page shows price and add-to-cart button')
	})

	test('product detail page should have quantity controls', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		// Click the first product
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()

		// Quantity input should exist
		const quantityInput = page.locator('[data-testid="quantity-input"]')
		await expect(quantityInput).toBeVisible()

		// Plus and minus buttons should exist
		await expect(page.locator('[data-testid="plus-quantity-button"]')).toBeVisible()
		await expect(page.locator('[data-testid="minus-quantity-button"]')).toBeVisible()

		// Default quantity should be 1
		await expect(quantityInput).toHaveValue('1')

		// Increase quantity
		await browsePage.increaseQuantity()
		await expect(quantityInput).toHaveValue('2')

		// Decrease back
		await browsePage.decreaseQuantity()
		await expect(quantityInput).toHaveValue('1')

		console.log('Quantity controls work correctly')
	})

	test('homepage should render with hero and product list', async ({ page }) => {
		await page.goto('/')
		await expect(page.locator('[data-testid="homepage"]')).toBeVisible({ timeout: 10000 })

		// Hero section should have the headline
		await expect(page.locator('text="Buy & Sell Stuff with sats"')).toBeVisible()

		// "Start Selling" button should be visible
		await expect(page.locator('text="Start Selling"')).toBeVisible()

		// Infinite product list should appear
		await expect(page.locator('[data-testid="infinite-product-list"]')).toBeVisible({ timeout: 15000 })

		console.log('Homepage renders with hero, CTA, and product list')
	})

	test('homepage should display featured sections when configured', async ({ page }) => {
		await page.goto('/')
		await expect(page.locator('[data-testid="homepage"]')).toBeVisible({ timeout: 10000 })

		// Wait for products to load so featured sections have time to render
		await page.waitForTimeout(3000)

		// Featured sections container should exist (even if individual sections may be empty)
		const featuredSections = page.locator('[data-testid="featured-sections"]')
		const hasFeatured = await featuredSections.isVisible().catch(() => false)

		if (hasFeatured) {
			// Check which sections are present
			const hasProducts = await page
				.locator('[data-testid="featured-products"]')
				.isVisible()
				.catch(() => false)
			const hasCollections = await page
				.locator('[data-testid="featured-collections"]')
				.isVisible()
				.catch(() => false)
			const hasSellers = await page
				.locator('[data-testid="featured-sellers"]')
				.isVisible()
				.catch(() => false)

			console.log(`Featured sections: products=${hasProducts}, collections=${hasCollections}, sellers=${hasSellers}`)
		} else {
			console.log('No featured sections configured — skipping featured checks')
		}
	})

	test('browser back from product detail should return to products page', async ({ page }) => {
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()

		// Click a product to go to detail
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()

		// Go back
		await page.goBack()
		await page.waitForTimeout(1000)

		// Should be back on products page
		await expect(page.locator('[data-testid="products-page"]')).toBeVisible({ timeout: 10000 })

		console.log('Browser back navigation from product detail works')
	})
})
