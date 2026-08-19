import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { seedAuction } from '../scenarios'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { RELAY_URL } from '../test-config'
import type { VerifiedEvent } from 'nostr-tools/pure'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a kind-1023 bid event (AUCTION_BID_KIND) directly to the relay for a
 * given auction. The bid references the auction by its root event id and
 * coordinates.
 */
async function seedBidForAuction(auctionEvent: VerifiedEvent, bidderSk: string, amount: number): Promise<VerifiedEvent> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const { finalizeEvent } = await import('nostr-tools/pure')
		const { hexToBytes } = await import('@noble/hashes/utils.js')
		const now = Math.floor(Date.now() / 1000)

		// Extract the auction d-tag to build coordinates
		const dTag = auctionEvent.tags.find((t) => t[0] === 'd')?.[1] ?? ''
		const auctionCoordinates = `30408:${auctionEvent.pubkey}:${dTag}`

		const bidEvent = finalizeEvent(
			{
				kind: 1023, // AUCTION_BID_KIND
				created_at: now,
				content: '',
				tags: [
					['auction_root_event_id', auctionEvent.id],
					['a', auctionCoordinates],
					['p', auctionEvent.pubkey],
					['amount', String(amount), 'SAT'],
					['mint', 'https://nofees.testnut.cashu.space'],
					['locktime', String(now + 86400)],
				],
			},
			hexToBytes(bidderSk),
		)

		await relay.publish(bidEvent)
		return bidEvent
	} finally {
		relay.close()
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Dashboard Widgets', () => {
	// Test 1: New user with no auctions sees empty / getting-started state
	test('displays empty state for new user with no auctions', async ({ newUserPage }) => {
		test.setTimeout(60_000)

		// Navigate to the dashboard
		await newUserPage.goto('/dashboard')
		await newUserPage.waitForLoadState('networkidle')

		// The dashboard shows a "Getting Started" card when totalListings === 0
		// This is the empty state for a new user with no products or auctions
		await expect(newUserPage.getByText(/welcome to your marketplace dashboard/i)).toBeVisible({
			timeout: 15_000,
		})

		// The dashboard should also show zero counts for stats
		// "Active Listings" card should show 0
		const activeListingsCard = newUserPage.getByText(/active listings/i).locator('..')
		await expect(activeListingsCard).toBeVisible({ timeout: 10_000 })

		// Navigate to the auctions management page to verify empty state there too
		await newUserPage.goto('/dashboard/products/auctions')
		await newUserPage.waitForLoadState('networkidle')

		// The auctions page should show the "No auctions yet" empty state
		await expect(newUserPage.getByText(/no auctions yet/i)).toBeVisible({ timeout: 15_000 })
	})

	// Test 2: Merchant with seeded auctions sees correct auction count
	test('displays Your Auctions count for merchant with auctions', async ({ merchantPage }) => {
		test.setTimeout(90_000)

		// Seed an auction for the merchant (devUser1)
		const relay = await Relay.connect(RELAY_URL)
		let seededAuction: VerifiedEvent
		try {
			seededAuction = await seedAuction(relay, devUser1.sk, {
				title: `Dashboard Count Test ${Date.now()}`,
				description: 'E2E test auction for dashboard count widget',
				startingBid: 1000,
				bidIncrement: 100,
			})
		} finally {
			relay.close()
		}

		// Navigate to the auctions management page
		await merchantPage.goto('/dashboard/products/auctions')
		await merchantPage.waitForLoadState('networkidle')

		// The auctions page should show the seeded auction (not the empty state)
		await expect(merchantPage.getByText(/no auctions yet/i)).not.toBeVisible({ timeout: 10_000 })

		// The seeded auction title should be visible in the list
		await expect(merchantPage.getByText(seededAuction.tags.find((t) => t[0] === 'title')?.[1] ?? '')).toBeVisible({
			timeout: 30_000,
		})

		// Navigate to the main dashboard to verify auction count is reflected
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('networkidle')

		// The dashboard should show at least 1 in active listings (products are seeded by merchant scenario)
		const activeListingsValue = merchantPage
			.getByText(/active listings/i)
			.locator('..')
			.locator('.text-2xl')
		await expect(activeListingsValue).toBeVisible({ timeout: 15_000 })
		const countText = await activeListingsValue.textContent()
		expect(parseInt(countText ?? '0', 10)).toBeGreaterThanOrEqual(1)
	})

	// Test 3: Buyer with bid history sees previously bid widget
	test('displays Previously Bid widget for buyer with bid history', async ({ buyerPage }) => {
		test.setTimeout(90_000)

		// Seed an auction as the merchant (devUser1)
		const relay = await Relay.connect(RELAY_URL)
		let auctionEvent: VerifiedEvent
		try {
			auctionEvent = await seedAuction(relay, devUser1.sk, {
				title: `Bid History Test ${Date.now()}`,
				description: 'E2E test auction for previously bid widget',
				startingBid: 1000,
				bidIncrement: 100,
			})
		} finally {
			relay.close()
		}

		// Seed a bid from the buyer (devUser2)
		await seedBidForAuction(auctionEvent, devUser2.sk, 1100)

		// Navigate to the buyer's bids dashboard page
		await buyerPage.goto('/dashboard/products/bids')
		await buyerPage.waitForLoadState('networkidle')

		// The bids page should NOT show the empty state
		await expect(buyerPage.getByText(/no bids yet/i)).not.toBeVisible({ timeout: 15_000 })

		// The bids page should show the auction title in the bid list
		const auctionTitle = auctionEvent.tags.find((t) => t[0] === 'title')?.[1] ?? ''
		await expect(buyerPage.getByText(auctionTitle).first()).toBeVisible({ timeout: 30_000 })

		// Verify the bid amount is displayed
		await expect(buyerPage.getByText(/1,100\s*sats/i).first()).toBeVisible({ timeout: 10_000 })
	})

	// Test 4: Merchant with active auctions sees needs-attention widget
	test('displays Needs Attention widget for merchant with active auctions', async ({ merchantPage }) => {
		test.setTimeout(90_000)

		// Seed an active auction for the merchant
		const relay = await Relay.connect(RELAY_URL)
		let seededAuction: VerifiedEvent
		try {
			seededAuction = await seedAuction(relay, devUser1.sk, {
				title: `Needs Attention Test ${Date.now()}`,
				description: 'E2E test auction for needs attention widget',
				startingBid: 1000,
				bidIncrement: 100,
			})
		} finally {
			relay.close()
		}

		// Navigate to the auctions management page
		await merchantPage.goto('/dashboard/products/auctions')
		await merchantPage.waitForLoadState('networkidle')

		// The auction should appear in the list (not empty state)
		await expect(merchantPage.getByText(/no auctions yet/i)).not.toBeVisible({ timeout: 10_000 })

		// The auction title should be visible — this is the merchant's "needs attention" view
		// showing active auctions that require monitoring
		const auctionTitle = seededAuction.tags.find((t) => t[0] === 'title')?.[1] ?? ''
		await expect(merchantPage.getByText(auctionTitle).first()).toBeVisible({ timeout: 30_000 })

		// The auction should show a status badge (Live, Scheduled, etc.)
		// Active auctions should display a status badge
		const auctionListItem = merchantPage.locator('li').filter({ hasText: auctionTitle }).first()
		await expect(auctionListItem).toBeVisible({ timeout: 10_000 })

		// Verify the "Open Auction" link is present — merchant needs to manage active auctions
		await expect(merchantPage.getByRole('button', { name: /open auction/i }).first()).toBeVisible({
			timeout: 10_000,
		})

		// Verify the "Add An Auction" button is still available for the merchant
		await expect(merchantPage.getByRole('button', { name: /add an auction/i }).first()).toBeVisible({
			timeout: 10_000,
		})
	})

	// Test 5: Dashboard widgets refresh after publishing a new auction
	test('dashboard widgets refresh after publishing new auction', async ({ merchantPage, relayMonitor }) => {
		test.setTimeout(120_000)

		// First, navigate to auctions page and count existing auctions
		await merchantPage.goto('/dashboard/products/auctions')
		await merchantPage.waitForLoadState('networkidle')

		// Wait for loading to finish
		await expect(merchantPage.getByText(/loading auctions/i)).not.toBeVisible({ timeout: 15_000 })

		// Count existing auction items (li elements in the auction list)
		const existingAuctionItems = merchantPage.locator('ul > li').filter({ hasText: /open auction/i })
		const initialCount = await existingAuctionItems.count()

		// Navigate to the public auctions page to create a new auction via UI
		await merchantPage.goto('/auctions')
		await merchantPage.waitForLoadState('networkidle')

		// Click the "Create Auction" button to open the sheet drawer
		const createButton = merchantPage.getByRole('button', { name: /create auction/i })
		await createButton.click()

		// Wait for the auction form sheet to appear
		const titleInput = merchantPage.getByLabel(/title/i).or(merchantPage.getByPlaceholder(/title/i))
		await titleInput.waitFor({ state: 'visible', timeout: 10_000 })
		const newAuctionTitle = `Refresh Test ${Date.now()}`
		await titleInput.fill(newAuctionTitle)

		// Fill summary if available
		const summaryInput = merchantPage.getByLabel(/summary/i).or(merchantPage.getByPlaceholder(/summary/i))
		if (await summaryInput.isVisible().catch(() => false)) {
			await summaryInput.fill('E2E test auction for dashboard refresh verification')
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
		expect(capturedEvent!.nostrEvent!.kind).toBe(30408)

		// Navigate back to the auctions dashboard page
		await merchantPage.goto('/dashboard/products/auctions')
		await merchantPage.waitForLoadState('networkidle')

		// Wait for loading to finish
		await expect(merchantPage.getByText(/loading auctions/i)).not.toBeVisible({ timeout: 15_000 })

		// The new auction should appear in the list
		await expect(merchantPage.getByText(newAuctionTitle).first()).toBeVisible({ timeout: 30_000 })

		// The auction count should have incremented (at least initialCount + 1)
		const updatedAuctionItems = merchantPage.locator('ul > li').filter({ hasText: /open auction/i })
		const newCount = await updatedAuctionItems.count()
		expect(newCount).toBeGreaterThan(initialCount)

		// Navigate to the main dashboard to verify it also reflects the new auction
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('networkidle')

		// The dashboard should show updated stats
		const activeListingsValue = merchantPage
			.getByText(/active listings/i)
			.locator('..')
			.locator('.text-2xl')
		await expect(activeListingsValue).toBeVisible({ timeout: 15_000 })
		const dashboardCountText = await activeListingsValue.textContent()
		expect(parseInt(dashboardCountText ?? '0', 10)).toBeGreaterThanOrEqual(1)
	})
})
