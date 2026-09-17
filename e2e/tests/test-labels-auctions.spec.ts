import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { queryRelayEvents } from '../utils/relay-query'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'

// ---------------------------------------------------------------------------
// Relay helpers — publish kind 1985 label events and kind 5 deletions
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
 * Publish a minimal kind-30408 auction listing.
 * Returns the published event (id + d-tag are needed for labeling and routing).
 */
async function seedAuction(skHex: string, title: string, dTag: string): Promise<VerifiedEvent> {
	const now = Math.floor(Date.now() / 1000)
	return await publishEvent(skHex, {
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

/**
 * Publish a NIP-09 deletion (kind 5) for a label event.
 * Tags: e (label event id) + k (1985). No a tag — kind 1985 is not replaceable.
 */
async function seedTestLabelDeletion(skHex: string, labelEventId: string, content = 'Unmarking test label.'): Promise<VerifiedEvent> {
	return await publishEvent(skHex, {
		kind: 5,
		created_at: Math.floor(Date.now() / 1000),
		content,
		tags: [
			['e', labelEventId],
			['k', '1985'],
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

/**
 * Wait until the auctions feed has rendered the control auction, so an
 * absence assertion is about the gate and not about a not-yet-loaded feed.
 */
async function waitForAuctionsFeedLoaded(page: Page, controlTitle: string): Promise<void> {
	await expect(page.getByText(controlTitle)).toBeVisible({ timeout: 30_000 })
}

const dismissPiiWarning = async (page: Page): Promise<void> => {
	const piiDialog = page.getByRole('dialog', { name: 'Some of your personal data may be exposed' })
	if (await piiDialog.isVisible().catch(() => false)) {
		await piiDialog.getByRole('button', { name: 'Dismiss Warning' }).click()
		await expect(piiDialog).toBeHidden()
	}
}

/** Unique per-run suffix so repeated runs never collide on a d-tag or title. */
const runSuffix = (): string => `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

// ---------------------------------------------------------------------------
// Scenario 1: the auction feed is a discovery surface — hidden, but reachable
// ---------------------------------------------------------------------------

test.describe('Test listing labels — auctions (ADR-0009)', () => {
	test('a labeled auction is excluded from the feed, reachable by direct link, and revealed by the toggle', async ({
		unauthenticatedPage,
	}) => {
		const suffix = runSuffix()
		const controlTitle = `Control Auction ${suffix}`
		const labeledTitle = `Labeled Auction ${suffix}`

		const control = await seedAuction(devUser1.sk, controlTitle, `test-label-auction-control-${suffix}`)
		const labeled = await seedAuction(devUser1.sk, labeledTitle, `test-label-auction-labeled-${suffix}`)

		// Labeled by an authorized labeler key (devUser1 is in the admin set)
		await seedTestLabel(devUser1.sk, auctionCoordinate(labeled))

		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)

		// Default hidden: the labeled auction is not in the feed
		await expect(unauthenticatedPage.getByText(labeledTitle)).toHaveCount(0)

		// Direct link: the auction is still reachable, and the notice explains why
		// it is missing from browsing.
		await safeGoto(unauthenticatedPage, `/auctions/${labeled.id}`)
		await expect(unauthenticatedPage.getByText(labeledTitle)).toBeVisible({ timeout: 15_000 })
		const notice = unauthenticatedPage.getByTestId('test-listing-notice')
		await expect(notice).toBeVisible({ timeout: 15_000 })

		// The explainer states the real effect (browse-only) and an appeal path
		await notice.click()
		const noticeDialog = unauthenticatedPage.getByTestId('test-listing-notice-dialog')
		await expect(noticeDialog).toBeVisible()
		await expect(noticeDialog).toContainText('hidden from browsing')
		await expect(unauthenticatedPage.getByTestId('test-listing-notice-contact')).toBeVisible()
		await unauthenticatedPage.getByTestId('test-listing-notice-close').click()

		// The "Show test listings" toggle reveals it in the feed, card marker
		// included. The flag lives in memory, so the assertions must stay on this
		// page — navigating would reset it to the hidden default.
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await unauthenticatedPage.getByRole('checkbox', { name: 'Show test listings' }).check()
		await expect(unauthenticatedPage.getByText(labeledTitle)).toBeVisible({ timeout: 30_000 })
		await expect(unauthenticatedPage.getByTestId('test-listing-notice-icon').first()).toBeVisible({ timeout: 15_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 2: un-labeled auction reappears after the NIP-09 deletion
	// -----------------------------------------------------------------------

	test('an auction reappears in the feed after the test label is deleted via NIP-09', async ({ unauthenticatedPage }) => {
		const suffix = runSuffix()
		const controlTitle = `Reappear Control ${suffix}`
		const title = `Reappear Auction ${suffix}`

		await seedAuction(devUser1.sk, controlTitle, `test-label-reappear-control-${suffix}`)
		const auction = await seedAuction(devUser1.sk, title, `test-label-reappear-${suffix}`)
		const labelEvent = await seedTestLabel(devUser1.sk, auctionCoordinate(auction))

		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// Un-label: NIP-09 deletion signed by the SAME labeler (devUser1)
		await seedTestLabelDeletion(devUser1.sk, labelEvent.id)

		// Reload → fresh store/cache → the auction reappears
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 30_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 3: unauthorized labels are ignored
	// -----------------------------------------------------------------------

	test('a label from an unauthorized key does not hide the auction', async ({ unauthenticatedPage }) => {
		const suffix = runSuffix()
		const title = `Unauthorized Label Auction ${suffix}`

		// Auction by devUser2, label also signed by devUser2 — who is NOT in the
		// authorized set, so the label must be ignored.
		const auction = await seedAuction(devUser2.sk, title, `test-label-unauthorized-${suffix}`)
		await seedTestLabel(devUser2.sk, auctionCoordinate(auction))

		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, title)
	})

	// -----------------------------------------------------------------------
	// Scenario 4: authorized labeler curates another seller's auction
	// -----------------------------------------------------------------------

	test('an authorized labeler marks a seller’s auction from its public page; the feed hides it, unmark restores it', async ({
		merchantPage,
		unauthenticatedPage,
	}) => {
		const suffix = runSuffix()
		const title = `Cross-user Label Auction ${suffix}`

		// Seeded by ANOTHER seller (devUser2); merchantPage is devUser1.
		const auction = await seedAuction(devUser2.sk, title, `test-label-cross-user-${suffix}`)
		const coordinate = auctionCoordinate(auction)

		// Visible in the feed before it is curated
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, title)

		await safeGoto(merchantPage, `/auctions/${auction.id}`)
		const markButton = merchantPage.getByTestId('mark-test-label-auction-button')
		await expect(markButton).toBeVisible({ timeout: 30_000 })

		// Mark as test: confirmation dialog with pre-filled, editable content
		await markButton.click()
		const dialog = merchantPage.getByRole('alertdialog')
		await expect(dialog).toBeVisible()
		await expect(dialog.getByTestId('test-label-content-auction')).toContainText('Marked as test listing')
		await dialog.getByRole('button', { name: 'Mark as Test' }).click()

		// Optimistic UI: the button flips to "Unmark as Test Auction"
		const unmarkButton = merchantPage.getByTestId('unmark-test-label-auction-button')
		await expect(unmarkButton).toBeVisible({ timeout: 15_000 })

		// Relay is the source of truth: a kind-1985 label for the coordinate exists
		let labelEventIdOnRelay = ''
		await expect(async () => {
			const labels = await queryRelayEvents({ kinds: [1985], '#a': [coordinate], authors: [devUser1.pk] })
			expect(labels.length).toBeGreaterThan(0)
			labelEventIdOnRelay = labels[0].id
		}).toPass({ timeout: 15_000 })

		// The feed now hides the auction for a browsing visitor
		await safeGoto(unauthenticatedPage, '/auctions')
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// Unmark as test: the label deletion lands on the relay and the auction returns
		await safeGoto(merchantPage, `/auctions/${auction.id}`)
		await merchantPage.getByTestId('unmark-test-label-auction-button').click()
		const unmarkDialog = merchantPage.getByRole('alertdialog')
		await expect(unmarkDialog).toBeVisible()
		await unmarkDialog.getByRole('button', { name: 'Unmark as Test' }).click()
		await expect(merchantPage.getByTestId('mark-test-label-auction-button')).toBeVisible({ timeout: 15_000 })

		// The NIP-09 deletion event referencing the label id lands on the relay.
		// (nak actively purges deleted events, so the label itself may be gone —
		// the deletion event is the durable artifact to assert on.)
		await expect(async () => {
			const deletions = await queryRelayEvents({ kinds: [5], '#e': [labelEventIdOnRelay], authors: [devUser1.pk] })
			expect(deletions.length).toBeGreaterThan(0)
		}).toPass({ timeout: 15_000 })

		await safeGoto(unauthenticatedPage, '/auctions')
		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 30_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 5: the owner's dashboard keeps the auction, and says why
	// -----------------------------------------------------------------------

	test('a labeled auction stays visible in the owner dashboard while hidden from the public feed', async ({ merchantPage }) => {
		const suffix = runSuffix()
		const title = `Dashboard Label Auction ${suffix}`

		const auction = await seedAuction(devUser1.sk, title, `test-label-dashboard-${suffix}`)
		await seedTestLabel(devUser1.sk, auctionCoordinate(auction))

		await safeGoto(merchantPage, `/dashboard/products/auctions/${auction.id}`)
		await dismissPiiWarning(merchantPage)

		// The owner still sees the auction, plus the notice and the label action
		await expect(merchantPage.getByText(title).first()).toBeVisible({ timeout: 30_000 })
		await expect(merchantPage.getByTestId('test-listing-notice')).toBeVisible({ timeout: 15_000 })
		await expect(merchantPage.getByTestId('unmark-test-label-auction-button')).toBeVisible({ timeout: 15_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 6: non-authorized users never see the label actions
	// -----------------------------------------------------------------------

	test('a non-authorized user sees no test-label auction actions', async ({ buyerPage }) => {
		const suffix = runSuffix()
		const title = `Non-admin Label Auction ${suffix}`

		// Seeded by devUser2 — the buyer IS the seller of this auction
		const auction = await seedAuction(devUser2.sk, title, `test-label-non-admin-${suffix}`)

		await safeGoto(buyerPage, `/auctions/${auction.id}`)
		await expect(buyerPage.getByText(title)).toBeVisible({ timeout: 30_000 })
		await expect(buyerPage.getByTestId('mark-test-label-auction-button')).toHaveCount(0, { timeout: 15_000 })
		await expect(buyerPage.getByTestId('unmark-test-label-auction-button')).toHaveCount(0)
	})
})
