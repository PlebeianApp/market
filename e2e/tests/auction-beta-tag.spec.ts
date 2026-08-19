import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1 } from '../../src/lib/fixtures'
import { queryRelayEvents, getTagValue, type RelayEvent } from '../utils/relay-query'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a kind-30408 auction event directly to the relay with optional
 * beta tag. Returns the published event plus the d-tag value.
 */
async function seedAuction(opts: { withBetaTag?: boolean; dTag?: string }): Promise<{ event: RelayEvent; dTag: string }> {
	const relay = await Relay.connect(RELAY_URL)
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
		['mint', 'https://mint.minibits.cash/Bitcoin'],
		['key_scheme', 'hd_p2pk'],
		['p2pk_xpub', 'xpub' + '0'.repeat(100)],
		['settlement_policy', 'cashu_p2pk_v1'],
		['schema', 'auction_v1'],
		['image', 'https://placehold.co/400x400'],
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
	await relay.close()

	return { event: event as unknown as RelayEvent, dTag }
}

/**
 * Publish an updated kind-30408 for the same d-tag (replaceable event)
 * with a newer created_at and optionally a beta tag.
 */
async function updateAuction(dTag: string, opts: { withBetaTag?: boolean }): Promise<RelayEvent> {
	const relay = await Relay.connect(RELAY_URL)
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
		['mint', 'https://mint.minibits.cash/Bitcoin'],
		['key_scheme', 'hd_p2pk'],
		['p2pk_xpub', 'xpub' + '0'.repeat(100)],
		['settlement_policy', 'cashu_p2pk_v1'],
		['schema', 'auction_v1'],
		['image', 'https://placehold.co/400x400'],
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
	await relay.close()

	return event as unknown as RelayEvent
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Beta Tag', () => {
	// Test 1.1: Beta tag present in published kind-30408 event
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

	// Test 1.2: Beta tag parsed correctly from relay event and displayed
	test('parses beta tag from seeded kind-30408 event and displays beta indicator', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		// Seed an auction with beta tag
		const { event } = await seedAuction({ withBetaTag: true })

		// Navigate to the auction detail page
		await merchantPage.goto(`/auctions/${event.id}`)
		await merchantPage.waitForLoadState('networkidle')

		// Wait for the auction title to appear
		await expect(merchantPage.locator('h1').first()).toBeVisible({ timeout: 30_000 })

		// Assert the beta badge is visible
		await expect(merchantPage.getByTestId('beta-badge')).toBeVisible({ timeout: 15_000 })
		await expect(merchantPage.getByTestId('beta-badge')).toHaveText(/beta/i)
	})

	// Test 1.2 edge case: no beta tag → no beta indicator
	test('does not display beta indicator for legacy events without beta tag', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		// Seed an auction WITHOUT beta tag (legacy)
		const { event } = await seedAuction({ withBetaTag: false })

		// Navigate to the auction detail page
		await merchantPage.goto(`/auctions/${event.id}`)
		await merchantPage.waitForLoadState('networkidle')

		// Wait for the auction title to appear
		await expect(merchantPage.locator('h1').first()).toBeVisible({ timeout: 30_000 })

		// Assert the beta badge is NOT visible
		await expect(merchantPage.getByTestId('beta-badge')).not.toBeVisible({ timeout: 10_000 })
	})

	// Test 1.3: Beta tag survives auction update (replaceable event)
	test('beta tag persists across auction update publish', async () => {
		test.setTimeout(60_000)

		// Seed initial auction with beta tag
		const { dTag } = await seedAuction({ withBetaTag: true })

		// Publish updated event with beta tag (same d-tag, newer created_at)
		const updatedEvent = await updateAuction(dTag, { withBetaTag: true })

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

		// Event IDs should differ (not duplicates)
		const eventIds = new Set(events.map((e) => e.id))
		expect(eventIds.size).toBeGreaterThanOrEqual(2)
	})

	// Test 1.3 edge case: update without beta tag should not carry it
	test('updated event without beta tag does not have beta tag', async () => {
		test.setTimeout(60_000)

		const { dTag } = await seedAuction({ withBetaTag: true })

		// Publish update WITHOUT beta tag (simulates a non-compliant publisher)
		await updateAuction(dTag, { withBetaTag: false })

		// Query relay for the latest event for this d-tag
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			'#d': [dTag],
			limit: 20,
		})

		expect(events.length).toBeGreaterThanOrEqual(2)

		// Find the latest event
		const latest = events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]

		// Latest event should NOT have the beta tag
		const betaTag = latest.tags.find((t) => t[0] === 'beta')
		expect(betaTag).toBeUndefined()
	})

	// Test 1.4: Relay query verification for beta tag (post-merge)
	test('relay query by beta tag returns only tagged auctions', async () => {
		test.setTimeout(60_000)

		// Seed two auctions — one with beta tag, one without
		const { dTag: betaDTag } = await seedAuction({ withBetaTag: true })
		const { dTag: noBetaDTag } = await seedAuction({ withBetaTag: false })

		// Query relay filtering by #beta tag
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			'#beta': ['true'],
			limit: 50,
		})

		// Should return at least 1 result (the beta-tagged auction)
		expect(events.length).toBeGreaterThanOrEqual(1)

		// All returned events should have the beta tag
		for (const event of events) {
			const betaTag = event.tags.find((t) => t[0] === 'beta' && t[1] === 'true')
			expect(betaTag).toBeDefined()
		}

		// The non-beta auction d-tag should NOT be in the results
		const returnedDTags = events.map((e) => getTagValue(e, 'd')).filter(Boolean)
		expect(returnedDTags).not.toContain(noBetaDTag)

		// The beta auction d-tag SHOULD be in the results
		expect(returnedDTags).toContain(betaDTag)
	})

	// Test 1.4 edge case: query with non-matching beta tag value
	test('relay query with beta false returns no results', async () => {
		test.setTimeout(60_000)

		await seedAuction({ withBetaTag: true })

		// Query relay with #beta: ['false'] — should return 0 results
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			'#beta': ['false'],
			limit: 50,
		})

		expect(events.length).toBe(0)
	})
})