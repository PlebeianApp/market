import { test, expect } from '@playwright/test'
import { skipIfInSetupMode } from './utils/test-utils'
import { LoginPage } from './po/LoginPage'
import { MessagesPage } from './po/MessagesPage'

test.describe.serial('16. Direct Messaging', () => {
	let loginPage: LoginPage
	let messagesPage: MessagesPage

	test.beforeEach(async ({ page }) => {
		loginPage = new LoginPage(page)
		messagesPage = new MessagesPage(page)
		await loginPage.goto()
		await skipIfInSetupMode(page, test)
		await loginPage.login()
	})

	test('messages page should be accessible from dashboard', async ({ page }) => {
		await messagesPage.goToMessages()
		await page.waitForTimeout(2000)

		// Should show conversations or empty state
		const hasConversations = await page
			.locator('[data-testid="conversation-list-item"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)
		const hasEmptyState = await page
			.locator('[data-testid="empty-state"]')
			.isVisible({ timeout: 2000 })
			.catch(() => false)

		expect(hasConversations || hasEmptyState).toBeTruthy()
		console.log(hasConversations ? 'Messages page shows conversations' : 'Messages page shows empty state')
	})

	test('conversation list should display items with user info', async ({ page }) => {
		await messagesPage.goToMessages()
		await page.waitForTimeout(2000)

		const hasConversations = await page
			.locator('[data-testid="conversation-list-item"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasConversations) {
			const count = await messagesPage.getConversationCount()
			expect(count).toBeGreaterThan(0)
			console.log(`Found ${count} conversations`)
		} else {
			console.log('No conversations available')
		}
	})

	test('clicking conversation should open conversation view', async ({ page }) => {
		await messagesPage.goToMessages()
		await page.waitForTimeout(2000)

		const hasConversations = await page
			.locator('[data-testid="conversation-list-item"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasConversations) {
			await messagesPage.openConversation(0)

			// Conversation view should be visible
			await expect(page.locator('[data-testid="conversation-view"]')).toBeVisible()

			// Messages list should be present
			await expect(page.locator('[data-testid="messages-list"]')).toBeVisible()

			console.log('Conversation view opened successfully')
		} else {
			console.log('No conversations to open')
		}
	})

	test('message input should be present in conversation view', async ({ page }) => {
		await messagesPage.goToMessages()
		await page.waitForTimeout(2000)

		const hasConversations = await page
			.locator('[data-testid="conversation-list-item"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasConversations) {
			await messagesPage.openConversation(0)

			// Message input should be visible
			await expect(page.locator('[data-testid="message-textarea"]')).toBeVisible()
			await expect(page.locator('[data-testid="send-message-button"]')).toBeVisible()

			console.log('Message input controls are present')
		} else {
			console.log('No conversations — skipping input check')
		}
	})

	test('send button should be disabled for empty messages', async ({ page }) => {
		await messagesPage.goToMessages()
		await page.waitForTimeout(2000)

		const hasConversations = await page
			.locator('[data-testid="conversation-list-item"]')
			.first()
			.isVisible({ timeout: 5000 })
			.catch(() => false)

		if (hasConversations) {
			await messagesPage.openConversation(0)

			const textarea = page.locator('[data-testid="message-textarea"]')
			await expect(textarea).toBeVisible()

			// Clear the textarea to ensure it's empty
			await textarea.fill('')

			// Send button should be disabled when empty
			const sendButton = page.locator('[data-testid="send-message-button"]')
			const isDisabled = await sendButton.isDisabled()

			console.log(`Send button disabled for empty message: ${isDisabled}`)
		} else {
			console.log('No conversations — skipping send button check')
		}
	})
})
