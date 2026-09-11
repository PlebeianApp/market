/**
 * E2E tests for auction bidding with Cashu mints.
 *
 * These tests use a LOCAL Cashu mint (nutshell with FakeWallet backend)
 * started automatically by the Playwright webServer config on port 3338.
 * The FakeWallet auto-settles Lightning invoices instantly, so no external
 * Lightning node or external mint is required.
 *
 * MINT_A and MINT_B point to the same local mint via different hostnames
 * (localhost vs 127.0.0.1) so the wallet treats them as separate mints.
 * MINT_UNTRUSTED is a non-working local URL used to verify mint filtering;
 * it is registered in the wallet (zero balance) but never funded — mintTestEcash
 * is always called with { allowFallback: false } (ADR-0005: never fall back to
 * the external dev testnet mints), and the untrusted URL has no mint behind it.
 */

import { test, expect } from '../fixtures'
import { RELAY_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { finalizeEvent, type EventTemplate, type Event } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2, XPUB } from '../../src/lib/fixtures'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

useWebSocketImplementation(WebSocket)

test.use({ video: 'on' })

const D_TAG = 'e2e-auction-mint-test'
const MINT_A = 'http://localhost:3338'
const MINT_B = 'http://127.0.0.1:3338'
const MINT_UNTRUSTED = 'http://untrusted.localhost:3340'
const SCREENSHOT_DIR = 'test-results'

const __filename = fileURLToPath(import.meta.url)
const LOCAL_IMAGE_PATH = path.join(path.dirname(__filename), '..', 'fixtures', 'test-product-image.png')

/**
 * Intercepts requests to placehold.co (the image URL embedded in seeded
 * auction events by seedAuction) and serves a local fixture image instead.
 * ADR-0005: tests make ZERO external network calls — modeled on the
 * interceptCdnImages pattern in product-page.spec.ts. The <img> still loads
 * (so visibility assertions pass), but no request ever leaves localhost.
 */
async function interceptPlaceholdImages(page: import('@playwright/test').Page) {
	await page.route('**/placehold.co/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/png',
			path: LOCAL_IMAGE_PATH,
		})
	})
}

// ADR-0005: every test in this file navigates to a seeded auction page whose
// event embeds a placehold.co image URL — intercept it on the (per-test)
// buyerPage before any navigation to the auction detail page.
test.beforeEach(async ({ buyerPage }) => {
	await interceptPlaceholdImages(buyerPage)
})

async function seedAuction(relay: Relay, overrides: { mints: string[]; dTag?: string; dleqRequired?: boolean }) {
	const skBytes = hexToBytes(devUser1.sk)
	const now = Math.floor(Date.now() / 1000)
	// Live auction (post-DLEQ-rollout path). The local Cashu mint (nutshell
	// FakeWallet) advertises NUT-12 and returns DLEQ proofs on mint/swap, so
	// the post-rollout DLEQ-required bid path works against it — see
	// auctionDLEQ.mint.integration.test.ts. A relative start keeps the auction
	// live regardless of when CI runs (a fixed past epoch would make it ENDED
	// and hide the bid button).
	const startAt = now - 60
	const endAt = now + 3600
	const maxEndAt = now + 7200

	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'E2E auction for mint selection testing',
			tags: [
				// Append a per-run timestamp so every seed mints a FRESH auction:
				// bids (kind-1023) persist on the shared local relay across runs, so a
				// fixed d would leave the auction's current price above the bid
				// amount ensureInsufficientBidFunds computes on a re-run — the
				// confirm dialog would stay under-floor (Confirm disabled) and the
				// deposit modal would never open. Tests navigate by event id, so the
				// d tag value is opaque (same pattern as app-settings.spec.ts).
				['d', `${overrides.dTag ?? D_TAG}-${Date.now()}`],
				['title', 'E2E Mint Test Auction'],
				['summary', 'Auction with multiple mints for e2e testing'],
				['auction_type', 'english'],
				['start_at', String(startAt)],
				['end_at', String(endAt)],
				['max_end_at', String(maxEndAt)],
				['currency', 'SAT'],
				['price', '100', 'SAT'],
				['starting_bid', '100', 'SAT'],
				['bid_increment', '50'],
				['reserve', '0'],
				['settlement_policy', 'cashu_p2pk_path_oracle_v1'],
				['key_scheme', 'hd_p2pk'],
				['p2pk_xpub', XPUB],
				['path_issuer', TEST_APP_PUBLIC_KEY],
				['settlement_grace', '7200'],
				['extension_rule', 'none'],
				['schema', 'auction_v1'],
				// ADR-0011 Decision 8 — emit the canonical DLEQ activation tag
				// explicitly instead of relying on the deploy-time `start_at`
				// boundary, so these scenarios keep exercising the DLEQ-required
				// lock path if the boundary ever moves. Scenario 4 below passes
				// `dleqRequired: false` for the grandfathered legacy path.
				['dleq_required', (overrides.dleqRequired ?? true) ? '1' : '0'],
				...overrides.mints.map((mint) => ['mint', mint]),
				['image', 'https://placehold.co/600x600', '600x600', '0'],
			],
		},
		skBytes,
	)
	await relay.publish(event)
	return event
}

async function waitForWalletReady(page: import('@playwright/test').Page, timeoutMs = 30_000) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const status = await page.evaluate(() => {
			const w = (window as any).__nip60
			return w ? w.getStatus().status : 'unavailable'
		})
		if (status === 'ready' || status === 'no_wallet') return status
		await page.waitForTimeout(500)
	}
	throw new Error('Wallet did not initialize within timeout')
}

