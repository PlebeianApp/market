import { test as base, expect, type Page } from '@playwright/test'
import { RelayMonitor } from './relay-monitor'
import { setupAuthContext, type TestUser } from './auth'
import { ensureScenario, type ScenarioName } from '../scenarios'
import { devUser1, devUser2 } from '../../src/lib/fixtures'

type TestFixtures = {
	/** Page with devUser1 logged in (merchant / app owner) */
	merchantPage: Page

	/** Page with devUser2 logged in (buyer) */
	buyerPage: Page

	/** Relay monitor attached to the default page */
	relayMonitor: RelayMonitor

	/** Which data scenario to seed before tests. Set via test.use({ scenario: '...' }) */
	scenario: ScenarioName
}

export const test = base.extend<TestFixtures>({
	// Default scenario - override per test file with test.use({ scenario: '...' })
	scenario: ['base', { option: true }],

	relayMonitor: async ({ page }, use) => {
		const monitor = new RelayMonitor(page)
		await monitor.start()
		await use(monitor)
	},

	merchantPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		const context = await browser.newContext()
		await setupAuthContext(context, devUser1)
		const page = await context.newPage()

		// Navigate and wait for the app to load
		await page.goto('/')
		await page.waitForLoadState('networkidle')
		// Give the auto-login a moment to complete
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},

	buyerPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		const context = await browser.newContext()
		await setupAuthContext(context, devUser2)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('networkidle')
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},
})

export { expect }
export type { TestUser }
