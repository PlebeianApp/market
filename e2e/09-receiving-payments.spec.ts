import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'
import { devUser1 } from '../src/lib/fixtures'

test.describe.serial('9. Receiving Payments Flow', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
	})

	test('should configure receiving payment methods for devUser1', async ({ page }) => {
		// Logout any existing user first
		await loginPage.logout()

		// Login with devUser1's private key
		await loginPage.login('a', devUser1.sk)

		// Navigate to Receiving Payments page through Products menu
		await dashboardPage.navigateTo('Products')
		await page.waitForTimeout(500)

		// Look for the "Receive Payments" link in the products submenu
		await page.click('a[href*="receiving-payments"]')
		await page.waitForTimeout(500)

		// Verify we're on the receiving payments page
		await expect(page.locator('text=Manage your payment receiving options here')).toBeVisible()

		// Test 1: Add Lightning Network payment method (Global scope)
		console.log('⚡ Adding Lightning Network payment method...')

		// Click "Add new payment method"
		await page.click('text=Add new payment method')
		await page.waitForTimeout(500)

		// Select Lightning Network payment method
		await page.click('[data-testid="payment-method-selector"]')
		await page.click('[data-testid="payment-method-ln"]')
		await page.waitForTimeout(300)

		// Scope should default to Global, so we can proceed
		// Fill in Lightning address
		const lightningAddress = 'devuser1@getalby.com'
		await page.fill('[data-testid="payment-details-input"]', lightningAddress)
		await page.waitForTimeout(300)

		// Set as default
		await page.check('[data-testid="default-payment-checkbox"]')
		await page.waitForTimeout(300)

		// Save the Lightning payment method
		await page.click('[data-testid="save-payment-button"]')
		await page.waitForTimeout(1000)

		// Wait for the form to close
		await expect(page.locator('[data-testid="payment-details-input"]')).not.toBeVisible({ timeout: 3000 })

		console.log('✅ Lightning Network payment method added')

		// Test 2: Add On-Chain payment method (Global scope)
		console.log('₿ Adding On-Chain payment method...')

		// Click "Add new payment method" again
		await page.click('text=Add new payment method')
		await page.waitForTimeout(500)

		// Select On-Chain payment method
		await page.click('[data-testid="payment-method-selector"]')
		await page.click('[data-testid="payment-method-on-chain"]')
		await page.waitForTimeout(300)

		// Fill in Bitcoin address
		const bitcoinAddress = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
		await page.fill('[data-testid="payment-details-input"]', bitcoinAddress)
		await page.waitForTimeout(300)

		// Don't set as default (Lightning should remain default)

		// Save the On-Chain payment method
		await page.click('[data-testid="save-payment-button"]')
		await page.waitForTimeout(1000)

		// Wait for confirmation dialog to appear
		await expect(page.locator('text=Confirm Payment Details')).toBeVisible({ timeout: 5000 })

		// Confirm the Bitcoin address
		await page.click('button:has-text("Confirm")')
		await page.waitForTimeout(1000)

		// Wait for the form to close
		await expect(page.locator('[data-testid="payment-details-input"]')).not.toBeVisible({ timeout: 3000 })

		console.log('✅ On-Chain payment method added')

		// Test 3: Verify both payment methods are displayed
		await page.waitForTimeout(1000)

		// Check that Lightning address is displayed and marked as default
		await expect(page.locator(`text=${lightningAddress.substring(0, 20)}`)).toBeVisible()
		await expect(page.locator('[class*="yellow"]')).toBeVisible() // Default star icon

		// Check that Bitcoin address is displayed
		await expect(page.locator(`text=${bitcoinAddress.substring(0, 20)}`)).toBeVisible()

		console.log('✅ Successfully configured and tested receiving payment methods for devUser1')
		console.log(`💰 Lightning Network: ${lightningAddress} (Default)`)
		console.log(`₿ On-Chain: ${bitcoinAddress}`)
	})

	test('should test payment method filtering functionality', async ({ page }) => {
		// Login with devUser1's private key (payment methods should persist)
		await loginPage.login('a', devUser1.sk)

		// Navigate to Receiving Payments page
		await dashboardPage.navigateTo('Products')
		await page.waitForTimeout(500)
		await page.click('a[href*="receiving-payments"]')
		await page.waitForTimeout(500)

		const lightningAddress = 'devuser1@getalby.com'
		const bitcoinAddress = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'

		// Test filtering functionality
		console.log('🔍 Testing payment method filtering...')

		// Filter by Lightning Network only
		await page.click('text=All payment methods')
		await page.click('text=Lightning Address')
		await page.waitForTimeout(500)

		// Should only show Lightning method
		await expect(page.locator(`text=${lightningAddress.substring(0, 20)}`)).toBeVisible()
		await expect(page.locator(`text=${bitcoinAddress.substring(0, 20)}`)).not.toBeVisible()

		// Filter by On Chain only
		await page.click('text=Lightning Address')
		await page.click('text=Onchain Address')
		await page.waitForTimeout(500)

		// Should only show On-Chain method
		await expect(page.locator(`text=${bitcoinAddress.substring(0, 20)}`)).toBeVisible()
		await expect(page.locator(`text=${lightningAddress.substring(0, 20)}`)).not.toBeVisible()

		// Reset to show all
		await page.click('text=Onchain Address')
		await page.click('text=All payment methods')
		await page.waitForTimeout(500)

		// Both should be visible again
		await expect(page.locator(`text=${lightningAddress.substring(0, 20)}`)).toBeVisible()
		await expect(page.locator(`text=${bitcoinAddress.substring(0, 20)}`)).toBeVisible()

		console.log('✅ Payment method filtering works correctly')
	})

	test('should test editing and deleting payment methods', async ({ page }) => {
		// Login with devUser1's private key
		await loginPage.login('a', devUser1.sk)

		// Navigate to Receiving Payments page
		await dashboardPage.navigateTo('Products')
		await page.waitForTimeout(500)
		await page.click('a[href*="receiving-payments"]')
		await page.waitForTimeout(500)

		const lightningAddress = 'devuser1@getalby.com'

		// Test editing a payment method
		console.log('✏️ Testing payment method editing...')

		// Click on the Lightning payment method to edit it
		await page.click(`text=${lightningAddress.substring(0, 20)}`)
		await page.waitForTimeout(500)

		// Change the Lightning address
		const newLightningAddress = 'devuser1-updated@getalby.com'
		await page.fill('[data-testid="payment-details-input"]', '')
		await page.fill('[data-testid="payment-details-input"]', newLightningAddress)
		await page.waitForTimeout(300)

		// Update the payment method
		await page.click('[data-testid="save-payment-button"]')
		await page.waitForTimeout(1000)

		// Verify the updated address is displayed
		await expect(page.locator(`text=${newLightningAddress.substring(0, 20)}`)).toBeVisible()
		console.log('✅ Payment method updated successfully')

		// Test deleting a payment method
		console.log('🗑️ Testing payment method deletion...')

		// Click on the Lightning payment method to edit it again
		await page.click(`text=${newLightningAddress.substring(0, 20)}`)
		await page.waitForTimeout(500)

		// Click delete button
		await page.click('[data-testid="delete-payment-button"]')
		await page.waitForTimeout(1000)

		// Verify the payment method is no longer displayed
		await expect(page.locator(`text=${newLightningAddress.substring(0, 20)}`)).not.toBeVisible()
		console.log('✅ Payment method deleted successfully')
	})

	test('should test adding payment method with extended public key', async ({ page }) => {
		// Login with devUser1's private key
		await loginPage.login('a', devUser1.sk)

		// Navigate to Receiving Payments page
		await dashboardPage.navigateTo('Products')
		await page.waitForTimeout(500)
		await page.click('a[href*="receiving-payments"]')
		await page.waitForTimeout(500)

		// Test adding extended public key (XPUB)
		console.log('🔑 Testing extended public key payment method...')

		// Click "Add new payment method"
		await page.click('text=Add new payment method')
		await page.waitForTimeout(500)

		// Select On-Chain payment method
		await page.click('[data-testid="payment-method-selector"]')
		await page.click('[data-testid="payment-method-on-chain"]')
		await page.waitForTimeout(300)

		// Fill in extended public key from fixtures
		const { XPUB } = await import('../src/lib/fixtures')
		await page.fill('[data-testid="payment-details-input"]', XPUB)
		await page.waitForTimeout(300)

		// Save the payment method
		await page.click('[data-testid="save-payment-button"]')
		await page.waitForTimeout(1000)

		// Wait for confirmation dialog with address preview
		await expect(page.locator('text=Extended Public Key detected')).toBeVisible({ timeout: 5000 })
		await expect(page.locator('text=Preview of derived addresses')).toBeVisible()

		// Confirm the extended public key
		await page.click('button:has-text("Confirm")')
		await page.waitForTimeout(1000)

		// Verify the XPUB is added (check for partial XPUB string)
		await expect(page.locator(`text=${XPUB.substring(0, 20)}`)).toBeVisible()

		console.log('✅ Extended public key payment method added successfully')
		console.log(`🔑 XPUB: ${XPUB.substring(0, 30)}...`)
	})
})
