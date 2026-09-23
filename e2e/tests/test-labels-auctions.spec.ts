import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { queryRelayEvents } from '../utils/relay-query'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'

// Path to a local image fixture used to intercept external CDN requests.
// Same pattern (and same file) as `e2e/tests/product-page.spec.ts`.
const __filename = fileURLToPath(import.meta.url)
const LOCAL_IMAGE_PATH = path.join(path.dirname(__filename), '..', 'fixtures', 'test-product-image.png')

/**
 * Test Isolation (e2e/AGENTS.md, ADR-0005): the only allowed services are the
 * local relay, the local dev server and the local mint. Every auction seeded
 * here carries a `cdn.satellite.earth` image, so route it to the local fixture
 * instead of letting the run make real egress (an unreachable CDN also stalls
 * image loads, which is what `networkidle` waits on).
 */
async function interceptCdnImages(page: Page): Promise<void> {
	await page.route('**/cdn.satellite.earth/**', async (route) => {
		await route.fulfill({ status: 200, contentType: 'image/png', path: LOCAL_IMAGE_PATH })
	})
}

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
 * Publish a kind-30408 auction listing.
 *
 * Every REQUIRED tag is present (AUCTIONS.md §4.1): the auction feed is gated on
 * spec validity as well as on test labels, so a fixture missing `auditors` or
 * `max_end_at` would be absent from the feed for a reason that has nothing to do
 * with the label this suite marks — and every "the label hides it" assertion
 * would pass without the label.
 *
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
			['max_end_at', String(now + 86400)],
			['settlement_grace', '3600'],
			['currency', 'SAT'],
			['price', '1000', 'SAT'],
			['starting_bid', '1000', 'SAT'],
			['bid_increment', '100'],
			['reserve', '0'],
			['mint', 'http://localhost:3338'],
			['escrow_pubkey', '02' + '00'.repeat(32)],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', 'xpub' + '0'.repeat(100)],
			['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
			['auditors', devUser2.pk],
			['auditor_quorum', '1'],
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

		await interceptCdnImages(unauthenticatedPage)

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
		// The copy regression #1266 had to fix for products: detail views are
		// never gated, so the notice must not claim the item is hidden there.
		await expect(noticeDialog).not.toContainText('detail views')
		await expect(unauthenticatedPage.getByTestId('test-listing-notice-contact')).toBeVisible()
		await unauthenticatedPage.getByTestId('test-listing-notice-close').click()

		// Negative control: the unlabeled auction reached the same way renders
		// without any notice — absence asserted, not assumed.
		await safeGoto(unauthenticatedPage, `/auctions/${control.id}`)
		await expect(unauthenticatedPage.getByText(controlTitle)).toBeVisible({ timeout: 15_000 })
		await expect(unauthenticatedPage.getByTestId('test-listing-notice')).toHaveCount(0)

		// The "Show test listings" toggle reveals it in the feed, card marker
		// included. The flag is a module-level store, so it survives client-side
		// navigation and is reset only by a full document load — which is what
		// `safeGoto` performs. Both the reveal and the re-hide are asserted here,
		// on the page that holds the toggle.
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		const toggle = unauthenticatedPage.getByRole('checkbox', { name: 'Show test listings' })
		await toggle.check()
		await expect(unauthenticatedPage.getByText(labeledTitle)).toBeVisible({ timeout: 30_000 })
		await expect(unauthenticatedPage.getByTestId('test-listing-notice-icon').first()).toBeVisible({ timeout: 15_000 })

		// Switching it back off restores the default (hidden) feed
		await toggle.uncheck()
		await expect(unauthenticatedPage.getByText(labeledTitle)).toHaveCount(0, { timeout: 15_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 2: un-labeled auction reappears after the NIP-09 deletion
	// -----------------------------------------------------------------------

	test('an auction reappears in the feed after the test label is deleted via NIP-09', async ({ unauthenticatedPage }) => {
		const suffix = runSuffix()
		const controlTitle = `Reappear Control ${suffix}`
		const title = `Reappear Auction ${suffix}`

		await interceptCdnImages(unauthenticatedPage)

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
		const controlTitle = `Unauthorized Control ${suffix}`
		const title = `Unauthorized Label Auction ${suffix}`

		await interceptCdnImages(unauthenticatedPage)

		// Auction by devUser2, label also signed by devUser2 — who is NOT in the
		// authorized set, so the label must be ignored.
		await seedAuction(devUser2.sk, controlTitle, `test-label-unauthorized-control-${suffix}`)
		const auction = await seedAuction(devUser2.sk, title, `test-label-unauthorized-${suffix}`)
		await seedTestLabel(devUser2.sk, auctionCoordinate(auction))

		// The control anchors "the feed has rendered"; the assertion below is the
		// scenario's own claim, not the wait's.
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 15_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 4: authorized labeler curates another seller's auction
	// -----------------------------------------------------------------------

	test('an authorized labeler marks a seller’s auction from its public page; the feed hides it, unmark restores it', async ({
		merchantPage,
		unauthenticatedPage,
	}) => {
		const suffix = runSuffix()
		const controlTitle = `Cross-user Control ${suffix}`
		const title = `Cross-user Label Auction ${suffix}`

		await interceptCdnImages(merchantPage)
		await interceptCdnImages(unauthenticatedPage)

		// Seeded by ANOTHER seller (devUser2); merchantPage is devUser1.
		// The control stays unlabeled, so it can stand in for "the feed has
		// rendered" while the labeled auction is absent from it.
		await seedAuction(devUser2.sk, controlTitle, `test-label-cross-user-control-${suffix}`)
		const auction = await seedAuction(devUser2.sk, title, `test-label-cross-user-${suffix}`)
		const coordinate = auctionCoordinate(auction)

		// Visible in the feed before it is curated
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, title)

		await safeGoto(merchantPage, `/auctions/${auction.id}`)
		// The PII exposure warning (root-level dialog for users with seeded
		// order events) intercepts pointer events — dismiss it before clicking.
		await dismissPiiWarning(merchantPage)
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

		// The feed now hides the auction for a browsing visitor. Wait for the
		// control first: an absence assertion on a feed that has not rendered
		// yet proves nothing.
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
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
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await expect(unauthenticatedPage.getByText(title)).toBeVisible({ timeout: 30_000 })
	})

	// -----------------------------------------------------------------------
	// Scenario 5: the owner's dashboard keeps the auction, and says why
	// -----------------------------------------------------------------------

	test('a labeled auction stays visible in the owner dashboard while hidden from the public feed', async ({
		merchantPage,
		unauthenticatedPage,
	}) => {
		const suffix = runSuffix()
		const controlTitle = `Dashboard Control ${suffix}`
		const title = `Dashboard Label Auction ${suffix}`

		await interceptCdnImages(merchantPage)
		await interceptCdnImages(unauthenticatedPage)

		await seedAuction(devUser1.sk, controlTitle, `test-label-dashboard-control-${suffix}`)
		const auction = await seedAuction(devUser1.sk, title, `test-label-dashboard-${suffix}`)
		await seedTestLabel(devUser1.sk, auctionCoordinate(auction))

		// Public half of the claim: browsing visitors no longer see it.
		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// Owner half: the seller still reaches it and is told why it is hidden.
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

		await interceptCdnImages(buyerPage)

		// Seeded by devUser2 — the buyer IS the seller of this auction
		const auction = await seedAuction(devUser2.sk, title, `test-label-non-admin-${suffix}`)

		await safeGoto(buyerPage, `/auctions/${auction.id}`)
		await expect(buyerPage.getByText(title)).toBeVisible({ timeout: 30_000 })
		await expect(buyerPage.getByTestId('mark-test-label-auction-button')).toHaveCount(0, { timeout: 15_000 })
		await expect(buyerPage.getByTestId('unmark-test-label-auction-button')).toHaveCount(0)

		// The second surface this PR adds the action to: the owner's dashboard
		// list. It renders the button unconditionally and relies on the
		// component's own role gate, so a non-authorized seller visiting their
		// own list must still see no action. The title assertion anchors the
		// absence — an empty list would make "no button" meaningless.
		await safeGoto(buyerPage, '/dashboard/products/auctions')
		await expect(buyerPage.getByText(title).first()).toBeVisible({ timeout: 30_000 })
		await expect(buyerPage.getByTestId('mark-test-label-auction-button')).toHaveCount(0)
		await expect(buyerPage.getByTestId('unmark-test-label-auction-button')).toHaveCount(0)
	})

	// -----------------------------------------------------------------------
	// Scenario 7: a deletion from the wrong key cannot un-hide an auction
	// -----------------------------------------------------------------------

	test('a NIP-09 deletion from a key other than the labeler cannot un-hide the auction', async ({ unauthenticatedPage }) => {
		const suffix = runSuffix()
		const controlTitle = `Foreign Deletion Control ${suffix}`
		const title = `Foreign Deletion Auction ${suffix}`

		await interceptCdnImages(unauthenticatedPage)

		await seedAuction(devUser1.sk, controlTitle, `test-label-foreign-delete-control-${suffix}`)
		const auction = await seedAuction(devUser1.sk, title, `test-label-foreign-delete-${suffix}`)
		const labelEvent = await seedTestLabel(devUser1.sk, auctionCoordinate(auction))

		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)

		// NIP-09 says only the referenced event's own author may delete it, and
		// the local relay enforces that: a foreign kind-5 is refused at publish
		// time ("blocked: you are not the author of this event"), so nothing
		// ever reaches readers to lift the label. The scenario therefore asserts
		// the refusal and then that the label is still standing. The app-side
		// rule for a relay that *does* accept such a deletion is a pure-function
		// test (testLabels.test.ts, auctionTestLabelGate.test.ts).
		await expect(seedTestLabelDeletion(devUser2.sk, labelEvent.id)).rejects.toThrow(/not the author/)

		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, controlTitle)
		await expect(unauthenticatedPage.getByText(title)).toHaveCount(0)
	})
})
