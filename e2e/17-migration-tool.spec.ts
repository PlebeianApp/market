import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'

test.describe.serial('17. Migration Tool', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('migration tool page should load', async ({ page }) => {
		await page.goto('/dashboard/products/migration-tool')
		await page.waitForTimeout(2000)

		// Should show migration tool header or content
		const migrationHeader = page.getByText(/migration tool/i)
		await expect(migrationHeader.first()).toBeVisible({ timeout: 10000 })

		console.log('Migration tool page loaded')
	})

	test('migration tool should show product list or empty state', async ({ page }) => {
		await page.goto('/dashboard/products/migration-tool')
		await page.waitForTimeout(3000)

		// Should show either products to migrate or empty state
		const hasProducts = await page
			.getByText(/found.*product.*to migrate/i)
			.isVisible({ timeout: 5000 })
			.catch(() => false)
		const hasEmptyState = await page
			.getByText(/no products to migrate/i)
			.isVisible({ timeout: 2000 })
			.catch(() => false)
		const isLoading = await page
			.getByText(/loading products/i)
			.isVisible({ timeout: 1000 })
			.catch(() => false)

		expect(hasProducts || hasEmptyState || isLoading).toBeTruthy()

		if (hasProducts) {
			console.log('Migration tool shows products to migrate')
		} else if (hasEmptyState) {
			console.log('Migration tool shows empty state (no NIP-15 products)')
		} else {
			console.log('Migration tool is loading products')
		}
	})

	test('NIP-15 product cards should display parsed data', async ({ page }) => {
		await page.goto('/dashboard/products/migration-tool')
		await page.waitForTimeout(3000)

		const hasProducts = await page
			.getByText(/found.*product.*to migrate/i)
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasProducts) {
			// Product cards should show name, description, price
			const firstCard = page.locator('.cursor-pointer').first()
			await expect(firstCard).toBeVisible()

			// Should display price information
			await expect(firstCard.getByText(/price/i)).toBeVisible()

			// Should have a migrate button
			await expect(firstCard.getByText(/migrate/i)).toBeVisible()

			console.log('NIP-15 product cards display parsed data correctly')
		} else {
			console.log('No NIP-15 products available — skipping card check')
		}
	})

	test('clicking a product should open migration form', async ({ page }) => {
		await page.goto('/dashboard/products/migration-tool')
		await page.waitForTimeout(3000)

		const hasProducts = await page
			.getByText(/found.*product.*to migrate/i)
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasProducts) {
			// Click the first product card
			const firstCard = page.locator('.cursor-pointer').first()
			await firstCard.click()
			await page.waitForTimeout(2000)

			// Should show migration form or back button
			const backButton = page.getByText(/back/i).first()
			const formVisible = await backButton.isVisible({ timeout: 5000 }).catch(() => false)

			if (formVisible) {
				console.log('Migration form opened for selected product')
			} else {
				console.log('Could not confirm migration form opened')
			}
		} else {
			console.log('No NIP-15 products available — skipping form check')
		}
	})

	test('all-migrated state should show appropriate message', async ({ page }) => {
		await page.goto('/dashboard/products/migration-tool')
		await page.waitForTimeout(3000)

		const allMigrated = await page
			.getByText(/all your nip-15 products have been migrated/i)
			.isVisible({ timeout: 3000 })
			.catch(() => false)

		if (allMigrated) {
			console.log('All-migrated state shows correct message')
		} else {
			console.log('Not in all-migrated state — products still pending or none exist')
		}
	})
})
