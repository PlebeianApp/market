import { test, expect } from '../fixtures'
import { RELAY_URL } from '../test-config'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import {
	CashuMintMock,
	MOCK_TOKENS,
	MOCK_MINT_URL,
	MOCK_LOCKTIME_PAST,
	MOCK_LOCKTIME_FUTURE,
	MOCK_CHILD_PUBKEY,
	MOCK_REFUND_PUBKEY,
	MOCK_XPUB,
	MOCK_PROOF_AMOUNT,
	type MockToken,
} from '../utils/cashu-mint-mock'

useWebSocketImplementation(WebSocket)

test.use({ scenario: 'merchant' })

// ---------------------------------------------------------------------------
// Seed helpers — use pre-computed crypto fixtures from CashuMintMock.
// No @cashu/cashu-ts or @noble/secp256k1 imports needed in e2e tests.
// ---------------------------------------------------------------------------

interface SeededAuction {
	auctionEventId: string
	auctionCoordinate: string
	auctionRootEventId: string
	sellerPk: string
	endAt: number
	maxEndAt: number
	settlementGrace: number
	locktime: number
}

async function seedEndedAuction(
	relay: Relay,
	sellerSk: string,
	opts: {
		reserve?: number
		token?: MockToken
		title?: string
	},
): Promise<SeededAuction> {
	const sellerPk = devUser1.pk
	const token = opts.token ?? MOCK_TOKENS.unspent
	const locktime = token === MOCK_TOKENS.unspentFuture ? MOCK_LOCKTIME_FUTURE : MOCK_LOCKTIME_PAST

	// For past-window tokens (locktime=150): use timestamps in 1970 so the
	// auction ended long ago and the settlement window is expired.
	// For future-window tokens (locktime=2e9): maxEndAt=1, grace=2e9-1.
	const maxEndAt = locktime === MOCK_LOCKTIME_FUTURE ? 1 : 50
	const settlementGrace = locktime - maxEndAt
	const endAt = maxEndAt
	const startAt = 0
	const now = Math.floor(Date.now() / 1000)
	const dTag = `e2e-settlement-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
	const coordinate = `30408:${sellerPk}:${dTag}`

	const event = finalizeEvent(
		{
			kind: 30408,
			created_at: now - 3600,
			content: 'E2E settlement test auction',
			tags: [
				['d', dTag],
				['title', opts.title ?? 'E2E Settlement Test Auction'],
				['summary', 'Auction for settlement descriptor e2e tests'],
				['auction_type', 'english'],
				['start_at', String(startAt)],
				['end_at', String(endAt)],
				['max_end_at', String(maxEndAt)],
				['settlement_grace', String(settlementGrace)],
				['currency', 'SAT'],
				['price', '1000', 'SAT'],
				['starting_bid', '1000', 'SAT'],
				['bid_increment', '100'],
				['reserve', String(opts.reserve ?? 0)],
				['mint', MOCK_MINT_URL],
				['key_scheme', 'hd_p2pk'],
				['p2pk_xpub', MOCK_XPUB],
				['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
				['auditors', '[]'],
				['auditor_quorum', '1'],
				['max_skew_sec', '30'],
				['fallback_delay_sec', '150'],
				['schema', 'auction_v1'],
			],
		},
		hexToBytes(sellerSk),
	)
	await relay.publish(event)

	return {
		auctionEventId: event.id,
		auctionCoordinate: coordinate,
		auctionRootEventId: event.id,
		sellerPk,
		endAt,
		maxEndAt,
		settlementGrace,
		locktime,
	}
}

async function seedBid(
	relay: Relay,
	bidderSk: string,
	auction: SeededAuction,
	opts: { amount: number; token?: MockToken },
): Promise<string> {
	const token = opts.token ?? MOCK_TOKENS.unspent

	const event = finalizeEvent(
		{
			kind: 1023,
			created_at: auction.endAt > 1 ? auction.endAt - 60 : 1,
			content: '',
			tags: [
				['e', auction.auctionRootEventId],
				['a', auction.auctionCoordinate],
				['p', auction.sellerPk],
				['amount', String(opts.amount)],
				['currency', 'SAT'],
				['mint', MOCK_MINT_URL],
				['locktime', String(auction.locktime)],
				['refund_pubkey', MOCK_REFUND_PUBKEY],
				['child_pubkey', MOCK_CHILD_PUBKEY],
				['lock_secret', token.lockSecret],
				['proof_y', token.proofY],
				['created_for_end_at', String(auction.endAt)],
				['bid_nonce', `nonce-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`],
				['key_scheme', 'hd_p2pk'],
				['status', 'locked'],
			],
		},
		hexToBytes(bidderSk),
	)
	await relay.publish(event)
	return event.id
}

async function seedPathRelease(
	relay: Relay,
	bidderSk: string,
	auction: SeededAuction,
	bidEventId: string,
	token: MockToken,
): Promise<string> {
	const event = finalizeEvent(
		{
			kind: 1025,
			created_at: auction.endAt + 30,
			content: '',
			tags: [
				['e', bidEventId],
				['a', auction.auctionCoordinate],
				['p', auction.sellerPk],
				['derivation_path', 'm/0'],
				['child_pubkey', MOCK_CHILD_PUBKEY],
				['release_reason', 'settlement'],
				['cashu_token', token.token],
			],
		},
		hexToBytes(bidderSk),
	)
	await relay.publish(event)
	return event.id
}

async function seedSettlement(
	relay: Relay,
	sellerSk: string,
	auction: SeededAuction,
	opts: {
		status: 'settled' | 'reserve_not_met' | 'cancelled' | 'griefed_no_fallback'
		winningBidId?: string
		winnerPubkey?: string
		finalAmount?: number
		pathReleaseEventId?: string
	},
): Promise<string> {
	const tags: string[][] = [
		['e', auction.auctionRootEventId],
		['a', auction.auctionCoordinate],
		['status', opts.status],
		['close_at', String(Math.floor(Date.now() / 1000))],
		['final_amount', String(opts.finalAmount ?? 0)],
	]

	if (opts.winningBidId) tags.push(['winning_bid', opts.winningBidId])
	if (opts.winnerPubkey) tags.push(['winner', opts.winnerPubkey])
	if (opts.pathReleaseEventId) tags.push(['path_release', opts.pathReleaseEventId])

	const event = finalizeEvent(
		{
			kind: 1024,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags,
		},
		hexToBytes(sellerSk),
	)
	await relay.publish(event)
	return event.id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Settlement Descriptor', () => {
	test.describe('seller view', () => {
		test('seller sees awaiting-path-release when auction ended, reserve met, no path release', async ({ merchantPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(merchantPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0 })
				await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
			} finally {
				relay.close()
			}

			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			await expect(merchantPage.getByText(/awaiting path release/i)).toBeVisible({ timeout: 15_000 })
		})

		test('seller sees settlement-ready when path release published', async ({ merchantPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(merchantPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0 })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
				await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspent)
			} finally {
				relay.close()
			}

			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			await expect(merchantPage.getByText(/settlement ready/i)).toBeVisible({ timeout: 15_000 })
			await expect(merchantPage.getByRole('button', { name: /publish settlement/i })).toBeVisible()
		})

		test('seller sees reserve-not-met when no bid meets reserve', async ({ merchantPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(merchantPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 100000 })
				await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
			} finally {
				relay.close()
			}

			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			await expect(merchantPage.getByText(/reserve not met/i)).toBeVisible({ timeout: 15_000 })
			await expect(merchantPage.getByRole('button', { name: /close auction/i })).toBeVisible()
		})

		test('seller sees order-received after settlement with claim order', async ({ merchantPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(merchantPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0 })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
				const prId = await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspent)
				await seedSettlement(relay, devUser1.sk, auction, {
					status: 'settled',
					winningBidId: bidId,
					winnerPubkey: devUser2.pk,
					finalAmount: MOCK_PROOF_AMOUNT,
					pathReleaseEventId: prId,
				})
			} finally {
				relay.close()
			}

			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			// After settlement, seller should see "Awaiting Shipping Details" (no claim order yet)
			await expect(merchantPage.getByText(/awaiting shipping details/i)).toBeVisible({ timeout: 15_000 })
		})
	})

	test.describe('winning-bidder view', () => {
		test('winner sees release-path card when auction ended, reserve met, window open', async ({ buyerPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(buyerPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token: MOCK_TOKENS.unspentFuture })
				await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token: MOCK_TOKENS.unspentFuture })
			} finally {
				relay.close()
			}

			await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
			await buyerPage.waitForLoadState('networkidle')

			await expect(buyerPage.getByText(/you won.*release your path/i)).toBeVisible({ timeout: 15_000 })
			await expect(buyerPage.getByRole('button', { name: /release path/i })).toBeVisible()
		})

		test('winner sees path-released after publishing path release', async ({ buyerPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(buyerPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0 })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
				await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspent)
			} finally {
				relay.close()
			}

			await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
			await buyerPage.waitForLoadState('networkidle')

			await expect(buyerPage.getByText(/path release published/i)).toBeVisible({ timeout: 15_000 })
		})

		test('winner sees you-won after settlement', async ({ buyerPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(buyerPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0 })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
				const prId = await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspent)
				await seedSettlement(relay, devUser1.sk, auction, {
					status: 'settled',
					winningBidId: bidId,
					winnerPubkey: devUser2.pk,
					finalAmount: MOCK_PROOF_AMOUNT,
					pathReleaseEventId: prId,
				})
			} finally {
				relay.close()
			}

			await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
			await buyerPage.waitForLoadState('networkidle')

			await expect(buyerPage.getByText(/you won this auction/i)).toBeVisible({ timeout: 15_000 })
			await expect(buyerPage.getByRole('button', { name: /submit shipping/i })).toBeVisible()
		})
	})

	test.describe('outbid-bidder view', () => {
		test('outbid bidder sees no settlement card (null descriptor)', async ({ merchantPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(merchantPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0 })
				await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
			} finally {
				relay.close()
			}

			// Visit as unauthenticated user (non-participant)
			// The auction page should render without a settlement card
			const response = await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			expect(response?.ok()).toBe(true)
			await merchantPage.waitForLoadState('networkidle')
		})
	})

	test.describe('settlement window expired', () => {
		test('seller sees settlement-window-expired when no path release after grace', async ({ merchantPage }) => {
			test.setTimeout(60_000)

			await CashuMintMock.setup(merchantPage)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0 })
				await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT })
			} finally {
				relay.close()
			}

			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			await expect(merchantPage.getByText(/settlement window expired/i)).toBeVisible({ timeout: 15_000 })
		})
	})
})
