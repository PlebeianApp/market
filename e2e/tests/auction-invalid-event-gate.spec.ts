/**
 * Spec validity at the read boundary — a malformed kind-30408 is not a feed item.
 *
 * The defect this family pins, as observed on staging: an event shaped like an
 * auction but missing its required tags (AUCTIONS.md §4.1) appeared in the
 * browse page AND held slot #1 under the default "Ending Soon" sort, rendering
 * "No end date". Two independent causes, two assertions here:
 *
 *   1. admission — the event is not a well-formed auction, so the feed and the
 *      browse surfaces drop it (`filterAdmissibleAuctionEvents`);
 *   2. ordering — a missing close time reads as `0`, which used to win the
 *      "Ending Soon" comparison outright. The fixture that must never outrank a
 *      real auction is seeded alongside a control ending in ten minutes.
 *
 * Reachability is asserted in the same test, because the two promises only make
 * sense together: the event is excluded from browsing *and* stays reachable by
 * direct link, where the notice names the offending tags. A gate without the
 * notice would leave a visitor looking at a listing that is missing from every
 * list with no explanation.
 *
 * The maintainer's rulings of 2026-09-19 are pinned here too: a zero timing
 * value is gating (not a warning that sorts last), and a malformed auction is
 * not biddable — the detail page keeps its notice but loses its bid panel.
 */
import { test, expect } from '../fixtures'
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { Page } from '@playwright/test'
import { devUser1, devUser3 } from '../../src/lib/fixtures'
import { queryRelayEvents } from '../utils/relay-query'

test.use({ scenario: 'merchant' })

const RELAY_URL = 'ws://localhost:10547'
const AUCTION_KIND = 30408
const AUDITOR_PK = 'b'.repeat(64)

