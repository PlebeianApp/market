import { test, expect } from '@playwright/test'
import { createRelayMonitor } from './utils/relay-monitor'
import { skipIfInSetupMode, handleDecryptDialog, login, navigateTo, fillProfileForm, verifyProfileForm } from './utils/test-utils'

// Helper function to fill user profile form
async function fillUserForm(page: any, userData: any) {
	console.log('📝 Filling user profile form...')

	// Handle potential decrypt dialog that might appear when accessing profile
	try {
		const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
		if (await decryptDialog.isVisible({ timeout: 200 })) {
			console.log('🔑 Decrypt dialog appeared, entering password...')
			await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
			await page.click('[data-testid="decrypt-login-button"]')
			await page.waitForTimeout(100)
		}
	} catch (e) {
		// No decrypt dialog needed
	}

	// Wait for profile form to be ready (looking for name field which is required)
	await page.waitForSelector('input[name="name"]', { timeout: 1000 })

	// Fill all form fields using the correct TanStack Form field names
	await page.fill('input[name="name"]', userData.name)
	await page.fill('input[name="displayName"]', userData.displayName)
	await page.fill('textarea[name="about"]', userData.about)
	await page.fill('input[name="website"]', userData.website)
	await page.fill('input[name="lud16"]', userData.lud16)
	await page.fill('input[name="nip05"]', userData.nip05)

	console.log('✅ Profile form filled successfully')
}

// Helper function to navigate using UI elements
async function navigateWithUI(page: any, linkText: string): Promise<boolean> {
	try {
		// Look for navigation link with the specified text
		const navLink = page.getByText(linkText, { exact: false })
		if (await navLink.isVisible({ timeout: 100 })) {
			await navLink.click()
			await page.waitForTimeout(100)
			return true
		}
		return false
	} catch (error) {
		console.log(`Failed to find navigation link: ${linkText}`)
		return false
	}
}

const testProfileData = {
	name: 'Test User E2E',
	displayName: 'Test User Display',
	about: 'This is a test user created during e2e testing. Hello Nostr world!',
	nip05: 'testuser@example.com',
	lud16: 'testuser@getalby.com',
	website: 'https://example.com',
}

test.describe.serial('4. User Profile Creation Flow', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
		await skipIfInSetupMode(page, test)
	})

	test('should complete full user creation and profile setup flow', async ({ page }) => {
		const relayMonitor = await createRelayMonitor(page)
		await login(page)

		await navigateTo(page, 'Profile')
		await handleDecryptDialog(page)

		await expect(page.locator('h1').filter({ hasText: 'Profile' }).first()).toBeVisible()

		await fillProfileForm(page, testProfileData)
		await page.click('[data-testid="profile-save-button"]')
		await expect(page.locator('[data-testid="profile-save-button"]:has-text("Save")')).toBeVisible({
			timeout: 5000, // Increased timeout
		})

		const profileEvent = await relayMonitor.waitForProfileEvent()
		expect(profileEvent).not.toBeNull()
		relayMonitor.stopMonitoring()

		// Verify persistence by navigating away and back
		await navigateTo(page, 'Products')
		await navigateTo(page, 'Profile')
		await handleDecryptDialog(page)

		await verifyProfileForm(page, testProfileData)
	})

	test('should handle login with existing stored key', async ({ page }) => {
		await page.goto('/')
		await handleDecryptDialog(page)
		if (await page.locator('[data-testid="dashboard-link"]').isVisible()) {
			return // Already logged in
		}
		await login(page, { password: 'pass1234' })
	})
})
