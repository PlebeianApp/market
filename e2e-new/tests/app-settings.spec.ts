import { test, expect, type Page } from '../fixtures'
import { devUser1, devUser2 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

/**
 * Navigate to an admin-gated route, handling the async admin check.
 * The root route guard in __root.tsx redirects non-admins from /dashboard/app-settings/*.
 * Since the admin check is async (NDK query), the first navigation attempt may be
 * interrupted by a redirect. This helper retries navigation to work around the race.
 */
async function gotoAdminRoute(page: Page, path: string) {
	await page.goto(path, { waitUntil: 'commit' }).catch(() => {})

	// If we got redirected, wait a moment for the admin query to resolve and try again
	const currentUrl = page.url()
	if (!currentUrl.includes('app-settings')) {
		await page.waitForTimeout(2000)
		await page.goto(path)
	}

	// Wait for the page to be fully loaded
	await page.waitForLoadState('networkidle')
}

/**
 * Wait for a page heading to confirm we're on the right admin page.
 * Uses heading role to avoid strict mode violations from sidebar nav links.
 */
async function expectPageHeading(page: Page, name: string | RegExp) {
	await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 10_000 })
}

/**
 * Fill an input and click the adjacent Add button in the same flex row.
 * The Input component wraps the native <input> in a <div>, so the DOM is:
 *   <div class="flex gap-2">       ← flex container (grandparent)
 *     <div class="w-full">         ← Input wrapper   (parent)
 *       <input id="newXxx" />      ← native input
 *     </div>
 *     <button>Add</button>
 *   </div>
 * We go up two levels (input → wrapper → flex container) to find the sibling button.
 */
async function fillAndAdd(page: Page, inputId: string, value: string) {
	const input = page.locator(`#${inputId}`)
	await input.scrollIntoViewIfNeeded()
	await input.fill(value)
	// Go up two levels: native <input> → Input wrapper div → flex container div
	await input.locator('../..').getByRole('button', { name: 'Add' }).click()
}

// --- App Settings (Miscellaneous) ---
// Note: The app-miscelleneous page is owner-only. devUser1 is an admin but NOT the owner
// (the owner is TEST_APP_PUBLIC_KEY). So devUser1 sees "You don't have permission".

test.describe('App Settings', () => {
	test('admin can navigate to app settings page', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/app-miscelleneous')

		// devUser1 is admin but NOT owner, so should see permission denied message
		await expect(merchantPage.getByText("You don't have permission to manage these settings.")).toBeVisible({
			timeout: 10_000,
		})
	})

	test('non-admin is redirected away from app settings', async ({ buyerPage }) => {
		// The root route guard redirects non-admins — goto may be interrupted
		await buyerPage.goto('/dashboard/app-settings/app-miscelleneous', { waitUntil: 'commit' }).catch(() => {})
		await expect(buyerPage).not.toHaveURL(/app-settings/, { timeout: 10_000 })
	})
})

// --- Featured Items ---

test.describe('Featured Items', () => {
	test('admin can view featured items page with tabs', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/featured-items')
		await expectPageHeading(merchantPage, 'Featured Items')

		// Verify all three tabs exist
		await expect(merchantPage.getByRole('tab', { name: /Products/ })).toBeVisible()
		await expect(merchantPage.getByRole('tab', { name: /Collections/ })).toBeVisible()
		await expect(merchantPage.getByRole('tab', { name: /Users/ })).toBeVisible()
	})

	test('can add a product to featured list by coordinate', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/featured-items')
		await expectPageHeading(merchantPage, 'Featured Items')

		const productCoords = `30402:${devUser1.pk}:bitcoin-hardware-wallet`
		await fillAndAdd(merchantPage, 'newProduct', productCoords)

		// Product should appear — at least one remove button exists
		await expect(merchantPage.locator('button[class*="destructive"]').first()).toBeVisible({ timeout: 15_000 })
	})

	test('can remove a product from featured list', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/featured-items')
		await expectPageHeading(merchantPage, 'Featured Items')

		// First add a product so we have something to remove
		const productCoords = `30402:${devUser1.pk}:nostr-t-shirt`
		await fillAndAdd(merchantPage, 'newProduct', productCoords)

		// Wait for at least one remove button
		const removeButtons = merchantPage.locator('button[class*="destructive"]')
		await expect(removeButtons.first()).toBeVisible({ timeout: 15_000 })
		const countAfterAdd = await removeButtons.count()

		// Remove the last item
		await removeButtons.last().click()

		// One fewer remove button than after the add
		await expect(removeButtons).toHaveCount(countAfterAdd - 1, { timeout: 15_000 })
	})

	test('collections tab shows empty state', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/featured-items')
		await expectPageHeading(merchantPage, 'Featured Items')

		// Switch to Collections tab
		await merchantPage.getByRole('tab', { name: /Collections/ }).click()

		await expect(merchantPage.getByText('No featured collections yet')).toBeVisible()
	})

	test('can add a user to featured list by hex pubkey', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/featured-items')
		await expectPageHeading(merchantPage, 'Featured Items')

		// Switch to Users tab and wait for it to become active
		await merchantPage.getByRole('tab', { name: /Users/ }).click()
		const usersPanel = merchantPage.getByRole('tabpanel', { name: /Users/ })
		await expect(usersPanel).toBeVisible()

		await fillAndAdd(merchantPage, 'newUser', devUser2.pk)

		// User should appear — at least one remove button should exist in the Users tab
		await expect(usersPanel.locator('button[class*="destructive"]').first()).toBeVisible({ timeout: 15_000 })
	})

	test('permissions section shows admin role', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/featured-items')
		await expectPageHeading(merchantPage, 'Featured Items')

		// Scroll to the bottom to find the permissions card
		const permissionsCard = merchantPage.getByText('Your Permissions')
		await permissionsCard.scrollIntoViewIfNeeded()
		await expect(permissionsCard).toBeVisible()
		await expect(merchantPage.getByText('Administrator')).toBeVisible()
	})

	test('non-admin user is redirected away from featured items', async ({ buyerPage }) => {
		// The root route guard redirects non-admins — goto may be interrupted
		await buyerPage.goto('/dashboard/app-settings/featured-items', { waitUntil: 'commit' }).catch(() => {})
		await expect(buyerPage).not.toHaveURL(/app-settings/, { timeout: 10_000 })
	})
})