async function fundWallet(page: import('@playwright/test').Page, amount: number, mintUrl: string) {
	const result = await page.evaluate(
		async ({ amount: amt, mintUrl: mint }) => {
			const w = (window as any).__nip60
			if (!w) throw new Error('__nip60 bridge not available')
			// ADR-0005: mint e-cash from the requested (local) mint ONLY — never
			// fall back to the external dev testnet mints. Without this, a failed
			// local mint minting silently continues to testnut.cashu.space etc.
			// (real external network calls from an e2e test).
			return await w.mintTestEcash(amt, mint, { allowFallback: false })
		},
		{ amount, mintUrl },
	)
	return result
}

async function waitForWalletBalance(page: import('@playwright/test').Page, minBalance: number, timeoutMs = 30_000) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const status = await page.evaluate(() => {
			const w = (window as any).__nip60
			return w ? w.getStatus() : { balance: 0, status: 'unavailable' }
		})
		if (status.balance >= minBalance && status.status === 'ready') return status
		await page.waitForTimeout(500)
	}
	throw new Error(`Wallet balance did not reach ${minBalance} within timeout`)
}

/**
 * Wait until a mint URL is registered in the wallet store. The __nip60
 * addMint bridge updates the store synchronously, but polling makes the
 * registration explicit (and fails loudly if the wallet was not ready to
 * accept it) instead of relying on a fixed sleep for React to pick up the
 * store update.
 */
async function waitForWalletMint(page: import('@playwright/test').Page, mintUrl: string, timeoutMs = 30_000) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const registered = await page.evaluate((url) => {
			const w = (window as any).__nip60
			const mints: string[] = w ? (w.getStatus().mints ?? []) : []
			return mints.includes(url)
		}, mintUrl)
		if (registered) return
		await page.waitForTimeout(500)
	}
	throw new Error(`Mint ${mintUrl} did not appear in the wallet store within timeout`)
}

/**
 * Dynamically set the bid amount to exceed the actual wallet balance,
 * ensuring `hasInsufficientBidFunds = true` regardless of accumulated
 * balance from previous tests.
 *
 * The wallet balance persists across tests because NDK loads wallet state
 * from IndexedDB/localStorage, not just from relay events. Hardcoding a
 * small bid amount (e.g. 100 sats) may not trigger insufficient funds
 * if the wallet already has thousands of sats.
 *
 * This helper reads the balance via __nip60.getStatus(), computes a bid
 * amount of max(100, balance + 500), and fills the always-visible bid
 * amount input directly (the single-input rework removed the "Customize
 * bid" edit-mode toggle).
 *
 * Must be called after waitForWalletReady (or waitForWalletBalance) and
 * before clicking the bid button.
 */
async function ensureInsufficientBidFunds(page: import('@playwright/test').Page) {
	const balance = await page.evaluate(() => {
		const w = (window as any).__nip60
		return w ? (w.getStatus().balance ?? 0) : 0
	})

	// seedAuction sets starting_bid to 100 SAT, so minBid = 100.
	// Previous bids from earlier test runs may persist on the relay,
	// raising the "current price" above 100. deltaAmount = bidAmount - currentPrice.
	// We need deltaAmount > balance, so bidAmount > currentPrice + balance.
	// Use a large bid amount to guarantee this regardless of currentPrice.
	const minBid = 100
	const bidAmount = Math.max(minBid, balance + 500)

	// The bid amount input is always visible (single-input rework); fill it
	// directly — there is no "Customize bid" edit-mode toggle anymore.
	const bidInput = page.locator('input[type="number"]').first()
	await bidInput.fill(String(bidAmount))
}

/**
 * Set the auction-rules acknowledgment in localStorage so the rules dialog
 * is skipped and the Confirm Bid dialog appears directly.
 * Must be called BEFORE navigating to the auction page (localStorage
 * persists across same-origin navigations on the same page).
 */
async function acknowledgeAuctionRules(page: import('@playwright/test').Page) {
	await page.evaluate((pubkey) => {
		localStorage.setItem(`auction-rules-ack:v1:${pubkey}`, 'true')
	}, devUser2.pk)
}

/**
 * Purge devUser2's NDK wallet events (kind 7375/7376) from the local relay.
 *
 * Tests 1-6 fund the wallet with 20-5000 sats. Without purging, the wallet
 * balance accumulates across tests (e.g. 25,004 sats by test 7), making
 * `canFund = true` and `hasInsufficientBidFunds = false`, so
 * `startFundingForBid` returns bidData instead of opening the deposit modal.
 *
 * This helper fetches all kind 7375 and 7376 events authored by devUser2 and
 * publishes kind 5 (deletion) events for each, signed with devUser2's key.
 */
async function purgeWalletEvents() {
	const relay = await Relay.connect(RELAY_URL)
	try {
		// Fetch all kind 7375/7376 events by devUser2 via subscribe (Relay has no .list())
		const events: Event[] = []
		await new Promise<void>((resolve) => {
			const sub = relay.subscribe([{ kinds: [7375, 7376], authors: [devUser2.pk] }], {
				onevent: (event: Event) => events.push(event),
				oneose: () => {
					sub.close()
					resolve()
				},
			})
		})
		const skBytes = hexToBytes(devUser2.sk)
		for (const event of events) {
			const deletionEvent = finalizeEvent(
				{
					kind: 5,
					created_at: Math.floor(Date.now() / 1000),
					tags: [['e', event.id]],
					content: 'purge wallet event for e2e test',
				},
				skBytes,
			)
			await relay.publish(deletionEvent)
		}
	} finally {
		relay.close()
	}
}

