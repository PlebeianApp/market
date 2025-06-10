import { type Page, expect } from '@playwright/test'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { waitForAppReady, checkAppConfiguration } from './relay-utils'

// Use a fixed test user for consistency across all tests
const FIXED_TEST_USER = {
	privateKey: '5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0', // devUser1.sk
	publicKey: '86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0', // devUser1.pk
	npub: 'npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah',
}

export interface TestUser {
	privateKey: string
	publicKey: string
	npub: string
}

export function generateTestUser(): TestUser {
	const privateKey = generateSecretKey()
	const privateKeyHex = Buffer.from(privateKey).toString('hex')
	const publicKey = getPublicKey(privateKey)
	const npub = nip19.npubEncode(publicKey)

	return {
		privateKey: privateKeyHex,
		publicKey,
		npub,
	}
}

export async function waitForNavigation(page: Page, expectedUrl: string, timeout = 1000) {
	await page.waitForURL(expectedUrl, { timeout })
}

export async function fillSetupForm(page: Page, testUser?: TestUser) {
	console.log('📝 Filling setup form...')

	// Wait for form to be visible
	await page.waitForSelector('input[name="name"]', { timeout: 1000 })

	// Use fixed test user if no user provided
	const userToUse = testUser || FIXED_TEST_USER

	// Fill required fields
	await page.fill('input[name="name"]', 'Test Market')
	await page.fill('input[name="displayName"]', 'Test Market Display')
	await page.fill('input[name="ownerPk"]', userToUse.npub)
	await page.fill('input[name="contactEmail"]', 'test@example.com')

	console.log('📤 Submitting setup form...')

	// Submit the form
	await page.click('button[type="submit"]')

	// Wait for either success message or navigation to home page
	try {
		// Wait for success toast message
		await page.waitForSelector('.sonner-toast:has-text("App settings successfully updated")', { timeout: 1000 })
		console.log('✅ Setup form submitted successfully')
	} catch (e) {
		console.log('⚠️  No success toast found, checking for navigation...')
	}

	// Wait for navigation to complete (either success or already navigated)
	await page.waitForTimeout(1000)
	console.log('📍 Setup form submission completed')
}

export async function expectToBeOnSetupPage(page: Page) {
	await expect(page).toHaveURL('/setup')
	await expect(page.getByText('Instance Setup')).toBeVisible()
}

export async function expectToBeOnHomePage(page: Page) {
	await expect(page).toHaveURL('/')
}

export async function mockNostrExtension(page: Page, testUser?: TestUser) {
	// Use fixed test user if no user provided
	const userToUse = testUser || FIXED_TEST_USER

	// Mock the window.nostr extension for testing
	await page.addInitScript((user) => {
		;(window as any).nostr = {
			async getPublicKey() {
				return user.publicKey
			},
			async signEvent(event: any) {
				// Mock signing - in real tests you might want proper signing
				return { ...event, sig: 'mock_signature' }
			},
		}
	}, userToUse)
}

export async function ensureAppState(page: Page, expectedState: 'setup' | 'ready'): Promise<boolean> {
	try {
		const appState = await waitForAppReady(page)
		return appState === expectedState
	} catch (error) {
		console.error('Failed to determine app state:', error)
		return false
	}
}

export async function skipIfInSetupMode(page: Page, testContext: any) {
	if (page.url().includes('/setup')) {
		testContext.skip()
		return true
	}
	return false
}

export async function handleDecryptDialog(page: Page): Promise<boolean> {
	try {
		const decryptDialog = page.locator('[data-testid="decrypt-password-dialog"]')
		if (await decryptDialog.isVisible({ timeout: 2000 })) {
			await page.fill('[data-testid="decrypt-password-input"]', 'pass1234')
			await page.click('[data-testid="decrypt-login-button"]')
			await expect(decryptDialog).not.toBeVisible({ timeout: 5000 })
			return true
		}
	} catch (e) {
		// No decrypt dialog
	}
	return false
}

export async function login(page: Page, options: { password?: string } = {}) {
	const dashboardLink = page.locator('[data-testid="dashboard-link"]')
	if (await dashboardLink.isVisible()) {
		return // Already logged in
	}

	// Check if we need to handle decrypt dialog first
	await handleDecryptDialog(page)

	// Check again if we're logged in after decrypt
	if (await dashboardLink.isVisible()) {
		return
	}

	await page.click('[data-testid="login-button"]')
	await page.waitForSelector('[data-testid="login-dialog"]', { timeout: 5000 })
	await page.click('[data-testid="private-key-tab"]')
	await page.waitForTimeout(1000)

	const storedPasswordInput = page.locator('[data-testid="stored-password-input"]')
	if (await storedPasswordInput.isVisible()) {
		// User already exists, just decrypt
		await storedPasswordInput.fill(options.password || 'pass1234')
		await page.check('[data-testid="auto-login-checkbox"]')
		await page.click('[data-testid="stored-key-login-button"]')
	} else {
		// First time setup - use fixed test user instead of generating
		const privateKeyBytes = new Uint8Array(Buffer.from(FIXED_TEST_USER.privateKey, 'hex'))
		const fixedPrivateKeyNsec = nip19.nsecEncode(privateKeyBytes)

		// Click "Import existing key" instead of generate
		const importButton = page.locator('[data-testid="import-key-button"]')
		if (await importButton.isVisible()) {
			await page.click('[data-testid="import-key-button"]')
		} else {
			// If no import button, fill the private key input directly
			await page.fill('[data-testid="private-key-input"]', fixedPrivateKeyNsec)
		}

		await page.waitForTimeout(1000)

		// Continue with the fixed private key
		await page.click('[data-testid="continue-button"]')
		await page.waitForTimeout(1000)

		// Set password and enable auto-login
		await page.fill('[data-testid="new-password-input"]', options.password || 'pass1234')
		await page.fill('[data-testid="confirm-password-input"]', options.password || 'pass1234')
		await page.check('[data-testid="auto-login-checkbox"]') // This is crucial!
		await page.click('[data-testid="encrypt-continue-button"]')
	}

	await expect(dashboardLink).toBeVisible({ timeout: 10000 })
}

export async function navigateTo(page: Page, item: 'Profile' | 'Products' | 'Home' | 'Dashboard') {
	switch (item) {
		case 'Dashboard':
			await page.click('[data-testid="dashboard-link"]')
			break
		case 'Profile':
			await page.click('[data-testid="dashboard-link"]')
			await page.waitForTimeout(500)
			await page.click('a:has-text("👤 Profile")')
			break
		case 'Products':
			await page.click('[data-testid="dashboard-link"]')
			await page.waitForTimeout(500)
			// Assuming there is a link for products
			await page.click('a:has-text("📦 Products")')
			break
		case 'Home':
			await page.click('[data-testid="home-link"]')
			break
	}
	await page.waitForTimeout(1000) // Wait for page to settle
}

export async function fillProfileForm(page: Page, userData: Record<string, string>) {
	await page.waitForSelector('input[name="name"]', { timeout: 10000 })
	for (const [key, value] of Object.entries(userData)) {
		const selector = `[name="${key}"]`
		if (key === 'about') {
			await page.fill(`textarea${selector}`, value)
		} else {
			await page.fill(`input${selector}`, value)
		}
	}
}

export async function verifyProfileForm(page: Page, userData: Record<string, string>) {
	for (const [key, value] of Object.entries(userData)) {
		const selector = `[name="${key}"]`
		if (key === 'about') {
			await expect(page.locator(`textarea${selector}`)).toHaveValue(value)
		} else {
			await expect(page.locator(`input${selector}`)).toHaveValue(value)
		}
	}
}
