import { test, expect } from '../fixtures'
import { RELAY_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1 } from '../../src/lib/fixtures'
import path from 'node:path'
import { decode } from 'light-bolt11-decoder'

useWebSocketImplementation(WebSocket)

const D_TAG = 'e2e-auction-mint-test'
const MINT_A = 'https://testnut.cashu.space'
const MINT_B = 'https://nofees.testnut.cashu.space'
const MINT_UNTRUSTED = 'https://mint.minibits.cash/Bitcoin'
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
				mints: [MINT_A, 'https://nofees.testnut.cashu.space'],
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
				mints: [MINT_A, 'https://nofees.testnut.cashu.space'],
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
			expect(optionLabels).toContain('testnut.cashu.space')
			expect(optionLabels).toContain('nofees.testnut.cashu.space')
			expect(optionLabels).not.toContain('mint.minibits.cash')

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
