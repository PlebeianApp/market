import { describe, expect, test } from 'bun:test'

import {
	DEMO_FRIDAY_BROWSER_ACCEPTANCE_DRIVER_STATUS,
	expectedDemoFridayAntiSnipingEnd,
	runDemoFridayBrowserAcceptance,
	runDemoFridayFiveMemberAcceptance,
	type DemoFridayAcceptanceAuctionV1,
	type DemoFridayAcceptanceConsensusPort,
} from './demo-friday-browser-acceptance-runner'
import type { PlebeianFridayBrowserController } from './poc-friday-browser-entry'

const ACTORS = { seller: '11'.repeat(32), a: '22'.repeat(32), b: '33'.repeat(32) }
const FIVE = { seller: '11'.repeat(32), a: '22'.repeat(32), b: '33'.repeat(32),
	c: '44'.repeat(32), d: '55'.repeat(32) }

type PayoutRequest = Parameters<PlebeianFridayBrowserController['authorizeAuctionPayout']>[0]

function payoutEnvelope(actor: string, sellerPaymentPublicKey: string, request: PayoutRequest, validFrom: number) {
	return {
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_ENVELOPE_V1',
		authorizationDigest: 'aa'.repeat(32),
		authorization: { ...structuredClone(request), schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_V1',
			authNetworkId: 'friday-demo', chainId: 'friday-chain', sellerActor: actor,
			sellerPaymentPublicKey, canonicalMintUrl: 'https://127.0.0.1', activeSatKeysetId: 'keyset-1',
			denominationKeyDigest: 'bb'.repeat(32), validFrom,
			catalogOperationId: 'catalog-1', recipientCatalog: {} },
		sellerAuthorization: { id: 'cc'.repeat(32) },
	} as never
}

