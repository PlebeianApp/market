import { test, expect } from '../fixtures'

test.use({ scenario: 'base' })

test.describe('Navigation', () => {
	test('homepage loads and shows header', async ({ page }) => {
		await page.goto('/')
		await expect(page.locator('header')).toBeVisible()
	})

	test('products page loads', async ({ page }) => {
		await page.goto('/products')
		await expect(page).toHaveURL(/\/products/)
	})

	test('community page loads', async ({ page }) => {
		await page.goto('/community')
		await expect(page).toHaveURL(/\/community/)
	})

	test('authenticated user can access dashboard', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard')
		await expect(merchantPage).toHaveURL(/\/dashboard/)
	})

	test('dashboard shows navigation sections', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard')

		// Verify key dashboard nav section headings are visible
		await expect(merchantPage.getByRole('heading', { name: 'SALES' })).toBeVisible()
		await expect(merchantPage.getByRole('heading', { name: 'PRODUCTS' })).toBeVisible()
		await expect(merchantPage.getByRole('heading', { name: 'ACCOUNT' })).toBeVisible()
	})

	test('dashboard products link navigates correctly', async ({ merchantPage }) => {
		await merchantPage.goto('/dashboard')

		// Click the sidebar Products link (not the header one)
		await merchantPage
			.locator('nav')
			.getByRole('link', { name: /Products/i })
			.click()
		await expect(merchantPage).toHaveURL(/\/dashboard\/products/)
	})
})
