import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'
const AUCTION_KIND = 30408
const AUCTION_BID_KIND = 1023

async function publishEvent(relay: Relay, template: Parameters<typeof finalizeEvent>[0], sk: string) {
	const event = finalizeEvent(template, hexToBytes(sk))
	await relay.publish(event)
	return event
}

async function seedAuction(relay: Relay, sellerSk: string, sellerPk: string, title: string) {
	const now = Math.floor(Date.now() / 1000)
	const dTag = `home-grid-${title}-${Date.now()}`
	const event = await publishEvent(
		relay,
		{
			kind: AUCTION_KIND,
			created_at: now,
			content: `Test auction: ${title}`,
			tags: [
				['d', dTag],
				['title', title],
				['summary', `Test auction for ${title}`],
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
		sellerSk,
	)
	return { eventId: event.id, dTag }
}

async function seedBid(relay: Relay, bidderSk: string, auctionEventId: string, auctionATag: string) {
	const now = Math.floor(Date.now() / 1000)
	return publishEvent(
		relay,
		{
			kind: AUCTION_BID_KIND,
			created_at: now,
			content: '',
			tags: [
				['e', auctionEventId], // auction root event id
				['a', auctionATag], // auction coordinate 30408:<seller>:<d>
				['amount', '6000'],
				['mint', 'https://mint.minibits.cash/Bitcoin'],
				['locktime', String(now + 172800 + 3600)],
			],
		},
		bidderSk,
	)
}

async function gotoAuctions(page: import('@playwright/test').Page) {
	await page.goto('/auctions')
	await page.waitForLoadState('networkidle')
}

test.describe('Auctions home page — Your Auctions & Previously Bid grids', () => {
	test('shows "Your Auctions" for auctions the signed-in user created', async ({ merchantPage }) => {
		test.setTimeout(90_000)
		const relay = await Relay.connect(RELAY_URL)

		// devUser1 (merchant) creates an auction → should appear in "Your Auctions"
		await seedAuction(relay, devUser1.sk, devUser1.pk, 'My Own Auction')
		await relay.close()

		await gotoAuctions(merchantPage)

		const yourAuctionsHeading = merchantPage.getByRole('heading', { name: 'Your Auctions' })
		await expect(yourAuctionsHeading).toBeVisible({ timeout: 30_000 })
	})

	test('shows "You Previously Bid" for auctions the signed-in user bid on', async ({ merchantPage }) => {
		test.setTimeout(90_000)
		const relay = await Relay.connect(RELAY_URL)

		// devUser2 sells an auction; devUser1 (merchant) bids on it
		const { eventId, dTag } = await seedAuction(relay, devUser2.sk, devUser2.pk, 'Bid Target Auction')
		await seedBid(relay, devUser1.sk, eventId, `30408:${devUser2.pk}:${dTag}`)
		await relay.close()

		await gotoAuctions(merchantPage)

		const previouslyBidHeading = merchantPage.getByRole('heading', { name: 'You Previously Bid' })
		await expect(previouslyBidHeading).toBeVisible({ timeout: 30_000 })
	})

	test('does NOT show "Your Auctions" for a user with no auctions', async ({ newUserPage }) => {
		test.setTimeout(60_000)

		await gotoAuctions(newUserPage)

		const yourAuctionsHeading = newUserPage.getByRole('heading', { name: 'Your Auctions' })
		await expect(yourAuctionsHeading).not.toBeVisible({ timeout: 15_000 })
	})
})
