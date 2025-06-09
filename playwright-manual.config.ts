import { defineConfig, devices } from '@playwright/test'

/**
 * Manual testing configuration - assumes services are already running
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: 'http://localhost:3000',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	globalSetup: './e2e/global-setup.ts',
	globalTeardown: './e2e/global-teardown.ts',

	timeout: 30 * 1000,
	expect: {
		timeout: 5 * 1000,
	},
})
