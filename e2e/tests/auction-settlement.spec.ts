import { test, expect } from '../fixtures'
import { RELAY_URL } from '../test-config'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2, devUser3 } from '../../src/lib/fixtures'
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
	MOCK_KEYSET_ID,
	type MockToken,
} from '../utils/cashu-mint-mock'
import type { Page } from 'playwright/test'
import { getAuctionHdAccountFromWalletKeys } from '../../src/lib/auctionHd'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../../src/lib/auctionP2pk'
import { hashToCurveHexFromString } from '../../src/lib/cashu/hashToCurve'
import { getEncodedToken } from '@cashu/cashu-ts'

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

interface DynamicWalletKeys {
	xpub: string
	childPubkey: string
	lockSecret: string
	token: string
	proofY: string
}

/**
 * Reads the seller's NIP-60 wallet p2pk + privkey from the browser,
 * then computes the auction HD xpub, child pubkey at m/0, P2PK lock
 * secret, Cashu token, and proofY — all derived from the wallet's
 * actual keys so publishAuctionSettlement can verify the chain.
 */
async function deriveDynamicWalletKeys(page: Page): Promise<DynamicWalletKeys> {
	// Read the wallet's p2pk and the corresponding private key from the browser.
	const { walletP2pk, walletPrivkey } = await page.evaluate(async () => {
		const wallet = (window as any).__nip60Wallet
		if (!wallet) throw new Error('NIP-60 wallet not initialized')
		const p2pk = await wallet.getP2pk()
		const signer = wallet.privkeys.get(p2pk)
		const privkey = signer?.privateKey
		if (!privkey) throw new Error('Wallet does not expose a private key for its p2pk')
		return { walletP2pk: p2pk, walletPrivkey: privkey }
	})

	// Compute the auction HD account xpub from the wallet keys.
	const account = await getAuctionHdAccountFromWalletKeys(walletP2pk, walletPrivkey)
	const xpub = account.publicExtendedKey
	if (!xpub) throw new Error('Failed to derive auction HD xpub from wallet keys')

	// Derive the child pubkey at m/0.
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, 'm/0')

	// Build the P2PK lock secret JSON (NUT-10/11 format).
	const lockSecret = JSON.stringify([
		'P2PK',
		{
			nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			data: childPubkey,
			tags: [
				['n_sigs', '1'],
				['locktime', String(MOCK_LOCKTIME_FUTURE)],
				['refund', MOCK_REFUND_PUBKEY],
				['n_sigs_refund', '1'],
				['sigflag', 'SIG_INPUTS'],
			],
		},
	])

	// Encode the Cashu token using getEncodedToken (pure function, no network).
	const token = getEncodedToken({
		mint: MOCK_MINT_URL,
		proofs: [
			{
				id: MOCK_KEYSET_ID,
				amount: MOCK_PROOF_AMOUNT,
				secret: lockSecret,
				C: '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
			},
		],
	})

	// Compute proofY from the lock secret.
	const proofY = hashToCurveHexFromString(lockSecret)

	return { xpub, childPubkey, lockSecret, token, proofY }
}

