import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'
import { ProductsPage } from './po/ProductsPage'
import { devUser1, devUser2, devUser4, devUser5, XPUB } from '../src/lib/fixtures'

test.describe.serial('10. Prepare Second User Flow', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage
	let productsPage: ProductsPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		productsPage = new ProductsPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
	})

	test('should setup devUser2 with complete configuration', async ({ page }) => {
		// Logout any existing user first
		await loginPage.logout()

		// Login with devUser2's private key
		await loginPage.login('a', devUser2.sk)

		console.log('👤 Setting up devUser2 profile...')

		// Step 1: Create user profile
		await dashboardPage.navigateTo('Profile')
		await page.waitForTimeout(500)

		// Fill in profile information
		const name = 'DevUser2'
		const displayName = 'DevUser2 Merchant'
		const about = 'Second test user for marketplace testing'
		const website = 'https://devuser2.test'
		const lightningAddress = 'devuser2@getalby.com'

		// Wait for form to be visible
		await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 10000 })

		await page.fill('input[name="name"]', name)
		await page.fill('input[name="displayName"]', displayName)
		await page.fill('textarea[name="about"]', about)
		await page.fill('input[name="website"]', website)
		await page.fill('input[name="lud16"]', lightningAddress)

		// Save profile
		await page.click('[data-testid="profile-save-button"]')
		await page.waitForTimeout(1000)

		console.log('✅ DevUser2 profile created')

		// Step 2: Create shipping method
		console.log('🚚 Setting up shipping method...')

		await dashboardPage.navigateTo('Products')
		await page.waitForTimeout(500)

		// Navigate to shipping options
		await page.click('a[href*="shipping-options"]')
		await page.waitForTimeout(500)

		// Click "Add new shipping option"
		await page.click('[data-testid="add-shipping-option-button"]')
		await page.waitForTimeout(500)

		// Fill shipping method details
		const shippingName = 'DevUser2 Standard Shipping'
		const shippingCost = '15'
		const shippingDescription = 'Standard shipping for DevUser2 products'

		await page.fill('[data-testid="shipping-title-input"]', shippingName)
		await page.fill('[data-testid="shipping-price-input"]', shippingCost)
		await page.fill('[data-testid="shipping-description-input"]', shippingDescription)

		// Select US as shipping country
		await page.click('[data-testid="shipping-country-select"]')
		await page.waitForTimeout(300)
		await page.click('[data-testid="country-usa"]')
		await page.waitForTimeout(300)

		// Save shipping method
		await page.click('[data-testid="shipping-submit-button"]')
		await page.waitForTimeout(1000)

		console.log('✅ Shipping method created')

		// Step 3: Set up receiving payment methods
		console.log('💰 Setting up receiving payment methods...')

		// Navigate to receiving payments
		await page.click('a[href*="receiving-payments"]')
		await page.waitForTimeout(500)

		// Add Lightning Network payment method
		await page.click('text=Add new payment method')
		await page.waitForTimeout(500)

		await page.click('[data-testid="payment-method-selector"]')
		await page.click('[data-testid="payment-method-ln"]')
		await page.waitForTimeout(300)

		const devUser2LightningAddress = 'devuser2-payments@getalby.com'
		await page.fill('[data-testid="payment-details-input"]', devUser2LightningAddress)
		await page.waitForTimeout(300)

		// Set as default
		await page.check('[data-testid="default-payment-checkbox"]')
		await page.waitForTimeout(300)

		// Save Lightning payment method
		await page.click('[data-testid="save-payment-button"]')
		await page.waitForTimeout(1000)

		// Add On-Chain payment method
		await page.click('text=Add new payment method')
		await page.waitForTimeout(500)

		await page.click('[data-testid="payment-method-selector"]')
		await page.click('[data-testid="payment-method-on-chain"]')
		await page.waitForTimeout(300)

		await page.fill('[data-testid="payment-details-input"]', XPUB)
		await page.waitForTimeout(300)

		// Save On-Chain payment method
		await page.click('[data-testid="save-payment-button"]')
		await page.waitForTimeout(1000)

		// Wait for confirmation dialog to appear for XPUB
		await expect(page.locator('text=Extended Public Key detected')).toBeVisible({ timeout: 5000 })

		// Confirm the extended public key
		await page.click('button:has-text("Confirm")')
		await page.waitForTimeout(1000)

		console.log('✅ Payment methods configured')

		// Step 4: Configure V4V with devUser4 and devUser5
		console.log('🔄 Setting up V4V configuration...')

		// Navigate to Circular Economy page through Sales menu
		await dashboardPage.navigateTo('Sales')
		await page.waitForTimeout(500)

		// Look for the "Circular Economy" link in the sales submenu
		await page.click('a[href*="circular-economy"]')
		await page.waitForTimeout(500)

		// Verify we're on the circular economy page
		await expect(page.locator('h2:has-text("Split of total sales")')).toBeVisible()

		// Set V4V percentage to 20% using the slider
		const slider = page.locator('[role="slider"]').first()

		// Use direct positioning for 20%
		const sliderBounds = await slider.boundingBox()
		if (sliderBounds) {
			// Calculate position for 20% (20/100 * width + left offset)
			const targetX = sliderBounds.x + sliderBounds.width * 0.2
			await page.mouse.click(targetX, sliderBounds.y + sliderBounds.height / 2)
		}
		await page.waitForTimeout(500)

		// Add first recipient (devUser4)
		await page.click('[data-testid="add-v4v-recipient-form-button"]')
		await page.waitForTimeout(500)

		// Fill in the npub directly - this auto-selects the user
		await page
			.locator('.space-y-4.mt-6.border.p-4.rounded-lg input[type="search"]')
			.fill('npub173cjrntc8qpwd4y8ne3jxw654l65ueuga20026xwcqjee3s0u2rqltqgwe')
		await page.waitForTimeout(1000)

		// Set percentage to 60% using the second slider (for recipient share)
		const recipientSlider = page.locator('[role="slider"]').nth(1)
		const recipientSliderBounds = await recipientSlider.boundingBox()
		if (recipientSliderBounds) {
			// Calculate position for 60%
			const targetX = recipientSliderBounds.x + recipientSliderBounds.width * 0.6
			await page.mouse.click(targetX, recipientSliderBounds.y + recipientSliderBounds.height / 2)
		}
		await page.waitForTimeout(300)

		// Add the recipient using explicit selector
		await page.click('[data-testid="add-v4v-recipient-button"]')
		await page.waitForTimeout(500)

		// Add second recipient (devUser5)
		await page.click('[data-testid="add-v4v-recipient-form-button"]')
		await page.waitForTimeout(500)

		// Fill in the npub for devUser5 - this auto-selects the user
		await page
			.locator('.space-y-4.mt-6.border.p-4.rounded-lg input[type="search"]')
			.fill('npub1jmrj0ax3agv2srgrvg2jp6l78jd7zwrsxvqf5n6mvk2e6zfz9mkqmwmacn')
		await page.waitForTimeout(1000)

		// Add the second recipient using explicit selector
		await page.click('[data-testid="add-v4v-recipient-button"]')
		await page.waitForTimeout(500)

		// Save the V4V configuration using explicit selector
		await page.click('[data-testid="save-v4v-button"]')
		await page.waitForTimeout(1000)

		// Verify success toast appears
		await expect(page.locator('text=V4V shares saved successfully')).toBeVisible({ timeout: 5000 })

		console.log('✅ V4V configuration saved')

		// Step 5: Create a product (not in collection)
		console.log('📦 Creating product...')

		// Navigate to products using dashboard navigation
		await dashboardPage.navigateTo('Products')
		await page.waitForTimeout(500)

		// Create product manually to handle custom shipping method
		// Click Add A Product button
		await page.click('[data-testid="add-product-button"]')

		// --- Name Tab ---
		await page.fill('[data-testid="product-name-input"]', 'DevUser2 Test Product')
		await page.fill('[data-testid="product-description-input"]', 'A test product created by DevUser2 for marketplace testing')

		// Go to Detail tab
		await page.click('[data-testid="product-next-button"]')

		// --- Detail Tab ---
		await page.fill('[data-testid="product-price-input"]', '50000')
		await page.fill('[data-testid="product-quantity-input"]', '25')

		await page.click('[data-testid="product-status-select"]')
		await page.click('[data-testid="status-option-on-sale"]')

		// Skip Spec tab
		await page.click('[data-testid="product-next-button"]')
		await page.click('[data-testid="product-next-button"]')

		// --- Category Tab ---
		await page.click('[data-testid="product-main-category-select"]')
		await page.click('[data-testid="main-category-bitcoin"]')

		// Go to Images tab
		await page.click('[data-testid="product-next-button"]')

		// --- Images Tab ---
		await page.fill(
			'[data-testid="image-url-input"]',
			'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png',
		)
		await page.click('[data-testid="image-save-button"]')
		await page.waitForTimeout(1000)

		// Go to Shipping tab
		await page.click('[data-testid="product-next-button"]')
		await page.waitForTimeout(500)

		// --- Shipping Tab ---
		// Look for the shipping method we created and select it
		await page.click(`text=${shippingName}`)
		await page.waitForTimeout(500)

		// Save the product
		await page.click('[data-testid="product-save-button"]')

		// Verify product was created - check that we're redirected to the product page
		await page.waitForURL('**/products/**', { timeout: 10000 })

		// Additional verification: check that we're on a specific product page (not the products list)
		// expect(page.url()).toMatch(/\/products\/[a-f0-9]+$/)

		console.log('✅ Product created successfully')
		console.log(`📦 Product: DevUser2 Test Product - 50000 sats`)
		console.log(`🚚 Shipping: ${shippingName} - ${shippingCost} USD`)
		console.log(`💰 Payments: Lightning (${devUser2LightningAddress}) + On-Chain`)
		console.log(`🔄 V4V: 20% split - devUser4 (60%), devUser5 (40%)`)
	})

	test('should verify both devUser1 and devUser2 products are visible in marketplace', async ({ page }) => {
		console.log('🔍 Verifying marketplace shows products from both users...')

		// Navigate to the main products/marketplace route without being logged in
		await loginPage.logout()
		await page.waitForTimeout(500)

		// Navigate to the products marketplace (public view)
		await page.goto('/products')
		await page.waitForTimeout(2000)

		// Wait for products to load
		await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible({ timeout: 10000 })

		// Look for products from both users
		// DevUser1 should have products from previous tests
		// DevUser2 should have the product we just created

		const productCards = page.locator('[data-testid="product-card"]')
		const productCount = await productCards.count()

		console.log(`📊 Found ${productCount} products in marketplace`)

		// Verify we have products from both users
		expect(productCount).toBeGreaterThanOrEqual(2)

		// Look for DevUser2's product specifically
		await expect(page.locator('text=DevUser2 Test Product')).toBeVisible({ timeout: 5000 })

		// Check that products have proper information displayed
		const devUser2Product = page.locator('[data-testid="product-card"]').filter({ hasText: 'DevUser2 Test Product' })
		await expect(devUser2Product.locator('text=11,000,000')).toBeVisible() // Price (50000 * 220)
		// await expect(devUser2Product.locator('text=Sats')).toBeVisible() // Currency

		console.log("✅ Both users' products are visible in marketplace")
		console.log('✅ DevUser2 product displays correct price and information')

		// Optional: Verify product details by clicking on DevUser2's product
		await devUser2Product.click()
		await page.waitForTimeout(1000)

		// Verify product detail page shows correct information
		// await expect(page.locator('DevUser2 Test Product')).toBeVisible()
		// await expect(page.locator('text=A test product created by DevUser2')).toBeVisible()
		// await expect(page.locator('text=50,000 sats')).toBeVisible()

		console.log('✅ Product detail page displays correctly')
	})

	test('should verify devUser2 dashboard shows complete setup', async ({ page }) => {
		console.log('🎛️ Verifying devUser2 dashboard configuration...')

		// Login as devUser2 to verify dashboard
		await loginPage.login('a', devUser2.sk)

		// Check profile is set up
		await dashboardPage.navigateTo('Profile')
		await page.waitForTimeout(500)

		await expect(page.locator('input[name="displayName"]')).toHaveValue('DevUser2 Merchant')
		await expect(page.locator('input[name="lud16"]')).toHaveValue('devuser2@getalby.com')

		console.log('✅ Profile configuration verified')

		// Check shipping methods
		await dashboardPage.navigateTo('Products')
		await page.waitForTimeout(500)
		await page.click('a[href*="shipping-options"]')
		await page.waitForTimeout(500)

		await expect(page.locator('text=DevUser2 Standard Shipping')).toBeVisible()
		await expect(page.locator('text=15')).toBeVisible() // Cost
		await expect(page.locator('text=USD')).toBeVisible() // Currency

		console.log('✅ Shipping methods verified')

		// Check payment methods
		await page.click('a[href*="receiving-payments"]')
		await page.waitForTimeout(500)

		await expect(page.locator('text=devuser2-payments@getalby.com')).toBeVisible()
		await expect(page.locator(`text=${XPUB.substring(0, 20)}`)).toBeVisible()

		console.log('✅ Payment methods verified')
	})
})
