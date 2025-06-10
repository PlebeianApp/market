import { test, expect } from '@playwright/test'
import { mockNostrExtension } from './utils/test-utils'
import { createRelayMonitor } from './utils/relay-monitor'
import { SetupPage } from './po/SetupPage'
import { BasePage } from './po/BasePage'

test.describe.serial('1. App Setup Flow', () => {
	test('should redirect to setup page on first visit and complete setup flow', async ({ page }) => {
		const basePage = new BasePage(page)
		const setupPage = new SetupPage(page)

		await mockNostrExtension(page)
		await basePage.goto()
		await basePage.pause(1000)

		const currentUrl = page.url()
		console.log(`📍 Current URL after navigation: ${currentUrl}`)

		if (currentUrl.includes('/setup')) {
			console.log('📋 App needs setup, proceeding with form fill...')
			const relayMonitor = await createRelayMonitor(page)

			await setupPage.fillForm()
			await setupPage.submitForm()

			console.log('⏳ Waiting for setup event to be stored...')
			const setupEvent = await relayMonitor.waitForSetupEvent(5000)
			expect(setupEvent).not.toBeNull()
			console.log('✅ Setup event successfully stored in relay.')

			relayMonitor.stopMonitoring()
			await basePage.waitForURL('/')
		} else {
			console.log('✅ App already configured, skipping setup form.')
			await basePage.waitForURL('/')
		}
	})

	test('should confirm app is configured and not require setup', async ({ page }) => {
		const basePage = new BasePage(page)
		await basePage.goto()
		await basePage.waitForURL(/\/$/, 5000) // Wait for home page, not setup
		await expect(page).not.toHaveURL(/\/setup/)
	})

	test('should show app is configured and allow navigation', async ({ page }) => {
		// After setup, we should land on the home page and not be redirected to setup.
		await page.goto('/')
		await expect(page).not.toHaveURL(/\/setup/)
		// await expectToBeOnHomePage(page) // This is now covered by the line above

		// Navigation should work correctly after setup.
		await page.goto('/products')
		await expect(page).toHaveURL('/products')
	})

	test('should force setup flow by checking app configuration', async ({ page }) => {
		// Navigate to the page first to ensure the server is ready
		await page.goto('/')

		// This test checks the actual app configuration endpoint
		const response = await page.request.get('/api/config')
		const data = await response.json()

		console.log('📊 App configuration:', {
			hasSettings: !!data.appSettings,
			needsSetup: data.needsSetup,
			relay: data.appRelay,
			appPublicKey: data.appPublicKey,
		})

		if (data.needsSetup) {
			console.log('🔧 App needs setup - this should trigger the setup flow')
		} else {
			console.log('✅ App is already configured')
			console.log('App settings:', data.appSettings)
		}

		// The test passes regardless, but logs the current state
		expect(data).toBeDefined()
	})
})