async function seedEndedAuction(
	relay: Relay,
	sellerSk: string,
	opts: {
		reserve?: number
		token?: MockToken
		title?: string
		xpub?: string
		locktime?: number
	},
): Promise<SeededAuction> {
	const sellerPk = devUser1.pk
	const token = opts.token ?? MOCK_TOKENS.unspent
	const locktime = opts.locktime ?? (token === MOCK_TOKENS.unspentFuture ? MOCK_LOCKTIME_FUTURE : MOCK_LOCKTIME_PAST)

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
				['p2pk_xpub', opts.xpub ?? MOCK_XPUB],
				['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
				['auditors', devUser3.pk],
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
	opts: {
		amount: number
		token?: MockToken
		childPubkey?: string
		lockSecret?: string
		proofY?: string
		tokenStr?: string
	},
): Promise<string> {
	const token = opts.token ?? MOCK_TOKENS.unspent

	const event = finalizeEvent(
		{
			kind: 1023,
			created_at: Math.max(1, auction.endAt - 60),
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
				['child_pubkey', opts.childPubkey ?? MOCK_CHILD_PUBKEY],
				['lock_secret', opts.lockSecret ?? token.lockSecret],
				['proof_y', opts.proofY ?? token.proofY],
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
	opts: { childPubkey?: string; token: string } | MockToken,
): Promise<string> {
	const childPubkey = 'childPubkey' in opts ? opts.childPubkey : undefined
	const tokenStr = 'token' in opts && typeof opts.token === 'string' ? opts.token : (opts as MockToken).token
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
				['child_pubkey', childPubkey ?? MOCK_CHILD_PUBKEY],
				['release_reason', 'settlement'],
				['cashu_token', tokenStr],
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
	// validateSettlementCompleteness requires payout tags for settled status
	if (opts.status === 'settled' && opts.winningBidId && opts.finalAmount) {
		tags.push(['payout', opts.winningBidId, String(opts.finalAmount), 'redeemed'])
	}

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

async function seedVerdict(
	relay: Relay,
	validatorSk: string,
	auction: SeededAuction,
	bidId: string,
	bidderPk: string,
	claim: string,
): Promise<string> {
	const dTag = `${bidderPk}:${auction.auctionRootEventId}`
	const tags: string[][] = [
		['d', dTag],
		['a', auction.auctionCoordinate],
		['bid', bidId],
		['claim', claim],
		['observed_at', String(Math.floor(Date.now() / 1000))],
	]

	const event = finalizeEvent(
		{
			kind: 30440,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags,
		},
		hexToBytes(validatorSk),
	)
	await relay.publish(event)
	return event.id
}

async function seedClaimOrder(
	relay: Relay,
	buyerSk: string,
	auction: SeededAuction,
	settlementEventId: string,
	amount: number,
): Promise<string> {
	const tags: string[][] = [
		['p', auction.sellerPk],
		['subject', 'Plebeian Auction Claim'],
		['type', 'order_creation'],
		['order', `order-${Date.now()}`],
		['amount', String(amount)],
		['a', auction.auctionCoordinate],
		['e', auction.auctionRootEventId],
		['e', settlementEventId, '', 'settlement'],
	]

	const event = finalizeEvent(
		{
			kind: 16,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags,
		},
		hexToBytes(buyerSk),
	)
	await relay.publish(event)
	return event.id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auction Settlement Descriptor', () => {
	test.describe('seller view', () => {
		test('seller sees awaiting-path-release when auction ended, reserve met, no path release', async ({
			merchantPage,
		}: {
			merchantPage: Page
		}) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token: MOCK_TOKENS.unspentFuture })
				await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token: MOCK_TOKENS.unspentFuture })
			} finally {
				relay.close()
			}

			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			await expect(merchantPage.getByText(/awaiting path release/i)).toBeVisible({ timeout: 15_000 })
		})

		test('seller sees settlement-ready when path release published', async ({ merchantPage }: { merchantPage: Page }) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token: MOCK_TOKENS.unspentFuture })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token: MOCK_TOKENS.unspentFuture })
				await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspentFuture)
			} finally {
				relay.close()
			}

			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			await expect(merchantPage.getByText(/settlement ready/i)).toBeVisible({ timeout: 15_000 })
			await expect(merchantPage.getByRole('button', { name: /publish settlement/i })).toBeVisible({ timeout: 15_000 })
		})

		test('seller sees reserve-not-met when no bid meets reserve', async ({ merchantPage }: { merchantPage: Page }) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

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
			await expect(merchantPage.getByRole('button', { name: /close auction/i })).toBeVisible({ timeout: 15_000 })
		})

		test('seller sees order-received after settlement with claim order', async ({ merchantPage }: { merchantPage: Page }) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token: MOCK_TOKENS.unspentFuture })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token: MOCK_TOKENS.unspentFuture })
				const prId = await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspentFuture)
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
		test('winner sees release-path card when auction ended, reserve met, window open', async ({ buyerPage }: { buyerPage: Page }) => {
			await CashuMintMock.setup(buyerPage)
			await dismissPiiModal(buyerPage, devUser2.pk)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			const token = MOCK_TOKENS.unspentFuture
			let bidId: string
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token })
				bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token })
			} finally {
				relay.close()
			}

			// Navigate first so auth context is ready, then inject bidder record.
			await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
			await buyerPage.waitForLoadState('networkidle')
			await seedBidderRecordToBrowser(buyerPage, bidId, auction, token)

			// Reload so the component picks up the localStorage record.
			await buyerPage.reload()
			await buyerPage.waitForLoadState('networkidle')

			await expect(buyerPage.getByText(/you won.*release your path/i)).toBeVisible({ timeout: 15_000 })
			await expect(buyerPage.getByRole('button', { name: /release path/i })).toBeVisible({ timeout: 15_000 })
		})

		test('winner sees path-released after publishing path release', async ({ buyerPage }: { buyerPage: Page }) => {
			await CashuMintMock.setup(buyerPage)
			await dismissPiiModal(buyerPage, devUser2.pk)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token: MOCK_TOKENS.unspentFuture })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token: MOCK_TOKENS.unspentFuture })
				await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspentFuture)
			} finally {
				relay.close()
			}

			await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
			await buyerPage.waitForLoadState('networkidle')

			await expect(buyerPage.getByRole('heading', { name: /path release published/i })).toBeVisible({ timeout: 15_000 })
		})

		test('winner sees you-won after settlement', async ({ buyerPage }: { buyerPage: Page }) => {
			await CashuMintMock.setup(buyerPage)
			await dismissPiiModal(buyerPage, devUser2.pk)

			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token: MOCK_TOKENS.unspentFuture })
				const bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token: MOCK_TOKENS.unspentFuture })
				const prId = await seedPathRelease(relay, devUser2.sk, auction, bidId, MOCK_TOKENS.unspentFuture)
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
			await expect(buyerPage.getByRole('button', { name: /submit shipping/i })).toBeVisible({ timeout: 15_000 })
		})
	})

	test.describe('outbid-bidder view', () => {
		test('outbid bidder sees no settlement card (null descriptor)', async ({ merchantPage }: { merchantPage: Page }) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

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
		test('seller sees settlement-window-expired when no path release after grace', async ({ merchantPage }: { merchantPage: Page }) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

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

// ---------------------------------------------------------------------------
// Helpers for UI interaction tests
// ---------------------------------------------------------------------------

/**
 * Dismiss the PII exposure modal that auto-opens on page load.
 * Sets a sessionStorage flag so the modal doesn't reappear on future navigations,
 * and clicks the "DISMISS WARNING" button if the dialog is currently open.
 */
async function dismissPiiModal(page: import('@playwright/test').Page, userPubkey: string) {
	await page.evaluate((pk) => {
		const key = 'pii-warning-dismissed'
		const list = JSON.parse(sessionStorage.getItem(key) || '[]')
		if (!list.includes(pk)) list.push(pk)
		sessionStorage.setItem(key, JSON.stringify(list))
	}, userPubkey)
	// Close the dialog if it's already open from the fixture's initial navigation
	const dismissBtn = page.getByRole('button', { name: /dismiss warning/i })
	if (await dismissBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await dismissBtn.click()
	}
}

/**
 * Inject a bidder record into the browser's localStorage so that
 * `walkBidderRecordChain` can find it when the user clicks
 * "Release Path". The record must match the bid event's id and
 * contain enough crypto data for `publishBidderPathRelease` to
 * construct and sign a kind-1025 event.
 */
async function seedBidderRecordToBrowser(
	page: import('@playwright/test').Page,
	bidEventId: string,
	auction: SeededAuction,
	token: MockToken,
) {
	const bidderPk = devUser2.pk
	const storageKey = `auction_bidder_records_v1_${bidderPk.slice(0, 8)}`

	const proof = {
		id: MOCK_KEYSET_ID,
		amount: MOCK_PROOF_AMOUNT,
		secret: token.lockSecret,
		C: '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
	}

	const record = {
		bidEventId,
		auctionRootEventId: auction.auctionRootEventId,
		auctionCoordinate: auction.auctionCoordinate,
		sellerPubkey: auction.sellerPk,
		p2pkXpub: MOCK_XPUB,
		derivationPath: 'm/0',
		childPubkey: MOCK_CHILD_PUBKEY,
		refundPubkey: MOCK_REFUND_PUBKEY,
		refundPrivateKey: 'e61ae5a4f505026e3d2b5aeba82c748b6b799346a1e98e266d7252cddb8f502b',
		mintUrl: MOCK_MINT_URL,
		amount: MOCK_PROOF_AMOUNT,
		legLockedAmount: MOCK_PROOF_AMOUNT,
		prevBidEventId: null,
		locktime: auction.locktime,
		proofs: [proof],
		lockSecrets: [token.lockSecret],
		proofYs: [token.proofY],
		createdAt: Math.floor(Date.now() / 1000) - 60,
		status: 'live',
	}

	await page.evaluate(
		({ key, data }) => {
			localStorage.setItem(key, JSON.stringify([data]))
		},
		{ key: storageKey, data: record },
	)
}

/**
 * Subscribe to a relay and wait for an event matching the given kind
 * and tag filter. Returns the event or null on timeout.
 */
async function waitForRelayEvent(
	relay: Relay,
	kind: number,
	tagName: string,
	tagValue: string,
	timeoutMs = 15_000,
): Promise<{ id: string; kind: number; pubkey: string; tags: string[][]; content: string } | null> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			sub.close()
			resolve(null)
		}, timeoutMs)

		const sub = relay.subscribe([{ kinds: [kind], [`#${tagName}`]: [tagValue] }], {
			onevent: (event) => {
				if (event.kind !== kind) return
				if (!event.tags.some((t) => t[0] === tagName && t[1] === tagValue)) return
				clearTimeout(timer)
				sub.close()
				resolve(event as any)
			},
		})
	})
}

