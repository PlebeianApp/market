/**
 * Local Playwright config for running the e2e suite against system Chromium.
 *
 * The base config (playwright.config.ts) uses Playwright's bundled headless
 * shell, which is not installed in every environment. This override points the
 * chromium project at a system Chromium binary via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
 * (defaulting to /usr/bin/chromium-browser) so `executablePath` is honoured and the
 * bundled-browser lookup is skipped.
 *
 * Everything else (webServer relay + dev server, global setup/teardown, projects,
 * timeouts) is inherited from the base config.
 */
import { defineConfig, devices } from '@playwright/test'
import baseConfig from './playwright.config'

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser'

// The base config's webServer (relay + dev server) uses Playwright's default
// 60s readiness timeout, which is too short for the dev server's first cold
// compile in this environment. Bump it so the managed startup has room to finish
// building without timing out before the port comes up.
const baseServers = baseConfig.webServer
const webServer = Array.isArray(baseServers) ? baseServers.map((s) => ({ ...s, timeout: 300_000 })) : baseServers

export default defineConfig({
	...baseConfig,
	webServer,
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					executablePath,
					// Snap/system Chromium in headless CI containers needs --no-sandbox.
					args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
				},
			},
		},
	],
})
