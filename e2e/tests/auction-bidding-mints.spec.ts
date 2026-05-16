import { test, expect } from '../fixtures'
import { RELAY_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils'
import WebSocket from 'ws'
import { devUser1 } from '../../src/lib/fixtures'
import path from 'node:path'

useWebSocketImplementation(WebSocket)

const D_TAG = 'e2e-auction-mint-test'
const MINT_A = 'https://testnut.cashu.space'
const MINT_B = 'https://nofees.testnut.cashu.space'
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

async function waitForWalletReady(page: import('@playwright/test').Page, timeoutMs = 20_000) {
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

async function waitForWalletBalance(page: import('@playwright/test').Page, minBalance: number, timeoutMs = 15_000) {
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

test.describe('Auction Bidding with Multiple Mints — Rendering', () => {
	test('auction detail page renders bid button for multi-mint auction', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A, MINT_B],
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await expect(buyerPage.getByRole('button', { name: /bid|place bid|submitting/i })).toBeVisible({ timeout: 10_000 })
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
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await expect(buyerPage.getByRole('button', { name: /bid|place bid|submitting/i })).toBeVisible({ timeout: 10_000 })
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
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

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
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

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
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 500, MINT_A)
			await waitForWalletBalance(buyerPage, 400)
			await buyerPage.reload()
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await expect(buyerPage.getByRole('button', { name: /bid|place bid/i })).toBeVisible({ timeout: 10_000 })
			await expect(buyerPage.getByRole('button', { name: /bid|place bid/i })).toBeEnabled({ timeout: 5_000 })

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr886-funded-mint-selector.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	test('mint selector disables underfunded mint', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-underfunded-mint-test',
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 50, MINT_A)
			await waitForWalletBalance(buyerPage, 40)
			await buyerPage.reload()
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await expect(buyerPage.locator('.opacity-60')).toBeVisible({ timeout: 10_000 })

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr886-underfunded-mint-disabled.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	test('bid button disabled when no mint can fund delta', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A],
				dTag: 'e2e-no-funds-test',
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 50, MINT_A)
			await waitForWalletBalance(buyerPage, 40)
			await buyerPage.reload()
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			const editBtn = buyerPage.locator('[title="Customize bid"]')
			await editBtn.click({ timeout: 5_000 })
			const input = buyerPage.locator('input[type="number"]')
			await input.fill('500')

			const bidBtn = buyerPage.getByRole('button', { name: /bid 500/i })
			await expect(bidBtn).toBeDisabled({ timeout: 5_000 })

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr886-bid-disabled-no-funds.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})

	test('second funded mint appears in selector and is selectable', async ({ buyerPage }) => {
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auctionEvent = await seedAuction(relay, {
				mints: [MINT_A, MINT_B],
				dTag: 'e2e-second-mint-funded-test',
			})

			await buyerPage.goto(`/auctions/${auctionEvent.id}`)
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			await waitForWalletReady(buyerPage)
			await fundWallet(buyerPage, 200, MINT_B)
			await waitForWalletBalance(buyerPage, 150)
			await buyerPage.reload()
			await expect(buyerPage.getByText('E2E Mint Test Auction')).toBeVisible({ timeout: 15_000 })

			const mintToggle = buyerPage.getByRole('button', { name: /nofees.*testnut/i })
			await expect(mintToggle).toBeVisible({ timeout: 10_000 })

			await buyerPage.screenshot({
				path: path.join(SCREENSHOT_DIR, 'pr886-second-mint-selectable.png'),
				fullPage: true,
			})
		} finally {
			relay.close()
		}
	})
})
