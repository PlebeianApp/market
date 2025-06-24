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

	test('should create multiple products with different categories and features', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// Create Product 1: Bitcoin Mining Rig
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

		console.log('✅ Created Bitcoin Mining Rig')

		// Create Product 2: Art Print (using Updated Fall Collection)
		await productsPage.createProduct({
			name: 'Bitcoin Art Print',
			description: 'Beautiful Bitcoin-themed art print for your home or office.',
			collection: 'Updated Fall Collection',
			price: '25000',
			quantity: '50',
			status: 'on-sale',
			mainCategory: 'Art',
			imageUrl: 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
			shippingOptions: ['standard-north-america'],
		})

		console.log('✅ Created Bitcoin Art Print')

		// Create Product 3: T-Shirt (no collection)
		await productsPage.createProduct({
			name: 'Bitcoin T-Shirt',
			description: 'Comfortable cotton t-shirt with Bitcoin logo.',
			price: '15000',
			quantity: '100',
			status: 'on-sale',
			mainCategory: 'Clothing',
			imageUrl: 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
			shippingOptions: ['express-international'],
		})

		console.log('✅ Created Bitcoin T-Shirt')

		console.log('✅ Created 4 products successfully with different categories and features')
	})

	test('should edit an existing product', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		await productsPage.editProduct('Bitcoin Mining Rig', {
			name: 'Bitcoin Mining Rig Pro',
			price: '750000',
		})

		await productsPage.verifyProductExists('Bitcoin Mining Rig Pro')
		console.log('✅ Updated Bitcoin Mining Rig to Pro version')
	})

	test('should delete a product', async ({ page }) => {
		await dashboardPage.navigateTo('Products')
		await expect(page.locator('h1').filter({ hasText: 'Products' }).first()).toBeVisible()

		// First, verify we have 3 products
		await productsPage.verifyProductCountIs(3)

		// Delete the T-Shirt product
		await productsPage.deleteProduct('Bitcoin T-Shirt')

		// Verify we now have 2 products
		await productsPage.verifyProductCountIs(2)

		// Verify the T-Shirt is gone
		await productsPage.verifyProductNotExists('Bitcoin T-Shirt')

		console.log('✅ Deleted Bitcoin T-Shirt, product count reduced from 3 to 2')
	})
})
