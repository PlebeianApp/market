import { type Page } from '@playwright/test'

/**
 * Clear relay state by restarting the relay process
 * This ensures tests start with a clean slate
 */
export async function clearRelayState() {
	console.log('🧹 Clearing relay state...')

	try {
		// This would need to be implemented based on how you want to reset the relay
		// For now, just log that we should restart the relay
		console.log('💡 To fully reset state, restart the relay with: ./scripts/start-test-env.sh')
	} catch (error) {
		console.error('Failed to clear relay state:', error)
	}
}

/**
 * Wait for app to be ready and determine if setup is needed
 */
export async function waitForAppReady(page: Page, timeout = 10000): Promise<'setup' | 'ready'> {
	console.log('⏳ Waiting for app to be ready...')

	const startTime = Date.now()
	while (Date.now() - startTime < timeout) {
		try {
			// Check current URL
			const url = page.url()

			// If we're on setup page, return setup
			if (url.includes('/setup')) {
				console.log('📋 App needs setup')
				return 'setup'
			}

			// If we're on home page and not being redirected, app is ready
			if (url === 'http://localhost:3000/' || url.endsWith('/')) {
				// Wait a bit more to ensure no redirect happens
				await page.waitForTimeout(2000)
				const finalUrl = page.url()
				if (!finalUrl.includes('/setup')) {
					console.log('✅ App is ready')
					return 'ready'
				}
			}

			// Wait and try again
			await page.waitForTimeout(1000)
		} catch (error) {
			console.log('⏳ Still waiting for app...')
			await page.waitForTimeout(1000)
		}
	}

	throw new Error('Timeout waiting for app to be ready')
}

/**
 * Check if the app has valid configuration by testing the /api/config endpoint
 */
export async function checkAppConfiguration(page: Page): Promise<boolean> {
	try {
		const response = await page.evaluate(async () => {
			const res = await fetch('/api/config')
			return res.json()
		})

		console.log('📊 App config:', {
			hasSettings: !!response.appSettings,
			needsSetup: response.needsSetup,
			relay: response.appRelay,
		})

		return !response.needsSetup && !!response.appSettings
	} catch (error) {
		console.error('Failed to check app configuration:', error)
		return false
	}
}
