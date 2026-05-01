import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { TEST_APP_PRIVATE_KEY, RELAY_URL, BASE_URL, TEST_PORT } from './test-config'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
	testDir: './tests',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	testMatch: /.*\.spec\.ts$/,

	use: {
		baseURL: BASE_URL,
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

	// On CI, servers are started manually in the workflow for better visibility.
	// Locally, Playwright manages the relay and dev server automatically.
	webServer: process.env.CI
		? []
		: [
				{
					command: 'nak serve --hostname 0.0.0.0',
					port: 10547,
					reuseExistingServer: true,
					stdout: 'pipe',
					stderr: 'pipe',
				},
				{
					// Seed the relay with app settings, then start the dev server.
					// The dev server caches appSettings at startup, so events must
					// exist on the relay before it initializes.
					command: 'bun e2e-new/seed-relay.ts && NODE_ENV=test bun dev',
					cwd: PROJECT_ROOT,
					port: TEST_PORT,
					reuseExistingServer: true,
					stdout: 'pipe',
					stderr: 'pipe',
					env: {
						NODE_ENV: 'test',
						PORT: String(TEST_PORT),
						APP_RELAY_URL: RELAY_URL,
						APP_PRIVATE_KEY: TEST_APP_PRIVATE_KEY,
						LOCAL_RELAY_ONLY: 'true',
						NIP46_RELAY_URL: RELAY_URL,
					},
				},
			],

	globalSetup: './global-setup.ts',
	globalTeardown: './global-teardown.ts',
	timeout: 30_000,
	expect: { timeout: 5_000 },
})
