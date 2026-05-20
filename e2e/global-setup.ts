import type { FullConfig } from '@playwright/test'
import { TEST_APP_PUBLIC_KEY, BASE_URL } from './test-config'

/**
 * Playwright global setup.
 *
 * Relay seeding (app settings, admin list, relay list) is handled by
 * seed-relay.ts which runs as part of the webServer command before the
 * dev server starts. This ensures the dev server finds the events on
 * startup and caches them correctly.
 *
 * This global setup runs after the webServer is ready and verifies
 * the server is in a good state before tests begin.
 */
async function globalSetup(config: FullConfig) {
	console.log('\n--- E2E Global Setup ---')
	console.log(`  App pubkey: ${TEST_APP_PUBLIC_KEY.slice(0, 16)}...`)

	// Verify the dev server has app settings loaded.
	// The server may open its port before finishing the async fetchAppSettings() call,
	// so retry a few times with a delay before failing.
	const maxRetries = 10
	const retryDelay = 1000
	let lastError: string | null = null

	for (let i = 0; i < maxRetries; i++) {
		try {
			const res = await fetch(`${BASE_URL}/api/config`)
			const configData = await res.json()
			if (!configData.needsSetup) {
				console.log('  Server health: OK (app settings loaded)')
				console.log('--- Global Setup Complete ---\n')
				return
			}
			lastError = 'needsSetup=true'
		} catch (err) {
			lastError = String(err)
		}

		if (i < maxRetries - 1) {
			await new Promise((r) => setTimeout(r, retryDelay))
		}
	}

	throw new Error(
		`Dev server reports needsSetup=true after ${maxRetries} retries — app settings not loaded.\n` +
			'This usually happens when the relay was restarted but the dev server was reused.\n' +
			'Fix: stop the dev server (kill port ' +
			BASE_URL.split(':').pop() +
			') and re-run tests.',
	)
}

export default globalSetup
