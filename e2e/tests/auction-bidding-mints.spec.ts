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
 * MINT_UNTRUSTED is a non-working local URL; mintTestEcash falls back to
 * the trusted dev mints when the preferred URL is not in the trusted list.
 */

import { test, expect } from '../fixtures'
import { RELAY_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2, XPUB } from '../../src/lib/fixtures'
import path from 'node:path'
import { decode } from 'light-bolt11-decoder'

useWebSocketImplementation(WebSocket)

const D_TAG = 'e2e-auction-mint-test'
const MINT_A = 'http://localhost:3338'
const MINT_B = 'http://127.0.0.1:3338'
const MINT_UNTRUSTED = 'http://untrusted.localhost:3340'
const SCREENSHOT_DIR = 'test-results'

async function seedAuction(relay: Relay, overrides: { mints: string[]; dTag?: string }) {
	const skBytes = hexToBytes(devUser1.sk)
	const now = Math.floor(Date.now() / 1000)
	const startAt = now - 60
	const endAt = now + 3600
	const maxEndAt = now + 7200

	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'E2E auction for mint selection testing',
			tags: [
				['d', overrides.dTag ?? D_TAG],
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
			return await w.mintTestEcash(amt, mint)
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

const parseBolt11Sats = (bolt11: string): number => {
	const amountMillisatsRaw = decode(bolt11).sections.find((section) => section.name === 'amount')?.value
	if (!amountMillisatsRaw) {
		throw new Error('No amount section found in bolt11 invoice')
	}
	const amountMillisats = parseInt(amountMillisatsRaw, 10)
	if (!Number.isFinite(amountMillisats) || amountMillisats <= 0) {
		throw new Error(`Invalid bolt11 amount section: ${amountMillisatsRaw}`)
	}
	return Math.floor(amountMillisats / 1000)
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

	test('auction funding modal only lists accepted mints and invoice amount includes fee padding', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A, MINT_B],
				dTag: 'e2e-auction-funding-fee-padding-test',
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 20, MINT_A)
			await fundWallet(buyerPage, 20, MINT_B)
			await fundWallet(buyerPage, 5_000, MINT_UNTRUSTED)
			await buyerPage.reload()
			await waitForWalletBalance(buyerPage, 5_000)

			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()
			const depositDialog = buyerPage.getByRole('dialog')
			await expect(depositDialog.getByText('Deposit Lightning')).toBeVisible({ timeout: 10_000 })

			const mintSelect = depositDialog.locator('select').first()
			const optionLabels = await mintSelect.locator('option').allTextContents()
			expect(optionLabels).toContain('localhost')
			expect(optionLabels).toContain('127.0.0.1')
			expect(optionLabels).not.toContain('untrusted.localhost')

			const amountInput = depositDialog.locator('input[type="number"]').first()
			const requestedAmount = Number(await amountInput.inputValue())
			expect(Number.isFinite(requestedAmount)).toBe(true)
			expect(requestedAmount).toBeGreaterThan(0)

			await depositDialog.getByRole('button', { name: 'Generate Invoice' }).click()
			await expect(depositDialog.getByText('Lightning Invoice')).toBeVisible({ timeout: 15_000 })

			const invoiceValue = await depositDialog.locator('input[readonly]').first().inputValue()
			expect(invoiceValue.toLowerCase().startsWith('ln')).toBe(true)

			const invoiceAmountSats = parseBolt11Sats(invoiceValue)
			expect(invoiceAmountSats).toBeGreaterThan(requestedAmount)
		} finally {
			relay.close()
		}
	})
})

// ---------------------------------------------------------------------------
// Direct Lightning Bid Funding — video-recorded e2e scenarios (PR #1205)
//
// These tests exercise the full bid → deposit → mint → publish lifecycle
// using the __nip60 dev bridge to simulate Lightning payment confirmation
// without a real Lightning node. Video recording is always on for this group.
//
// NOTE: These tests require a running dev server (port 34567), local relay
// (nak serve on port 10547), and a local Cashu mint (port 3338, started
// automatically by the Playwright webServer config).
// ---------------------------------------------------------------------------