function fixture(options: { lostResponseAmount?: number; corruptFinalSellerBalance?: boolean } = {}) {
	const balances = new Map([[ACTORS.seller, 0], [ACTORS.a, 0], [ACTORS.b, 0]])
	const locked = new Map([[ACTORS.a, 0], [ACTORS.b, 0]]), refunds = new Set<string>()
	const operations = new Map<string, string>()
	const admitted = new Map<string, { fundingOperationId: string; committedHeight: number }>()
	const controllerInstances = new Map<string, number>()
	let counter = 0, sellerWinnerReady = false, injectedLostResponse = false, auctionDuration = 900
	let payout: Awaited<ReturnType<PlebeianFridayBrowserController['authorizeAuctionPayout']>> | null = null
	let payoutCalls = 0, sellerPlanCalls = 0
	let auction: DemoFridayAcceptanceAuctionV1 = { auctionId: 'auction-1', seller: ACTORS.seller,
		status: 'open', originalEndTime: 10_000, endTime: 10_000, extensionCount: 0,
		leaderActor: '', leaderBidId: '', leaderCommittedAt: 0, highBid: 0, winner: '' }
	const sellerPaymentPublicKey = `02${'44'.repeat(32)}`
	const seller: PlebeianFridayBrowserController = {
		async actor() { return ACTORS.seller }, async sellerPaymentPublicKey() { return sellerPaymentPublicKey },
		async authorizeAuctionPayout(request) { payoutCalls += 1
			payout = payoutEnvelope(ACTORS.seller, sellerPaymentPublicKey, request,
				request.originalEndTime - auctionDuration); return payout },
		async readAuctionPayout(auctionId) { return payout?.authorization.auctionId === auctionId ? payout : null },
		fundingPolicy() { return { schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
			browserWalletAdvisoryMaxResultingBalance: 50_000, digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' } },
		async pendingFakeFunding() { return null },
		async balance() { const available = balances.get(ACTORS.seller)!; return {
			available, reserved: 0, locked: 0, pending: 0, unresolved: 0, total: available } },
		async fundFake() { throw new Error('seller funding unused') }, async placeBid() { throw new Error('seller bid unused') },
		async serviceSellerPlans() { sellerPlanCalls += 1; throw new Error('retired seller plan path used') },
		async expiredPrelockPending() { return [] }, async discardExpiredPrelockPending() { throw new Error('unused') },
		async importAvailable() { if (!sellerWinnerReady) return { refunds: 0, winnerPayments: 0 }
			sellerWinnerReady = false; balances.set(ACTORS.seller, balances.get(ACTORS.seller)! + auction.highBid
				- (options.corruptFinalSellerBalance ? 1 : 0)); return { refunds: 0, winnerPayments: 1 } },
		async cancelPending() { throw new Error('unused') }, async recoverCancellation() { throw new Error('unused') },
	}
	const bidder = (actor: string): PlebeianFridayBrowserController => {
		controllerInstances.set(actor, (controllerInstances.get(actor) ?? 0) + 1)
		return {
			async actor() { return actor }, async sellerPaymentPublicKey() { return `03${'55'.repeat(32)}` },
			async authorizeAuctionPayout() { throw new Error('unused') }, async readAuctionPayout() { return null },
			fundingPolicy() { return { schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
				browserWalletAdvisoryMaxResultingBalance: 50_000, digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' } },
			async pendingFakeFunding() { return null },
			async balance() { const available = balances.get(actor)!, held = locked.get(actor)!; return {
				available, reserved: 0, locked: held, pending: 0, unresolved: 0, total: available + held } },
			async fundFake(amount) { balances.set(actor, balances.get(actor)! + amount); return {
				operationId: `faucet-${actor.slice(0, 8)}`, state: 'finalized', balance: balances.get(actor)! } },
			async placeBid(request) {
				if (payout === null) throw new Error('auction payout authorization is absent')
				const key = `${actor}:${request.auctionId}:${request.bidAmount}`
				const operationId = operations.get(key) ?? `op-${++counter}`
				if (!operations.has(key)) operations.set(key, operationId)
				const recovered = admitted.get(key)
				if (recovered) return { status: 'admitted', ...recovered }
				balances.set(actor, balances.get(actor)! - request.fullPoolAmount); locked.set(actor, request.fullPoolAmount)
				if (auction.leaderActor !== '') refunds.add(auction.leaderActor)
				const committedAt = request.bidAmount === 2_000 ? 9_950 : 9_000 + counter
				const extendedEnd = request.bidAmount === 2_000
					? Math.min(Math.max(auction.endTime, committedAt + 180), auction.originalEndTime + 1_800)
					: auction.endTime
				auction = { ...auction, leaderActor: actor, leaderBidId: actor.slice(0, 64),
					leaderCommittedAt: committedAt, highBid: request.bidAmount,
					...(extendedEnd > auction.endTime ? { endTime: extendedEnd,
						extensionCount: auction.extensionCount + 1 } : {}) }
				const receipt = { fundingOperationId: operationId, committedHeight: 10 + counter }
				admitted.set(key, receipt)
				if (!injectedLostResponse && request.bidAmount === options.lostResponseAmount) {
					injectedLostResponse = true
					return { status: 'unknown', fundingOperationId: operationId }
				}
				return { status: 'admitted', ...receipt }
			},
			async serviceSellerPlans() { sellerPlanCalls += 1; throw new Error('retired seller plan path used') },
			async expiredPrelockPending() { return [] }, async discardExpiredPrelockPending() { throw new Error('unused') },
			async importAvailable() { if (!refunds.delete(actor)) return { refunds: 0, winnerPayments: 0 }
				balances.set(actor, balances.get(actor)! + locked.get(actor)!); locked.set(actor, 0); return { refunds: 1, winnerPayments: 0 } },
			async cancelPending() { throw new Error('unused') }, async recoverCancellation() { throw new Error('unused') },
		}
	}
	const reconnectAfterUnknown = async (request: { actor: string; fundingOperationId: string }) => {
		if (![ACTORS.a, ACTORS.b].includes(request.actor)
			|| ![...admitted.values()].some((receipt) => receipt.fundingOperationId === request.fundingOperationId)) {
			throw new Error('unknown recovery did not reference durable admission')
		}
		return bidder(request.actor)
	}
	const consensus: DemoFridayAcceptanceConsensusPort = {
		async createAuctionExact(request) { auctionDuration = request.durationSeconds; auction = { ...auction, auctionId: request.auctionId,
			seller: request.sellerActor, originalEndTime: 10_000, endTime: 10_000 } },
		async readAuctionExact() { return structuredClone(auction) },
		async waitForLeaderExact(request) { if (auction.leaderActor !== request.actor || auction.highBid !== request.amount) throw new Error('leader mismatch'); return structuredClone(auction) },
		async waitUntilLateWindowExact() { return structuredClone(auction) }, async waitUntilCloseEligibleExact() { return structuredClone(auction) },
		async closeAuctionExact() { auction = { ...auction, status: 'closed', winner: auction.leaderActor }
			locked.set(auction.winner, 0); sellerWinnerReady = true },
		async waitUntilClosedExact() { return structuredClone(auction) }, async setValidatorOfflineExact() {},
		async readValidatorsExact() { return [1, 2, 3, 4].map((slot) => ({ slot: slot as 1 | 2 | 3 | 4,
			online: slot !== 4, canonicalCommitHeight: slot === 4 ? 0 : 50, commitSignatures: slot === 4 ? 0 : 3 })) },
	}
	return { seller, bidderA: bidder(ACTORS.a), bidderB: bidder(ACTORS.b), consensus, reconnectAfterUnknown,
		payoutCalls: () => payoutCalls, sellerPlanCalls: () => sellerPlanCalls,
		controllerInstances: (actor: string) => controllerInstances.get(actor) ?? 0 }
}

function fiveMemberFixture(options: { duplicateLastActor?: boolean; corruptFinalSellerBalance?: boolean } = {}) {
	const bidderActors = [FIVE.a, FIVE.b, FIVE.c, options.duplicateLastActor ? FIVE.c : FIVE.d] as const
	const allActors = [FIVE.seller, ...bidderActors]
	const balances = new Map(allActors.map((actor) => [actor, 0]))
	const locked = new Map(allActors.map((actor) => [actor, 0]))
	const refunds = new Set<string>(), operations = new Map<string, string>()
	let counter = 0, sellerWinnerReady = false, validatorFourOnline = true, payoutCalls = 0, sellerPlanCalls = 0
	let auctionDuration = 360
	let payout: Awaited<ReturnType<PlebeianFridayBrowserController['authorizeAuctionPayout']>> | null = null
	let auction: DemoFridayAcceptanceAuctionV1 = { auctionId: 'auction-five', seller: FIVE.seller,
		status: 'open', originalEndTime: 10_000, endTime: 10_000, extensionCount: 0,
		leaderActor: '', leaderBidId: '', leaderCommittedAt: 0, highBid: 0, winner: '' }
	const sellerPaymentPublicKey = `02${'66'.repeat(32)}`
	const controller = (actor: string, seller = false): PlebeianFridayBrowserController => ({
		async actor() { return actor }, async sellerPaymentPublicKey() { return sellerPaymentPublicKey },
		async authorizeAuctionPayout(request) { if (!seller) throw new Error('bidder payout authorization unused')
			payoutCalls += 1; payout = payoutEnvelope(actor, sellerPaymentPublicKey, request,
				request.originalEndTime - auctionDuration); return payout },
		async readAuctionPayout(auctionId) { return payout?.authorization.auctionId === auctionId ? payout : null },
		fundingPolicy() { return { schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
			browserWalletAdvisoryMaxResultingBalance: 50_000, digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' } },
		async pendingFakeFunding() { return null },
		async balance() { const available = balances.get(actor)!, held = locked.get(actor)!; return {
			available, reserved: 0, locked: held, pending: 0, unresolved: 0, total: available + held } },
		async fundFake(amount) { balances.set(actor, balances.get(actor)! + amount); return {
			operationId: `faucet-${actor.slice(0, 8)}`, state: 'finalized', balance: balances.get(actor)! } },
		async placeBid(request) {
			if (seller) throw new Error('seller bid unused')
			if (payout === null) throw new Error('auction payout authorization is absent')
			const key = `${actor}:${request.auctionId}:${request.bidAmount}`
			const operationId = operations.get(key) ?? `op-${++counter}`
			if (!operations.has(key)) operations.set(key, operationId)
			balances.set(actor, balances.get(actor)! - request.fullPoolAmount); locked.set(actor, request.fullPoolAmount)
			if (auction.leaderActor !== '') refunds.add(auction.leaderActor)
			const committedAt = request.bidAmount === 400 ? 9_950 : 9_000 + counter
			const extendedEnd = request.bidAmount === 400
				? Math.min(Math.max(auction.endTime, committedAt + 180), auction.originalEndTime + 1_800) : auction.endTime
			auction = { ...auction, leaderActor: actor, leaderBidId: actor, leaderCommittedAt: committedAt,
				highBid: request.bidAmount, ...(extendedEnd > auction.endTime
					? { endTime: extendedEnd, extensionCount: auction.extensionCount + 1 } : {}) }
			return { status: 'admitted', fundingOperationId: operationId, committedHeight: 20 + counter }
		},
		async serviceSellerPlans() { sellerPlanCalls += 1; throw new Error('retired seller plan path used') },
		async expiredPrelockPending() { return [] }, async discardExpiredPrelockPending() { throw new Error('unused') },
		async importAvailable() {
			if (seller && sellerWinnerReady) { sellerWinnerReady = false
				balances.set(actor, balances.get(actor)! + auction.highBid - (options.corruptFinalSellerBalance ? 1 : 0))
				return { refunds: 0, winnerPayments: 1 } }
			if (!refunds.delete(actor)) return { refunds: 0, winnerPayments: 0 }
			balances.set(actor, balances.get(actor)! + locked.get(actor)!); locked.set(actor, 0)
			return { refunds: 1, winnerPayments: 0 }
		},
		async cancelPending() { throw new Error('unused') }, async recoverCancellation() { throw new Error('unused') },
	})
	const seller = controller(FIVE.seller, true)
	const bidders = bidderActors.map((actor) => controller(actor)) as unknown as readonly [
		PlebeianFridayBrowserController, PlebeianFridayBrowserController,
		PlebeianFridayBrowserController, PlebeianFridayBrowserController,
	]
	const consensus: DemoFridayAcceptanceConsensusPort = {
		async createAuctionExact(request) { auctionDuration = request.durationSeconds
			auction = { ...auction, auctionId: request.auctionId, seller: request.sellerActor } },
		async readAuctionExact() { return structuredClone(auction) },
		async waitForLeaderExact(request) { if (auction.leaderActor !== request.actor || auction.highBid !== request.amount) {
			throw new Error('leader mismatch') } return structuredClone(auction) },
		async waitUntilLateWindowExact() { return structuredClone(auction) },
		async waitUntilCloseEligibleExact() { return structuredClone(auction) },
		async closeAuctionExact() { throw new Error('five-member runner must not submit a manual close') },
		async waitUntilClosedExact() { auction = { ...auction, status: 'closed', winner: auction.leaderActor }
			locked.set(auction.winner, 0); sellerWinnerReady = true; return structuredClone(auction) },
		async setValidatorOfflineExact() { validatorFourOnline = false },
		async readValidatorsExact() { return [1, 2, 3, 4].map((slot) => ({ slot: slot as 1 | 2 | 3 | 4,
			online: slot !== 4 || validatorFourOnline, canonicalCommitHeight: 80,
			commitSignatures: validatorFourOnline ? 4 : 3 })) },
	}
	return { seller, bidders, consensus, payoutCalls: () => payoutCalls, sellerPlanCalls: () => sellerPlanCalls }
}

describe('Friday browser Coco acceptance runner', () => {
	test('does not claim the operator adapters are browser-bridged or live-tested', () => {
		expect(DEMO_FRIDAY_BROWSER_ACCEPTANCE_DRIVER_STATUS)
			.toBe('CONCRETE_OPERATOR_ADAPTERS_NOT_BROWSER_BRIDGED_OR_LIVE_TESTED')
	})
	test('drives funding, certified outbid import, anti-sniping and 3-of-4 close through concrete ports', async () => {
		const held = fixture()
		const receipt = await runDemoFridayBrowserAcceptance({ ...held, auctionId: 'auction-1', durationSeconds: 900,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 })
		expect(receipt.outbidRefund).toEqual({ actor: ACTORS.a, imported: 1, finalBalance: 10_000 })
		expect(receipt.outbidRefunds).toEqual([
			{ actor: ACTORS.a, amount: 1_000, imports: 1 },
			{ actor: ACTORS.b, amount: 1_500, imports: 1 },
		])
		expect(receipt.antiSniping).toEqual({ originalEndTime: 10_000, endTime: 10_130, extensionCount: 1 })
		expect(receipt.consensus).toEqual({ offlineSlot: 4, onlineValidators: 3, commitSignatures: 3 })
		expect(receipt.payoutAuthorization).toEqual({ authorizationDigest: 'aa'.repeat(32), maximumPayout: 50_000 })
		expect(receipt.settlement).toEqual({ winner: ACTORS.a, amount: 2_000, sellerImports: 1 })
		expect(receipt.conservation).toEqual({ initialTotal: 0, fundedTotal: 20_000, finalTotal: 20_000,
			finalSpendable: [2_000, 8_000, 10_000], unavailableTotal: 0 })
		expect(held.payoutCalls()).toBe(1)
		expect(held.sellerPlanCalls()).toBe(0)
	})

	test('recovers a committed bid after a lost response and controller restart without minting or locking twice', async () => {
		const held = fixture({ lostResponseAmount: 1_500 })
		const receipt = await runDemoFridayBrowserAcceptance({ ...held, auctionId: 'auction-1', durationSeconds: 900,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 })
		expect(held.controllerInstances(ACTORS.a)).toBe(1)
		expect(held.controllerInstances(ACTORS.b)).toBe(2)
		expect(held.payoutCalls()).toBe(1)
		expect(held.sellerPlanCalls()).toBe(0)
		expect(receipt.conservation).toEqual({ initialTotal: 0, fundedTotal: 20_000, finalTotal: 20_000,
			finalSpendable: [2_000, 8_000, 10_000], unavailableTotal: 0 })
	})

	test('fails before funding when the offline payout authorization cannot be re-read exactly', async () => {
		const held = fixture()
		held.seller.readAuctionPayout = async () => null
		await expect(runDemoFridayBrowserAcceptance({ ...held, auctionId: 'auction-1', durationSeconds: 900,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 }))
			.rejects.toThrow(/payout authorization/)
		expect((await held.bidderA.balance()).total).toBe(0)
		expect((await held.bidderB.balance()).total).toBe(0)
	})

	test('rejects the retired per-bid seller-plan path without asking the seller to service it', async () => {
		const held = fixture()
		held.bidderA.placeBid = async () => ({ status: 'seller_plan_pending', fundingOperationId: 'pending-1',
			sellerActor: ACTORS.seller, expiresAt: 9_999 })
		await expect(runDemoFridayBrowserAcceptance({ ...held, auctionId: 'auction-1', durationSeconds: 900,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 }))
			.rejects.toThrow(/retired per-bid seller-plan/)
		expect(held.sellerPlanCalls()).toBe(0)
	})

	test('three-role acceptance rejects final fake-sat conservation drift', async () => {
		const held = fixture({ corruptFinalSellerBalance: true })
		await expect(runDemoFridayBrowserAcceptance({ ...held, auctionId: 'auction-1', durationSeconds: 900,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 }))
			.rejects.toThrow(/conservation differs/)
	})

	test('drives five distinct members through funding, three refunds, automatic close and exact conservation', async () => {
		const held = fiveMemberFixture()
		const receipt = await runDemoFridayFiveMemberAcceptance({ ...held, auctionId: 'auction-five',
			durationSeconds: 360, lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180,
			maxTotalExtensionSeconds: 1_800, emergencyRecoverySeconds: 900,
			fundingAmount: 1_000, bidAmounts: [100, 200, 300, 400] })
		expect(receipt.actors).toEqual({ seller: FIVE.seller, bidders: [FIVE.a, FIVE.b, FIVE.c, FIVE.d] })
		expect(receipt.outbidRefunds).toEqual([
			{ actor: FIVE.a, amount: 100, imports: 1 },
			{ actor: FIVE.b, amount: 200, imports: 1 },
			{ actor: FIVE.c, amount: 300, imports: 1 },
		])
		expect(receipt.consensus).toEqual({ offlineSlot: 4, onlineValidators: 3, commitSignatures: 3, automaticClose: true })
		expect(receipt.payoutAuthorization).toEqual({ authorizationDigest: 'aa'.repeat(32), maximumPayout: 50_000 })
		expect(receipt.settlement).toEqual({ seller: FIVE.seller, winner: FIVE.d, amount: 400, sellerImports: 1 })
		expect(receipt.conservation).toEqual({ initialTotal: 0, fundedTotal: 5_000, finalTotal: 5_000,
			finalSpendable: [1_400, 1_000, 1_000, 1_000, 600], unavailableTotal: 0 })
		expect(held.payoutCalls()).toBe(1)
		expect(held.sellerPlanCalls()).toBe(0)
	})

	test('five-member acceptance rejects duplicate actors and final conservation drift', async () => {
		const duplicate = fiveMemberFixture({ duplicateLastActor: true })
		await expect(runDemoFridayFiveMemberAcceptance({ ...duplicate, auctionId: 'auction-five', durationSeconds: 360,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, fundingAmount: 1_000, bidAmounts: [100, 200, 300, 400] }))
			.rejects.toThrow(/five distinct actors/)
		const drift = fiveMemberFixture({ corruptFinalSellerBalance: true })
		await expect(runDemoFridayFiveMemberAcceptance({ ...drift, auctionId: 'auction-five', durationSeconds: 360,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, fundingAmount: 1_000, bidAmounts: [100, 200, 300, 400] }))
			.rejects.toThrow(/conservation differs/)
	})

	test('derives a late extension from committed time rather than prior end', () => {
		expect(expectedDemoFridayAntiSnipingEnd({ originalEndTime: 10_000, priorEndTime: 10_000,
			committedAt: 9_950, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800 }))
			.toBe(10_130)
	})

	test('rejects a bid committed at the exact current end', () => {
		expect(() => expectedDemoFridayAntiSnipingEnd({ originalEndTime: 10_000, priorEndTime: 10_000,
			committedAt: 10_000, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800 }))
			.toThrow(/at\/after the current end/)
	})

	test('caps a pre-end late bid at original end plus the maximum extension', () => {
		expect(expectedDemoFridayAntiSnipingEnd({ originalEndTime: 10_000, priorEndTime: 11_800,
			committedAt: 11_799, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800 }))
			.toBe(11_800)
	})

	test('refuses non-reviewed timing policy before any effect', async () => {
		const held = fixture()
		await expect(runDemoFridayBrowserAcceptance({ ...held, auctionId: 'auction-1', durationSeconds: 900,
			lateBidWindowSeconds: 60, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 }))
			.rejects.toThrow(/policy/)
	})

	test('refuses a weak validator observation instead of claiming 3-of-4 finality', async () => {
		const held = fixture(), base = held.consensus.readValidatorsExact
		held.consensus.readValidatorsExact = async () => (await base()).map((value) => value.slot === 1
			? { ...value, commitSignatures: 2 } : value)
		await expect(runDemoFridayBrowserAcceptance({ ...held, auctionId: 'auction-1', durationSeconds: 900,
			lateBidWindowSeconds: 180, lateBidExtensionSeconds: 180, maxTotalExtensionSeconds: 1_800,
			emergencyRecoverySeconds: 900, initialBid: 1_000, displacingBid: 1_500, lateBid: 2_000 }))
			.rejects.toThrow(/BFT evidence/)
	})
})
