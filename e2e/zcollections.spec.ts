import { test, expect } from '@playwright/test'
import { skipIfInSetupMode, login } from './utils/test-utils'

test.describe.serial('5. Collections Flow', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
		await skipIfInSetupMode(page, test)
		await login(page)
	})

	test('should create two collections', async ({ page }) => {
		// Navigate to collections page through UI
		await page.click('[data-testid="dashboard-link"]')
		await page.waitForTimeout(500)
		await page.click('a:has-text("🗂️ Collections")')
		await expect(page.locator('h1').filter({ hasText: 'Collections' })).toBeVisible()

		// --- Create First Collection ---
		await page.click('[data-testid="add-collection-button"]')
		await page.waitForSelector('[data-testid="collection-name-input"]') // Wait for form to be ready

		// Info Tab
		await page.fill('[data-testid="collection-name-input"]', 'Summer Collection')
		await page.fill('[data-testid="collection-description-input"]', 'Sunny clothes for a hot summer.')
		await page.click('[data-testid="collection-form-next"]')

		// Products Tab - just click next
		await page.click('[data-testid="collection-form-next"]')

		// Shipping Tab
		await page.check('text=Standard National')
		await page.click('[data-testid="collection-form-submit"]')

		// Verify we're back on collections page and collection is visible
		await expect(page.locator('h1').filter({ hasText: 'Collections' })).toBeVisible()
		await expect(page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Summer Collection' })).toBeVisible()

		// --- Create Second Collection ---
		await page.click('[data-testid="add-collection-button"]')
		await page.waitForSelector('[data-testid="collection-name-input"]')

		// Info Tab
		await page.fill('[data-testid="collection-name-input"]', 'Winter Collection')
		await page.fill('[data-testid="collection-description-input"]', 'Warm clothes for a cold winter.')
		await page.click('[data-testid="collection-form-next"]')

		// Products Tab - just click next
		await page.click('[data-testid="collection-form-next"]')

		// Shipping Tab
		await page.check('text=Standard National')
		await page.check('text=Express International')
		await page.click('[data-testid="collection-form-submit"]')

		// Verify we're back on collections page and both collections are visible
		await expect(page.locator('h1').filter({ hasText: 'Collections' })).toBeVisible()
		await expect(page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Winter Collection' })).toBeVisible()
		await expect(page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Summer Collection' })).toBeVisible()
	})
})
