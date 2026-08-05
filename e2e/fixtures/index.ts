import { test as base, expect, type Page, type Browser, type BrowserContext, type TestInfo } from '@playwright/test'
import { RelayMonitor } from './relay-monitor'
import { setupAuthContext, type TestUser } from './auth'
import { ensureScenario, resetRemoteCartForUser, type ScenarioName } from '../scenarios'
import { devUser1, devUser2, devUser3 } from '../../src/lib/fixtures'
import { shouldRecordVideo } from './video'
import * as fs from 'node:fs/promises'

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
 * Create a browser context that honours the project's `use.video` setting.
 *
 * The fixtures below create their own contexts (via browser.newContext) for
 * per-user isolation, which bypasses Playwright's automatic video recording.
 * Forwarding `recordVideo` for unconditional capture modes — i.e. the
 * @happy-path project (video: 'on') — makes those specs produce a video.webm
 * alongside their screenshots. Non-recording projects get a plain context,
 * identical to the previous behaviour. See e2e/fixtures/video.ts.
 */
async function newContext(browser: Browser, testInfo: TestInfo) {
	// `use.video` can be a string mode or an object form; we only ever configure
	// the string modes, so normalise anything else to "no recording".
	const videoMode = testInfo.project.use.video
	const mode = typeof videoMode === 'string' ? videoMode : undefined
	return browser.newContext(shouldRecordVideo(mode) ? { recordVideo: { dir: 'test-results' } } : {})
}

/**
 * Close a context and, if it recorded a video, attach the .webm to the test
 * result. Playwright only auto-attaches videos for contexts it creates through
 * the built-in page/context fixtures; for our manually-created contexts the
 * recording lands in test-results/page@<hash>.webm unattached. Explicitly
 * attaching it makes the video surface as a per-test artifact (filename
 * `video.webm`) so the list reporter and the nsite dashboard can pick it up.
 */
async function closeContext(context: BrowserContext, page: Page, testInfo: TestInfo) {
	const video = page.video()
	await context.close()
	if (video) {
		const rawPath = await video.path()
		await testInfo.attach('video', {
			path: rawPath,
			contentType: 'video/webm',
		})
		// The attach copies the file into the test's attachments/ dir; remove the
		// raw page@<hash>.webm left in the test-results root so CI artifact globs
		// capture exactly one canonical video per happy-path spec.
		await fs.unlink(rawPath).catch(() => {})
	}
}

export const test = base.extend<TestFixtures>({
	// Default scenario - override per test file with test.use({ scenario: '...' })
	scenario: ['base', { option: true }],

	relayMonitor: async ({ page }, use) => {
		const monitor = new RelayMonitor(page)
		await monitor.start()
		await use(monitor)
	},

	merchantPage: async ({ browser, scenario }, use, testInfo) => {
		await ensureScenario(scenario)
		const context = await newContext(browser, testInfo)
		await setupAuthContext(context, devUser1)
		const page = await context.newPage()

		// Navigate and wait for the app to load
		await page.goto('/')
		await page.waitForLoadState('networkidle')
		// Give the auto-login a moment to complete
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await closeContext(context, page, testInfo)
	},

	buyerPage: async ({ browser, scenario }, use, testInfo) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser2.sk)
		const context = await newContext(browser, testInfo)
		await setupAuthContext(context, devUser2)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('networkidle')
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await closeContext(context, page, testInfo)
	},

	newUserPage: async ({ browser, scenario }, use, testInfo) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser3.sk)
		const context = await newContext(browser, testInfo)
		await setupAuthContext(context, devUser3)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('networkidle')
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await closeContext(context, page, testInfo)
	},

	unauthenticatedPage: async ({ browser, scenario }, use, testInfo) => {
		await ensureScenario(scenario)
		const context = await newContext(browser, testInfo)
		// Do NOT call setupAuthContext here. This leaves the user logged out.
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('networkidle')
		// Verify we are NOT logged in (check for login button visibility)
		await expect(page.getByTestId('login-button')).toBeVisible({ timeout: 10_000 })

		await use(page)
		await closeContext(context, page, testInfo)
	},
})

export { expect }
export type { TestUser }
