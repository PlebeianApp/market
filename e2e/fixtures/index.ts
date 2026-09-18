import { test as base, expect, type Browser, type Page } from '@playwright/test'
import { RelayMonitor } from './relay-monitor'
import { setupAuthContext, type TestUser } from './auth'
import { ensureScenario, resetRemoteCartForUser, type ScenarioName } from '../scenarios'
import { devUser1, devUser2, devUser3 } from '../../src/lib/fixtures'
import { BASE_URL } from '../test-config'

type TestFixtures = {
	/** Page with devUser1 logged in (merchant / app owner) */
	merchantPage: Page

	/** Page with devUser2 logged in (buyer) */
	buyerPage: Page

	/** Page with devUser3 logged in (no seeded profile — fresh user) */
	newUserPage: Page

	/** Unauthenticated user for viewing public versions of pages */
	unauthenticatedPage: Page

	/** Relay monitor attached to the default page */
	relayMonitor: RelayMonitor

	/** Which data scenario to seed before tests. Set via test.use({ scenario: '...' }) */
	scenario: ScenarioName
}

/**
 * Context options for the authenticated page fixtures.
 *
 * These fixtures create their OWN contexts (one per role), so Playwright does
 * NOT apply the spec-level `test.use({ video })` to them automatically. Honour
 * an explicit `video: 'on'` by requesting `recordVideo`, so specs that opt in
 * (e.g. the settlement feature-gate spec) actually produce a video artefact.
 */
const contextOptions = (): Parameters<Browser['newContext']>[0] =>
	test.info().project.use.video === 'on'
		? { baseURL: BASE_URL, recordVideo: { dir: test.info().outputPath('videos') } }
		: { baseURL: BASE_URL }

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
		const context = await browser.newContext(contextOptions())
		await setupAuthContext(context, devUser1)
		const page = await context.newPage()

		// Navigate and wait for the app to load
		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		// Give the auto-login a moment to complete
		await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},

	buyerPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser2.sk)
		const context = await browser.newContext(contextOptions())
		await setupAuthContext(context, devUser2)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},

	newUserPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser3.sk)
		const context = await browser.newContext(contextOptions())
		await setupAuthContext(context, devUser3)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},

	unauthenticatedPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		const context = await browser.newContext(contextOptions())
		// Do NOT call setupAuthContext here. This leaves the user logged out.
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		// Verify we are NOT logged in (check for login button visibility)
		await expect(page.getByTestId('login-button')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},
})

export { expect }
export type { TestUser }
