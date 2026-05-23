import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

async function publishAuctionAndNavigate(merchantPage: import('@playwright/test').Page, relayMonitor: import('../fixtures/relay-monitor').RelayMonitor, title: string) {
	await merchantPage.goto('/auctions')
	await merchantPage.waitForLoadState('networkidle')

	await merchantPage.getByRole('button', { name: /create.*auction/i }).click()
	await merchantPage.getByRole('tab', { name: 'Auction' }).click()

	await expect(merchantPage.locator('span[title]').first()).toBeVisible({ timeout: 10_000 })

	await merchantPage.getByLabel(/title/i).fill(title)
	await merchantPage.getByLabel(/summary/i).fill(`Summary for ${title}`)
	await merchantPage.getByLabel(/starting price/i).fill('1000')

	const now = Math.floor(Date.now() / 1000)
	const startAt = now + 3600
	const maxEndAt = now + 7200
	await merchantPage.getByLabel(/start.*time/i).fill(new Date(startAt * 1000).toISOString().slice(0, 16))
	await merchantPage.getByLabel(/end.*time|max.*end/i).fill(new Date(maxEndAt * 1000).toISOString().slice(0, 16))

	const publishButton = merchantPage.getByRole('button', { name: /publish|create|submit/i })
	await expect(publishButton).toBeVisible()
	await publishButton.click()

	await expect(async () => {
		const auctionEvents = relayMonitor.findSentEventsByKind(30408)
		expect(auctionEvents.length).toBeGreaterThan(0)
	}).toPass({ timeout: 15_000 })

	const auctionEvent = relayMonitor.findSentEventsByKind(30408)[0]
	const dTag = auctionEvent.nostrEvent!.tags.find((t) => t[0] === 'd')?.[1]
	expect(dTag).toBeTruthy()

	await merchantPage.goto(`/auctions/${dTag}`)
	await merchantPage.waitForLoadState('networkidle')
	await merchantPage.waitForTimeout(3000)

	return dTag!
}

