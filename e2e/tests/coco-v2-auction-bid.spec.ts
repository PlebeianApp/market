import { expect, test } from '../fixtures'
import { RELAY_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { Wallet, getEncodedToken } from '@cashu/cashu-ts'
import type { Page } from '@playwright/test'
import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, type Event } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import WebSocket from 'ws'
import { devUser1, devUser2, devUser3, XPUB } from '../../src/lib/fixtures'
import { COCO_AUCTIONSDEV_FAKE_MINT_INFO, COCO_AUCTIONSDEV_SMOKE_SAFE } from '../coco-auctionsdev-smoke-contract'
import { verifyFreshAuctionsdevPublicReport } from '../../src/lib/coco/migration/freshAuctionsdevReport'
import { FRESH_AUCTIONSDEV_PUBLIC_REPORT_STORAGE_KEY } from '../../src/lib/coco/migration/freshAuctionsdevBrowser'
import { writeFile } from 'node:fs/promises'

useWebSocketImplementation(WebSocket)

const MINT_URL = COCO_AUCTIONSDEV_SMOKE_SAFE.mintUrl
const COCO_E2E_ENABLED = process.env.COCO_V2_E2E === '1'
const FULL_LIFECYCLE_TITLE = `Coco v2 Full Lifecycle ${Date.now()}`
const markSmokeCheck = (check: string): void => console.log(`COCO_AUCTIONSDEV_SMOKE_CHECK=${check}`)

const mintFakeToken = async (amount: number): Promise<string> => {
	const wallet = new Wallet(MINT_URL)
	await wallet.loadMint()
	const quote = await wallet.createMintQuoteBolt11(amount)
	const proofs = await wallet.mintProofsBolt11(amount, quote)
	if (!proofs.length) throw new Error('Local fake mint returned no proofs')
	return getEncodedToken({ mint: MINT_URL, proofs, unit: 'sat' })
}

const seedAuction = async (relay: Relay): Promise<Event> => {
	const now = Math.floor(Date.now() / 1000)
	const dTag = `coco-v2-e2e-${Date.now()}`
	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now,
			content: 'Coco v2 browser integration auction',
			tags: [
				['d', dTag],
				['title', 'Coco v2 Browser Auction'],
				['summary', 'Fake-funds-only Coco browser integration'],
				['auction_type', 'english'],
				['start_at', String(now - 60)],
				['end_at', String(now + 1800)],
				['max_end_at', String(now + 3600)],
				['settlement_grace', '300'],
				['currency', 'SAT'],
				['price', '100', 'SAT'],
				['starting_bid', '100', 'SAT'],
				['bid_increment', '10'],
				['reserve', '0'],
				['mint', MINT_URL],
				['auditors', TEST_APP_PUBLIC_KEY],
				['auditor_quorum', '1'],
				['max_skew_sec', '120'],
				['min_bid_curve', 'none:1.0'],
				['key_scheme', 'hd_p2pk'],
				['p2pk_xpub', XPUB],
				['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
				['schema', 'auction_v1'],
			],
		},
		hexToBytes(devUser1.sk),
	)
	await relay.publish(event)
	return event
}

const waitForBid = async (relay: Relay, auctionId: string, timeoutMs = 30_000): Promise<Event> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const events: Event[] = []
		await new Promise<void>((resolve) => {
			const sub = relay.subscribe([{ kinds: [1023], '#e': [auctionId], authors: [devUser2.pk] }], {
				onevent: (event) => events.push(event),
				oneose: () => {
					sub.close()
					resolve()
				},
			})
		})
		if (events[0]) return events[0]
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error('Timed out waiting for Coco kind-1023')
}

const waitForRelayEvent = async (
	relay: Relay,
	filter: Record<string, unknown>,
	predicate: (event: Event) => boolean = () => true,
	timeoutMs = 30_000,
): Promise<Event> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const events: Event[] = []
		await new Promise<void>((resolve) => {
			const sub = relay.subscribe([filter as never], {
				onevent: (event) => events.push(event),
				oneose: () => {
					sub.close()
					resolve()
				},
			})
		})
		const match = events.find(predicate)
		if (match) return match
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error(`Timed out waiting for relay event matching ${JSON.stringify(filter)}`)
}

