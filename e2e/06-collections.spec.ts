import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'

test.describe.serial('6. Collections Flow', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('should create two collections', async ({ page }) => {
		await dashboardPage.navigateTo('Collections')
		await expect(page.locator('h1').filter({ hasText: 'Collections' })).toBeVisible()

		// --- Create First Collection: Summer ---
		await page.click('[data-testid="add-collection-button"]')
		await page.waitForSelector('[data-testid="collection-name-input"]') // Wait for form to be ready

		// Info Tab
		await page.fill('[data-testid="collection-name-input"]', 'Summer Collection')
		await page.fill('[data-testid="collection-description-input"]', 'Sunny clothes for a hot summer.')
		await page.click('button:has-text("Shipping")')
		await page.locator('button:has-text("Add")').first().click()
		await page.click('[data-testid="collection-form-submit"]')
		await expect(page.getByText('Summer Collection')).toBeVisible()

		// --- Create Second Collection: Winter ---
		await page.click('[data-testid="add-collection-button"]')
		await page.waitForSelector('[data-testid="collection-name-input"]')

		// Info Tab
		await page.fill('[data-testid="collection-name-input"]', 'Winter Collection')
		await page.fill('[data-testid="collection-description-input"]', 'Warm clothes for a cold winter.')
		await page.click('button:has-text("Shipping")')
		const addButtons = page.locator('button:has-text("Add")')
		await addButtons.nth(0).click()
		await addButtons.nth(1).click()
		await page.click('[data-testid="collection-form-submit"]')
		await expect(page.getByText('Winter Collection')).toBeVisible()

		// --- Verify both collections exist ---
		const collections = page.locator('[data-testid^="collection-item-"]')
		expect(await collections.count()).toBe(2)
		await expect(collections.filter({ hasText: 'Summer Collection' })).toBeVisible()
		await expect(collections.filter({ hasText: 'Winter Collection' })).toBeVisible()

		console.log('✅ Created collections successfully')
	})

	test('should edit a collection and verify data persistence', async ({ page }) => {
		await dashboardPage.navigateTo('Collections')

		const summerCollection = page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Summer Collection' })
		await summerCollection.locator('[data-testid^="edit-collection-button-"]').click()

		await expect(page.locator('[data-testid="collection-name-input"]')).toHaveValue('Summer Collection')
		await page.fill('[data-testid="collection-name-input"]', 'Updated Fall Collection')
		await page.click('[data-testid="collection-form-submit"]')

		await expect(page.getByText('Updated Fall Collection')).toBeVisible()
		await expect(page.getByText('Summer Collection')).not.toBeVisible()

		console.log('✅ Collection updated successfully')
	})
})