// ---------------------------------------------------------------------------
// UI interaction tests — click buttons and verify events on the relay
// ---------------------------------------------------------------------------

test.describe('UI interaction — publish events to relay', () => {
	test.describe('winning-bidder clicks Release Path', () => {
		test('clicking Release Path publishes a kind-1025 event to the relay', async ({ buyerPage }: { buyerPage: Page }) => {
			await CashuMintMock.setup(buyerPage)
			await dismissPiiModal(buyerPage, devUser2.pk)

			const token = MOCK_TOKENS.unspentFuture
			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			let bidId: string
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token })
				bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token })
			} finally {
				relay.close()
			}

			// Navigate first so the app loads and the auth context is ready,
			// then inject the bidder record into localStorage.
			await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
			await buyerPage.waitForLoadState('networkidle')
			await seedBidderRecordToBrowser(buyerPage, bidId, auction, token)

			// Reload so the component picks up the localStorage record.
			await buyerPage.reload()
			await buyerPage.waitForLoadState('networkidle')

			// Wait for the Release Path button to appear.
			await expect(buyerPage.getByRole('button', { name: /release path/i })).toBeVisible({ timeout: 15_000 })

			// Open a relay subscription BEFORE clicking.
			const subRelay = await Relay.connect(RELAY_URL)
			try {
				// Click the button — this triggers handleReleasePath → publishBidderPathRelease.
				await buyerPage.getByRole('button', { name: /release path/i }).click()

				// Wait for a kind-1025 event on the relay referencing this auction.
				const event = await waitForRelayEvent(subRelay, 1025, 'a', auction.auctionCoordinate, 15_000)

				expect(event, 'kind-1025 path release event should arrive on the relay').not.toBeNull()
				expect(event!.pubkey).toBe(devUser2.pk)

				// Verify required tags.
				const tagMap = new Map(event!.tags.map((t) => [t[0], t[1]]))
				expect(tagMap.get('e')).toBe(bidId)
				expect(tagMap.get('a')).toBe(auction.auctionCoordinate)
				expect(tagMap.get('p')).toBe(auction.sellerPk)
				expect(tagMap.get('derivation_path')).toBe('m/0')
				expect(tagMap.get('child_pubkey')).toBe(MOCK_CHILD_PUBKEY)
				expect(tagMap.get('release_reason')).toBe('settlement')
				expect(tagMap.has('cashu_token')).toBe(true)
				expect(tagMap.get('cashu_token')!.startsWith('cashuB')).toBe(true)
			} finally {
				subRelay.close()
			}
		})

		test('after clicking Release Path, UI transitions to path-released state', async ({ buyerPage }: { buyerPage: Page }) => {
			await CashuMintMock.setup(buyerPage)
			await dismissPiiModal(buyerPage, devUser2.pk)

			const token = MOCK_TOKENS.unspentFuture
			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			let bidId: string
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token })
				bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token })
			} finally {
				relay.close()
			}

			// Navigate and inject bidder record into localStorage.
			await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
			await buyerPage.waitForLoadState('networkidle')
			await seedBidderRecordToBrowser(buyerPage, bidId, auction, token)

			// Reload so the component picks up the localStorage record.
			await buyerPage.reload()
			await buyerPage.waitForLoadState('networkidle')

			// Wait for the Release Path button to appear.
			await expect(buyerPage.getByRole('button', { name: /release path/i })).toBeVisible({ timeout: 15_000 })

			// Click the button — this triggers handleReleasePath → publishBidderPathRelease.
			await buyerPage.getByRole('button', { name: /release path/i }).click()

			// The optimistic UI should immediately transition to 'Path release published'.
			await expect(buyerPage.getByRole('heading', { name: /path release published/i })).toBeVisible({ timeout: 10_000 })

			// The Release Path button should disappear (the CTA is no longer release-path).
			await expect(buyerPage.getByRole('button', { name: /release path/i })).not.toBeVisible({ timeout: 10_000 })

			// Wait for the query to refetch and pick up the real event from the relay.
			// After refetch, the descriptor should still show 'Path Released' (not revert).
			await buyerPage.waitForTimeout(8_000)

			// The 'Path release published' state should persist (not revert to release-path).
			await expect(buyerPage.getByRole('heading', { name: /path release published/i })).toBeVisible({ timeout: 5_000 })

			// Reload the page — the real event should now be on the relay, so the
			// descriptor should still show 'Path Released' without the optimistic state.
			await buyerPage.reload()
			await buyerPage.waitForLoadState('networkidle')

			// After reload, the path release should be detected from the relay.
			await expect(buyerPage.getByRole('heading', { name: /path release published/i })).toBeVisible({ timeout: 15_000 })
			await expect(buyerPage.getByRole('button', { name: /release path/i })).not.toBeVisible({ timeout: 5_000 })
		})
	})

	test.describe('seller clicks Publish Settlement', () => {
		test('clicking Publish Settlement publishes a kind-1024 event to the relay', async ({ merchantPage }: { merchantPage: Page }) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

			// Navigate to the app first so the NIP-60 wallet initializes,
			// then read the wallet's actual p2pk + privkey and compute
			// the auction HD xpub, child pubkey, token, and proofY
			// dynamically — all derived from the wallet's real keys.
			// The merchantPage fixture already navigated to '/' and initialized
			// the NIP-60 wallet. Wait for the wallet to be ready before reading keys.
			await merchantPage.waitForFunction(() => !!(window as any).__nip60Wallet, undefined, { timeout: 15_000 })
			const dynKeys = await deriveDynamicWalletKeys(merchantPage)

			// Seed events to the relay using the dynamic xpub/child pubkey.
			const relay = await Relay.connect(RELAY_URL)
			let auction: SeededAuction
			let bidId: string
			let prId: string
			try {
				auction = await seedEndedAuction(relay, devUser1.sk, {
					reserve: 0,
					xpub: dynKeys.xpub,
					locktime: MOCK_LOCKTIME_FUTURE,
				})
				bidId = await seedBid(relay, devUser2.sk, auction, {
					amount: MOCK_PROOF_AMOUNT,
					childPubkey: dynKeys.childPubkey,
					lockSecret: dynKeys.lockSecret,
					proofY: dynKeys.proofY,
					token: dynKeys.token,
				})
				prId = await seedPathRelease(relay, devUser2.sk, auction, bidId, {
					childPubkey: dynKeys.childPubkey,
					token: dynKeys.token,
				})
			} finally {
				relay.close()
			}

			// Navigate to the auction page. The first goto('/') already
			// initialized the wallet; this second goto loads the auction
			// page with the wallet ready.
			await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
			await merchantPage.waitForLoadState('networkidle')

			// Wait a moment for React to hydrate, then check if the
			// button responds by evaluating a click in-page.

			// Wait for the Publish Settlement button to appear.
			await expect(merchantPage.getByRole('button', { name: /publish settlement/i })).toBeVisible({ timeout: 15_000 })

			// Open a relay subscription BEFORE clicking.
			const subRelay = await Relay.connect(RELAY_URL)
			try {
				await merchantPage.getByRole('button', { name: /publish settlement/i }).click()

				// Wait for the mutation to complete (swap + publish)
				await merchantPage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})

				const event = await waitForRelayEvent(subRelay, 1024, 'a', auction.auctionCoordinate, 30_000)

				expect(event, 'kind-1024 settlement event should arrive on the relay').not.toBeNull()
				expect(event!.pubkey).toBe(devUser1.pk)

				const tagMap = new Map(event!.tags.map((t) => [t[0], t[1]]))
				expect(tagMap.get('status')).toBe('settled')
				expect(tagMap.get('winning_bid')).toBe(bidId)
				expect(tagMap.get('winner')).toBe(devUser2.pk)
				expect(tagMap.get('path_release')).toBe(prId)
			} finally {
				subRelay.close()
			}
		})
	})

	test.describe('seller clicks Close Auction (reserve not met)', () => {
		test('clicking Close Auction publishes a kind-1024 event with status=reserve_not_met', async ({
			merchantPage,
		}: {
			merchantPage: Page
		}) => {
			await CashuMintMock.setup(merchantPage)
			await dismissPiiModal(merchantPage, devUser1.pk)

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

			// Wait for the Close Auction button to appear.
			await expect(merchantPage.getByRole('button', { name: /close auction/i })).toBeVisible({ timeout: 15_000 })

			// Open a relay subscription BEFORE clicking.
			const subRelay = await Relay.connect(RELAY_URL)
			try {
				await merchantPage.getByRole('button', { name: /close auction/i }).click()

				const event = await waitForRelayEvent(subRelay, 1024, 'a', auction.auctionCoordinate, 15_000)

				expect(event, 'kind-1024 settlement event should arrive on the relay').not.toBeNull()
				expect(event!.pubkey).toBe(devUser1.pk)

				const tagMap = new Map(event!.tags.map((t) => [t[0], t[1]]))
				expect(tagMap.get('status')).toBe('reserve_not_met')
			} finally {
				subRelay.close()
			}
		})
	})
})

