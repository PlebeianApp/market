import { test, expect } from '@playwright/test'
import { createRelayMonitor } from './utils/relay-monitor'
import { skipIfInSetupMode, fillProfileForm, verifyProfileForm } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { DashboardPage } from './po/DashboardPage'

const testProfileData = {
	name: 'Test User E2E',
	displayName: 'Test User Display',
	about: 'This is a test user created during e2e testing. Hello Nostr!',
	nip05: 'testuser@plebeian.market',
	lud16: 'testuser@getalby.com',
	website: 'https://plebeian.market',
}

test.describe.serial('4. User Profile Flow', () => {
	let loginPage: LoginPage
	let dashboardPage: DashboardPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		dashboardPage = new DashboardPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
	})

	test('should create and update a user profile', async ({ page }) => {
		const relayMonitor = await createRelayMonitor(page)

		await loginPage.login()
		await dashboardPage.navigateTo('Profile')
		await loginPage.handleDecryptDialog()

		await expect(page.locator('h1').filter({ hasText: 'Profile' }).first()).toBeVisible()

		await fillProfileForm(page, testProfileData)
		await page.click('[data-testid="profile-save-button"]')

		// Wait for the save button to be enabled again, indicating completion
		await expect(page.locator('[data-testid="profile-save-button"]:not([disabled])')).toBeVisible({
			timeout: 5000,
		})

		const profileEvent = await relayMonitor.waitForProfileEvent(10000)
		expect(profileEvent).not.toBeNull()
		console.log('✅ Profile event captured.')
		relayMonitor.stopMonitoring()

		// Verify persistence by navigating away and back
		await dashboardPage.navigateTo('Products')
		await dashboardPage.navigateTo('Profile')
		await loginPage.handleDecryptDialog()

		await verifyProfileForm(page, testProfileData)
		console.log('✅ Profile data verified after navigation.')
	})
})
