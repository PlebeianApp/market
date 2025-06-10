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

	test('should create standard and express shipping options', async ({ page }) => {
		await dashboardPage.navigateTo('Shipping Options')
		await expect(page.locator('h1').filter({ hasText: 'Shipping Options' }).first()).toBeVisible()

		// --- Create Standard National ---
		await page.click('[data-testid="add-shipping-option-button"]')
		await page.waitForTimeout(500)

		// Fill in the shipping option form
		await page.fill('[data-testid="shipping-title-input"]', 'Standard National')
		await page.fill('[data-testid="shipping-price-input"]', '10.00')

		// Fill in the shipping option form
		await page.fill('[data-testid="shipping-description-input"]', 'Standard National shipping option')

		// Select country - United States
		await page.click('[data-testid="shipping-country-select"]')
		await page.waitForTimeout(1000) // Wait for dropdown to open and populate
		// Use a more specific selector for the dropdown item
		await page.locator('[role="option"]').filter({ hasText: 'United States' }).click()

		// Submit the form
		await page.click('[data-testid="shipping-submit-button"]')

		// Wait for the shipping option to be created
		await page.waitForTimeout(1000)

		// Verify the shipping option appears in the list
		await expect(page.getByText('Standard National').first()).toBeVisible()

		// --- Create Express International ---
		await page.click('[data-testid="add-shipping-option-button"]')
		await page.waitForTimeout(500)

		await page.fill('[data-testid="shipping-title-input"]', 'Express International')
		await page.fill('[data-testid="shipping-price-input"]', '25.00')
		await page.fill('[data-testid="shipping-description-input"]', 'Express International shipping option')

		// Select service type as Express
		await page.click('[data-testid="shipping-service-select"]')
		await page.waitForTimeout(500)
		await page.locator('[role="option"]').filter({ hasText: 'Express Shipping' }).click()

		// Select country - Canada
		await page.click('[data-testid="shipping-country-select"]')
		await page.waitForTimeout(1000) // Wait for dropdown to open and populate
		// Use a more specific selector for the dropdown item
		await page.locator('[role="option"]').filter({ hasText: 'Canada' }).click()

		// Submit the form
		await page.click('[data-testid="shipping-submit-button"]')

		// Wait for the shipping option to be created
		await page.waitForTimeout(1000)

		// Debug: Check what shipping options are visible
		const shippingOptions = await page.locator('[data-testid^="shipping-option-item-"]').allTextContents()
		console.log('📋 Visible shipping options:', shippingOptions)

		// Verify both shipping options are visible
		await expect(page.getByText('Standard National').first()).toBeVisible()
		await expect(page.getByText('Express International').first()).toBeVisible({ timeout: 10000 })

		console.log('✅ Created shipping options successfully')
	})
})