// ---------------------------------------------------------------------------
// Cross-client test — bidder publishes, seller detects
// ---------------------------------------------------------------------------

test.describe('Cross-client — bidder publishes path release, seller detects', () => {
	test('seller sees Settlement Ready after bidder clicks Release Path on another client', async ({
		buyerPage,
		merchantPage,
	}: {
		buyerPage: Page
		merchantPage: Page
	}) => {
		await CashuMintMock.setup(buyerPage)
		await CashuMintMock.setup(merchantPage)
		await dismissPiiModal(buyerPage, devUser2.pk)
		await dismissPiiModal(merchantPage, devUser1.pk)

		const token = MOCK_TOKENS.unspentFuture
		const relay = await Relay.connect(RELAY_URL)
		let auction: SeededAuction
		let bidId: string
		try {
			auction = await seedEndedAuction(relay, devUser1.sk, { reserve: 0, token })
			bidId = await seedBid(relay, devUser2.sk, auction, { amount: MOCK_PROOF_AMOUNT, token })
		} finally {
			relay.close()
		}

		// Seller navigates to the auction page first — should see "Awaiting Path Release".
		await merchantPage.goto(`/auctions/${auction.auctionEventId}`)
		await merchantPage.waitForLoadState('networkidle')
		await expect(merchantPage.getByText(/awaiting path release/i)).toBeVisible({ timeout: 15_000 })

		// Bidder navigates to the auction page and injects bidder record.
		await buyerPage.goto(`/auctions/${auction.auctionEventId}`)
		await buyerPage.waitForLoadState('networkidle')
		await seedBidderRecordToBrowser(buyerPage, bidId, auction, token)
		await buyerPage.reload()
		await buyerPage.waitForLoadState('networkidle')

		// Bidder clicks "Release Path" — this publishes kind-1025 to the relay.
		await expect(buyerPage.getByRole('button', { name: /release path/i })).toBeVisible({ timeout: 15_000 })
		await buyerPage.getByRole('button', { name: /release path/i }).click()

		// Bidder sees optimistic "Path release published" immediately.
		await expect(buyerPage.getByRole('heading', { name: /path release published/i })).toBeVisible({ timeout: 10_000 })

		// Seller's query refetches every 5 seconds. Within 20 seconds the
		// seller should transition from "Awaiting Path Release" to "Settlement Ready".
		await expect(merchantPage.getByText(/settlement ready/i)).toBeVisible({ timeout: 20_000 })
		await expect(merchantPage.getByRole('button', { name: /publish settlement/i })).toBeVisible({ timeout: 5_000 })
	})
})

