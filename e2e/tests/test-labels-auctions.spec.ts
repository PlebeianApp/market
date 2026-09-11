import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1 } from '../../src/lib/fixtures'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'

// ---------------------------------------------------------------------------
// Relay helpers — publish kind 1985 label events (mirrors test-labels.spec.ts)
// ---------------------------------------------------------------------------

async function connectRelay(): Promise<Relay> {
	return await Relay.connect(RELAY_URL)
}

async function publishEvent(skHex: string, template: EventTemplate): Promise<VerifiedEvent> {
	const relay = await connectRelay()
	try {
		const event = finalizeEvent(template, hexToBytes(skHex))
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

/**
 * Publish a NIP-32 test label (kind 1985) for an item coordinate.
 * Tags: L/l in com.plebeian.market namespace + a single a-tag target.
 * No p tag (would label the user — out of ADR-0009 scope).
 */
async function seedTestLabel(
	skHex: string,
	coordinate: string,
	content = 'Marked as test listing by the e2e suite.',
): Promise<VerifiedEvent> {
	return await publishEvent(skHex, {
		kind: 1985,
		created_at: Math.floor(Date.now() / 1000),
		content,
		tags: [
			['L', 'com.plebeian.market'],
			['l', 'test', 'com.plebeian.market'],
			['a', coordinate],
		],
	})
}

const auctionCoordinate = (auctionEvent: VerifiedEvent): string =>
	`30408:${auctionEvent.pubkey}:${auctionEvent.tags.find((t) => t[0] === 'd')?.[1]}`

// ---------------------------------------------------------------------------
// Navigation helper — resilient SPA navigation (mirrors marketplace.spec.ts)
// ---------------------------------------------------------------------------

async function safeGoto(page: Page, url: string): Promise<void> {
	const targetPath = url.split('?')[0]

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto(url)
		} catch (error) {
			const msg = String(error)
			if (!msg.includes('interrupted by another navigation') && !msg.includes('ERR_ABORTED')) throw error
			await page.waitForLoadState('networkidle').catch(() => {})
		}

		await page.waitForTimeout(1000)
		await page.waitForLoadState('networkidle').catch(() => {})

		const currentPath = new URL(page.url()).pathname
		if (currentPath === targetPath || currentPath.startsWith(targetPath)) {
			return
		}
	}

	await page.goto(url)
}

// ---------------------------------------------------------------------------
// Auction scenario — kind-30408 coordinates are gated from the auctions feed
// ---------------------------------------------------------------------------

test.describe('Test listing labels — auctions (ADR-0009)', () => {
	test('auction with an active test label is excluded from the auctions feed', async ({ unauthenticatedPage }) => {
		const now = Math.floor(Date.now() / 1000)
		const suffix = `${now}-${Math.random().toString(36).substring(2, 8)}`

		// Two auctions: a control (visible) and one that gets labeled (hidden)
		const seedAuctionEvent = async (title: string, dTag: string): Promise<VerifiedEvent> =>
			await publishEvent(devUser1.sk, {
				kind: 30408,
				created_at: now,
				content: 'Auction used by the ADR-0009 test-label e2e suite.',
				tags: [
					['d', dTag],
					['title', title],
					['summary', 'E2E test auction'],
					['auction_type', 'english'],
					['start_at', String(now)],
					['end_at', String(now + 86400)],
					['currency', 'SAT'],
					['price', '1000', 'SAT'],
					['starting_bid', '1000', 'SAT'],
					['bid_increment', '100'],
					['reserve', '0'],
					['mint', 'http://localhost:3338'],
					['escrow_pubkey', '02' + '00'.repeat(32)],
					['key_scheme', 'hd_p2pk'],
					['p2pk_xpub', 'xpub' + '0'.repeat(100)],
					['settlement_policy', 'cashu_p2pk_v1'],
					['schema', 'auction_v1'],
					['image', 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png'],
					['t', 'Bitcoin'],
				],
			})

		const controlAuction = await seedAuctionEvent(`Control Auction ${suffix}`, `test-label-auction-control-${suffix}`)
		const labeledAuction = await seedAuctionEvent(`Labeled Auction ${suffix}`, `test-label-auction-labeled-${suffix}`)

		await seedTestLabel(devUser1.sk, auctionCoordinate(labeledAuction))

		await safeGoto(unauthenticatedPage, '/auctions')
		await expect(unauthenticatedPage.getByText(controlAuction.tags.find((t) => t[0] === 'title')?.[1] ?? '')).toBeVisible({
			timeout: 30_000,
		})

		await expect(unauthenticatedPage.getByText(labeledAuction.tags.find((t) => t[0] === 'title')?.[1] ?? '')).toHaveCount(0)
	})
})
