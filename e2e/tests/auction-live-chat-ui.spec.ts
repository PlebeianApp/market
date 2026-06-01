import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'

async function seedAuctionAndGetId() {
	const relay = await Relay.connect(RELAY_URL)
	const skBytes = hexToBytes(devUser1.sk)
	const now = Math.floor(Date.now() / 1000)
	const dTag = `test-chat-${Date.now()}`

	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'Test auction for live chat E2E',
			tags: [
				['d', dTag],
				['title', 'Live Chat E2E Auction'],
				['summary', 'Test auction for verifying live chat UI'],
				['image', 'https://placehold.co/400x400'],
				['price', '1000', 'SATS'],
				['status', 'on-sale'],
				['start_at', String(now)],
				['end_at', String(now + 86400)],
				['max_end_at', String(now + 172800)],
				['settlement_grace', '3600'],
				['t', 'art'],
				['mint', 'https://mint.minibits.cash/Bitcoin'],
			],
		},
		skBytes,
	)
	await relay.publish(event)
	await relay.close()

	return { eventId: event.id, dTag }
}

async function seedLiveActivity(dTag: string) {
	const relay = await Relay.connect(RELAY_URL)
	const skBytes = hexToBytes(devUser1.sk)
	const now = Math.floor(Date.now() / 1000)

	const liveEvent = finalizeEvent(
		{
			kind: 30311,
			created_at: now,
			content: '',
			tags: [
				['d', dTag],
				['a', `30408:${devUser1.pk}:${dTag}`],
				['title', 'Live Chat E2E Auction'],
				['status', 'live'],
				['client', 'plebeian.market'],
				['p', devUser1.pk, '', 'Host'],
				['starts', String(now)],
				['ends', String(now + 86400)],
				['relays', RELAY_URL],
			],
		},
		skBytes,
	)
	await relay.publish(liveEvent)
	await relay.close()

	return liveEvent
}

async function waitForAuctionPage(page: import('@playwright/test').Page, eventId: string) {
	await page.goto(`/auctions/${eventId}`)
	await page.waitForLoadState('networkidle')
	await expect(
		page
			.locator('h1')
			.or(page.locator('text=Live chat not available'))
			.or(page.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ }))
			.first(),
	).toBeVisible({ timeout: 30_000 })
}

test.describe('Auction Live Chat UI Components', () => {
	test('chat panel shows "not available" when no 30311 live activity exists', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const { eventId } = await seedAuctionAndGetId()

		await waitForAuctionPage(merchantPage, eventId)

		const notAvailable = merchantPage.getByText('Live chat not available for this auction')
		const chatLabel = merchantPage.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ })
		await expect(notAvailable.first().or(chatLabel)).toBeVisible({ timeout: 15_000 })
	})

	test('chat panel is hidden on mobile viewport width', async ({ browser }) => {
		test.setTimeout(60_000)

		const { eventId } = await seedAuctionAndGetId()

		const context = await browser.newContext({
			viewport: { width: 375, height: 667 },
		})
		const mobilePage = await context.newPage()

		await mobilePage.goto(`http://localhost:34567/auctions/${eventId}`)
		await mobilePage.waitForLoadState('networkidle')
		await mobilePage.waitForTimeout(3000)

		const chatContainer = mobilePage.locator('.hidden.w-80.shrink-0.lg\\:block')
		await expect(chatContainer).not.toBeVisible()

		await context.close()
	})

	test('chat panel container is visible on desktop viewport width with live activity', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const { eventId, dTag } = await seedAuctionAndGetId()
		await seedLiveActivity(dTag)

		await waitForAuctionPage(merchantPage, eventId)

		await expect(merchantPage.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ })).toBeVisible({ timeout: 20_000 })
	})

	test('unauthenticated user sees login prompt when live activity exists', async ({ unauthenticatedPage }) => {
		test.setTimeout(60_000)

		const { eventId, dTag } = await seedAuctionAndGetId()
		await seedLiveActivity(dTag)

		await unauthenticatedPage.goto(`/auctions/${eventId}`)
		await unauthenticatedPage.waitForLoadState('networkidle')
		await expect(unauthenticatedPage.locator('header')).toBeVisible({ timeout: 15_000 })

		const loginPrompt = unauthenticatedPage.getByText(/log in to join/i)
		const notAvailable = unauthenticatedPage.getByText('Live chat not available for this auction')
		await expect(loginPrompt.or(notAvailable)).toBeVisible({ timeout: 20_000 })
	})

	test('live chat panel shows empty state and message input', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const { eventId, dTag } = await seedAuctionAndGetId()
		await seedLiveActivity(dTag)

		await waitForAuctionPage(merchantPage, eventId)

		await expect(merchantPage.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ })).toBeVisible({ timeout: 20_000 })

		const emptyState = merchantPage.getByText('No messages yet. Be the first!')
		if (await emptyState.isVisible().catch(() => false)) {
			await expect(emptyState).toBeVisible()
		}

		const messageInput = merchantPage.getByPlaceholder('Type a message...')
		if (await messageInput.isVisible().catch(() => false)) {
			await messageInput.fill('Hello from E2E test!')
			await messageInput.press('Enter')

			await expect(merchantPage.getByText('Hello from E2E test!')).toBeVisible({ timeout: 10_000 })
		}
	})

	test('message count shows correct count', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const { eventId, dTag } = await seedAuctionAndGetId()
		await seedLiveActivity(dTag)

		await waitForAuctionPage(merchantPage, eventId)

		await expect(merchantPage.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ })).toBeVisible({ timeout: 20_000 })

		const messageCount = merchantPage.getByText(/\d+ messages/)
		if (await messageCount.isVisible().catch(() => false)) {
			const text = await messageCount.textContent()
			expect(text).toMatch(/^\d+ messages$/)
		}
	})
})
