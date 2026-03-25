import { test, expect } from '../fixtures'
import { devUser1 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

const TEST_PRODUCT_ADDRESS = `30402:${devUser1.pk}:bitcoin-hardware-wallet`

test.describe('Product Comments - Core', () => {
	test.beforeEach(async ({ merchantPage }) => {
		await merchantPage.goto(`/products/${TEST_PRODUCT_ADDRESS}`)
		await expect(merchantPage.locator('h1').filter({ hasText: 'Bitcoin Hardware Wallet' })).toBeVisible({ timeout: 30000 })
		await merchantPage.click('button:has-text("Comments")')
		await expect(merchantPage.getByRole('heading', { name: /Comments/i })).toBeVisible({ timeout: 10000 })
	})

	test('authenticated user can post comment and see it', async ({ merchantPage }) => {
		const commentText = `Test comment ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(commentText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${commentText}`)).toBeVisible({ timeout: 15000 })
		await expect(merchantPage.getByText('TestMerchant').first()).toBeVisible()
	})

	test('comment shows author name', async ({ merchantPage }) => {
		const commentText = `Author test ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(commentText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${commentText}`)).toBeVisible({ timeout: 15000 })
		await expect(merchantPage.getByText('TestMerchant').first()).toBeVisible()
	})

	test('comment shows relative timestamp', async ({ merchantPage }) => {
		const commentText = `Timestamp test ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(commentText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${commentText}`)).toBeVisible({ timeout: 15000 })
		await expect(merchantPage.getByText(/ago|less than a minute/).first()).toBeVisible()
	})

	test('shows comment count badge when comments exist', async ({ merchantPage }) => {
		const commentText = `Count test ${Date.now()}`
		const textarea = merchantPage.locator('textarea').first()
		await textarea.click()
		await textarea.fill(commentText)
		await textarea.dispatchEvent('input')
		await merchantPage.waitForTimeout(500)
		await merchantPage.locator('button:has-text("Post Comment")').click()
		await expect(merchantPage.locator(`text=${commentText}`)).toBeVisible({ timeout: 15000 })
		await expect(merchantPage.locator('[role="tabpanel"]').filter({ hasText: /Comments/ }).locator('text=/\\(\\d+\\)/')).toBeVisible()
	})

	test('can reply to comment with inline form', async ({ merchantPage }) => {
		const parentText = `Parent comment ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(parentText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${parentText}`)).toBeVisible({ timeout: 15000 })

		await merchantPage.click('button:has-text("Reply")')
		await expect(merchantPage.locator('textarea').nth(1)).toBeVisible()

		const replyText = `Reply comment ${Date.now()}`
		await merchantPage.locator('textarea').nth(1).pressSequentially(replyText)
		await expect(merchantPage.locator('button:has-text("Post Reply")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Reply")')
		await expect(merchantPage.locator(`text=${replyText}`)).toBeVisible({ timeout: 15000 })
	})

	test('cancel hides reply form', async ({ merchantPage }) => {
		const parentText = `Cancel test ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(parentText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${parentText}`)).toBeVisible({ timeout: 15000 })

		await merchantPage.click('button:has-text("Reply")')
		await expect(merchantPage.locator('textarea').nth(1)).toBeVisible()

		await merchantPage.click('button:has-text("Cancel")')
		await expect(merchantPage.locator('textarea').nth(1)).not.toBeVisible()
	})

	test('can delete own comment', async ({ merchantPage }) => {
		const deleteText = `Delete me ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(deleteText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${deleteText}`)).toBeVisible({ timeout: 15000 })

		merchantPage.on('dialog', (dialog) => dialog.accept())
		await merchantPage.locator('button svg.lucide-trash-2').last().click()
		await expect(merchantPage.locator(`text=${deleteText}`)).not.toBeVisible({ timeout: 15000 })
	})

	test('delete button only on own comments', async ({ merchantPage, buyerPage }) => {
		const merchantCommentText = `Merchant comment ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(merchantCommentText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${merchantCommentText}`)).toBeVisible({ timeout: 15000 })

		await buyerPage.goto(`/products/${TEST_PRODUCT_ADDRESS}`)
		await buyerPage.click('button:has-text("Comments")')
		await expect(buyerPage.locator(`text=${merchantCommentText}`)).toBeVisible({ timeout: 15000 })
		await expect(buyerPage.locator('button svg.lucide-trash-2')).toHaveCount(0)
	})
})

test.describe('Product Comments - Unauthenticated', () => {
	test('shows login prompt when not authenticated', async ({ page }) => {
		await page.goto(`/products/${TEST_PRODUCT_ADDRESS}`)
		await expect(page.locator('h1').filter({ hasText: 'Bitcoin Hardware Wallet' })).toBeVisible({ timeout: 30000 })
		await page.click('button:has-text("Comments")')
		await expect(page.getByRole('heading', { name: /Comments/i })).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('Please log in to leave a comment')).toBeVisible()
		await expect(page.locator('textarea').first()).not.toBeVisible()
	})

	test('unauthenticated user cannot see reply or delete buttons', async ({ page }) => {
		await page.goto(`/products/${TEST_PRODUCT_ADDRESS}`)
		await expect(page.locator('h1').filter({ hasText: 'Bitcoin Hardware Wallet' })).toBeVisible({ timeout: 30000 })
		await page.click('button:has-text("Comments")')
		await expect(page.getByRole('heading', { name: /Comments/i })).toBeVisible({ timeout: 10000 })
		await expect(page.getByText('Please log in to leave a comment')).toBeVisible()
		await expect(page.locator('button:has-text("Reply")')).toHaveCount(0)
		await expect(page.locator('button svg.lucide-trash-2')).toHaveCount(0)
	})

	test('unauthenticated user sees comments but no interaction buttons', async ({ merchantPage, page }) => {
		await merchantPage.goto(`/products/${TEST_PRODUCT_ADDRESS}`, { waitUntil: 'networkidle' })
		await expect(merchantPage.locator('h1').filter({ hasText: 'Bitcoin Hardware Wallet' })).toBeVisible({ timeout: 30000 })
		await merchantPage.click('button:has-text("Comments")')
		await expect(merchantPage.getByRole('heading', { name: /Comments/i })).toBeVisible({ timeout: 10000 })

		const commentText = `Visible to all ${Date.now()}`
		await merchantPage.locator('textarea').first().pressSequentially(commentText)
		await expect(merchantPage.locator('button:has-text("Post Comment")')).toBeEnabled()
		await merchantPage.click('button:has-text("Post Comment")')
		await expect(merchantPage.locator(`text=${commentText}`)).toBeVisible({ timeout: 15000 })

		await page.goto(`/products/${TEST_PRODUCT_ADDRESS}`, { waitUntil: 'networkidle' })
		await expect(page.locator('h1').filter({ hasText: 'Bitcoin Hardware Wallet' })).toBeVisible({ timeout: 30000 })
		await page.click('button:has-text("Comments")')
		await expect(page.getByRole('heading', { name: /Comments/i })).toBeVisible({ timeout: 10000 })

		await expect(page.locator(`text=${commentText}`)).toBeVisible({ timeout: 15000 })
		await expect(page.getByText('Please log in to leave a comment')).toBeVisible()
	})
})
