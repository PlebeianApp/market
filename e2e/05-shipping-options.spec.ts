import { test, expect } from '@playwright/test'
import { skipIfInSetupMode, login, navigateTo } from './utils/test-utils'

test.describe.serial('5. Shipping Options Flow', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
		await skipIfInSetupMode(page, test)
	})

	test('should create shipping options for collections', async ({ page }) => {
		await login(page)

		// Navigate to shipping options
		await navigateTo(page, 'Dashboard')
		await page.waitForTimeout(500)
		await page.click('a:has-text("📫 Shipping Options")')

		// Wait for shipping options page to load
		await expect(page.locator('h1').filter({ hasText: 'Shipping Options' }).first()).toBeVisible()

		// Create first shipping option - Standard National
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
		await page.waitForTimeout(2000)

		// Verify the shipping option appears in the list
		await expect(page.locator('text=Standard National')).toBeVisible()

		// Create second shipping option - Express International
		await page.click('[data-testid="add-shipping-option-button"]')
		await page.waitForTimeout(500)

		await page.fill('[data-testid="shipping-title-input"]', 'Express International')
		await page.fill('[data-testid="shipping-price-input"]', '25.00')

		// Select service type as Express
		await page.click('[data-testid="shipping-service-select"]')
		await page.click('text=Express Shipping')

		// Select country - Canada
		await page.click('[data-testid="shipping-country-select"]')
		await page.waitForTimeout(1000) // Wait for dropdown to open and populate
		// Use a more specific selector for the dropdown item
		await page.locator('[role="option"]').filter({ hasText: 'Canada' }).click()

		// Submit the form
		await page.click('[data-testid="shipping-submit-button"]')

		// Wait for the shipping option to be created
		await page.waitForTimeout(2000)

		// Verify both shipping options are visible
		await expect(page.locator('text=Standard National')).toBeVisible()
		await expect(page.locator('text=Express International')).toBeVisible()

		console.log('✅ Created shipping options successfully')
	})
})