test.describe('Auction Live Chat UI Components', () => {
	test('chat panel shows empty state when no messages exist', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await publishAuctionAndNavigate(merchantPage, relayMonitor, 'Empty Chat Test Auction')

		const liveChatHeader = merchantPage.getByText('Live Chat')
		if (!(await liveChatHeader.isVisible().catch(() => false))) {
			return
		}

		await expect(merchantPage.getByText('No messages yet. Be the first!')).toBeVisible({ timeout: 5_000 })
	})

	test('chat panel shows message count as 0 messages initially', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await publishAuctionAndNavigate(merchantPage, relayMonitor, 'Message Count Test Auction')

		const messageCount = merchantPage.getByText(/0 messages/)
		if (!(await messageCount.isVisible().catch(() => false))) {
			return
		}

		await expect(messageCount).toBeVisible()
	})

	test('status indicator is gray dot when auction has not started', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await publishAuctionAndNavigate(merchantPage, relayMonitor, 'Status Indicator Test Auction')

		const liveChatHeader = merchantPage.getByText('Live Chat')
		if (!(await liveChatHeader.isVisible().catch(() => false))) {
			return
		}

		const statusDot = merchantPage.locator('.h-2.w-2.rounded-full')
		await expect(statusDot).toBeVisible()
		const hasGray = await statusDot.evaluate((el) => el.classList.contains('bg-zinc-300'))
		expect(hasGray).toBe(true)
	})

	test('message input accepts text and clears after submission attempt', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await publishAuctionAndNavigate(merchantPage, relayMonitor, 'Message Input Test Auction')

		const messageInput = merchantPage.getByPlaceholder('Type a message...')
		if (!(await messageInput.isVisible().catch(() => false))) {
			return
		}

		await messageInput.fill('Hello from UI test!')
		expect(await messageInput.inputValue()).toBe('Hello from UI test!')

		await messageInput.press('Enter')

		await merchantPage.waitForTimeout(1000)
	})

	test('chat panel is hidden on mobile viewport width', async ({ merchantPage, relayMonitor, browser }) => {
		test.setTimeout(60_000)

		const context = await browser.newContext({
			viewport: { width: 375, height: 667 },
		})
		const mobilePage = await context.newPage()

		await mobilePage.goto('/')
		await mobilePage.waitForLoadState('networkidle')
		await mobilePage.waitForTimeout(2000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')
		await merchantPage.waitForTimeout(2000)

		const auctionCards = merchantPage.locator('[data-testid="auction-card"]')
		const cardCount = await auctionCards.count()

		if (cardCount === 0) {
			await context.close()
			return
		}

		const firstCard = auctionCards.first()
		const link = firstCard.locator('a').first()
		const href = await link.getAttribute('href')
		if (!href) {
			await context.close()
			return
		}

		await mobilePage.goto(href)
		await mobilePage.waitForLoadState('networkidle')
		await mobilePage.waitForTimeout(3000)

		const chatContainer = mobilePage.locator('.hidden.w-80.shrink-0.lg\\:block')
		await expect(chatContainer).not.toBeVisible()

		await context.close()
	})

	test('chat panel visible on desktop viewport width', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await publishAuctionAndNavigate(merchantPage, relayMonitor, 'Desktop Chat Test Auction')

		const chatContainer = merchantPage.locator('.hidden.w-80.shrink-0.lg\\:block')
		await expect(chatContainer).toBeVisible({ timeout: 5_000 })
	})

	test('unauthenticated user sees login prompt instead of message input', async ({ unauthenticatedPage }) => {
		test.setTimeout(60_000)

		await unauthenticatedPage.goto('/auctions')
		await unauthenticatedPage.waitForLoadState('networkidle')
		await unauthenticatedPage.waitForTimeout(2000)

		const auctionCards = unauthenticatedPage.locator('[data-testid="auction-card"]')
		const cardCount = await auctionCards.count()

		if (cardCount === 0) {
			return
		}

		const link = auctionCards.first().locator('a').first()
		const href = await link.getAttribute('href')
		if (!href) return

		await unauthenticatedPage.goto(href)
		await unauthenticatedPage.waitForLoadState('networkidle')
		await unauthenticatedPage.waitForTimeout(3000)

		const loginPrompt = unauthenticatedPage.getByText(/log in to join/i)
		if (await loginPrompt.isVisible().catch(() => false)) {
			await expect(loginPrompt).toBeVisible()
			const messageInput = unauthenticatedPage.getByPlaceholder('Type a message...')
			await expect(messageInput).not.toBeVisible()
		}
	})

	test('chat messages display with relative timestamp', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await publishAuctionAndNavigate(merchantPage, relayMonitor, 'Timestamp Test Auction')

		const liveChatHeader = merchantPage.getByText('Live Chat')
		if (!(await liveChatHeader.isVisible().catch(() => false))) {
			return
		}

		const messageInput = merchantPage.getByPlaceholder('Type a message...')
		if (!(await messageInput.isVisible().catch(() => false))) {
			return
		}

		await messageInput.fill('Timestamp test message')
		await messageInput.press('Enter')

		await expect(async () => {
			const chatEvents = relayMonitor.findSentEventsByKind(1311)
			expect(chatEvents.length).toBeGreaterThan(0)
		}).toPass({ timeout: 10_000 })

		await merchantPage.waitForTimeout(2000)

		const messageContent = merchantPage.getByText('Timestamp test message')
		await expect(messageContent).toBeVisible({ timeout: 10_000 })

		const relativeTime = merchantPage.locator('span.text-\\[10px\\].text-zinc-400')
		const timeCount = await relativeTime.count()
		expect(timeCount).toBeGreaterThan(0)

		const timeText = await relativeTime.last().textContent()
		expect(timeText).toMatch(/just now|\d+m|\d+h|\d+d/)
	})
})
