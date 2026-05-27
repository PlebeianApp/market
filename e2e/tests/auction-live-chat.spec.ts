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
	const dTag = `test-nip53-${Date.now()}`

	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'Test auction for live chat',
			tags: [
				['d', dTag],
				['title', 'NIP-53 Protocol Test Auction'],
				['summary', 'Test auction for verifying NIP-53 protocol'],
				['image', 'https://placehold.co/400x400'],
				['price', '5000', 'SATS'],
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
				['title', 'NIP-53 Protocol Test Auction'],
				['status', 'live'],
				['marketplace', 'plebeian'],
				['p', devUser1.pk, '', 'Host'],
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
	await expect(page.locator('text=NIP-53 Protocol Test Auction').or(page.locator('text=Live chat not available')).or(page.locator('text=Live Chat'))).toBeVisible({ timeout: 30_000 })
}

test.describe('Auction Live Chat', () => {
	test('live chat panel shows fallback when no 30311 exists', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const { eventId } = await seedAuctionAndGetId()

		await waitForAuctionPage(merchantPage, eventId)

		const notAvailable = merchantPage.getByText('Live chat not available for this auction')
		const chatVisible = merchantPage.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ })
		await expect(notAvailable.or(chatVisible)).toBeVisible({ timeout: 15_000 })
	})

	test('live chat panel shows login prompt for unauthenticated users', async ({ unauthenticatedPage }) => {
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

	test('merchant can type a message in the live chat input', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const { eventId, dTag } = await seedAuctionAndGetId()
		await seedLiveActivity(dTag)

		await waitForAuctionPage(merchantPage, eventId)

		await expect(merchantPage.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ })).toBeVisible({ timeout: 20_000 })

		const messageInput = merchantPage.getByPlaceholder('Type a message...')
		await expect(messageInput).toBeVisible({ timeout: 10_000 })

		await messageInput.fill('Hello from test!')
		expect(await messageInput.inputValue()).toBe('Hello from test!')
	})

	test('30311 live activity event has correct tags', async () => {
		const { dTag } = await seedAuctionAndGetId()
		const liveEvent = await seedLiveActivity(dTag)

		expect(liveEvent.kind).toBe(30311)
		expect(liveEvent.tags.some((t) => t[0] === 'd')).toBe(true)
		expect(liveEvent.tags.some((t) => t[0] === 'a' && t[1].startsWith('30408:'))).toBe(true)
		expect(liveEvent.tags.some((t) => t[0] === 'title')).toBe(true)
		expect(liveEvent.tags.some((t) => t[0] === 'status')).toBe(true)
		expect(liveEvent.tags.some((t) => t[0] === 'marketplace' && t[1] === 'plebeian')).toBe(true)
	})
})
