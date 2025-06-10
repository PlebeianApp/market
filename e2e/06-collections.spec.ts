import { test, expect } from '@playwright/test'
import { skipIfInSetupMode, login } from './utils/test-utils'

test.describe.serial('6. Collections Flow', () => {
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

		// Shipping Tab - wait for shipping options to load and select one
		await page.waitForTimeout(2000) // Wait for shipping options to load

		// Debug: Check what shipping options are available
		const availableOptions = await page.locator('[data-testid^="add-shipping-option-"]').allTextContents()
		console.log('📋 Available shipping options:', availableOptions)

		// Try to click any available Add button first
		const firstAddButtons = page.locator('button:has-text("Add")')
		const firstAddButtonCount = await firstAddButtons.count()
		console.log('📋 Number of Add buttons found:', firstAddButtonCount)

		if (firstAddButtonCount > 0) {
			await firstAddButtons.first().click()
		} else {
			console.log('⚠️ No shipping options found, skipping shipping selection')
		}
		await page.click('[data-testid="collection-form-submit"]')

		// Wait for navigation and form submission to complete
		await page.waitForTimeout(3000)

		// Debug: Check current URL and page content
		console.log('📍 Current URL after form submission:', page.url())
		const pageTitle = await page.locator('h1').first().textContent()
		console.log('📍 Current page title:', pageTitle)

		// Verify we're back on collections page - check for the Add Collection button or collections list
		await expect(page.locator('[data-testid="add-collection-button"]')).toBeVisible({ timeout: 10000 })
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

		// Shipping Tab - select shipping options by clicking the Add buttons
		await page.waitForTimeout(2000) // Wait for shipping options to load

		const secondAddButtons = page.locator('button:has-text("Add")')
		const secondAddButtonCount = await secondAddButtons.count()
		console.log('📋 Number of Add buttons found for second collection:', secondAddButtonCount)

		if (secondAddButtonCount >= 2) {
			await secondAddButtons.first().click()
			await secondAddButtons.nth(1).click()
		} else if (secondAddButtonCount === 1) {
			await secondAddButtons.first().click()
		} else {
			console.log('⚠️ No shipping options found for second collection')
		}
		await page.click('[data-testid="collection-form-submit"]')

		// Wait for navigation and form submission to complete
		await page.waitForTimeout(3000)

		// Debug: Check current URL and page content
		console.log('📍 Current URL after second form submission:', page.url())

		// Verify we're back on collections page - check for the Add Collection button
		await expect(page.locator('[data-testid="add-collection-button"]')).toBeVisible({ timeout: 10000 })
		await expect(page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Winter Collection' })).toBeVisible()
		await expect(page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Summer Collection' })).toBeVisible()

		console.log('✅ Created collections successfully')
	})

	test('should edit collection and verify data persistence', async ({ page }) => {
		// Navigate to collections page
		await page.click('[data-testid="dashboard-link"]')
		await page.waitForTimeout(500)
		await page.click('a:has-text("🗂️ Collections")')

		// Click edit button for Summer Collection
		const summerCollectionItem = page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Summer Collection' })
		await expect(summerCollectionItem).toBeVisible()

		// Click the edit button (pencil icon)
		await summerCollectionItem.locator('[data-testid^="edit-collection-button-"]').click()

		// Wait for edit form to load
		await page.waitForTimeout(1000)

		// Verify we're on the edit page and form data is loaded correctly
		await expect(page.locator('[data-testid="collection-name-input"]')).toHaveValue('Summer Collection')
		await expect(page.locator('[data-testid="collection-description-input"]')).toHaveValue('Sunny clothes for a hot summer.')

		// Update the collection name
		await page.fill('[data-testid="collection-name-input"]', 'Updated Summer Collection')

		// Click on Shipping tab to verify shipping options are preserved
		await page.click('button:has-text("Shipping")')
		await page.waitForTimeout(1000)

		// Verify that the shipping option was saved and is now in "Selected Shipping Options"
		await expect(page.locator('text=Selected Shipping Options')).toBeVisible()
		await expect(page.locator('text=Standard National').first()).toBeVisible()

		// Go back to Info tab
		await page.click('button:has-text("Info")')
		await page.waitForTimeout(500)

		// Submit the updated collection
		await page.click('[data-testid="collection-form-submit"]')

		// Wait for navigation back to collections list
		await page.waitForTimeout(3000)

		// Verify we're back on collections page and the updated collection is visible
		await expect(page.locator('[data-testid="add-collection-button"]')).toBeVisible({ timeout: 10000 })
		await expect(page.locator('[data-testid^="collection-item-"]').filter({ hasText: 'Updated Summer Collection' })).toBeVisible()

		console.log('✅ Collection updated successfully')
	})
})
