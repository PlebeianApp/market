import { DEFAULT_TRUSTED_MINTS } from '@/lib/constants'
import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

test.describe('Auction Custom Mint URL', () => {
	test('user can add a valid custom mint URL via text input', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const validMintUrl = 'https://testnut.cashu.space'

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		await merchantPage.getByPlaceholder('Enter mint URL...').fill(validMintUrl)

		await merchantPage.getByPlaceholder('Enter mint URL...').press('Enter')

		await expect(merchantPage.locator(`span[title="${validMintUrl}"]`)).toBeVisible({ timeout: 15_000 })

		const removeButtons = merchantPage.getByTitle('Remove mint')
		const afterCount = await removeButtons.count()
		expect(afterCount).toBeGreaterThanOrEqual(DEFAULT_TRUSTED_MINTS.length + 1)
	})

	test('user sees error when entering an invalid mint URL', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const invalidMintUrl = 'https://this-mint-does-not-exist.example.com'

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		const removeButtons = merchantPage.getByTitle('Remove mint')
		await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 })
		const initialCount = await removeButtons.count()

		await merchantPage.getByPlaceholder('Enter mint URL...').fill(invalidMintUrl)

		await merchantPage.getByPlaceholder('Enter mint URL...').press('Enter')

		await expect(merchantPage.getByText('Could not verify mint')).toBeVisible({ timeout: 15_000 })

		const afterCount = await removeButtons.count()
		expect(afterCount).toBe(initialCount)
	})

	test('empty text input does not add a mint', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()

		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		const removeButtons = merchantPage.getByTitle('Remove mint')
		await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 })

		const initialCount = await removeButtons.count()

		const input = merchantPage.getByPlaceholder('Enter mint URL...')
		await input.clear()

		const container = input.locator('xpath=../..')
		const addButton = container.locator('> button')
		await expect(addButton).toBeDisabled()

		const afterCount = await removeButtons.count()
		expect(afterCount).toBe(initialCount)
	})
})
