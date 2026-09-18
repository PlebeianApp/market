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

	/**
	 * Record a video for the authenticated page fixtures. Set via
	 * `test.use({ recordVideo: true })`. Playwright's own `video` option does
	 * NOT reach these fixtures because they create their own contexts; this
	 * option is what the feature-quality-gate specs opt into.
	 */
	recordVideo: boolean
}

/**
 * Context options for the authenticated page fixtures.
 *
 * These fixtures create their OWN contexts (one per role), so Playwright does
 * NOT apply the spec-level `video` option to them automatically. When the
 * `recordVideo` fixture option is set, request `recordVideo` explicitly so the
 * opt-in specs (e.g. the settlement feature-gate spec) produce a video artefact.
 */
const contextOptions = (wantsVideo: boolean): Parameters<Browser['newContext']>[0] =>
	wantsVideo ? { baseURL: BASE_URL, recordVideo: { dir: test.info().outputPath('videos') } } : { baseURL: BASE_URL }

export const test = base.extend<TestFixtures>({
	// Default scenario - override per test file with test.use({ scenario: '...' })
	scenario: ['base', { option: true }],
	recordVideo: [false, { option: true }],

	relayMonitor: async ({ page }, use) => {
		const monitor = new RelayMonitor(page)
		await monitor.start()
		await use(monitor)
	},

	merchantPage: async ({ browser, scenario, recordVideo }, use) => {
		await ensureScenario(scenario)
		const context = await browser.newContext(contextOptions(recordVideo))
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

	buyerPage: async ({ browser, scenario, recordVideo }, use) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser2.sk)
		const context = await browser.newContext(contextOptions(recordVideo))
		await setupAuthContext(context, devUser2)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},

	newUserPage: async ({ browser, scenario, recordVideo }, use) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser3.sk)
		const context = await browser.newContext(contextOptions(recordVideo))
		await setupAuthContext(context, devUser3)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		await expect(page.getByTestId('dashboard-button')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await context.close()
	},

	unauthenticatedPage: async ({ browser, scenario, recordVideo }, use) => {
		await ensureScenario(scenario)
		const context = await browser.newContext(contextOptions(recordVideo))
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