// --- Blacklists ---

test.describe('Blacklists', () => {
	test('admin can view blacklists page with tabs', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/blacklists')
		await expectPageHeading(merchantPage, 'Blacklists')

		// Verify all three tabs exist
		await expect(merchantPage.getByRole('tab', { name: /Users/ })).toBeVisible()
		await expect(merchantPage.getByRole('tab', { name: /Products/ })).toBeVisible()
		await expect(merchantPage.getByRole('tab', { name: /Collections/ })).toBeVisible()
	})

	test('can add a user to blacklist by hex pubkey', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/blacklists')
		await expectPageHeading(merchantPage, 'Blacklists')

		await fillAndAdd(merchantPage, 'newUser', devUser2.pk)

		// User should appear — at least one remove button exists
		await expect(merchantPage.locator('button[class*="destructive"]').first()).toBeVisible({ timeout: 15_000 })
	})

	test('can remove a user from blacklist', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/blacklists')
		await expectPageHeading(merchantPage, 'Blacklists')

		// First add a user so we have something to remove
		await fillAndAdd(merchantPage, 'newUser', devUser2.pk)

		const removeButtons = merchantPage.locator('button[class*="destructive"]')
		await expect(removeButtons.first()).toBeVisible({ timeout: 15_000 })
		const countAfterAdd = await removeButtons.count()

		// Remove the last item
		await removeButtons.last().click()

		// One fewer remove button than after the add
		await expect(removeButtons).toHaveCount(countAfterAdd - 1, { timeout: 15_000 })
	})

	test('can add a product to blacklist by coordinate', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/blacklists')
		await expectPageHeading(merchantPage, 'Blacklists')

		// Switch to Products tab
		await merchantPage.getByRole('tab', { name: /Products/ }).click()
		const productsPanel = merchantPage.getByRole('tabpanel', { name: /Products/ })
		await expect(productsPanel).toBeVisible()

		const productCoords = `30402:${devUser1.pk}:bitcoin-e-book`
		await fillAndAdd(merchantPage, 'newProduct', productCoords)

		// Product should appear — at least one remove button in the Products tab
		await expect(productsPanel.locator('button[class*="destructive"]').first()).toBeVisible({ timeout: 15_000 })
	})

	test('collections tab shows empty state', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/blacklists')
		await expectPageHeading(merchantPage, 'Blacklists')

		// Switch to Collections tab
		await merchantPage.getByRole('tab', { name: /Collections/ }).click()

		await expect(merchantPage.getByText('No collections are currently blacklisted')).toBeVisible()
	})

	test('permissions section shows admin role', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/blacklists')
		await expectPageHeading(merchantPage, 'Blacklists')

		// Scroll to the bottom to find the permissions card
		const permissionsCard = merchantPage.getByText('Your Permissions')
		await permissionsCard.scrollIntoViewIfNeeded()
		await expect(permissionsCard).toBeVisible()
		await expect(merchantPage.getByText('Administrator')).toBeVisible()
	})

	test('non-admin user is redirected away from blacklists', async ({ buyerPage }) => {
		// The root route guard redirects non-admins — goto may be interrupted
		await buyerPage.goto('/dashboard/app-settings/blacklists', { waitUntil: 'commit' }).catch(() => {})
		await expect(buyerPage).not.toHaveURL(/app-settings/, { timeout: 10_000 })
	})
})
