import { DEFAULT_TRUSTED_MINTS } from '@/lib/constants'
import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

test.describe('Auction Mint State', () => {
	test('trusted mints initialize with available mints', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		for (const mint of DEFAULT_TRUSTED_MINTS) {
			await expect(merchantPage.locator(`span[title="${mint}"]`)).toBeVisible({ timeout: 10_000 })
		}
	})

	test('user can remove a mint and the form stays valid', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		const removeButtons = merchantPage.getByTitle('Remove mint')
		await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 })

		const initialCount = await removeButtons.count()

		await removeButtons.first().click()

		const afterCount = await removeButtons.count()
		expect(afterCount).toBe(initialCount - 1)

		await expect(merchantPage.getByTitle('At least one mint is required').or(merchantPage.getByTitle('Remove mint')).first()).toBeVisible()
	})
})
