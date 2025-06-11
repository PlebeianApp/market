import { type Page, expect } from '@playwright/test'

export class BasePage {
	readonly page: Page

	constructor(page: Page) {
		this.page = page
	}

	async goto(path = '/') {
		await this.page.goto(path)
	}

	async waitForURL(url: string | RegExp, timeout = 3000) {
		await expect(this.page).toHaveURL(url, { timeout })
	}

	async pause(ms: number) {
		await this.page.waitForTimeout(ms)
	}
}
