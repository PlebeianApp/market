import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { LIVE_ACTIVITY_KIND, buildLiveActivityDTag, isWithinRelayTagIndexBudget } from '../../src/lib/nip53'
import { TEST_CVM_PRIVATE_KEY, TEST_CVM_PUBLIC_KEY } from '../test-config'

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
				// Every REQUIRED tag (AUCTIONS.md §4.1) — the feed is gated on spec
				// validity, so a fixture missing `starting_bid` would not be an
				// auction the app is willing to list.
				['d', dTag],
				['title', 'NIP-53 Protocol Test Auction'],
				['summary', 'Test auction for verifying NIP-53 protocol'],
				['auction_type', 'english'],
				['currency', 'SAT'],
				['image', 'https://placehold.co/400x400'],
				['price', '5000', 'SATS'],
				['status', 'on-sale'],
				['start_at', String(now)],
				['end_at', String(now + 86400)],
				['max_end_at', String(now + 172800)],
				['settlement_grace', '3600'],
				['starting_bid', '5000'],
				['bid_increment', '100'],
				['reserve', '0'],
				['key_scheme', 'hd_p2pk'],
				['p2pk_xpub', 'xpub' + '0'.repeat(100)],
				['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
				['auditors', devUser2.pk],
				['auditor_quorum', '1'],
				['schema', 'auction_v1'],
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
	// The activity is authored by the configured ContextVM identity, not by the
	// seller: the reader fails closed on any other author. See
	// TEST_CVM_PRIVATE_KEY.
	const skBytes = hexToBytes(TEST_CVM_PRIVATE_KEY)
	const now = Math.floor(Date.now() / 1000)
	const auctionCoord = `30408:${devUser1.pk}:${dTag}`
	// The activity's `d` is derived from the auction coordinate
	// (`auction:<12-hex digest>`), and the activity's `a` tag carries the full
	// auction coordinate back. Both stay inside the relay tag-index budget.
	const activityDTag = buildLiveActivityDTag(auctionCoord)

	const liveEvent = finalizeEvent(
		{
			kind: 30311,
			created_at: now,
			content: '',
			tags: [
				['d', activityDTag],
				['a', auctionCoord],
				['title', 'NIP-53 Protocol Test Auction'],
				['status', 'live'],
				['client', 'plebeian.market'],
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
	await expect(
		page
			.locator('h1')
			.or(page.locator('text=Live chat not available'))
			.or(page.locator('span.text-sm.font-medium', { hasText: /^Live Chat$/ }))
			.first(),
	).toBeVisible({ timeout: 30_000 })
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
		expect(liveEvent.tags.some((t) => t[0] === 'client' && t[1] === 'plebeian.market')).toBe(true)

		// Addressing contract: the activity's `d` is the digest derived from the
		// auction coordinate, the `a` tag is that full coordinate (2-way
		// reachability), and the activity's own coordinate — the value chat
		// messages carry in their `a` tag — fits the relay tag-index budget. The
		// retired format produced 123 characters here and was therefore
		// unreachable through any `#a` lookup on our relays.
		const auctionCoord = `30408:${devUser1.pk}:${dTag}`
		const activityCoord = `${LIVE_ACTIVITY_KIND}:${TEST_CVM_PUBLIC_KEY}:${buildLiveActivityDTag(auctionCoord)}`

		expect(liveEvent.pubkey).toBe(TEST_CVM_PUBLIC_KEY)
		expect(liveEvent.tags.find((t) => t[0] === 'd')?.[1]).toBe(buildLiveActivityDTag(auctionCoord))
		expect(liveEvent.tags.find((t) => t[0] === 'a')?.[1]).toBe(auctionCoord)
		expect(isWithinRelayTagIndexBudget(activityCoord)).toBe(true)
		expect(activityCoord.length).toBeLessThanOrEqual(100)
	})
})
