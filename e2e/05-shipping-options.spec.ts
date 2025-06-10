import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'

test.describe.serial('5. Shipping Options Flow', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('should create shipping options using templates and manual selection', async ({ page }) => {
		await dashboardPage.navigateTo('Shipping Options')
		await expect(page.locator('h1').filter({ hasText: 'Shipping Options' }).first()).toBeVisible()

		// --- Create Standard National using template ---
		await page.click('[data-testid="add-shipping-option-button"]')

		// Use North America template
		await page.click('[data-testid="shipping-template-select"]')
		await page.click('[data-testid="template-north-america"]')

		// Verify template filled the form
		await expect(page.locator('[data-testid="shipping-title-input"]')).toHaveValue('North America')
		await expect(page.locator('[data-testid="shipping-price-input"]')).toHaveValue('0')

		// Update the details
		await page.fill('[data-testid="shipping-title-input"]', 'Standard North America')
		await page.fill('[data-testid="shipping-price-input"]', '10.00')
		await page.fill('[data-testid="shipping-description-input"]', 'Standard shipping to North America')

		// Submit the form
		await page.click('[data-testid="shipping-submit-button"]')
		await page.waitForTimeout(200)

		// Verify the shipping option appears in the list
		await expect(page.getByText('Standard North America').first()).toBeVisible()

		// --- Create Express International with manual country selection ---
		await page.click('[data-testid="add-shipping-option-button"]')
		await page.waitForTimeout(200)

		await page.fill('[data-testid="shipping-title-input"]', 'Express International')
		await page.fill('[data-testid="shipping-price-input"]', '25.00')
		await page.fill('[data-testid="shipping-description-input"]', 'Express International shipping option')

		// Select service type as Express
		await page.click('[data-testid="shipping-service-select"]')
		await page.waitForTimeout(200)
		await page.click('[data-testid="service-express"]')

		// Add multiple countries manually
		await page.click('[data-testid="shipping-country-select"]')
		await page.click('[data-testid="country-usa"]')

		await page.click('[data-testid="shipping-country-select"]')
		await page.click('[data-testid="country-can"]')

		await page.click('[data-testid="shipping-country-select"]')
		await page.click('[data-testid="country-gbr"]')

		// Submit the form
		await page.click('[data-testid="shipping-submit-button"]')

		// Debug: Check what shipping options are visible
		const shippingOptions = await page.locator('[data-testid^="shipping-option-item-"]').allTextContents()
		console.log('📋 Visible shipping options:', shippingOptions)

		// Verify both shipping options are visible
		await expect(page.getByText('Standard North America').first()).toBeVisible()
		await expect(page.getByText('Express International').first()).toBeVisible({ timeout: 10000 })

		console.log('✅ Created shipping options successfully')
	})
})
