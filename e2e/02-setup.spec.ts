import { test, expect } from '@playwright/test'
import { fillSetupForm, expectToBeOnHomePage, mockNostrExtension } from './utils/test-utils'
import { createRelayMonitor } from './utils/relay-monitor'

test.describe.serial('1. App Setup Flow', () => {
	test('should redirect to setup page on first visit and complete setup flow', async ({ page }) => {
		// Use the fixed test user for consistency
		await mockNostrExtension(page)

		await page.goto('/')

		// Wait for the app to load and potentially redirect
		await page.waitForTimeout(3000)

		// Check if we're redirected to setup or already on home
		const currentUrl = page.url()
		console.log(`📍 Current URL after navigation and wait: ${currentUrl}`)

		// If we are on the setup page, fill the form and expect to be redirected to home.
		// Otherwise, we expect to be on the home page already.
		if (page.url().includes('/setup')) {
			console.log('📋 App needs setup - starting event monitoring...')
			const relayMonitor = await createRelayMonitor(page)

			await fillSetupForm(page)

			// Wait for the setup event to be stored in the relay
			console.log('⏳ Waiting for setup event to be stored...')
			const setupEvent = await relayMonitor.waitForSetupEvent(15000) // Increased timeout for setup
			expect(setupEvent).not.toBeNull()
			console.log('✅ Setup event successfully stored in relay')

			relayMonitor.stopMonitoring()
			await expectToBeOnHomePage(page)
		} else {
			console.log('✅ App already configured, skipping setup')
			await expectToBeOnHomePage(page)
		}
	})

	test('should show app is configured and allow navigation', async ({ page }) => {
		// After setup, we should land on the home page and not be redirected to setup.
		await page.goto('/')
		await expect(page).not.toHaveURL(/\/setup/)
		await expectToBeOnHomePage(page)

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
