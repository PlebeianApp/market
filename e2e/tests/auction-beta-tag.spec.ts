import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { Page } from '@playwright/test'
import { devUser1 } from '../../src/lib/fixtures'
import { queryRelayEvents, getTagValue, type RelayEvent } from '../utils/relay-query'
import { RELAY_URL } from '../test-config'

test.use({ scenario: 'merchant' })

const __filename = fileURLToPath(import.meta.url)
const LOCAL_IMAGE_PATH = path.join(path.dirname(__filename), '..', 'fixtures', 'test-product-image.png')
const CDN_PLACEHOLDER_IMAGE = 'https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png'

/**
 * Intercepts requests to cdn.satellite.earth and serves a local fixture image
 * (test isolation: no external network calls — see e2e/AGENTS.md).
 */
async function interceptCdnImages(page: Page) {
	await page.route('**/cdn.satellite.earth/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/png',
			path: LOCAL_IMAGE_PATH,
		})
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a kind-30408 auction event directly to the relay with optional
 * beta tag. Returns the published event plus the d-tag value.
 */
async function seedAuctionBeta(opts: { withBetaTag?: boolean; dTag?: string }): Promise<{ event: RelayEvent; dTag: string }> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const skBytes = hexToBytes(devUser1.sk)
		const now = Math.floor(Date.now() / 1000)
		const dTag = opts.dTag ?? `test-beta-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

		const tags: string[][] = [
			['d', dTag],
			['title', `Beta Tag Test Auction ${dTag}`],
			['summary', 'E2E test auction for beta tag'],
			['auction_type', 'english'],
			['start_at', String(now)],
			['end_at', String(now + 86400)],
			['max_end_at', String(now + 172800)],
			['settlement_grace', '3600'],
			['currency', 'SAT'],
			['price', '1000', 'SAT'],
			['starting_bid', '1000', 'SAT'],
			['bid_increment', '100'],
			['reserve', '0'],
			['mint', 'https://nofees.testnut.cashu.space'],
			['auditors', devUser1.pk],
			['auditor_quorum', '1'],
			['max_skew_sec', '120'],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', 'xpub' + '0'.repeat(100)],
			['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
			['schema', 'auction_v1'],
			['image', CDN_PLACEHOLDER_IMAGE],
			['t', 'Bitcoin'],
		]

		if (opts.withBetaTag) {
			tags.push(['beta', 'true'])
		}

		const event = finalizeEvent(
			{
				kind: 30408,
				created_at: now,
				content: 'Test auction for beta tag verification.',
				tags,
			},
			skBytes,
		)

		await relay.publish(event)
		return { event: event as unknown as RelayEvent, dTag }
	} finally {
		await relay.close()
	}
}

/**
 * Publish an updated kind-30408 for the same d-tag (addressable event)
 * with a newer created_at and optionally a beta tag.
 */
async function updateAuctionBeta(dTag: string, opts: { withBetaTag?: boolean }): Promise<RelayEvent> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const skBytes = hexToBytes(devUser1.sk)
		const now = Math.floor(Date.now() / 1000)

		const tags: string[][] = [
			['d', dTag],
			['title', `Beta Tag Test Auction ${dTag} (updated)`],
			['summary', 'E2E test auction for beta tag (updated)'],
			['auction_type', 'english'],
			['start_at', String(now)],
			['end_at', String(now + 86400)],
			['max_end_at', String(now + 172800)],
			['settlement_grace', '3600'],
			['currency', 'SAT'],
			['price', '1200', 'SAT'],
			['starting_bid', '1200', 'SAT'],
			['bid_increment', '100'],
			['reserve', '0'],
			['mint', 'https://nofees.testnut.cashu.space'],
			['auditors', devUser1.pk],
			['auditor_quorum', '1'],
			['max_skew_sec', '120'],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', 'xpub' + '0'.repeat(100)],
			['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
			['schema', 'auction_v1'],
			['image', CDN_PLACEHOLDER_IMAGE],
			['t', 'Bitcoin'],
		]

		if (opts.withBetaTag) {
			tags.push(['beta', 'true'])
		}

		const event = finalizeEvent(
			{
				kind: 30408,
				created_at: now + 1,
				content: 'Updated auction for beta tag persistence test.',
				tags,
			},
			skBytes,
		)

		await relay.publish(event)
		return event as unknown as RelayEvent
	} finally {
		await relay.close()
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Beta Tag', () => {
	// Test 1: Beta tag present in published kind-30408 event via UI
	test('publishes kind-30408 with beta tag when creating auction via UI', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(120_000)

		// Navigate to auctions page and open the create-auction sheet
		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		// Click the "Create Auction" button to open the sheet drawer
		const createButton = merchantPage.getByRole('button', { name: /create auction/i })
		await createButton.click()

		// Wait for the auction form sheet to appear
		const titleInput = merchantPage.getByLabel(/title/i).or(merchantPage.getByPlaceholder(/title/i))
		await titleInput.waitFor({ state: 'visible', timeout: 10_000 })
		await titleInput.fill('E2E Beta Tag Test Auction')

		const summaryInput = merchantPage.getByLabel(/summary/i).or(merchantPage.getByPlaceholder(/summary/i))
		if (await summaryInput.isVisible().catch(() => false)) {
			await summaryInput.fill('Test auction for beta tag e2e')
		}

		// Set end date to tomorrow
		const endAtInput = merchantPage.getByLabel(/end/i).or(merchantPage.getByPlaceholder(/end/i))
		if (await endAtInput.isVisible().catch(() => false)) {
			const tomorrow = new Date(Date.now() + 86400_000)
			await endAtInput.fill(tomorrow.toISOString().slice(0, 16))
		}

		// Set starting bid
		const startingBidInput = merchantPage.getByLabel(/starting bid/i).or(merchantPage.getByPlaceholder(/starting bid/i))
		if (await startingBidInput.isVisible().catch(() => false)) {
			await startingBidInput.fill('1000')
		}

		// Click publish
		const publishButton = merchantPage.getByRole('button', { name: /publish|create|submit/i }).first()
		await publishButton.click()

		// Wait for the kind-30408 event to be sent via relay
		const capturedEvent = await relayMonitor.waitForEvent({
			kind: 30408,
			direction: 'sent',
			timeout: 60_000,
		})

		expect(capturedEvent).not.toBeNull()
		expect(capturedEvent!.nostrEvent).not.toBeNull()
		const auctionEvent = capturedEvent!.nostrEvent!

		expect(auctionEvent.kind).toBe(30408)

		// Assert the event has a valid d tag
		const dTag = auctionEvent.tags.find((t) => t[0] === 'd')
		expect(dTag).toBeDefined()
		expect(dTag![1]).toBeTruthy()

		// Assert the event has the beta tag
		const betaTag = auctionEvent.tags.find((t) => t[0] === 'beta' && t[1] === 'true')
		expect(betaTag).toBeDefined()
		expect(betaTag).toEqual(['beta', 'true'])
	})

	// Test 2: Beta tag parsed from seeded event and displayed as badge
	test('parses beta tag from seeded kind-30408 event and displays beta indicator', async ({ merchantPage }) => {
		test.setTimeout(60_000)
		await interceptCdnImages(merchantPage)

		// Seed an auction with beta tag
		const { event } = await seedAuctionBeta({ withBetaTag: true })

		// Navigate to the auction detail page
		await merchantPage.goto(`/auctions/${event.id}`)
		await merchantPage.waitForLoadState('networkidle')

		// Wait for the auction title to appear
		await expect(merchantPage.locator('h1').first()).toBeVisible({ timeout: 30_000 })

		// Assert the beta badge is visible
		await expect(merchantPage.getByTestId('beta-badge')).toBeVisible({ timeout: 15_000 })
		await expect(merchantPage.getByTestId('beta-badge')).toHaveText(/beta/i)
	})

	// Test 3: No beta tag → no badge
	test('parses auction event WITHOUT beta tag — no badge displayed', async ({ merchantPage }) => {
		test.setTimeout(60_000)
		await interceptCdnImages(merchantPage)

		// Seed an auction WITHOUT beta tag (legacy)
		const { event } = await seedAuctionBeta({ withBetaTag: false })

		// Navigate to the auction detail page
		await merchantPage.goto(`/auctions/${event.id}`)
		await merchantPage.waitForLoadState('networkidle')

		// Wait for the auction title to appear
		await expect(merchantPage.locator('h1').first()).toBeVisible({ timeout: 30_000 })

		// Assert the beta badge is NOT visible
		await expect(merchantPage.getByTestId('beta-badge')).not.toBeVisible({ timeout: 10_000 })
	})

	// Test 4: Beta tag survives auction update (addressable replaceable event)
	test('beta tag persists across auction update publish', async () => {
		test.setTimeout(60_000)

		// Seed initial auction with beta tag
		const { dTag } = await seedAuctionBeta({ withBetaTag: true })

		// Publish updated event with beta tag (same d-tag, newer created_at)
		const updatedEvent = await updateAuctionBeta(dTag, { withBetaTag: true })

		// Query relay for kind-30408 by d-tag
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			'#d': [dTag],
			limit: 20,
		})

		// Should have at least 2 events (original + update)
		expect(events.length).toBeGreaterThanOrEqual(2)

		// Find the latest event (highest created_at)
		const latest = events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]

		// Latest event should have the beta tag
		const betaTag = latest.tags.find((t) => t[0] === 'beta' && t[1] === 'true')
		expect(betaTag).toBeDefined()
		expect(betaTag).toEqual(['beta', 'true'])

		// The latest event ID should match the updated event
		expect(latest.id).toBe(updatedEvent.id)
	})

	// Test 5: Beta-tagged and untagged auctions are distinguishable by tag
	// ('beta' is not a single-letter tag, so #beta is not a valid NIP-01
	// filter — clients must fetch by author/kind and filter client-side.)
	test('beta tag distinguishes tagged from untagged auctions when querying by author', async () => {
		test.setTimeout(60_000)

		// Seed two auctions — one with beta tag, one without
		const { dTag: betaDTag } = await seedAuctionBeta({ withBetaTag: true })
		const { dTag: noBetaDTag } = await seedAuctionBeta({ withBetaTag: false })

		// Query relay for this author's auctions (valid NIP-01 filter)
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			limit: 100,
		})

		// Filter client-side by the beta tag, as consumers must
		const betaEvents = events.filter((e) => e.tags.some((t) => t[0] === 'beta' && t[1] === 'true'))
		expect(betaEvents.length).toBeGreaterThanOrEqual(1)
		for (const event of betaEvents) {
			expect(event.tags.find((t) => t[0] === 'beta' && t[1] === 'true')).toBeDefined()
		}

		const betaDTags = betaEvents.map((e) => getTagValue(e, 'd')).filter(Boolean)
		expect(betaDTags).toContain(betaDTag)
		expect(betaDTags).not.toContain(noBetaDTag)

		// The untagged auction is still on the relay, just without the tag
		const allDTags = events.map((e) => getTagValue(e, 'd')).filter(Boolean)
		expect(allDTags).toContain(noBetaDTag)
	})
})
