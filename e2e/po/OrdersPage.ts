import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

/**
 * Page object for buyer's order view (purchases).
 */
export class OrdersPage extends BasePage {
	private readonly orderCards = this.page.locator('[data-testid="order-card"]')
	private readonly orderDetail = this.page.locator('[data-testid="order-detail"]')
	private readonly orderStatus = this.page.locator('[data-testid="order-status"]')
	private readonly orderTimeline = this.page.locator('[data-testid="order-timeline"]')

	async goToOrders() {
		await this.goto('/dashboard/account/your-purchases')
	}

	async expectOrdersVisible() {
		await expect(this.orderCards.first()).toBeVisible({ timeout: 15000 })
	}

	async getOrderCount() {
		return await this.orderCards.count()
	}

	async clickOrder(index: number) {
		await this.orderCards.nth(index).click()
		await expect(this.orderDetail).toBeVisible({ timeout: 10000 })
	}

	async expectOrderDetailVisible() {
		await expect(this.orderDetail).toBeVisible({ timeout: 10000 })
	}

	async getOrderStatus() {
		return await this.orderStatus.textContent()
	}

	async expectTimeline() {
		await expect(this.orderTimeline).toBeVisible()
	}

	async expectNoOrders() {
		await expect(this.orderCards).toHaveCount(0)
	}
}
