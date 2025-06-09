import { type Page, expect } from '@playwright/test'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { waitForAppReady, checkAppConfiguration } from './relay-utils'

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

export async function waitForNavigation(page: Page, expectedUrl: string, timeout = 10000) {
	await page.waitForURL(expectedUrl, { timeout })
}

export async function fillSetupForm(page: Page, testUser: TestUser) {
	// Wait for form to be visible
	await page.waitForSelector('input[name="name"]', { timeout: 10000 })

	// Fill required fields
	await page.fill('input[name="name"]', 'Test Market')
	await page.fill('input[name="displayName"]', 'Test Market Display')
	await page.fill('input[name="ownerPk"]', testUser.npub)
	await page.fill('input[name="contactEmail"]', 'test@example.com')

	// Submit the form
	await page.click('button[type="submit"]')

	// Wait for submission to complete
	await page.waitForTimeout(2000)
}

export async function expectToBeOnSetupPage(page: Page) {
	await expect(page).toHaveURL('/setup')
	await expect(page.getByText('Instance Setup')).toBeVisible()
}

export async function expectToBeOnHomePage(page: Page) {
	await expect(page).toHaveURL('/')
}

export async function mockNostrExtension(page: Page, testUser: TestUser) {
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
	}, testUser)
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

	await page.click('[data-testid="login-button"]')
	await page.waitForSelector('[data-testid="login-dialog"]', { timeout: 5000 })
	await page.click('[data-testid="private-key-tab"]')
	await page.waitForTimeout(1000)

	const storedPasswordInput = page.locator('[data-testid="stored-password-input"]')
	if (await storedPasswordInput.isVisible()) {
		await storedPasswordInput.fill(options.password || 'pass1234')
		await page.check('[data-testid="auto-login-checkbox"]')
		await page.click('[data-testid="stored-key-login-button"]')
	} else {
		await page.click('[data-testid="generate-key-button"]')
		await page.waitForTimeout(1000)

		const privateKeyInput = page.locator('[data-testid="private-key-input"]')
		const privateKeyValue = await privateKeyInput.inputValue()
		expect(privateKeyValue).toMatch(/^nsec1[a-z0-9]+$/)

		await page.click('[data-testid="continue-button"]')
		await page.waitForTimeout(1000)

		await page.fill('[data-testid="new-password-input"]', options.password || 'pass1234')
		await page.fill('[data-testid="confirm-password-input"]', options.password || 'pass1234')
		await page.check('[data-testid="auto-login-checkbox"]')
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
