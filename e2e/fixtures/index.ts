import { test as base, expect, type Page } from '@playwright/test'
import { RelayMonitor } from './relay-monitor'
import { setupAuthContext, type TestUser } from './auth'
import { ensureScenario, resetRemoteCartForUser, type ScenarioName } from '../scenarios'
import { devUser1, devUser2, devUser3 } from '../../src/lib/fixtures'

/**
 * Dismiss the PII exposure modal if it appears.
 *
 * The PII scanner runs on page load when the user has kind-16 order events
 * with PII tags (address, email, phone) on the relay. PII events from
 * previous test runs accumulate on the reused relay and trigger the modal
 * on subsequent page loads, blocking all clicks. This helper dismisses
 * the modal so test interactions can proceed.
 */
async function dismissPIIModalIfPresent(page: Page): Promise<void> {
	const dismissButton = page.getByRole('button', { name: /dismiss warning/i })
	if (await dismissButton.isVisible({ timeout: 3000 }).catch(() => false)) {
		await dismissButton.click()
		await expect(dismissButton).not.toBeVisible({ timeout: 5000 })
	}
}

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
		await page.waitForLoadState('domcontentloaded')
		// Give the auto-login a moment to complete
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })
		// Dismiss PII modal if accumulated PII events trigger it
		await dismissPIIModalIfPresent(page)

		await use(page)
		await context.close()
	},

	buyerPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser2.sk)
		const context = await browser.newContext()
		await setupAuthContext(context, devUser2)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })
		await dismissPIIModalIfPresent(page)

		await use(page)
		await context.close()
	},

	newUserPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		await resetRemoteCartForUser(devUser3.sk)
		const context = await browser.newContext()
		await setupAuthContext(context, devUser3)
		const page = await context.newPage()

		await page.goto('/')
		await page.waitForLoadState('domcontentloaded')
		await expect(page.locator('header')).toBeVisible({ timeout: 10_000 })
		await dismissPIIModalIfPresent(page)

		await use(page)
		await context.close()
	},

	unauthenticatedPage: async ({ browser, scenario }, use) => {
		await ensureScenario(scenario)
		const context = await browser.newContext()
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
