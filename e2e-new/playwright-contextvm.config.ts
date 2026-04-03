import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
	testDir: path.resolve('/home/c03rad0r/market-get-currency-context-vm/e2e-new/tests'),
	testMatch: /contextvm-org\.spec\.ts$/,
	fullyParallel: false,
	retries: 0,
	workers: 1,
	reporter: 'list',
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: {
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
})
