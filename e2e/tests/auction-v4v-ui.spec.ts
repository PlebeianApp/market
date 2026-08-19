import { test, expect } from '../fixtures'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { queryRelayEvents, getTagValue, type RelayEvent } from '../utils/relay-query'
import { RELAY_URL } from '../test-config'
import { seedV4VWithRecipients } from '../scenarios'

test.use({ scenario: 'merchant' })

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** V4V split recipients used across tests — devUser2 + devUser1 as recipients */
const V4V_RECIPIENTS = [
	{ pubkey: devUser2.pk, splitPercent: '60' },
	{ pubkey: devUser1.pk, splitPercent: '40' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a kind-30408 auction event directly to the relay with V4V split
 * recipient tags. Each tag follows the format:
 *   ['v4v', recipientPubkey, splitPercent]
 *
 * Returns the published event plus the d-tag value.
 */
async function seedAuctionWithV4V(opts?: {
	dTag?: string
	recipients?: Array<{ pubkey: string; splitPercent: string }>
}): Promise<{ event: RelayEvent; dTag: string }> {
	const relay = await Relay.connect(RELAY_URL)
	const skBytes = hexToBytes(devUser1.sk)
	const now = Math.floor(Date.now() / 1000)
	const dTag = opts?.dTag ?? `test-v4v-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
	const recipients = opts?.recipients ?? V4V_RECIPIENTS

	const tags: string[][] = [
		['d', dTag],
		['title', `V4V Test Auction ${dTag}`],
		['summary', 'E2E test auction for V4V split recipients'],
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
		['beta', 'true'],
		['schema', 'auction_v1'],
		['image', 'https://placehold.co/400x400'],
		['t', 'Bitcoin'],
	]

	// Append V4V split recipient tags
	for (const r of recipients) {
		tags.push(['v4v', r.pubkey, r.splitPercent])
	}

	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'Test auction for V4V split recipient verification.',
			tags,
		},
		skBytes,
	)

	await relay.publish(event)
	await relay.close()

	return { event: event as unknown as RelayEvent, dTag }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction V4V UI', () => {
	// Test 1: V4V recipients displayed on the auction detail page
	test('displays V4V recipients on auction detail page', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		// Seed an auction with V4V split recipients
		const { event } = await seedAuctionWithV4V()

		// Navigate to the auction detail page
		await merchantPage.goto(`/auctions/${event.id}`)
		await merchantPage.waitForLoadState('networkidle')

		// Wait for the auction title to appear
		await expect(merchantPage.locator('h1').first()).toBeVisible({ timeout: 30_000 })

		// Assert V4V recipients section is visible
		const v4vSection = merchantPage.getByTestId('auction-v4v-recipients')
		await expect(v4vSection).toBeVisible({ timeout: 15_000 })

		// Assert each recipient is shown with their split percentage
		for (const recipient of V4V_RECIPIENTS) {
			const recipientItem = v4vSection.getByTestId(`v4v-recipient-${recipient.pubkey}`)
			await expect(recipientItem).toBeVisible({ timeout: 10_000 })

			// Assert the recipient's percentage is displayed
			const expectedPct = parseInt(recipient.splitPercent, 10)
			await expect(recipientItem).toContainText(`${expectedPct}%`)
		}
	})

	// Test 2: V4V tags emitted when publishing auction via UI
	test('emits V4V tags when publishing auction via UI', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(120_000)

		// Seed V4V configuration for the merchant so the form has recipients
		await seedV4VWithRecipients(devUser1.sk, [
			{ pubkey: devUser2.pk, percentage: 0.6 },
			{ pubkey: devUser1.pk, percentage: 0.4 },
		])

		// Navigate to auctions page and open the create-auction sheet
		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		// Click the "Create Auction" button to open the sheet drawer
		const createButton = merchantPage.getByRole('button', { name: /create auction/i })
		await createButton.click()

		// Wait for the auction form sheet to appear
		const titleInput = merchantPage.getByLabel(/title/i).or(merchantPage.getByPlaceholder(/title/i))
		await titleInput.waitFor({ state: 'visible', timeout: 10_000 })
		await titleInput.fill('E2E V4V Tags Test Auction')

		const summaryInput = merchantPage.getByLabel(/summary/i).or(merchantPage.getByPlaceholder(/summary/i))
		if (await summaryInput.isVisible().catch(() => false)) {
			await summaryInput.fill('Test auction for V4V tag emission e2e')
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

		// Assert V4V tags are present for each recipient
		const v4vTags = auctionEvent.tags.filter((t) => t[0] === 'v4v')
		expect(v4vTags.length).toBeGreaterThanOrEqual(V4V_RECIPIENTS.length)

		// Verify each expected recipient has a matching v4v tag
		for (const recipient of V4V_RECIPIENTS) {
			const matchingTag = v4vTags.find((t) => t[1] === recipient.pubkey)
			expect(matchingTag).toBeDefined()
			expect(matchingTag![0]).toBe('v4v')
			expect(matchingTag![1]).toBe(recipient.pubkey)
			// The splitPercent should be present as the third element
			expect(matchingTag![2]).toBeTruthy()
		}
	})

	// Test 3: V4V tags parsed from seeded relay event and displayed on detail page
	test('parses V4V tags from seeded relay event', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		// Seed an auction with specific V4V tags
		const customRecipients = [
			{ pubkey: devUser2.pk, splitPercent: '70' },
			{ pubkey: devUser1.pk, splitPercent: '30' },
		]
		const { event, dTag } = await seedAuctionWithV4V({ recipients: customRecipients })

		// Verify the seeded event has V4V tags via direct relay query
		const events = await queryRelayEvents({
			kinds: [30408],
			authors: [devUser1.pk],
			'#d': [dTag],
			limit: 10,
		})

		expect(events.length).toBeGreaterThanOrEqual(1)

		// Find the latest event (highest created_at)
		const latest = events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]

		// Assert V4V tags are present in the seeded event
		const v4vTags = latest.tags.filter((t) => t[0] === 'v4v')
		expect(v4vTags.length).toBe(customRecipients.length)

		for (let i = 0; i < customRecipients.length; i++) {
			const expected = customRecipients[i]
			const tag = v4vTags.find((t) => t[1] === expected.pubkey)
			expect(tag).toBeDefined()
			expect(tag).toEqual(['v4v', expected.pubkey, expected.splitPercent])
		}

		// Navigate to the auction detail page
		await merchantPage.goto(`/auctions/${event.id}`)
		await merchantPage.waitForLoadState('networkidle')

		// Wait for the auction title to appear
		await expect(merchantPage.locator('h1').first()).toBeVisible({ timeout: 30_000 })

		// Assert V4V recipients section is visible
		const v4vSection = merchantPage.getByTestId('auction-v4v-recipients')
		await expect(v4vSection).toBeVisible({ timeout: 15_000 })

		// Assert each recipient matches the seeded data
		for (const recipient of customRecipients) {
			const recipientItem = v4vSection.getByTestId(`v4v-recipient-${recipient.pubkey}`)
			await expect(recipientItem).toBeVisible({ timeout: 10_000 })

			// Assert the split percentage matches the seeded value
			const expectedPct = parseInt(recipient.splitPercent, 10)
			await expect(recipientItem).toContainText(`${expectedPct}%`)
		}

		// Verify the event ID matches what was seeded
		expect(latest.id).toBe(event.id)
	})
})
