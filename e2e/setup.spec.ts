import { test, expect } from '@playwright/test'
import { generateTestUser, fillSetupForm, expectToBeOnHomePage, mockNostrExtension } from './utils/test-utils'

test.describe.serial('1. App Setup Flow', () => {
	test('should redirect to setup page on first visit and complete setup flow', async ({ page }) => {
		const testUser = generateTestUser()
		await mockNostrExtension(page, testUser)

		await page.goto('/')

		// If we are on the setup page, fill the form and expect to be redirected to home.
		// Otherwise, we expect to be on the home page already.
		if (page.url().includes('/setup')) {
			await fillSetupForm(page, testUser)
			await expectToBeOnHomePage(page)
		} else {
			await expectToBeOnHomePage(page)
		}
	})

	test('should show app is configured and allow navigation', async ({ page }) => {
		// After setup, we should land on the home page and not be redirected to setup.
		await page.goto('/')
		await expect(page).not.toHaveURL(/\/setup/)
		await expectToBeOnHomePage(page)

		// Navigation should work correctly after setup.
		await page.goto('/products')
		await expect(page).toHaveURL('/products')
	})
})
