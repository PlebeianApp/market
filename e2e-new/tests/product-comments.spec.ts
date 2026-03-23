import { test, expect } from '../fixtures'
import { devUser1 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

const TEST_PRODUCT_ADDRESS = `30402:${devUser1.pk}:bitcoin-hardware-wallet`

test.describe('Product Comments', () => {
	test('authenticated user can post comment and see it', async ({ merchantPage }) => {
		await merchantPage.goto(`/products/${TEST_PRODUCT_ADDRESS}`)
		await merchantPage.click('button:has-text("Comments")')

		const commentText = `Test comment ${Date.now()}`
		await merchantPage.locator('textarea').first().fill(commentText)
		await merchantPage.click('button:has-text("Post Comment")')

		await expect(merchantPage.locator(`text=${commentText}`)).toBeVisible({ timeout: 10000 })
		await expect(merchantPage.locator('text=TestMerchant')).toBeVisible()
	})

	test('can reply to comment with inline form', async ({ merchantPage }) => {
		await merchantPage.goto(`/products/${TEST_PRODUCT_ADDRESS}`)
		await merchantPage.click('button:has-text("Comments")')

		const parentText = `Parent comment ${Date.now()}`
		await merchantPage.locator('textarea').first().fill(parentText)
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${parentText}`)).toBeVisible({ timeout: 10000 })

		await merchantPage.click('button:has-text("Reply")')
		const replyText = `Reply comment ${Date.now()}`
		await merchantPage.locator('textarea').nth(1).fill(replyText)
		await merchantPage.click('button:has-text("Post Reply")')

		await expect(merchantPage.locator(`text=${replyText}`)).toBeVisible({ timeout: 10000 })
	})

	test('can delete own comment', async ({ merchantPage }) => {
		await merchantPage.goto(`/products/${TEST_PRODUCT_ADDRESS}`)
		await merchantPage.click('button:has-text("Comments")')

		const deleteText = `Delete me ${Date.now()}`
		await merchantPage.locator('textarea').first().fill(deleteText)
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${deleteText}`)).toBeVisible({ timeout: 10000 })

		merchantPage.on('dialog', (dialog) => dialog.accept())
		await merchantPage.locator('button svg.lucide-trash-2').last().click()

		await expect(merchantPage.locator(`text=${deleteText}`)).not.toBeVisible({ timeout: 10000 })
	})
})
