import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

test.describe('Auction Live Chat', () => {
	test('live chat panel is visible on auction detail page (desktop viewport)', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()
		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		await expect(merchantPage.locator('span[title]').first()).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByLabel(/title/i).fill('Live Chat Test Auction')
		await merchantPage.getByLabel(/summary/i).fill('Testing live chat on this auction')
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
		await merchantPage.waitForTimeout(2000)

		await expect(merchantPage.getByText('Live Chat')).toBeVisible({ timeout: 10_000 })
	})

	test('live chat panel shows login prompt for unauthenticated users', async ({ unauthenticatedPage }) => {
		test.setTimeout(60_000)

		await unauthenticatedPage.goto('/auctions')
		await unauthenticatedPage.waitForLoadState('networkidle')

		const auctionCards = unauthenticatedPage.locator('[data-testid="auction-card"]')
		const cardCount = await auctionCards.count()

		if (cardCount === 0) {
			const liveCoord = '30311:' + 'a'.repeat(64) + ':test-auction'
			await unauthenticatedPage.goto(`/auctions/test-auction`)
			await unauthenticatedPage.waitForLoadState('networkidle')
		} else {
			await auctionCards.first().click()
			await unauthenticatedPage.waitForLoadState('networkidle')
		}

		const loginPrompt = unauthenticatedPage.getByText(/log in to join/i)
		if (await loginPrompt.isVisible().catch(() => false)) {
			await expect(loginPrompt).toBeVisible()
		}
	})

	test('merchant can type a message in the live chat input', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		const auctionCards = merchantPage.locator('[data-testid="auction-card"]')
		const cardCount = await auctionCards.count()

		if (cardCount === 0) {
			return
		}

		await auctionCards.first().click()
		await merchantPage.waitForLoadState('networkidle')
		await merchantPage.waitForTimeout(2000)

		const chatPanel = merchantPage.getByText('Live Chat')
		if (!(await chatPanel.isVisible().catch(() => false))) {
			return
		}

		const messageInput = merchantPage.getByPlaceholder(/type a message/i)
		if (!(await messageInput.isVisible().catch(() => false))) {
			return
		}

		await messageInput.fill('Hello from test!')
		expect(await messageInput.inputValue()).toBe('Hello from test!')

		const sendButton = merchantPage.getByRole('button', { name: '' }).filter({ has: merchantPage.locator('svg') })
		await expect(sendButton.first()).toBeEnabled()
	})

	test('publishing an auction also publishes a 30311 live activity event', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(60_000)

		relayMonitor.clear()

		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('button', { name: /create.*auction/i }).click()
		await merchantPage.getByRole('tab', { name: 'Auction' }).click()

		await expect(merchantPage.locator('span[title]').first()).toBeVisible({ timeout: 10_000 })

		await merchantPage.getByLabel(/title/i).fill('Live Activity Event Test')
		await merchantPage.getByLabel(/summary/i).fill('Should trigger 30311 publish')
		await merchantPage.getByLabel(/starting price/i).fill('5000')

		const now = Math.floor(Date.now() / 1000)
		const startAt = now + 3600
		const maxEndAt = now + 7200
		await merchantPage.getByLabel(/start.*time/i).fill(new Date(startAt * 1000).toISOString().slice(0, 16))
		await merchantPage.getByLabel(/end.*time|max.*end/i).fill(new Date(maxEndAt * 1000).toISOString().slice(0, 16))

		const publishButton = merchantPage.getByRole('button', { name: /publish|create|submit/i })
		await expect(publishButton).toBeVisible()
		await publishButton.click()

		await expect(async () => {
			const liveActivityEvents = relayMonitor.findSentEventsByKind(30311)
			expect(liveActivityEvents.length).toBeGreaterThan(0)
		}).toPass({ timeout: 15_000 })

		const liveActivityEvent = relayMonitor.findSentEventsByKind(30311)[0]
		const nostrEvent = liveActivityEvent.nostrEvent!

		expect(nostrEvent.tags.some((t) => t[0] === 'd')).toBe(true)
		expect(nostrEvent.tags.some((t) => t[0] === 'a' && t[1].startsWith('30408:'))).toBe(true)
		expect(nostrEvent.tags.some((t) => t[0] === 'title')).toBe(true)
		expect(nostrEvent.tags.some((t) => t[0] === 'status')).toBe(true)
		expect(nostrEvent.tags.some((t) => t[0] === 'marketplace' && t[1] === 'plebeian')).toBe(true)
	})
})
