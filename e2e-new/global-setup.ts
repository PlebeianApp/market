import type { FullConfig } from '@playwright/test'
import { TEST_APP_PUBLIC_KEY } from './test-config'

/**
 * Playwright global setup.
 *
 * Relay seeding (app settings, admin list, relay list) is handled by
 * seed-relay.ts which runs as part of the webServer command before the
 * dev server starts. This ensures the dev server finds the events on
 * startup and caches them correctly.
 *
 * This global setup runs after the webServer is ready and is available
 * for any additional one-time initialization needed before tests.
 */
async function globalSetup(config: FullConfig) {
	console.log('\n--- E2E Global Setup ---')
	console.log(`  App pubkey: ${TEST_APP_PUBLIC_KEY.slice(0, 16)}...`)
	console.log('--- Global Setup Complete ---\n')
}

export default globalSetup