test.describe('Auction Bidding with Multiple Mints — Rendering', () => {
	test('auction detail page renders bid button for multi-mint auction', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A, MINT_B],
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await expect(buyerPage.getByRole('button', { name: /bid|place bid|submitting/i }).first()).toBeVisible({ timeout: 10_000 })
		} finally {
			relay.close()
		}
	})

	test('auction detail page renders for single-mint auction', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await expect(buyerPage.getByRole('button', { name: /bid|place bid|submitting/i }).first()).toBeVisible({ timeout: 10_000 })
		} finally {
			relay.close()
		}
	})

	test('auction detail page renders minimum bid info', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await expect(buyerPage.getByText(/minimum allowed bid/i)).toBeVisible({ timeout: 10_000 })
		} finally {
			relay.close()
		}
	})

	test('second mint renders in mint selector when present in trusted mints', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A, MINT_B],
				dTag: 'e2e-auction-second-mint-test',
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await expect(buyerPage.getByText('Minimum allowed bid')).toBeVisible({ timeout: 10_000 })
		} finally {
			relay.close()
		}
	})
})

test.describe('Auction Bidding — Wallet-Funded Mint Selection', () => {
	test.slow()

	test.beforeEach(async () => {
		await purgeWalletEvents()
	})

	test('mint selector shows funded mint with balance', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-funded-mint-test',
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 500, MINT_A)
			await waitForWalletBalance(buyerPage, 400)
			await buyerPage.reload()

			await waitForWalletBalance(buyerPage, 400)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await expect(buyerPage.getByRole('button', { name: /bid|place bid/i }).first()).toBeVisible({ timeout: 10_000 })
			await expect(buyerPage.getByRole('button', { name: /bid|place bid/i }).first()).toBeEnabled({ timeout: 5_000 })

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr886-funded-mint-selector.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	test('funded mint shows balance and enables bid after wallet reload', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-funded-mint-reload-test',
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 500, MINT_A)
			await waitForWalletBalance(buyerPage, 400)

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr886-funded-mint-no-reload.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	test('auction funding only lists accepted mints and completes the bid', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A, MINT_B],
				dTag: 'e2e-auction-funding-fee-padding-test',
			})

			// Pre-set auction rules ack to skip the rules dialog.
			await acknowledgeAuctionRules(buyerPage)

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 20, MINT_A)
			await fundWallet(buyerPage, 20, MINT_B)
			// ADR-0005: fund the wallet's large balance from the LOCAL mint only
			// (mintTestEcash no longer falls back to the external dev testnet
			// mints, so MINT_UNTRUSTED — which has no mint behind it — cannot be
			// funded). The untrusted mint is still REGISTERED below so the mint
			// selector's filtering is exercised against a real non-auction mint
			// with zero balance.
			await fundWallet(buyerPage, 5_000, MINT_B)
			await buyerPage.reload()
			await waitForWalletBalance(buyerPage, 5_000)
			// Explicitly register mints after reload — the wallet re-inits from
			// relay events and may not have the mint in its store when the
			// deposit modal opens, causing filteredMints to be empty.
			await buyerPage.evaluate(
				(mints) => {
					const w = (window as any).__nip60
					if (w?.addMint) mints.forEach((m: string) => w.addMint(m))
				},
				[MINT_A, MINT_B, MINT_UNTRUSTED],
			)

			// Dynamically set bid amount to exceed actual wallet balance, ensuring
			// hasInsufficientBidFunds = true regardless of accumulated balance.
			await ensureInsufficientBidFunds(buyerPage)

			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()

			// Confirm Bid dialog appears (rules already acknowledged).
			const confirmDialog = buyerPage.getByRole('dialog', { name: /confirm bid/i })
			await expect(confirmDialog).toBeVisible({ timeout: 10_000 })

			// Verify the confirm dialog's mint selector lists ONLY the auction's
			// accepted mints (localhost + 127.0.0.1) — not the untrusted mint.
			// The Radix Select options are portaled outside the dialog, so query
			// them at page level.
			const mintSelectTrigger = confirmDialog.getByRole('combobox').first()
			await mintSelectTrigger.click()
			const optionLabels = await buyerPage.getByRole('option').allTextContents()
			expect(optionLabels.some((label) => label.startsWith('localhost'))).toBe(true)
			expect(optionLabels.some((label) => label.startsWith('127.0.0.1'))).toBe(true)
			expect(optionLabels.some((label) => label.includes('untrusted'))).toBe(false)
			await buyerPage.getByRole('option').first().click()

			// Confirm the bid — the wallet has insufficient funds, so funding runs
			// through the local Cashu mint. Its FakeWallet backend auto-settles the
			// Lightning invoice, so funding completes and the bid progress dialog
			// takes over (invoice fee-padding is covered by the nip60 unit tests).
			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			await expect(buyerPage.getByText(/placing your bid|bid successfully placed/i)).toBeVisible({ timeout: 20_000 })
		} finally {
			relay.close()
		}
	})
})