const receiveFakeFunds = async (page: Page, token: string): Promise<void> => {
	await page.getByTestId('wallet-button').click()
	await page.getByRole('button', { name: 'Receive fake eCash' }).click()
	const dialog = page.getByRole('dialog', { name: 'Receive eCash' })
	await dialog.locator('textarea').fill(token)
	await dialog.getByRole('button', { name: 'Receive', exact: true }).click()
	await expect(dialog.getByText('eCash Received!')).toBeVisible({ timeout: 30_000 })
	await dialog.getByRole('button', { name: 'Done' }).click()
	const walletButton = page.getByTestId('wallet-button')
	if ((await walletButton.getAttribute('aria-expanded')) === 'true') await walletButton.click()
}

const placeCocoBid = async (page: Page, auction: Event, bidderPubkey: string, amount: number): Promise<void> => {
	await page.evaluate((pubkey) => localStorage.setItem(`auction-rules-ack:v1:${pubkey}`, 'true'), bidderPubkey)
	// The create flow already returned the relay-acknowledged event. Open its
	// normal public route directly so index-query propagation cannot make the
	// monetary smoke flaky.
	await page.goto(`/auctions/${auction.id}`)
	await expect(page.getByRole('heading', { name: FULL_LIFECYCLE_TITLE })).toBeVisible({ timeout: 30_000 })
	await page.locator('input[type="number"]').first().fill(String(amount))
	await page
		.getByRole('button', { name: new RegExp(`place bid|bid ${amount} sats`, 'i') })
		.first()
		.click()
	let dialog = page.getByRole('dialog', { name: 'Confirm Bid' })
	await dialog.getByRole('combobox').click()
	// The normal UI intentionally presents the mint hostname, not its full
	// URL. Select the exact local fake-mint hostname so this cannot fall
	// through to a similarly named public mint.
	await page.getByRole('option', { name: /^localhost$/i }).click()
	await expect(dialog.getByText('Coco available', { exact: true })).toBeVisible()
	await expect(dialog.getByText('500 sats', { exact: true })).toBeVisible()
	await dialog.getByRole('button', { name: 'Prepare Bid' }).click()
	await expect(dialog.getByText('prepared', { exact: true })).toBeVisible({ timeout: 30_000 })
	await page.reload()
	dialog = page.getByRole('dialog', { name: 'Confirm Bid' })
	await expect(dialog.getByText('prepared', { exact: true })).toBeVisible({ timeout: 30_000 })
	await dialog.getByRole('button', { name: 'Publish Prepared Bid' }).click()
}

const publishValidVerdict = async (relay: Relay, auction: Event, bid: Event): Promise<Event> => {
	const coordinate = auction.tags.find((tag) => tag[0] === 'd')?.[1]
	if (!coordinate) throw new Error('Auction d tag is missing')
	const event = finalizeEvent(
		{
			kind: 30440,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags: [
				['d', `${bid.pubkey}:${auction.id}:${bid.id}`],
				['p', bid.pubkey],
				['a', `30408:${auction.pubkey}:${coordinate}`],
				['e', auction.id],
				['bid', bid.id],
				['claim', 'valid_bid_placed'],
				['observed_at', String(bid.created_at)],
			],
		},
		hexToBytes(process.env.CVM_SERVER_KEY || 'e2e2222222222222222222222222222222222222222222222222222222222222'),
	)
	await relay.publish(event)
	return event
}

const createAuctionThroughNormalUi = async (page: Page, relay: Relay): Promise<Event> => {
	await page.goto('/dashboard/products/auctions')
	await page.getByRole('button', { name: 'Add An Auction' }).first().click()
	const dialog = page.getByRole('dialog', { name: 'Create Auction' })
	await dialog.locator('#auction-title').fill(FULL_LIFECYCLE_TITLE)
	await dialog.locator('#auction-description').fill('Local fake-funds-only deterministic A/B/C browser smoke.')
	await dialog.getByRole('button', { name: 'Next' }).click()
	await dialog.locator('#auction-starting-bid').fill('100')
	const durationSlider = dialog.locator('[role="slider"]')
	await durationSlider.press('Home')
	await durationSlider.press('ArrowRight')
	await expect(dialog.getByText(/Runs for:\s*2 minutes/i)).toBeVisible()
	await dialog.getByRole('button', { name: 'Advanced' }).click()
	await dialog.getByRole('button', { name: /5 min.*tight/i }).click()
	await dialog.getByRole('button', { name: 'Next' }).click()
	await dialog.getByRole('button', { name: 'Next' }).click()
	await dialog.getByRole('button', { name: 'Next' }).click()
	await dialog.getByTestId('image-url-input').fill('http://localhost:34567/images/page-min.png')
	await dialog.getByTestId('image-save-button').click()
	await dialog.getByRole('button', { name: 'Next' }).click()
	await dialog.getByRole('button', { name: 'Publish Auction' }).click()
	return waitForRelayEvent(relay, { kinds: [30408], authors: [devUser1.pk], limit: 50 }, (event) =>
		event.tags.some((tag) => tag[0] === 'title' && tag[1] === FULL_LIFECYCLE_TITLE),
	)
}

