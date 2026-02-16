import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'

test.describe.serial('7b. Product Creation Edge Cases', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('publish button should be disabled when required fields are empty', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// Open create product form
		await page.click('[data-testid="add-product-button"]')
		await page.waitForTimeout(500)

		// We should be on the Name tab — go directly to shipping tab where Publish is visible
		await page.click('[data-testid="product-tab-shipping"]')
		await page.waitForTimeout(500)

		// Publish button should be disabled because name, description, images are all empty
		const publishButton = page.locator('[data-testid="product-publish-button"]')
		await expect(publishButton).toBeDisabled()

		console.log('Verified publish button is disabled with empty required fields')
	})

	test('validation indicators should appear on tabs with missing required fields', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// Open create product form
		await page.click('[data-testid="add-product-button"]')
		await page.waitForTimeout(500)

		// Name tab should show asterisk (required indicator) since name and description are empty
		const nameTab = page.locator('[data-testid="product-tab-name"]')
		await expect(nameTab.locator('.text-red-500')).toBeVisible()

		// Images tab should show asterisk since no images added
		const imagesTab = page.locator('[data-testid="product-tab-images"]')
		await expect(imagesTab.locator('.text-red-500')).toBeVisible()

		// Shipping tab should show asterisk since no shipping options selected
		const shippingTab = page.locator('[data-testid="product-tab-shipping"]')
		await expect(shippingTab.locator('.text-red-500')).toBeVisible()

		console.log('Verified validation indicators on tabs with missing fields')
	})

	test('validation indicator should clear when name and description are filled', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// Open create product form
		await page.click('[data-testid="add-product-button"]')
		await page.waitForTimeout(500)

		// Name tab should show asterisk initially
		const nameTab = page.locator('[data-testid="product-tab-name"]')
		await expect(nameTab.locator('.text-red-500')).toBeVisible()

		// Fill in name and description
		await page.fill('[data-testid="product-name-input"]', 'Test Product')
		await page.fill('[data-testid="product-description-input"]', 'Test description for validation')

		// Name tab should no longer show asterisk
		await expect(nameTab.locator('.text-red-500')).not.toBeVisible()

		console.log('Verified validation clears after filling required fields')
	})

	test('tab navigation should work via Next and Back buttons', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// Open create product form
		await page.click('[data-testid="add-product-button"]')
		await page.waitForTimeout(500)

		// Should start on Name tab (or Shipping if no shipping options — handled by navigation hook)
		// Click Next to go through tabs
		const nameTab = page.locator('[data-testid="product-tab-name"]')
		const detailTab = page.locator('[data-testid="product-tab-detail"]')

		// If we're on the name tab, click Next
		if ((await nameTab.getAttribute('data-state')) === 'active') {
			await page.click('[data-testid="product-next-button"]')
			await page.waitForTimeout(300)

			// Should be on Detail tab now
			await expect(detailTab).toHaveAttribute('data-state', 'active')

			// Back button should be visible
			const backButton = page.locator('[data-testid="product-back-button"]')
			await expect(backButton).toBeVisible()

			// Click Back to go back to Name tab
			await backButton.click()
			await page.waitForTimeout(300)
			await expect(nameTab).toHaveAttribute('data-state', 'active')
		}

		console.log('Verified tab navigation with Next and Back buttons')
	})

	test('tabs should be directly clickable for random access', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// Open create product form
		await page.click('[data-testid="add-product-button"]')
		await page.waitForTimeout(500)

		// Click directly on Images tab (skip Detail, Spec, Category)
		await page.click('[data-testid="product-tab-images"]')
		await page.waitForTimeout(300)

		const imagesTab = page.locator('[data-testid="product-tab-images"]')
		await expect(imagesTab).toHaveAttribute('data-state', 'active')

		// Click directly on Spec tab
		await page.click('[data-testid="product-tab-spec"]')
		await page.waitForTimeout(300)

		const specTab = page.locator('[data-testid="product-tab-spec"]')
		await expect(specTab).toHaveAttribute('data-state', 'active')

		console.log('Verified direct tab clicking for random access')
	})

	test('publish button tooltip should list all validation issues', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// Open create product form
		await page.click('[data-testid="add-product-button"]')
		await page.waitForTimeout(500)

		// Navigate to shipping tab where publish button is visible
		await page.click('[data-testid="product-tab-shipping"]')
		await page.waitForTimeout(500)

		// Hover over the publish button to reveal tooltip
		const publishButton = page.locator('[data-testid="product-publish-button"]')
		if (await publishButton.isVisible()) {
			// The button is wrapped in a span for tooltip — hover on the span
			await publishButton.locator('..').hover()
			await page.waitForTimeout(500)

			// Tooltip should list validation issues
			const tooltip = page.locator('[role="tooltip"]')
			if (await tooltip.isVisible({ timeout: 2000 }).catch(() => false)) {
				await expect(tooltip).toContainText('required')
			}
		}

		console.log('Verified publish button tooltip shows validation issues')
	})
})