// ---------------------------------------------------------------------------
// Direct Lightning Bid Funding — video-recorded e2e scenarios (PR #1205/#1235)
//
// RESOLVED (PR #1280 round 3): these tests were temporarily disabled
// (2026-09-10) because they failed deterministically on the DLEQ-required
// lock path — the bid lock's P2PK swap outputs carried no NUT-12 DLEQ
// proofs, so the lock outcome was classified "unconfirmed" and the bid
// never reached "placing your bid".
//
// Root cause (isolated empirically by probing the local mint's NUT-04/05
// and P2PK-lock swap directly with cashu-ts 2.9.0): NOT the DLEQ lock
// path, but the CI-installed nutshell version. e2e.yml installed
// `pip install cashu` unpinned, which pulled nutshell
// >= 0.20.x — a version whose /v1/swap does not return NUT-12 DLEQ proofs
// on the P2PK-lock swap and whose version-01 keyset ids @cashu/cashu-ts
// 2.9.0 cannot even verify. nutshell 0.19.2 (the known-good triple
// already pinned in ci-unit.yml) returns NUT-12 DLEQ proofs on mint AND
// swap. e2e.yml now pins 'cashu==0.19.2', and
// src/lib/__tests__/auctionDLEQ.mint.integration.test.ts locks the
// property in CI: the P2PK lock-path swap issues output proofs carrying
// verifiable DLEQ (ADR-0011 Blocker 2).
//
// The scenarios therefore run on the REAL DLEQ-required lock path: the
// seeded auction carries an explicit signed `dleq_required=1` tag, so the
// payment path AND the DLEQ lock path are exercised together, per the
// round-3 review (legacy payment-path coverage must not be disabled).
// Scenario 4 is the grandfathered counterpart (`dleq_required=0`) — the
// legacy non-DLEQ cohort keeps its own end-to-end payment-path coverage.
//
// These tests exercise the full bid → deposit → mint → lock → publish
// lifecycle against the REAL local Cashu mint. The invoice the app creates
// (NUT-04) is settled by the local mint's FakeWallet backend instantly,
// and the wallet's deposit monitor completes the real NUT-05 minting round
// trip on its own — the __nip60 dev bridge is used only for wallet set-up
// (mintTestEcash, addMint) and to READ deposit status (getDepositStatus).
// No payment is faked via simulateDepositSuccess.
//
// NOTE: These tests require a running dev server (port 34567), local relay
// (nak serve on port 10547), and a local Cashu mint (port 3338, started
// automatically by the Playwright webServer config).
// ---------------------------------------------------------------------------