const readCocoOperations = async (page: Page, pubkey: string) =>
	page.evaluate(
		async ({ accountPubkey }) => {
			const databaseName = `plebeian_coco_v2_test_${accountPubkey}`
			const open = indexedDB.open(databaseName)
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				open.onsuccess = () => resolve(open.result)
				open.onerror = () => reject(open.error)
			})
			const readAll = (storeName: string) =>
				new Promise<Record<string, unknown>[]>((resolve, reject) => {
					if (!database.objectStoreNames.contains(storeName)) return resolve([])
					const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll()
					request.onsuccess = () => resolve(request.result as Record<string, unknown>[])
					request.onerror = () => reject(request.error)
				})
			const result = {
				sends: await readAll('coco_cashu_send_operations'),
				receives: await readAll('coco_cashu_receive_operations'),
				proofs: await readAll('coco_cashu_proofs'),
			}
			database.close()
			return result
		},
		{ accountPubkey: pubkey },
	)

test.describe('Coco v2 normal Auction UI — fake funds', () => {
	test.skip(!COCO_E2E_ENABLED, 'Run with COCO_V2_E2E=1 and the explicit fake-funds Coco environment')

	test('receive → prepare → hard reload → execute publishes the exact durable bid', async ({ buyerPage }) => {
		test.slow()
		const relay = await Relay.connect(RELAY_URL)
		try {
			const auction = await seedAuction(relay)
			const token = await mintFakeToken(1_000)

			await buyerPage.getByTestId('wallet-button').click()
			await buyerPage.getByRole('button', { name: 'Receive fake eCash' }).click()
			const receiveDialog = buyerPage.getByRole('dialog', { name: 'Receive eCash' })
			await receiveDialog.locator('textarea').fill(token)
			await receiveDialog.getByRole('button', { name: 'Receive', exact: true }).click()
			await expect(receiveDialog.getByText('eCash Received!')).toBeVisible({ timeout: 30_000 })
			await receiveDialog.getByRole('button', { name: 'Done' }).click()

			await buyerPage.evaluate((pubkey) => {
				localStorage.setItem(`auction-rules-ack:v1:${pubkey}`, 'true')
			}, devUser2.pk)
			await buyerPage.goto(`/auctions/${auction.id}`)
			await expect(buyerPage.getByRole('heading', { name: 'Coco v2 Browser Auction' })).toBeVisible({ timeout: 15_000 })
			await buyerPage.locator('input[type="number"]').first().fill('100')
			await buyerPage
				.getByRole('button', { name: /place bid|bid 100 sats/i })
				.first()
				.click()

			let bidDialog = buyerPage.getByRole('dialog', { name: 'Confirm Bid' })
			await bidDialog.getByRole('button', { name: 'Prepare Bid' }).click()
			await expect(bidDialog.getByText('prepared', { exact: true })).toBeVisible({ timeout: 30_000 })
			await expect(bidDialog.getByText('Coco fee')).toBeVisible()

			await buyerPage.reload()
			bidDialog = buyerPage.getByRole('dialog', { name: 'Confirm Bid' })
			await expect(bidDialog).toBeVisible({ timeout: 30_000 })
			await expect(bidDialog.getByText('prepared', { exact: true })).toBeVisible()
			await bidDialog.getByRole('button', { name: 'Publish Prepared Bid' }).click()

			const bid = await waitForBid(relay, auction.id)
			expect(bid.pubkey).toBe(devUser2.pk)
			expect(bid.tags.some((tag) => tag[0] === 'coco_operation' && tag[1]?.startsWith('pm:coco-v2:auction:prepare-bid:'))).toBe(true)
			expect(bid.tags.some((tag) => tag[0] === 'coco_condition' && /^[0-9a-f]{64}$/.test(tag[1] ?? ''))).toBe(true)
			expect(bid.tags.some((tag) => tag[0] === 'coco_commitment' && /^[0-9a-f]{64}$/.test(tag[1] ?? ''))).toBe(true)
		} finally {
			relay.close()
		}
	})

	test('@coco-auctionsdev-smoke normal create → A/B bids → winner Receive → loser original-Send refund', async ({
		merchantPage,
		buyerPage,
		newUserPage,
	}, testInfo) => {
		test.setTimeout(10 * 60_000)
		for (const page of [merchantPage, buyerPage, newUserPage]) page.setDefaultTimeout(20_000)
		const pageErrors: string[] = []
		for (const page of [merchantPage, buyerPage, newUserPage]) {
			page.on('pageerror', (error) => pageErrors.push(error.message))
			await page.route(`${MINT_URL}/v1/info`, (route) => route.fulfill({ json: COCO_AUCTIONSDEV_FAKE_MINT_INFO }))
		}
		const relay = await Relay.connect(RELAY_URL)
		try {
			const [buyerToken, higherBidderToken] = await Promise.all([mintFakeToken(500), mintFakeToken(500)])
			await Promise.all([receiveFakeFunds(buyerPage, buyerToken), receiveFakeFunds(newUserPage, higherBidderToken)])
			const buyerPreflightReport = await buyerPage.evaluate((key) => {
				const value = localStorage.getItem(key)
				if (!value) throw new Error('fresh-wallet preflight public report is missing')
				return JSON.parse(value) as unknown
			}, FRESH_AUCTIONSDEV_PUBLIC_REPORT_STORAGE_KEY)
			await verifyFreshAuctionsdevPublicReport(buyerPreflightReport, {
				marketCommit: process.env.BUN_PUBLIC_MARKET_COMMIT_SHA!,
				account: devUser2.pk,
				environment: 'test',
			})
			const preflightReportPath = testInfo.outputPath('fresh-auctionsdev-preflight.json')
			await writeFile(preflightReportPath, `${JSON.stringify(buyerPreflightReport, null, 2)}\n`, 'utf8')
			console.log(`COCO_AUCTIONSDEV_PREFLIGHT_REPORT_PATH=${preflightReportPath}`)
			markSmokeCheck('fund')

			const auction = await createAuctionThroughNormalUi(merchantPage, relay)
			markSmokeCheck('create')
			const coordinate = `30408:${auction.pubkey}:${auction.tags.find((tag) => tag[0] === 'd')?.[1]}`
			const maxEndAt = Number(auction.tags.find((tag) => tag[0] === 'max_end_at')?.[1])
			const settlementGrace = Number(auction.tags.find((tag) => tag[0] === 'settlement_grace')?.[1])
			expect(Number.isSafeInteger(maxEndAt)).toBe(true)
			expect(settlementGrace).toBe(300)
			expect(auction.tags.some((tag) => tag[0] === 'mint' && tag[1] === MINT_URL)).toBe(true)
			expect(auction.tags.some((tag) => tag[0] === 'p2pk_xpub' && tag[1]?.startsWith('xpub'))).toBe(true)

			await placeCocoBid(buyerPage, auction, devUser2.pk, 100)
			const bidA = await waitForRelayEvent(relay, { kinds: [1023], '#e': [auction.id], authors: [devUser2.pk] })
			markSmokeCheck('bidA')
			markSmokeCheck('hardReloadRecovery')
			await publishValidVerdict(relay, auction, bidA)

			await placeCocoBid(newUserPage, auction, devUser3.pk, 110)
			const bidB = await waitForRelayEvent(relay, { kinds: [1023], '#e': [auction.id], authors: [devUser3.pk] })
			markSmokeCheck('bidB')
			await publishValidVerdict(relay, auction, bidB)
			await newUserPage.reload()
			expect(Number(bidB.tags.find((tag) => tag[0] === 'amount')?.[1])).toBe(110)

			const endWaitMs = Math.max(0, (maxEndAt + 1) * 1000 - Date.now())
			await newUserPage.waitForTimeout(endWaitMs)
			await newUserPage.goto(`/dashboard/products/auctions/${auction.id}`)
			await expect(newUserPage.getByRole('button', { name: 'Release path & settle' })).toBeEnabled({ timeout: 30_000 })
			await newUserPage.getByRole('button', { name: 'Release path & settle' }).click()
			const release = await waitForRelayEvent(relay, { kinds: [1025], '#a': [coordinate] }, (event) =>
				event.tags.some((tag) => tag[0] === 'e' && tag[1] === bidB.id),
			)
			markSmokeCheck('winnerRelease')
			await newUserPage.reload()
			await expect(newUserPage.getByText('Path release published')).toBeVisible({ timeout: 30_000 })

			await merchantPage.goto(`/dashboard/products/auctions/${auction.id}`)
			await expect(merchantPage.getByRole('button', { name: 'Publish Settlement' })).toBeEnabled({ timeout: 30_000 })
			await merchantPage.getByRole('button', { name: 'Publish Settlement' }).click()
			const settlement = await waitForRelayEvent(relay, { kinds: [1024], '#e': [auction.id] })
			expect(settlement.tags.some((tag) => tag[0] === 'winning_bid' && tag[1] === bidB.id)).toBe(true)
			expect(settlement.tags.some((tag) => tag[0] === 'path_release' && tag[1] === release.id)).toBe(true)
			await merchantPage.reload()

			const sellerOperations = await readCocoOperations(merchantPage, devUser1.pk)
			const settlementOperationId = settlement.tags.find((tag) => tag[0] === 'coco_receive_operation')?.[1]
			expect(settlementOperationId).toBeTruthy()
			expect(sellerOperations.receives.filter((operation) => operation.id === settlementOperationId)).toHaveLength(1)
			expect(sellerOperations.receives.find((operation) => operation.id === settlementOperationId)?.state).toBe('finalized')
			markSmokeCheck('sellerReceiveFinalized')
			markSmokeCheck('settlement')

			const locktimeA = Number(bidA.tags.find((tag) => tag[0] === 'locktime')?.[1])
			const sendAId = bidA.tags.find((tag) => tag[0] === 'coco_operation')?.[1]
			const sendBId = bidB.tags.find((tag) => tag[0] === 'coco_operation')?.[1]
			expect(sendAId).toBeTruthy()
			expect(sendBId).toBeTruthy()
			const refundWaitMs = Math.max(0, (locktimeA + 1) * 1000 - Date.now())
			await buyerPage.waitForTimeout(refundWaitMs)
			await buyerPage.goto('/dashboard/products/bids')
			await expect(buyerPage.getByRole('button', { name: 'Refund original Send' })).toBeEnabled({ timeout: 30_000 })
			await buyerPage.getByRole('button', { name: 'Refund original Send' }).click()
			// Toasts are intentionally ephemeral. Poll the authoritative operation
			// instead, and do not navigate while the exact-Send reclaim is in flight.
			try {
				await expect
					.poll(
						async () => {
							const operations = await readCocoOperations(buyerPage, devUser2.pk)
							return operations.sends.find((operation) => operation.id === sendAId)?.state ?? 'missing'
						},
						{ timeout: 60_000, intervals: [250, 500, 1_000] },
					)
					.toBe('rolled_back')
			} catch (error) {
				const operations = await readCocoOperations(buyerPage, devUser2.pk)
				const operation = operations.sends.find((candidate) => candidate.id === sendAId)
				const reclaimData = (() => {
					if (typeof operation?.reclaimDataJson !== 'string') return null
					try {
						const parsed = JSON.parse(operation.reclaimDataJson) as { spendingPath?: unknown }
						return parsed && typeof parsed === 'object' ? parsed : null
					} catch {
						return null
					}
				})()
				const errorToast = await buyerPage
					.locator('[data-sonner-toast][data-type="error"]')
					.last()
					.textContent({ timeout: 2_000 })
					.catch(() => null)
				console.log(
					`COCO_AUCTIONSDEV_REFUND_CAUSAL_ERROR=${JSON.stringify({
						toast: errorToast,
						operationId: sendAId,
						state: operation?.state ?? 'missing',
						revision: operation?.revision ?? null,
						method: operation?.method ?? null,
						reclaimSpendingPath: reclaimData?.spendingPath ?? null,
					})}`,
				)
				throw error
			}
			await buyerPage.reload()

			const [buyerOperations, winnerOperations] = await Promise.all([
				readCocoOperations(buyerPage, devUser2.pk),
				readCocoOperations(newUserPage, devUser3.pk),
			])
			expect(buyerOperations.sends.filter((operation) => operation.id === sendAId)).toHaveLength(1)
			expect(buyerOperations.sends.find((operation) => operation.id === sendAId)?.state).toBe('rolled_back')
			markSmokeCheck('loserOriginalSendRefund')
			expect(winnerOperations.sends.filter((operation) => operation.id === sendBId)).toHaveLength(1)
			expect(sellerOperations.receives.filter((operation) => operation.state === 'finalized')).toHaveLength(1)

			const readyBalance = (operations: Awaited<ReturnType<typeof readCocoOperations>>) =>
				operations.proofs.filter((proof) => proof.state === 'ready').reduce((sum, proof) => sum + Number(proof.amount), 0)
			expect(readyBalance(buyerOperations)).toBe(500)
			expect(readyBalance(winnerOperations) + readyBalance(sellerOperations)).toBe(500)
			markSmokeCheck('conservation')
			expect(pageErrors, `Unhandled browser errors: ${pageErrors.join(' | ')}`).toEqual([])
		} finally {
			relay.close()
		}
	})
})
