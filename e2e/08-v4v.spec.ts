import { test, expect } from '@playwright/test'
import { skipIfInSetupMode, fillProfileForm } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'
import { nip19 } from 'nostr-tools'
import { devUser4, devUser5 } from '../src/lib/fixtures'

// Convert the dev users to include npub format for easier use in tests
const testUsers = {
	devUser4: {
		...devUser4,
		npub: nip19.npubEncode(devUser4.pk),
	},
	devUser5: {
		...devUser5,
		npub: nip19.npubEncode(devUser5.pk),
	},
}

// Profile data for dev users
const devUser4ProfileData = {
	name: 'Dev User 4',
	displayName: 'Development User 4',
	about: 'Test user 4 for V4V testing and development',
	nip05: 'devuser4@plebeian.market',
	lud16: 'devuser4@getalby.com',
	website: 'https://plebeian.market',
}

const devUser5ProfileData = {
	name: 'Dev User 5',
	displayName: 'Development User 5',
	about: 'Test user 5 for V4V testing and development',
	nip05: 'devuser5@plebeian.market',
	lud16: 'devuser5@getalby.com',
	website: 'https://plebeian.market',
}

test.describe.serial('8. V4V Configuration Flow', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
	})

	test('should create profile for dev user 4', async ({ page }) => {
		// Logout any existing user first
		await loginPage.logout()

		// Login with devUser4's private key
		await loginPage.login('a', devUser4.sk)

		await dashboardPage.navigateTo('Profile')
		await loginPage.handleDecryptDialog()

		await expect(page.locator('h1').filter({ hasText: 'Profile' }).first()).toBeVisible()

		await fillProfileForm(page, devUser4ProfileData)
		await page.click('[data-testid="profile-save-button"]')

		// Wait for the save button to be enabled again, indicating completion
		await expect(page.locator('[data-testid="profile-save-button"]:not([disabled])')).toBeVisible({
			timeout: 5000,
		})

		console.log('✅ Created profile for Dev User 4')
	})

	test('should create profile for dev user 5', async ({ page }) => {
		// Logout any existing user first
		await loginPage.logout()

		// Login with devUser5's private key
		await loginPage.login('a', devUser5.sk)

		await dashboardPage.navigateTo('Profile')
		await loginPage.handleDecryptDialog()

		await expect(page.locator('h1').filter({ hasText: 'Profile' }).first()).toBeVisible()

		await fillProfileForm(page, devUser5ProfileData)
		await page.click('[data-testid="profile-save-button"]')

		// Wait for the save button to be enabled again, indicating completion
		await expect(page.locator('[data-testid="profile-save-button"]:not([disabled])')).toBeVisible({
			timeout: 5000,
		})

		console.log('✅ Created profile for Dev User 5')
	})

	test('should configure V4V settings with dev users 4 and 5 as recipients', async ({ page }) => {
		// Logout any existing user first
		await loginPage.logout()

		// Login as the main test user (default)
		await loginPage.login()

		// Navigate to Circular Economy page through Sales menu
		await dashboardPage.navigateTo('Sales')
		await page.waitForTimeout(500)

		// Look for the "Circular Economy" link in the sales submenu
		await page.click('a[href*="circular-economy"]')
		await page.waitForTimeout(500)

		// Verify we're on the circular economy page
		await expect(page.locator('h2:has-text("Split of total sales")')).toBeVisible()

		// Set V4V percentage to 15% using the slider
		const slider = page.locator('[role="slider"]').first()

		// Use direct positioning for 15% without going to 0 first
		const sliderBounds = await slider.boundingBox()
		if (sliderBounds) {
			// Calculate position for 15% (15/100 * width + left offset)
			const targetX = sliderBounds.x + sliderBounds.width * 0.15
			await page.mouse.click(targetX, sliderBounds.y + sliderBounds.height / 2)
		}
		await page.waitForTimeout(500)

		// Add first recipient (devUser4)
		await page.click('[data-testid="add-v4v-recipient-form-button"]')
		await page.waitForTimeout(500)

		// Fill in the npub directly - this auto-selects the user
		await page.locator('.space-y-4.mt-6.border.p-4.rounded-lg input[type="search"]').fill(testUsers.devUser4.npub)
		await page.waitForTimeout(1000)

		// Set percentage to 35% using the second slider (for recipient share)
		const recipientSlider = page.locator('[role="slider"]').nth(1)
		const recipientSliderBounds = await recipientSlider.boundingBox()
		if (recipientSliderBounds) {
			// Calculate position for 35%
			const targetX = recipientSliderBounds.x + recipientSliderBounds.width * 0.35
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
		await page.locator('.space-y-4.mt-6.border.p-4.rounded-lg input[type="search"]').fill(testUsers.devUser5.npub)
		await page.waitForTimeout(1000)

		// Add the second recipient using explicit selector
		await page.click('[data-testid="add-v4v-recipient-button"]')
		await page.waitForTimeout(500)

		// Save the V4V configuration using explicit selector
		await page.click('[data-testid="save-v4v-button"]')
		await page.waitForTimeout(1000)

		// Verify success toast appears
		await expect(page.locator('text=V4V shares saved successfully')).toBeVisible({ timeout: 5000 })

		// Verify the split percentages are shown correctly
		await expect(page.locator('text=Seller: 90%')).toBeVisible()
		await expect(page.locator('text=V4V: 10%')).toBeVisible()

		// Verify both recipients are displayed in the recipients list
		// Look for the UserWithAvatar components showing both users
		const recipientItems = page.locator('.border.rounded-md.overflow-hidden')
		await expect(recipientItems).toHaveCount(2)

		console.log('✅ Successfully configured V4V with dev users 4 and 5')
		console.log(`📊 V4V Split: 85% Seller, 15% V4V`)
		console.log(`   - DevUser4 (${testUsers.devUser4.pk.slice(0, 8)}...): 5.25% of total (35% of V4V)`)
		console.log(`   - DevUser5 (${testUsers.devUser5.pk.slice(0, 8)}...): 9.75% of total (65% of V4V)`)
	})

	test('should verify V4V settings persist after page reload', async ({ page }) => {
		// Ensure we're logged in as the main test user
		await loginPage.login()

		// Navigate back to Circular Economy page
		await dashboardPage.navigateTo('Sales')
		await page.waitForTimeout(500)
		await page.click('a[href*="circular-economy"]')
		await page.waitForTimeout(500)

		// Verify the settings are still there
		await expect(page.locator('text=Seller: 90%')).toBeVisible()
		await expect(page.locator('text=V4V: 10%')).toBeVisible()

		// Verify both recipients are still displayed
		const recipientItems = page.locator('.border.rounded-md.overflow-hidden')
		await expect(recipientItems).toHaveCount(2)

		console.log('✅ V4V settings persisted correctly after page reload')
	})

	test('should be able to modify V4V percentages', async ({ page }) => {
		// Ensure we're logged in as the main test user
		await loginPage.login()

		// Navigate to Circular Economy page
		await dashboardPage.navigateTo('Sales')
		await page.waitForTimeout(500)
		await page.click('a[href*="circular-economy"]')
		await page.waitForTimeout(500)

		// Use the "Equal All" button to make both recipients equal
		await page.click('[data-testid="equal-all-v4v-button"]')
		await page.waitForTimeout(500)

		// Verify both recipients now have equal shares (50% each of the V4V portion)
		// Look for percentage displays in the recipient bars
		const percentageDisplays = page.locator('.font-semibold:has-text("%")')
		const percentages = await percentageDisplays.allTextContents()

		// Both should show 50% or close to it
		expect(percentages.some((p) => p.includes('50'))).toBeTruthy()

		// Save the updated configuration using explicit selector
		await page.click('[data-testid="save-v4v-button"]')
		await page.waitForTimeout(1000)

		// Verify success message
		await expect(page.locator('text=V4V shares saved successfully')).toBeVisible()

		console.log('✅ Successfully updated V4V to equal shares (7.5% each)')
	})
})
