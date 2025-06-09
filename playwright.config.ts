import { defineConfig, devices } from '@playwright/test'

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
	testDir: './e2e',
	/* Run tests in files in parallel */
	fullyParallel: false,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: 'html',
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		baseURL: 'http://localhost:3000',

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: 'on-first-retry',

		/* Take screenshot on failure */
		screenshot: 'only-on-failure',

		/* Record video on failure */
		video: 'retain-on-failure',
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	/* Run your local dev server before starting the tests */
	webServer: [
		{
			command: 'nak serve',
			port: 10547,
			reuseExistingServer: !process.env.CI,
			env: {
				NODE_ENV: 'test',
			},
		},
		{
			command: 'NODE_ENV=test bun dev',
			port: 3000,
			reuseExistingServer: !process.env.CI,
			env: {
				NODE_ENV: 'test',
				APP_RELAY_URL: 'ws://localhost:10547',
				APP_PRIVATE_KEY: process.env.TEST_APP_PRIVATE_KEY || 'a'.repeat(64), // Default test private key
			},
		},
	],

	/* Global setup and teardown */
	globalSetup: './e2e/global-setup.ts',
	globalTeardown: './e2e/global-teardown.ts',

	/* Test timeout */
	timeout: 30 * 1000,
	expect: {
		timeout: 5 * 1000,
	},
})
