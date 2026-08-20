/**
 * E2E tests for media rendering: a video `image` tag must render a
 * <video> player, and an `image` tag must render an <img>. Guards the
 * shared <Media> component (Scope A) against regressions.
 */
import { test, expect } from '../fixtures'
import { RELAY_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, XPUB } from '../../src/lib/fixtures'

useWebSocketImplementation(WebSocket)

const VIDEO_URL = 'https://media.example.invalid/video.mp4'
const IMAGE_URL = 'https://placehold.co/600x600/png?text=Image'

async function seedMediaAuction(relay: Relay) {
	const now = Math.floor(Date.now() / 1000)
	const d = `media-test-${now}`
	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'Media rendering test auction',
			tags: [
				['d', d],
				['title', 'Media Test Auction'],
				['summary', 'Auction with a video and an image'],
				['auction_type', 'english'],
				['start_at', String(now - 60)],
				['end_at', String(now + 3600)],
				['max_end_at', String(now + 7200)],
				['currency', 'SAT'],
				['price', '100', 'SAT'],
				['starting_bid', '100', 'SAT'],
				['bid_increment', '50'],
				['reserve', '0'],
				['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
				['key_scheme', 'hd_p2pk'],
				['p2pk_xpub', XPUB],
				['auditors', TEST_APP_PUBLIC_KEY],
				['auditor_quorum', '1'],
				['settlement_grace', '7200'],
				['extension_rule', 'none'],
				['schema', 'auction_v1'],
				['image', VIDEO_URL, '1280x720', '0'],
				['image', IMAGE_URL, '600x600', '1'],
			],
		},
		hexToBytes(devUser1.sk),
	)
	await relay.publish(event)
	return event
}

test.describe('media rendering', () => {
	test('auction renders a <video> player for a video image URL', async ({ page }) => {
		// Intercept the fake video src so no real external request is made;
		// the assertion is on the <video> element, not on playback.
		await page.route('**/video.mp4', (route) => route.abort())

		const relay = await Relay.connect(RELAY_URL)
		const auction = await seedMediaAuction(relay)
		await page.goto(`/auctions/${auction.id}`)
		await expect(page.locator('h1')).toContainText('Media Test Auction', { timeout: 20_000 })
		await expect(page.locator('video').first()).toBeVisible({ timeout: 20_000 })
		await relay.close()
	})

	test('auction renders an <img> for an image URL in the gallery', async ({ page }) => {
		const relay = await Relay.connect(RELAY_URL)
		const auction = await seedMediaAuction(relay)
		await page.goto(`/auctions/${auction.id}`)
		await expect(page.locator('h1')).toContainText('Media Test Auction', { timeout: 20_000 })
		// The image is the second gallery item; its thumbnail (always visible) is an <img>.
		await expect(page.locator('img[alt*="thumbnail 2"]').first()).toBeVisible({ timeout: 20_000 })
		await relay.close()
	})
})
