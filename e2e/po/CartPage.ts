import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

export class CartPage extends BasePage {
	private readonly cartButton = this.page.locator('[data-testid="cart-button"]')
	private readonly cartItemCount = this.page.locator('[data-testid="cart-item-count"]')
	private readonly cartContent = this.page.locator('[data-testid="cart-content"]')
	private readonly emptyCart = this.page.locator('[data-testid="empty-cart"]')
	private readonly cartTotal = this.page.locator('[data-testid="cart-total"]')
	private readonly clearButton = this.page.locator('[data-testid="cart-clear-button"]')
	private readonly checkoutButton = this.page.locator('[data-testid="cart-checkout-button"]')

	async openCart() {
		await this.cartButton.click()
		// Wait for either cart content or empty cart screen
		await expect(this.cartContent.or(this.emptyCart)).toBeVisible({ timeout: 5000 })
	}

	async expectCartEmpty() {
		await expect(this.emptyCart).toBeVisible()
	}

	async expectCartNotEmpty() {
		await expect(this.cartContent).toBeVisible()
	}

	async getItemCount() {
		const countText = await this.cartItemCount.textContent()
		if (!countText) return 0
		return countText === '99+' ? 100 : parseInt(countText)
	}

	async expectItemCount(count: number) {
		if (count === 0) {
			await expect(this.cartItemCount).not.toBeVisible()
		} else {
			await expect(this.cartItemCount).toHaveText(String(count))
		}
	}

	async getTotalText() {
		return await this.cartTotal.textContent()
	}

	async clearCart() {
		await this.clearButton.click()
	}

	async proceedToCheckout() {
		await expect(this.checkoutButton).toBeEnabled()
		await this.checkoutButton.click()
		await this.waitForURL(/\/checkout/, 10000)
	}

	async expectCheckoutDisabled() {
		await expect(this.checkoutButton).toBeDisabled()
	}

	async expectCheckoutEnabled() {
		await expect(this.checkoutButton).toBeEnabled()
	}
}
