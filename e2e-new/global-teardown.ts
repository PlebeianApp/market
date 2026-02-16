import type { FullConfig } from '@playwright/test'

async function globalTeardown(config: FullConfig) {
	console.log('\n--- E2E Global Teardown ---')
	console.log('  Cleanup complete')
}

export default globalTeardown