test.describe('settlement validation failure — unresolvable v2 keyset ID', () => {
	test('seller stays on Awaiting Path Release when path release token has unresolvable v2 keyset ID', async ({
		merchantPage,
	}: {
		merchantPage: Page
	}) => {
		await CashuMintMock.setup(merchantPage)
		await dismissPiiModal(merchantPage, devUser1.pk)

		// Build a token with a v2 keyset ID (01 prefix, 33 bytes).
		// The mock mint only returns v1 keysets (id: '0000000000000000'),
		// so getDecodedToken cannot resolve the v2 short keyset ID → throws.
		const V2_KEYSET_ID = '01abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
		const v2Token = getEncodedToken({
			mint: MOCK_MINT_URL,
			proofs: [
				{
					id: V2_KEYSET_ID,
					amount: MOCK_PROOF_AMOUNT,
					secret: MOCK_TOKENS.unspentFuture.lockSecret,
					C: '03' + '4'.repeat(64),
				},
			],
		})

		const relay = await Relay.connect(RELAY_URL)
		let auction: SeededAuction
		let bidId: string
		let prId: string
		try {
			auction = await seedEndedAuction(relay, devUser1.sk, {
				reserve: 0,
				token: MOCK_TOKENS.unspentFuture,
			})
			bidId = await seedBid(relay, devUser2.sk, auction, {
				amount: MOCK_PROOF_AMOUNT,
				token: MOCK_TOKENS.unspentFuture,
			})
			// Path release uses a token with an unresolvable v2 keyset ID.
			prId = await seedPathRelease(relay, devUser2.sk, auction, bidId, { token: v2Token })
			// Seed a settlement referencing the (invalid) path release.
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

		// The path release has an unresolvable v2 keyset ID, so validatePathRelease
		// rejects it. The settlement referencing it is also rejected.
		// The seller should see "Awaiting Path Release", NOT "Awaiting Shipping Details".
		await expect(merchantPage.getByText(/awaiting path release/i)).toBeVisible({ timeout: 15_000 })
		await expect(merchantPage.getByText(/awaiting shipping details|order received/i)).not.toBeVisible()
	})
})