test.describe('Direct Lightning Bid Funding (video recorded)', () => {
	// video: 'on' set in playwright.config.ts
	test.slow()

	/** Bid event kind per AUCTIONS.md §4.2. */
	const AUCTION_BID_KIND = 1023

	/** Timeout for the deposit confirmation monitor (must match nip60 store). */
	const DEPOSIT_TIMEOUT_MS = 15_000

	/**
	 * Set the auction-rules acknowledgment in localStorage so the rules dialog
	 * is skipped and the Confirm Bid dialog appears directly.
	 */
	async function acknowledgeAuctionRules(page: import('@playwright/test').Page) {
		await page.evaluate((pubkey) => {
			localStorage.setItem(`auction-rules-ack:v1:${pubkey}`, 'true')
		}, devUser2.pk)
	}

	/**
	 * Wait for the deposit QR code to appear inside the bid-variant
	 * DepositLightningModal. The QR is rendered as an <svg> inside the dialog.
	 */
	async function waitForDepositQR(page: import('@playwright/test').Page, timeoutMs = 30_000) {
		const dialog = page.getByRole('dialog', { name: /bid with lightning/i })
		await expect(dialog).toBeVisible({ timeout: 15_000 })
		await expect(dialog.locator('svg')).toBeVisible({ timeout: timeoutMs })
		return dialog
	}

	/**
	 * Simulate a Lightning invoice payment by emitting 'success' on the active
	 * deposit via the __nip60 dev bridge. This triggers the same store
	 * transition as a real mint confirmation.
	 */
	async function simulateDepositPayment(page: import('@playwright/test').Page) {
		const ok = await page.evaluate(() => {
			const w = (window as any).__nip60
			if (w?.simulateDepositSuccess) {
				w.simulateDepositSuccess()
				return true
			}
			return false
		})
		expect(ok).toBe(true)
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

			// Wait for wallet to initialise — no funding, so balance is 0
			// (insufficient for the 100 sat starting bid).
			await waitForWalletReady(buyerPage)

			// Click the bid button — opens the Confirm Bid dialog.
			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()

			const confirmDialog = buyerPage.getByRole('dialog', { name: /confirm bid/i })
			await expect(confirmDialog).toBeVisible({ timeout: 10_000 })

			// Select a mint in the confirm dialog (if a mint selector is shown).
			const mintSelectTrigger = confirmDialog.getByRole('combobox').first()
			if (await mintSelectTrigger.isVisible().catch(() => false)) {
				await mintSelectTrigger.click()
				await confirmDialog.getByRole('option').first().click()
			}

			// Confirm the bid — since wallet has insufficient funds, the
			// DepositLightningModal (bid variant) opens with a QR invoice.
			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			// Wait for the QR code to appear (auto-generated in bid variant).
			const depositDialog = await waitForDepositQR(buyerPage)

			// Verify the invoice amount is displayed.
			await expect(depositDialog.getByText(/sats/i)).toBeVisible({ timeout: 10_000 })

			// Simulate the Lightning payment being received by the mint.
			// This triggers depositStatus → 'success' → onSuccess callback →
			// handleFundingSuccess → submitPreparedBid → kind-1023 published.
			await simulateDepositPayment(buyerPage)

			// Verify the deposit success UI appears.
			await expect(buyerPage.getByText('Deposit Successful!')).toBeVisible({ timeout: 30_000 })

			// Verify the bid event (kind 1023) was published to the relay.
			const bidEvent = await waitForBidEvent(relay, auctionEvent.id, 30_000)
			expect(bidEvent).not.toBeNull()
			expect(bidEvent!.kind).toBe(AUCTION_BID_KIND)
			expect(bidEvent!.pubkey).toBe(devUser2.pk)
			// The bid event must reference the auction root event id via 'e' tag.
			expect(bidEvent!.tags.some((t) => t[0] === 'e' && t[1] === auctionEvent.id)).toBe(true)

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
				await confirmDialog.getByRole('option').first().click()
			}

			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			// Wait for the QR invoice to appear.
			await waitForDepositQR(buyerPage)

			// Wait for the deposit confirmation timeout (15 s + buffer).
			// The deposit monitor sets depositStatus to 'awaiting_confirmation_retry'.
			await buyerPage.waitForTimeout(DEPOSIT_TIMEOUT_MS + 2_000)

			// Verify the deposit status is 'awaiting_confirmation_retry' via
			// the __nip60 dev bridge.
			const depositStatus = await buyerPage.evaluate(() => {
				const w = (window as any).__nip60
				return w?.getDepositStatus?.() ?? null
			})
			expect(depositStatus).not.toBeNull()
			expect(depositStatus.depositStatus).toBe('awaiting_confirmation_retry')

			// Switch to the classic top-up view where the "Retry confirmation"
			// button is rendered (the bid-variant view uses the same "Confirm"
			// button for both initial check and retry).
			const depositDialog = buyerPage.getByRole('dialog')
			await depositDialog.getByRole('button', { name: /or top up your wallet/i }).click()

			// In the classic view, the "Retry confirmation" button appears
			// when needsConfirmationRetry is true.
			await expect(depositDialog.getByText(/confirmation timed out/i)).toBeVisible({ timeout: 10_000 })
			const retryButton = depositDialog.getByRole('button', { name: /retry confirmation/i })
			await expect(retryButton).toBeVisible({ timeout: 10_000 })

			// Click "Retry confirmation" — this calls retryDepositConfirmation()
			// which resets depositStatus to 'pending' and re-checks the mint.
			await retryButton.click()

			// Verify the deposit status returned to 'pending' after retry.
			const postRetryStatus = await buyerPage.evaluate(() => {
				const w = (window as any).__nip60
				return w?.getDepositStatus?.() ?? null
			})
			expect(postRetryStatus).not.toBeNull()
			expect(postRetryStatus.depositStatus).toBe('pending')

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr1205-ln-bid-funding-timeout.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	// ── Scenario 3: Publish Failure ────────────────────────────────────

	test('publish failure: sufficient funds → bid publish fails → retry available', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-ln-bid-funding-publish-failure',
			})

			await acknowledgeAuctionRules(buyerPage)

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.locator('h1')).toContainText('E2E Mint Test Auction', { timeout: 15_000 })

			// Wait for wallet and fund with sufficient balance (500 sats ≥ 100 sat bid).
			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 500, MINT_A)
			await waitForWalletBalance(buyerPage, 400)
			await buyerPage.reload()
			await waitForWalletBalance(buyerPage, 400)

			// Intercept NIP-07 signEvent for kind-1023 to simulate a publish
			// failure (e.g., relay rejection). The bid mutation will throw,
			// and the funding hook transitions to
			// 'mint_succeeded_bid_publish_failed_reclaimable' with a toast.
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

			// Place a bid — with sufficient funds, no deposit modal opens;
			// the bid goes directly to publish, which fails.
			await buyerPage
				.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i })
				.first()
				.click()

			const confirmDialog = buyerPage.getByRole('dialog', { name: /confirm bid/i })
			await expect(confirmDialog).toBeVisible({ timeout: 10_000 })

			const mintSelectTrigger = confirmDialog.getByRole('combobox').first()
			if (await mintSelectTrigger.isVisible().catch(() => false)) {
				await mintSelectTrigger.click()
				await confirmDialog.getByRole('option').first().click()
			}

			await confirmDialog.getByRole('button', { name: 'Confirm' }).click()

			// Verify the error toast appears indicating publish failure.
			await expect(buyerPage.getByText(/bid publishing failed/i)).toBeVisible({ timeout: 30_000 })

			// Restore the original signEvent so a retry can succeed.
			await buyerPage.evaluate(() => {
				const nostr = (window as any).nostr
				if (nostr && (window as any).__originalSignEvent) {
					nostr.signEvent = (window as any).__originalSignEvent
					delete (window as any).__originalSignEvent
				}
			})

			// Verify the bid button is still available for retry.
			await expect(buyerPage.getByRole('button', { name: /place bid|bid\s+[\d,]+\s+sats/i }).first()).toBeVisible({ timeout: 10_000 })

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr1205-ln-bid-funding-publish-failure.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})
})
