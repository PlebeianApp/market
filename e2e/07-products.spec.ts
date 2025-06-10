import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'
import { ProductsPage } from './po/ProductsPage'

test.describe.serial('7. Product Creation Flow', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage
	let productsPage: ProductsPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		productsPage = new ProductsPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('should create a product with category, image, and shipping options', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		await productsPage.createProduct({
			name: 'Bitcoin Mining Rig',
			description: 'High-performance Bitcoin mining rig with latest ASIC technology. Perfect for serious miners.',
			collection: 'Winter Collection',
			price: '500000',
			quantity: '10',
			status: 'on-sale',
			mainCategory: 'Bitcoin',
			imageUrl: 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
			shippingOptions: ['standard-north-america', 'express-international'],
		})

		await productsPage.verifyProductExists('Bitcoin Mining Rig')
		console.log('✅ Created product successfully with category, image, and shipping options')
	})

	test('should edit an existing product', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		await productsPage.editProduct('Bitcoin Mining Rig', {
			name: 'Bitcoin Mining Rig Pro',
			price: '750000',
		})

		await productsPage.verifyProductExists('Bitcoin Mining Rig Pro')
		console.log('✅ Updated product successfully')
	})

	test('should delete a product', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		await productsPage.deleteProduct('Bitcoin Mining Rig Pro')
		await productsPage.verifyProductNotExists('Bitcoin Mining Rig Pro')
		console.log('✅ Deleted product successfully')
	})
})
