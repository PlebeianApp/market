import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { BrowsePage } from './po/BrowsePage'
import { CartPage } from './po/CartPage'

test.describe.serial('12. Shopping Cart', () => {
	let loginPage: LoginPage
	let browsePage: BrowsePage
	let cartPage: CartPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		browsePage = new BrowsePage(page)
		cartPage = new CartPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('cart should be empty initially', async ({ page }) => {
		// Cart badge should not show a count
		const badge = page.locator('[data-testid="cart-item-count"]')
		await expect(badge).not.toBeVisible()

		// Open the cart drawer
		await cartPage.openCart()

		// Should show empty cart screen
		await cartPage.expectCartEmpty()

		console.log('Cart is empty initially')
	})

	test('should add a product to cart from product detail', async ({ page }) => {
		// Navigate to products and click the first one
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()

		// Click add to cart
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		// Cart badge should show count of 1
		await cartPage.expectItemCount(1)

		// Open cart and verify it's not empty
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		console.log('Added product to cart from product detail')
	})

	test('should show cart item with quantity controls', async ({ page }) => {
		// Open cart (should have the item from previous test)
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		// Cart items should have quantity controls
		const cartContent = page.locator('[data-testid="cart-content"]')
		const quantityInput = cartContent.locator('[data-testid="cart-item-quantity"]').first()
		await expect(quantityInput).toBeVisible()

		// Increment and decrement buttons should be present
		await expect(cartContent.locator('[data-testid="cart-item-increment"]').first()).toBeVisible()
		await expect(cartContent.locator('[data-testid="cart-item-decrement"]').first()).toBeVisible()

		// Remove button should be present
		await expect(cartContent.locator('[data-testid="cart-item-remove"]').first()).toBeVisible()

		console.log('Cart item displays with quantity controls')
	})

	test('should update quantity in cart', async ({ page }) => {
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		const cartContent = page.locator('[data-testid="cart-content"]')
		const quantityInput = cartContent.locator('[data-testid="cart-item-quantity"]').first()
		const incrementBtn = cartContent.locator('[data-testid="cart-item-increment"]').first()

		// Get initial quantity
		const initialQty = await quantityInput.inputValue()
		expect(initialQty).toBe('1')

		// Increment quantity
		await incrementBtn.click()
		await page.waitForTimeout(500)

		// Quantity should now be 2
		await expect(quantityInput).toHaveValue('2')

		// Cart badge should update
		await expect(page.locator('[data-testid="cart-item-count"]')).toHaveText('2')

		console.log('Quantity updated from 1 to 2')
	})

	test('should show cart total', async ({ page }) => {
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		// Cart total should be visible
		const totalText = await cartPage.getTotalText()
		expect(totalText).toBeTruthy()
		expect(totalText!.length).toBeGreaterThan(0)

		console.log(`Cart total: ${totalText}`)
	})

	test('should persist cart across page navigation', async ({ page }) => {
		// Navigate away from current page
		await browsePage.goToProducts()
		await page.waitForTimeout(1000)

		// Cart badge should still show items
		const badge = page.locator('[data-testid="cart-item-count"]')
		await expect(badge).toBeVisible()

		// Open cart and verify items still there
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		console.log('Cart persists across page navigation')
	})

	test('should clear entire cart', async ({ page }) => {
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		// Click clear button
		await cartPage.clearCart()
		await page.waitForTimeout(1000)

		// Cart should be empty now
		await cartPage.expectCartEmpty()

		// Badge should not be visible
		await expect(page.locator('[data-testid="cart-item-count"]')).not.toBeVisible()

		console.log('Cart cleared successfully')
	})

	test('should add product back and remove via remove button', async ({ page }) => {
		// Add a product to cart again
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		// Open cart
		await cartPage.openCart()
		await cartPage.expectCartNotEmpty()

		// Click remove button on the first item
		const removeBtn = page.locator('[data-testid="cart-item-remove"]').first()
		await removeBtn.click()
		await page.waitForTimeout(1000)

		// Cart should be empty
		await cartPage.expectCartEmpty()

		console.log('Removed item via remove button')
	})

	test('should add multiple products to cart', async ({ page }) => {
		// Add first product
		await browsePage.goToProducts()
		await browsePage.expectProductsVisible()
		await browsePage.clickProduct(0)
		await browsePage.expectProductDetailVisible()
		await browsePage.addToCart()
		await page.waitForTimeout(1000)

		// Go back and add second product
		await page.goBack()
		await page.waitForTimeout(1000)
		await browsePage.expectProductsVisible()

		// Check if there's a second product
		const productCount = await browsePage.getProductCount()
		if (productCount >= 2) {
			await browsePage.clickProduct(1)
			await browsePage.expectProductDetailVisible()
			await browsePage.addToCart()
			await page.waitForTimeout(1000)

			// Badge should show 2
			await cartPage.expectItemCount(2)

			// Open cart and verify both items
			await cartPage.openCart()
			await cartPage.expectCartNotEmpty()

			console.log('Added 2 products to cart')
		} else {
			console.log('Only 1 product available, skipping multi-product test')
		}

		// Clean up: clear cart for next test run
		await cartPage.openCart()
		if (
			await page
				.locator('[data-testid="cart-clear-button"]')
				.isVisible()
				.catch(() => false)
		) {
			await cartPage.clearCart()
			await page.waitForTimeout(500)
		}
	})
})
