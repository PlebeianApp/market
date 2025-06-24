import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'

type DashboardNavItems = 'Profile' | 'Products' | 'Collections' | 'Shipping Options' | 'Sales' | 'Messages'

export class DashboardPage extends BasePage {
	private readonly dashboardLink = this.page.locator('[data-testid="dashboard-link"]')

	private navLink(item: DashboardNavItems) {
		const linkMap = {
			Profile: '👤 Profile',
			Products: '📦 Products',
			Collections: '🗂️ Collections',
			'Shipping Options': '📫 Shipping Options',
			Sales: '💰 Sales',
			Messages: '✉️ Messages',
		}
		const text = linkMap[item]
		return this.page.locator(`a:has-text("${text}")`)
	}

	async goToDashboard() {
		await this.dashboardLink.click()
		await this.pause(500)
	}

	async navigateTo(item: DashboardNavItems) {
		await this.goToDashboard()
		await this.navLink(item).click()
		await this.pause(200)
	}
}
