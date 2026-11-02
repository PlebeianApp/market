import { describe, expect, test } from 'bun:test'

import {
	DEMO_FRIDAY_BROWSER_ACCEPTANCE_DRIVER_STATUS,
	expectedDemoFridayAntiSnipingEnd,
	runDemoFridayBrowserAcceptance,
	type DemoFridayAcceptanceAuctionV1,
	type DemoFridayAcceptanceConsensusPort,
} from './demo-friday-browser-acceptance-runner'
import type { PlebeianFridayBrowserController } from './poc-friday-browser-entry'

const ACTORS = { seller: '11'.repeat(32), a: '22'.repeat(32), b: '33'.repeat(32) }

function fixture() {
	const pendingPlans: string[] = [], balances = new Map([[ACTORS.a, 0], [ACTORS.b, 0]])
	const locked = new Map([[ACTORS.a, 0], [ACTORS.b, 0]]), refunds = new Set<string>()
	let counter = 0, sellerWinnerReady = false
	let auction: DemoFridayAcceptanceAuctionV1 = { auctionId: 'auction-1', seller: ACTORS.seller,
		status: 'open', originalEndTime: 10_000, endTime: 10_000, extensionCount: 0,
		leaderActor: '', leaderBidId: '', leaderCommittedAt: 0, highBid: 0, winner: '' }
	const operationActor = new Map<string, string>()
	const seller: PlebeianFridayBrowserController = {
		async actor() { return ACTORS.seller }, async sellerPaymentPublicKey() { return `02${'44'.repeat(32)}` },
		fundingPolicy() { return { schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
			browserWalletAdvisoryMaxResultingBalance: 50_000, digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' } },
		async pendingFakeFunding() { return null },
		async balance() { return { available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0, total: 0 } },
		async fundFake() { throw new Error('seller funding unused') }, async placeBid() { throw new Error('seller bid unused') },
		async serviceSellerPlans() { const operations = pendingPlans.splice(0); return { registered: operations.length, operations } },
		async importAvailable() { if (!sellerWinnerReady) return { refunds: 0, winnerPayments: 0 }; sellerWinnerReady = false; return { refunds: 0, winnerPayments: 1 } },
		async cancelPending() { throw new Error('unused') }, async recoverCancellation() { throw new Error('unused') },
	}
	const bidder = (actor: string): PlebeianFridayBrowserController => {
		const prepared = new Map<string, string>()
		return {
			async actor() { return actor }, async sellerPaymentPublicKey() { return `03${'55'.repeat(32)}` },
			fundingPolicy() { return { schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
				browserWalletAdvisoryMaxResultingBalance: 50_000, digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' } },
			async pendingFakeFunding() { return null },
			async balance() { const available = balances.get(actor)!, held = locked.get(actor)!; return {
				available, reserved: 0, locked: held, pending: 0, unresolved: 0, total: available + held } },
			async fundFake(amount) { balances.set(actor, amount); return { operationId: `faucet-${actor.slice(0, 8)}`, state: 'finalized', balance: amount } },
			async placeBid(request) {
				const key = `${request.auctionId}:${request.bidAmount}`, operationId = prepared.get(key) ?? `op-${++counter}`
				if (!prepared.has(key)) { prepared.set(key, operationId); pendingPlans.push(operationId); operationActor.set(operationId, actor)
					return { status: 'seller_plan_pending', fundingOperationId: operationId, sellerActor: ACTORS.seller, expiresAt: 100 } }
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
				return { status: 'admitted', fundingOperationId: operationId, committedHeight: 10 + counter }
			},
			async serviceSellerPlans() { return { registered: 0, operations: [] } },
			async importAvailable() { if (!refunds.delete(actor)) return { refunds: 0, winnerPayments: 0 }
				balances.set(actor, balances.get(actor)! + locked.get(actor)!); locked.set(actor, 0); return { refunds: 1, winnerPayments: 0 } },
			async cancelPending() { throw new Error('unused') }, async recoverCancellation() { throw new Error('unused') },
		}
	}
	const consensus: DemoFridayAcceptanceConsensusPort = {
		async createAuctionExact(request) { auction = { ...auction, auctionId: request.auctionId,
			seller: request.sellerActor, originalEndTime: 10_000, endTime: 10_000 } },
		async readAuctionExact() { return structuredClone(auction) },
		async waitForLeaderExact(request) { if (auction.leaderActor !== request.actor || auction.highBid !== request.amount) throw new Error('leader mismatch'); return structuredClone(auction) },
		async waitUntilLateWindowExact() { return structuredClone(auction) }, async waitUntilCloseEligibleExact() { return structuredClone(auction) },
		async closeAuctionExact() { auction = { ...auction, status: 'closed', winner: auction.leaderActor }; sellerWinnerReady = true },
		async waitUntilClosedExact() { return structuredClone(auction) }, async setValidatorOfflineExact() {},
		async readValidatorsExact() { return [1, 2, 3, 4].map((slot) => ({ slot: slot as 1 | 2 | 3 | 4,
			online: slot !== 4, canonicalCommitHeight: slot === 4 ? 0 : 50, commitSignatures: slot === 4 ? 0 : 3 })) },
	}
	return { seller, bidderA: bidder(ACTORS.a), bidderB: bidder(ACTORS.b), consensus, operationActor }
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
		expect(receipt.antiSniping).toEqual({ originalEndTime: 10_000, endTime: 10_130, extensionCount: 1 })
		expect(receipt.consensus).toEqual({ offlineSlot: 4, onlineValidators: 3, commitSignatures: 3 })
		expect(receipt.settlement).toEqual({ winner: ACTORS.a, amount: 2_000, sellerImports: 1 })
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