test.describe('Direct Lightning Bid Funding (video recorded)', () => {
	// Video is scoped to this suite by the spec-level test.use({ video: 'on' })
	// at the top of this file; the global default in playwright.config.ts is
	// retain-on-failure.
	test.slow()

	test.beforeEach(async () => {
		await purgeWalletEvents()
	})

	/** Bid event kind per AUCTIONS.md §4.2. */
	const AUCTION_BID_KIND = 1023

	/** Timeout for the deposit confirmation monitor (must match nip60 store). */
	const DEPOSIT_TIMEOUT_MS = 15_000

	/**
	 * Wait for the deposit QR code to appear inside the bid-variant
	 * DepositLightningModal. The QR is rendered as an <svg> inside the dialog.
	 */
	async function waitForDepositQR(page: import('@playwright/test').Page, timeoutMs = 30_000) {
		// The DepositLightningModal renders a Radix Dialog whose DialogTitle is
		// "Bid with lightning" (bid variant). The title contains a Zap icon <svg>,
		// so we locate the dialog by its visible title text rather than by role
		// name (which can be unreliable when the title has mixed content).
		const dialog = page.getByRole('dialog').filter({ hasText: /bid with lightning/i })
		await expect(dialog).toBeVisible({ timeout: 15_000 })
		// The QR code is rendered as a <QRCodeSVG> which produces an <svg> inside
		// a <button>. The title's Zap icon is also an <svg>, so target the QR
		// container specifically (it's inside a div with fixed 216×216 dimensions).
		await expect(dialog.locator('div[class*="216"] svg')).toBeVisible({ timeout: timeoutMs })
		return dialog
	}

	/**
	 * Read the current deposit status via the __nip60 dev bridge (read-only —
	 * the bridge is never used to fake payment state in these scenarios).
	 */
	async function getDepositStatus(page: import('@playwright/test').Page) {
		return await page.evaluate(() => {
			const w = (window as any).__nip60
			return w?.getDepositStatus?.() ?? null
		})
	}

	/**
	 * Block the local mint's NUT-05 token-issuing endpoint (POST
	 * /v1/mint/bolt11) so the wallet's deposit monitor can never mint the
	 * proofs for the quote it created. The FakeWallet backend settles
	 * invoices instantly, so without this interception a natural payment
	 * timeout can never occur against the local mint: with the endpoint
	 * blocked, the deposit cannot finalize and the 15s confirmation timeout
	 * fires exactly as it would for an unpaid invoice on a real Lightning
	 * backend. The quote-creation endpoint (NUT-04, /v1/mint/quote/bolt11)
	 * and the keyset/info endpoints stay reachable, so the invoice itself
	 * is real. This intercepts LOCAL traffic only (ADR-0005 is unaffected).
	 */
	async function blockMintTokenEndpoint(page: import('@playwright/test').Page) {
		await page.route('**/v1/mint/bolt11', (route) => route.abort())
	}

	/**
	 * Subscribe to the relay and wait for a kind-1023 bid event referencing
	 * the given auction root event id. Returns the event or null on timeout.
	 */
	async function waitForBidEvent(
		relay: Relay,
		auctionEventId: string,
		timeoutMs = 30_000,
	): Promise<{ id: string; pubkey: string; kind: number; tags: string[][] } | null> {
		return new Promise((resolve) => {
			const sub = relay.subscribe([{ kinds: [AUCTION_BID_KIND], '#e': [auctionEventId], limit: 1 }], {
				onevent(event) {
					sub.close()
					resolve(event)
				},
				oneose() {
					// No events yet — keep waiting, the EOSE just means the
					// initial scan is done.
				},
			})
			setTimeout(() => {
				sub.close()
				resolve(null)
			}, timeoutMs)
		})
	}

	// ── Scenario 1: Happy Path ─────────────────────────────────────────

	test('happy path: bid → insufficient funds → QR invoice → pay → e-cash minted → bid published', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-ln-bid-funding-happy-path',
			})

			// Pre-set auction rules ack to skip the rules dialog.
			await acknowledgeAuctionRules(buyerPage)

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			// Wait for wallet to initialise, then fund with a small amount so
			// the wallet knows about the mint. The bid amount is set dynamically
			// to exceed the wallet balance, so the deposit modal will open.
			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 20, MINT_A)
			await buyerPage.reload()
			await waitForWalletReady(buyerPage)
			// Wait for the wallet balance to be loaded from relay events after
			// reload. waitForWalletReady only checks status === 'ready', but the
			// mint balances may not be loaded yet, causing resolveAuctionMintSelection
			// to see no available mints and depositMint to be null.
			await waitForWalletBalance(buyerPage, 1)
			// Explicitly register mint after reload — wallet re-inits from relay
			// events and may not have the mint in its store when the deposit
			// modal opens, causing filteredMints to be empty.
			await buyerPage.evaluate((mint) => {
				const w = (window as any).__nip60
				if (w?.addMint) w.addMint(mint)
			}, MINT_A)
			// Wait until the mint is registered in the wallet store so the
			// deposit modal's mint selection sees it.
			await waitForWalletMint(buyerPage, MINT_A)

			// Dynamically set bid amount to exceed actual wallet balance, ensuring
			// hasInsufficientBidFunds = true regardless of accumulated balance.
			await ensureInsufficientBidFunds(buyerPage)
			// Click the bid button — opens the Confirm Bid dialog.
			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()

			const confirmDialog = buyerPage.getByRole('dialog', { name: /confirm bid/i })
			await expect(confirmDialog).toBeVisible({ timeout: 10_000 })

			// Select a mint in the confirm dialog (if a mint selector is shown).
			// The mint selector is a Radix Select (combobox) whose dropdown content
			// is portaled outside the dialog DOM, so we query options at page level.
			const mintSelectTrigger = confirmDialog.getByRole('combobox').first()
			if (await mintSelectTrigger.isVisible().catch(() => false)) {
				await mintSelectTrigger.click()
				await buyerPage.getByRole('option').first().click()
			}

			// Confirm the bid — since wallet has insufficient funds, the
			// DepositLightningModal (bid variant) opens with a QR invoice.
			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			// Wait for the QR code to appear (auto-generated in bid variant).
			const depositDialog = await waitForDepositQR(buyerPage)

			// Verify the invoice amount is displayed.
			await expect(depositDialog.getByText(/sats/i)).toBeVisible({ timeout: 10_000 })

			// The local mint's FakeWallet backend settles the invoice instantly, so
			// the wallet's deposit monitor completes the REAL NUT-04 → NUT-05 round
			// trip on its own: the quote is paid, proofs are minted and stored, and
			// the deposit emits 'success' → onSuccess → handleFundingSuccess →
			// submitPreparedBid → kind-1023 published. No payment simulation is used.
			//
			// Assert the bid progress dialog (the modal's transient
			// 'Deposit Successful!' screen is torn down immediately by
			// handleFundingSuccess, so asserting it would be flake-prone).
			await expect(buyerPage.getByText(/placing your bid|bid successfully placed/i)).toBeVisible({ timeout: 30_000 })

			// Verify the bid event (kind 1023) was published to the relay.
			const bidEvent = await waitForBidEvent(relay, auctionEvent.id, 30_000)
			expect(bidEvent).not.toBeNull()
			expect(bidEvent!.kind).toBe(AUCTION_BID_KIND)
			expect(bidEvent!.pubkey).toBe(devUser2.pk)
			// The bid event must reference the auction root event id via 'e' tag.
			expect(bidEvent!.tags.some((t) => t[0] === 'e' && t[1] === auctionEvent.id)).toBe(true)

			// ADR-0011 — DLEQ-required lock coverage, end to end. The seeded
			// auction carries `dleq_required=1`, so the lock validated the
			// freshly issued P2PK outputs carry NUT-12 proofs and the published
			// kind-1023 must carry one `dleq_proof` tag per `lock_secret`, in
			// parallel order. Without this the bid would be unverifiable
			// collateral (validators classify a DLEQ-required bid with no
			// `dleq_proof` tags as `dleq_invalid`).
			const lockSecrets = bidEvent!.tags.filter((t) => t[0] === 'lock_secret')
			const proofYs = bidEvent!.tags.filter((t) => t[0] === 'proof_y')
			const dleqProofs = bidEvent!.tags.filter((t) => t[0] === 'dleq_proof')
			expect(lockSecrets.length).toBeGreaterThan(0)
			expect(proofYs).toHaveLength(lockSecrets.length)
			expect(dleqProofs).toHaveLength(lockSecrets.length)
			for (const tag of dleqProofs) {
				const parsed = JSON.parse(tag[1]) as { id?: string; amount?: number; C?: string; e?: string; s?: string; r?: string }
				expect(parsed.id).toBeTruthy()
				expect(parsed.amount).toBeGreaterThan(0)
				// Compressed secp256k1 point (the mint signature `C`).
				expect(parsed.C).toMatch(/^0[23][0-9a-f]{64}$/)
				expect(parsed.e).toBeTruthy()
				expect(parsed.s).toBeTruthy()
				// `r` (blinding factor) is what makes the proof verifiable offline.
				expect(parsed.r).toBeTruthy()
			}

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr1205-ln-bid-funding-happy-path.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	// ── Scenario 2: Timeout ────────────────────────────────────────────

	test('timeout: invoice generated → 15s timeout → retry confirmation', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-ln-bid-funding-timeout',
			})

			await acknowledgeAuctionRules(buyerPage)

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 20, MINT_A)
			await buyerPage.reload()
			await waitForWalletReady(buyerPage)
			// Wait for the wallet balance to be loaded from relay events after
			// reload. waitForWalletReady only checks status === 'ready', but the
			// mint balances may not be loaded yet, causing resolveAuctionMintSelection
			// to see no available mints and depositMint to be null.
			await waitForWalletBalance(buyerPage, 1)
			// Explicitly register mint after reload.
			await buyerPage.evaluate((mint) => {
				const w = (window as any).__nip60
				if (w?.addMint) w.addMint(mint)
			}, MINT_A)
			// Wait until the mint is registered in the wallet store so the
			// deposit modal's mint selection sees it.
			await waitForWalletMint(buyerPage, MINT_A)

			// Dynamically set bid amount to exceed actual wallet balance, ensuring
			// hasInsufficientBidFunds = true regardless of accumulated balance.
			await ensureInsufficientBidFunds(buyerPage)
			// Place a bid to open the deposit modal.
			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()

			const confirmDialog = buyerPage.getByRole('dialog', { name: /confirm bid/i })
			await expect(confirmDialog).toBeVisible({ timeout: 10_000 })

			const mintSelectTrigger = confirmDialog.getByRole('combobox').first()
			if (await mintSelectTrigger.isVisible().catch(() => false)) {
				await mintSelectTrigger.click()
				await buyerPage.getByRole('option').first().click()
			}

			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			// Block the mint's NUT-05 token endpoint BEFORE the deposit monitor can
			// mint proofs, so the 15 s confirmation timeout fires (see
			// blockMintTokenEndpoint). The invoice (NUT-04 quote) itself is real.
			await blockMintTokenEndpoint(buyerPage)

			// Wait for the QR invoice to appear.
			const depositDialog = await waitForDepositQR(buyerPage)

			// #1235 round-3 fix 2 (felixfelix #2) — capture the invoice identity from
			// the modal's readOnly invoice input BEFORE the timeout/retry: the retry
			// below must reconcile THIS payment, never create a fresh quote.
			// (The input truncates visually, but inputValue() returns the full string.)
			const invoiceInput = depositDialog.locator('input[type="text"]')
			await expect(invoiceInput).not.toHaveValue('', { timeout: 15_000 })
			const invoiceBeforeRetry = await invoiceInput.inputValue()
			expect(invoiceBeforeRetry.length).toBeGreaterThan(0)

			// Wait for the deposit confirmation timeout (15 s + buffer).
			// The deposit monitor sets depositStatus to 'awaiting_confirmation_retry'.
			await buyerPage.waitForTimeout(DEPOSIT_TIMEOUT_MS + 2_000)

			// Verify the deposit status is 'awaiting_confirmation_retry' via
			// the __nip60 dev bridge.
			const depositStatus = await getDepositStatus(buyerPage)
			expect(depositStatus).not.toBeNull()
			expect(depositStatus.depositStatus).toBe('awaiting_confirmation_retry')

			// The bid-variant deposit view renders the needsConfirmationRetry UI:
			// a "Confirmation timed out." status and a "Retry check" button that
			// calls retryDepositConfirmation() (DepositLightningModal.tsx). This
			// is the real user surface — there is no classic top-up view in the
			// bid variant (the previously targeted 'or top up your wallet' button
			// does not exist anywhere in src/).
			await expect(depositDialog.getByText(/confirmation timed out/i)).toBeVisible({ timeout: 10_000 })
			const retryButton = depositDialog.getByRole('button', { name: /retry check/i })
			await expect(retryButton).toBeVisible({ timeout: 10_000 })

			// Click "Retry check" — this calls retryDepositConfirmation()
			// which resets depositStatus to 'pending' and re-checks the mint for
			// the SAME deposit (quote identity is preserved).
			await retryButton.click()

			// Verify the deposit status returned to 'pending' after retry. This is
			// deterministic while the NUT-05 endpoint is still blocked — the retry
			// re-check cannot succeed, so the status cannot advance past the
			// synchronous 'pending' reset performed by retryDepositConfirmation().
			const postRetryStatus = await getDepositStatus(buyerPage)
			expect(postRetryStatus).not.toBeNull()
			expect(postRetryStatus.depositStatus).toBe('pending')
			// Invoice-identity invariant, part 1 (read via the __nip60 dev bridge,
			// after the retry click but before the retry can complete): the store
			// still holds the SAME invoice the modal displayed — the retry re-arms
			// the confirmation monitor for the ORIGINAL quote; no new funding
			// session (which would show a fresh invoice here) was created.
			expect(postRetryStatus.depositInvoice).toBe(invoiceBeforeRetry)

			// Unblock the mint's token endpoint: the deposit monitor (re-armed by
			// the retry) reconciles the SAME quote against the real local mint —
			// the FakeWallet backend has already settled the invoice — mints the
			// proofs and completes the funding flow into bid publication.
			//
			// What is proven below, e2e-level, for the retry reconciliation
			// invariant: (1) the invoice captured before the retry is still the
			// active deposit invoice in the store after the retry click (same
			// quote reconciled — no fresh NUT-04 quote), (2) the SAME deposit
			// settles and the flow reaches bid publication (success text), and
			// (3) after success the funding session is torn down — the bid
			// variant closes the deposit modal immediately
			// (handleFundingSuccess) and the modal's open→closed effect fully
			// clears the terminal deposit session (cancelDeposit without
			// preserveRecovery), so the store deterministically returns to
			// 'idle' with the invoice cleared. A second funding session would
			// have left a fresh pending deposit + invoice behind instead.
			await buyerPage.unroute('**/v1/mint/bolt11')
			await expect(buyerPage.getByText(/placing your bid|bid successfully placed/i)).toBeVisible({ timeout: 30_000 })

			// Invoice-identity invariant, part 2 (read via the __nip60 dev bridge,
			// after success): the SAME deposit settled and the session was then
			// torn down — the store returns to its cleared post-session state
			// ('idle', invoice null), which also proves no NEW quote/deposit was
			// created by the reconciliation. The terminal 'success' state itself
			// is transient by design (the modal closes immediately on success),
			// so it is not observable here.
			await expect.poll(async () => (await getDepositStatus(buyerPage))?.depositStatus, { timeout: 15_000 }).toBe('idle')
			const finalDepositStatus = await getDepositStatus(buyerPage)
			expect(finalDepositStatus).not.toBeNull()
			expect(finalDepositStatus.depositInvoice).toBeNull()

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr1205-ln-bid-funding-timeout.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	// ── Scenario 3: Signing Failure ────────────────────────────────────

	test('signing failure: deposit succeeds → bid publish fails → retry available', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-ln-bid-funding-publish-failure',
			})

			await acknowledgeAuctionRules(buyerPage)

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			// Wait for wallet and fund with a small amount so the wallet
			// knows about the mint. The bid amount is set dynamically to
			// exceed the wallet balance, so the deposit modal will open.
			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 20, MINT_A)
			await buyerPage.reload()
			await waitForWalletReady(buyerPage)
			// Wait for the wallet balance to be loaded from relay events after
			// reload. waitForWalletReady only checks status === 'ready', but the
			// mint balances may not be loaded yet, causing resolveAuctionMintSelection
			// to see no available mints and depositMint to be null.
			await waitForWalletBalance(buyerPage, 1)
			// Explicitly register mint after reload.
			await buyerPage.evaluate((mint) => {
				const w = (window as any).__nip60
				if (w?.addMint) w.addMint(mint)
			}, MINT_A)
			// Wait until the mint is registered in the wallet store so the
			// deposit modal's mint selection sees it.
			await waitForWalletMint(buyerPage, MINT_A)

			// Dynamically set bid amount to exceed actual wallet balance, ensuring
			// hasInsufficientBidFunds = true regardless of accumulated balance.
			await ensureInsufficientBidFunds(buyerPage)
			// #1235 round-3 fix 7 (felixfelix #10) — intercept NIP-07 signEvent for
			// kind-1023 to simulate a SIGNING failure (NOT a relay rejection: the
			// event never reaches a relay). The publish pipeline caches the built
			// UNSIGNED event before signing, so the signEvent throw surfaces as
			// AuctionBidPublishFailedError carrying the finalized event id: after
			// the deposit succeeds and e-cash is minted, the bid mutation throws,
			// the funding hook transitions to
			// 'mint_succeeded_bid_publish_failed_reclaimable' with a toast, and the
			// Retry publish path can re-sign the SAME cached event (same id, zero
			// additional mint interaction) — the unsigned-cache re-sign path this
			// scenario exercises.
			await buyerPage.evaluate(() => {
				const nostr = (window as any).nostr
				if (!nostr) return
				const originalSignEvent = nostr.signEvent
				;(window as any).__originalSignEvent = originalSignEvent
				nostr.signEvent = async (event: any) => {
					if (event.kind === 1023) {
						throw new Error('Mock: relay rejected bid event')
					}
					return originalSignEvent.call(nostr, event)
				}
			})

			// Place a bid — wallet has insufficient funds (bid amount exceeds
			// wallet balance), so the deposit modal opens after Confirm.
			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()

			const confirmDialog = buyerPage.getByRole('dialog', { name: /confirm bid/i })
			await expect(confirmDialog).toBeVisible({ timeout: 10_000 })

			const mintSelectTrigger = confirmDialog.getByRole('combobox').first()
			if (await mintSelectTrigger.isVisible().catch(() => false)) {
				await mintSelectTrigger.click()
				await buyerPage.getByRole('option').first().click()
			}

			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			// Wait for the deposit QR invoice to appear. The local mint's
			// FakeWallet backend settles the invoice instantly, so the wallet's
			// deposit monitor completes the real NUT-04 → NUT-05 round trip on
			// its own (no payment simulation). This triggers depositStatus →
			// 'success' → onSuccess → submitPreparedBid → kind-1023 publish
			// (which fails — signEvent is intercepted above).
			await waitForDepositQR(buyerPage)

			// Verify the error toast appears indicating the bid publish step
			// failed (the failure is the local signing of the kind-1023).
			await expect(buyerPage.getByText(/bid publishing failed/i)).toBeVisible({ timeout: 30_000 })

			// Restore the original signEvent so a retry can succeed.
			await buyerPage.evaluate(() => {
				const nostr = (window as any).nostr
				if (nostr && (window as any).__originalSignEvent) {
					nostr.signEvent = (window as any).__originalSignEvent
					delete (window as any).__originalSignEvent
				}
			})

			// Verify the publish-failure terminal state and its retry affordance.
			// After the deposit succeeds and the publish fails, the funding hook
			// opens the bid progress dialog in the
			// 'mint_succeeded_bid_publish_failed_reclaimable' state: the dialog
			// (which does NOT auto-close) shows "Bid Publish Failed" and a
			// "Retry publish" button — the designed retry affordance
			// (AuctionBidProgressDialog). The page-level bid button is not
			// reachable while the dialog is open, so assert the affordance where
			// it actually lives.
			const failureDialog = buyerPage.getByRole('dialog').filter({ hasText: /bid publish failed/i })
			await expect(failureDialog).toBeVisible({ timeout: 10_000 })
			const retryPublishButton = failureDialog.getByRole('button', { name: /retry publish/i })
			await expect(retryPublishButton).toBeVisible()
			await expect(retryPublishButton).toBeEnabled()

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr1205-ln-bid-funding-publish-failure.png'),
				fullPage: true,
			})

			// #1235 round-3 fix 7 (felixfelix #10 + #9) — complete the retry and
			// traverse the hook→publisher seam: clicking Retry publish must drive
			// retryBidPublish → republishAuctionBid on the cached UNSIGNED kind-1023
			// — re-signing it locally (signEvent restored above), keeping the SAME
			// event id, and touching the mint ZERO additional times — all the way
			// to a relay-visible bid event.
			await retryPublishButton.click()

			await expect(buyerPage.getByText(/placing your bid|bid successfully placed/i)).toBeVisible({ timeout: 30_000 })

			// The relay receives the retried kind-1023 for this auction.
			const retriedBidEvent = await waitForBidEvent(relay, auctionEvent.id, 30_000)
			expect(retriedBidEvent).not.toBeNull()
			expect(retriedBidEvent!.kind).toBe(AUCTION_BID_KIND)
			expect(retriedBidEvent!.pubkey).toBe(devUser2.pk)
			// The bid event must reference the auction root event id via 'e' tag.
			expect(retriedBidEvent!.tags.some((t) => t[0] === 'e' && t[1] === auctionEvent.id)).toBe(true)

			// In-app identity check: the bidder record the app persisted for
			// this leg (written before the first publish attempt) carries the
			// same event id the relay received — the retry published the SAME
			// event, not a re-built one. The dev bridge exposes no bid-event id,
			// so read the app's durable per-user bidder records from
			// localStorage (user-scoped key includes 'auction_bidder_records_v1').
			const localBidEventIds = await buyerPage.evaluate(() => {
				const ids: string[] = []
				for (let index = 0; index < localStorage.length; index++) {
					const key = localStorage.key(index)
					if (!key || !key.includes('auction_bidder_records_v1')) continue
					try {
						const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
						if (!Array.isArray(parsed)) continue
						for (const record of parsed) if (record && typeof record.bidEventId === 'string') ids.push(record.bidEventId)
					} catch {
						// ignore malformed entries
					}
				}
				return ids
			})
			expect(localBidEventIds).toContain(retriedBidEvent!.id)
		} finally {
			relay.close()
		}
	})

	// ── Scenario 4: grandfathered (non-DLEQ) auction ───────────────────

	test('legacy auction (dleq_required=0): bid funds and publishes WITHOUT dleq_proof tags', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			// ADR-0011 Decision 7/8 — a grandfathered auction opts out of the
			// DLEQ requirement with the canonical signed tag. The legacy
			// non-DLEQ collateral path must stay fully usable for that cohort,
			// so this scenario is the non-DLEQ counterpart of the happy path
			// above: same payment funnel, no `dleq_proof` tags on the result.
			// It also covers the bid FORM's canonical threading end to end:
			// with the form omitting `dleqRequired`, the publish path fell back
			// to the `start_at` boundary and this bid carried two `dleq_proof`
			// tags (RED) instead of none.
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-ln-bid-funding-legacy-auction',
				dleqRequired: false,
			})

			await acknowledgeAuctionRules(buyerPage)

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 20, MINT_A)
			await buyerPage.reload()
			await waitForWalletReady(buyerPage)
			await waitForWalletBalance(buyerPage, 1)
			await buyerPage.evaluate((mint) => {
				const w = (window as any).__nip60
				if (w?.addMint) w.addMint(mint)
			}, MINT_A)
			await waitForWalletMint(buyerPage, MINT_A)

			await ensureInsufficientBidFunds(buyerPage)
			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()

			const confirmDialog = buyerPage.getByRole('dialog', { name: /confirm bid/i })
			await expect(confirmDialog).toBeVisible({ timeout: 10_000 })

			const mintSelectTrigger = confirmDialog.getByRole('combobox').first()
			if (await mintSelectTrigger.isVisible().catch(() => false)) {
				await mintSelectTrigger.click()
				await buyerPage.getByRole('option').first().click()
			}

			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			await expect(buyerPage.getByText(/placing your bid|bid successfully placed/i)).toBeVisible({ timeout: 30_000 })

			const bidEvent = await waitForBidEvent(relay, auctionEvent.id, 30_000)
			expect(bidEvent).not.toBeNull()
			expect(bidEvent!.kind).toBe(AUCTION_BID_KIND)
			expect(bidEvent!.pubkey).toBe(devUser2.pk)
			expect(bidEvent!.tags.some((t) => t[0] === 'e' && t[1] === auctionEvent.id)).toBe(true)

			// The legacy path still publishes its lock collateral...
			expect(bidEvent!.tags.filter((t) => t[0] === 'lock_secret').length).toBeGreaterThan(0)
			// ...and must NOT publish `dleq_proof` tags: the lock ran without
			// the output DLEQ requirement (N1 — the tag decision follows the
			// same signed `dleq_required=0` the lock was given).
			expect(bidEvent!.tags.filter((t) => t[0] === 'dleq_proof')).toHaveLength(0)
		} finally {
			relay.close()
		}
	})
})
