import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'
import { DashboardPage } from './DashboardPage'

/**
 * Page object for seller's sales/order management view.
 */
export class SalesPage extends BasePage {
	private readonly orderCards = this.page.locator('[data-testid="order-card"]')
	private readonly orderDetail = this.page.locator('[data-testid="order-detail"]')
	private readonly orderStatus = this.page.locator('[data-testid="order-status"]')
	private readonly orderActions = this.page.locator('[data-testid="order-actions-menu"]')

	async goToSales() {
		const dashboard = new DashboardPage(this.page)
		await dashboard.navigateTo('Sales')
	}

	async expectSalesVisible() {
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

	async openOrderActions() {
		await this.orderActions.click()
	}

	async expectNoSales() {
		await expect(this.orderCards).toHaveCount(0)
	}
}
