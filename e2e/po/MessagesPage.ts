import { type Page, expect } from '@playwright/test'
import { BasePage } from './BasePage'
import { DashboardPage } from './DashboardPage'

export class MessagesPage extends BasePage {
	private readonly conversationItems = this.page.locator('[data-testid="conversation-list-item"]')
	private readonly conversationView = this.page.locator('[data-testid="conversation-view"]')
	private readonly messageTextarea = this.page.locator('[data-testid="message-textarea"]')
	private readonly sendButton = this.page.locator('[data-testid="send-message-button"]')
	private readonly messagesList = this.page.locator('[data-testid="messages-list"]')
	private readonly emptyState = this.page.locator('[data-testid="empty-state"]')

	async goToMessages() {
		const dashboard = new DashboardPage(this.page)
		await dashboard.navigateTo('Messages')
	}

	async expectConversationsVisible() {
		await expect(this.conversationItems.first()).toBeVisible({ timeout: 15000 })
	}

	async getConversationCount() {
		return await this.conversationItems.count()
	}

	async openConversation(index: number) {
		await this.conversationItems.nth(index).click()
		await expect(this.conversationView).toBeVisible({ timeout: 10000 })
	}

	async sendMessage(text: string) {
		await this.messageTextarea.fill(text)
		await this.sendButton.click()
	}

	async expectMessageVisible(text: string) {
		const message = this.messagesList.locator(`text="${text}"`).first()
		await expect(message).toBeVisible({ timeout: 10000 })
	}

	async expectEmptyState() {
		await expect(this.emptyState).toBeVisible()
	}

	async expectNoConversations() {
		await expect(this.conversationItems).toHaveCount(0)
	}
}