/** Unique per-run suffix so repeated runs never collide on a d-tag or title. */
const runSuffix = (): string => `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

async function publishAuction(skHex: string, tags: string[][]): Promise<VerifiedEvent> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const template: EventTemplate = {
			kind: AUCTION_KIND,
			created_at: Math.floor(Date.now() / 1000),
			content: 'Spec-validity e2e fixture.',
			tags,
		}
		const event = finalizeEvent(template, hexToBytes(skHex))
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

/** Every REQUIRED tag (AUCTIONS.md §4.1) — a well-formed auction. */
const validAuctionTags = (dTag: string, title: string, endInSeconds: number): string[][] => {
	const now = Math.floor(Date.now() / 1000)
	return [
		['d', dTag],
		['title', title],
		['summary', 'Spec-validity e2e control auction.'],
		['auction_type', 'english'],
		['currency', 'SAT'],
		['start_at', String(now)],
		['end_at', String(now + endInSeconds)],
		['max_end_at', String(now + endInSeconds)],
		['settlement_grace', '3600'],
		['starting_bid', '1000'],
		['bid_increment', '100'],
		['reserve', '0'],
		['mint', 'http://localhost:3338'],
		['key_scheme', 'hd_p2pk'],
		['p2pk_xpub', 'xpub' + '0'.repeat(100)],
		['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
		['auditors', AUDITOR_PK],
		['auditor_quorum', '1'],
		['schema', 'auction_v1'],
	]
}

/**
 * The staging shape: a `d` tag and a title, nothing else. No `start_at`, no
 * `end_at`, no `starting_bid` — so the parser refuses it and the old code path
 * still rendered it with "No end date" at slot #1.
 */
const malformedAuctionTags = (dTag: string, title: string): string[][] => [
	['d', dTag],
	['title', title],
	['summary', 'Malformed e2e fixture: only the tags a bare listing carries.'],
]

/**
 * Every REQUIRED tag present, but the three timing values are `0`. This is the
 * shape the parser used to accept: `end_at >= start_at` and
 * `max_end_at >= end_at` are trivially true at zero, so the event was a feed
 * item that merely sorted last. Under the maintainer's ruling of 2026-09-19
 * ("gate completely on invalid event format") the range is part of the format,
 * so this is not a feed item either.
 */
const zeroTimingAuctionTags = (dTag: string, title: string): string[][] =>
	validAuctionTags(dTag, title, 86_400).map((tag) =>
		tag[0] === 'start_at' || tag[0] === 'end_at' || tag[0] === 'max_end_at' ? [tag[0], '0'] : tag,
	)

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
 * Wait until the feed has rendered the control auction, so an absence assertion
 * is about the gate and not about a not-yet-loaded feed.
 */
async function waitForAuctionsFeedLoaded(page: Page, controlTitle: string): Promise<void> {
	await expect(page.getByText(controlTitle)).toBeVisible({ timeout: 30_000 })
}

/**
 * DOM order of the three fixtures among the auction card links, or `-1` when a
 * title is not rendered at all. Read from the DOM rather than from a screenshot
 * so the assertion is exact: the malformed fixture must be absent (-1), and the
 * ten-minute control must sort ahead of the one ending tomorrow.
 */
async function cardOrder(page: Page, titles: string[]): Promise<number[]> {
	return await page.evaluate((needles: string[]) => {
		const links = Array.from(document.querySelectorAll('a[href^="/auctions/"]'))
		return needles.map((needle) => links.findIndex((link) => (link.textContent ?? '').includes(needle)))
	}, titles)
}

test.describe('Spec validity — malformed auction events (AUCTIONS.md §4.1)', () => {
	test('a malformed event is absent from the feed, does not win "Ending Soon", and is reachable by direct link with a notice', async ({
		unauthenticatedPage,
	}) => {
		test.setTimeout(120_000)

		const suffix = runSuffix()
		const malformedTitle = `Malformed Auction ${suffix}`
		const zeroTimingTitle = `Zero Timing Auction ${suffix}`
		const soonTitle = `Ending Soon Control ${suffix}`
		const laterTitle = `Later Control ${suffix}`

		const malformed = await publishAuction(devUser3.sk, malformedAuctionTags(`invalid-${suffix}`, malformedTitle))
		const zeroTiming = await publishAuction(devUser3.sk, zeroTimingAuctionTags(`zero-timing-${suffix}`, zeroTimingTitle))
		const soon = await publishAuction(devUser3.sk, validAuctionTags(`soon-${suffix}`, soonTitle, 600))
		const later = await publishAuction(devUser3.sk, validAuctionTags(`later-${suffix}`, laterTitle, 86_400))

		// The relay is the source of truth: both malformed events exist and are
		// fetchable, so their absence from the feed is the gate — not a failed
		// publish. (Asserted first; the reachability step below would otherwise
		// be the only proof of presence, i.e. it would come too late to make the
		// absence assertion meaningful.)
		await expect(async () => {
			const events = await queryRelayEvents({ kinds: [AUCTION_KIND], ids: [malformed.id, zeroTiming.id] })
			expect(events.length).toBe(2)
		}).toPass({ timeout: 15_000 })

		await safeGoto(unauthenticatedPage, '/auctions')
		await waitForAuctionsFeedLoaded(unauthenticatedPage, soonTitle)

		const [malformedIndex, zeroTimingIndex, soonIndex, laterIndex] = await cardOrder(unauthenticatedPage, [
			malformedTitle,
			zeroTimingTitle,
			soonTitle,
			laterTitle,
		])

		// 1. Admission: neither malformed event is a card, anywhere on the page.
		// The second one carries every required tag and only fails the timing
		// range, which is exactly the reclassification the ruling made.
		expect(malformedIndex).toBe(-1)
		expect(zeroTimingIndex).toBe(-1)
		await expect(unauthenticatedPage.getByText(malformedTitle)).toHaveCount(0)
		await expect(unauthenticatedPage.getByText(zeroTimingTitle)).toHaveCount(0)
		// The controls are both rendered, so the assertions above are not vacuous.
		expect(soonIndex).toBeGreaterThanOrEqual(0)
		expect(laterIndex).toBeGreaterThanOrEqual(0)

		// 2. Ordering: the control ending in ten minutes sorts ahead of the one
		// ending tomorrow. With the old comparator the malformed event — cutoff
		// `0`, i.e. "not ended" and numerically first — took slot #1 instead.
		expect(soonIndex).toBeLessThan(laterIndex)

		// 3. Reachability: the direct link resolves the event and says why it is
		// missing from browsing, naming the tags the parser refused.
		await safeGoto(unauthenticatedPage, `/auctions/${malformed.id}`)
		await expect(unauthenticatedPage.getByText(malformedTitle)).toBeVisible({ timeout: 15_000 })

		const notice = unauthenticatedPage.getByTestId('invalid-auction-notice')
		await expect(notice).toBeVisible({ timeout: 15_000 })
		await notice.click()

		const noticeDialog = unauthenticatedPage.getByTestId('invalid-auction-notice-dialog')
		await expect(noticeDialog).toBeVisible()
		await expect(noticeDialog).toContainText('not a well-formed auction')
		// The reason is the tag, not a generic "invalid" — that is what makes the
		// notice actionable for the seller who has to republish.
		const reasons = unauthenticatedPage.getByTestId('invalid-auction-notice-reason')
		await expect(reasons.first()).toContainText('start_at')
		await unauthenticatedPage.getByTestId('invalid-auction-notice-close').click()

		// 4. Not biddable: the bid panel is replaced by the block, so there is no
		// bid control to reach on a malformed auction (ruling of 2026-09-19).
		// Scoped to this auction's bid area: the page also renders cards for the
		// seller's *other* auctions, which carry their own (valid) controls.
		const malformedBidArea = unauthenticatedPage.getByTestId('auction-bid-area')
		await expect(malformedBidArea.getByTestId('invalid-auction-bid-blocked')).toBeVisible()
		await expect(malformedBidArea.getByTestId('auction-bidder')).toHaveCount(0)

		// 5. The zero-timing event fails the same way, and the notice names the
		// range rather than a missing tag — the ruling in user-visible copy.
		await safeGoto(unauthenticatedPage, `/auctions/${zeroTiming.id}`)
		await expect(unauthenticatedPage.getByText(zeroTimingTitle)).toBeVisible({ timeout: 15_000 })
		await unauthenticatedPage.getByTestId('invalid-auction-notice').click()
		await expect(unauthenticatedPage.getByTestId('invalid-auction-notice-dialog')).toContainText('positive unix-seconds')
		await unauthenticatedPage.getByTestId('invalid-auction-notice-close').click()
		const zeroTimingBidArea = unauthenticatedPage.getByTestId('auction-bid-area')
		await expect(zeroTimingBidArea.getByTestId('invalid-auction-bid-blocked')).toBeVisible()
		await expect(zeroTimingBidArea.getByTestId('auction-bidder')).toHaveCount(0)

		// Negative control: a well-formed auction reached the same way renders
		// without any notice and keeps its bid panel — absence and presence
		// asserted, not assumed.
		await safeGoto(unauthenticatedPage, `/auctions/${soon.id}`)
		await expect(unauthenticatedPage.getByText(soonTitle)).toBeVisible({ timeout: 15_000 })
		await expect(unauthenticatedPage.getByTestId('invalid-auction-notice')).toHaveCount(0)
		const validBidArea = unauthenticatedPage.getByTestId('auction-bid-area')
		await expect(validBidArea.getByTestId('invalid-auction-bid-blocked')).toHaveCount(0)
		await expect(validBidArea.getByTestId('auction-bidder')).toBeVisible({ timeout: 15_000 })
	})

	test('the owner dashboard keeps a malformed auction visible, so the seller can republish it', async ({ merchantPage }) => {
		test.setTimeout(120_000)

		// Published by the signed-in merchant, so this is the owner surface.
		const suffix = runSuffix()
		const malformedTitle = `Owner Malformed Auction ${suffix}`
		const malformed = await publishAuction(devUser1.sk, malformedAuctionTags(`owner-invalid-${suffix}`, malformedTitle))

		await safeGoto(merchantPage, '/dashboard/products/auctions')
		await expect(merchantPage.getByText(malformedTitle)).toBeVisible({ timeout: 30_000 })

		await safeGoto(merchantPage, `/dashboard/products/auctions/${malformed.id}`)
		await expect(merchantPage.getByTestId('invalid-auction-notice')).toBeVisible({ timeout: 15_000 })
		// The owner surface keeps the event *and* offers no bid control for it:
		// the dashboard detail page is the seller's settlement surface and
		// renders no bid panel at all (`AuctionBidder` is mounted only on the
		// public detail page and on cards). Pinned so a malformed event can never
		// acquire one here either.
		await expect(merchantPage.getByTestId('auction-bidder')).toHaveCount(0)
		await expect(merchantPage.getByTestId('invalid-auction-bid-blocked')).toHaveCount(0)
	})
})
