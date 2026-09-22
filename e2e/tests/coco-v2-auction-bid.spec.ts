import { expect, test } from '../fixtures'
import { RELAY_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { Wallet, getEncodedToken } from '@plebeian-market/coco-cashu-ts'
import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, type Event } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import WebSocket from 'ws'
import { devUser1, devUser2, XPUB } from '../../src/lib/fixtures'

useWebSocketImplementation(WebSocket)

const MINT_URL = 'http://localhost:3338'
const COCO_E2E_ENABLED = process.env.COCO_V2_E2E === '1'

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
})
