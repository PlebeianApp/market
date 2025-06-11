import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'

const pages = ['products', 'posts', 'community', 'dashboard']

test.describe.serial('2. App Navigation', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
		skipIfInSetupMode(page, test)
	})

	for (const pageName of pages) {
		test(`should be able to navigate to ${pageName} page`, async ({ page }) => {
			await page.goto(`/${pageName}`)
			await expect(page).toHaveURL(`/${pageName}`)
		})
	}

	test('should display page content without errors', async ({ page }) => {
		const errorTexts = ['Something went wrong', 'Error:', 'Failed to load', '404', '500', 'Internal Server Error']

		for (const errorText of errorTexts) {
			await expect(page.locator(`text=${errorText}`)).not.toBeVisible()
		}

		await expect(page.locator('html')).toBeVisible()
		await expect(page.locator('body')).toBeVisible()
	})
})
