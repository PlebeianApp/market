import type { PlebeianFridayBrowserController } from './poc-friday-browser-entry'

const HEX32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

/**
 * Fixed authenticated Comet and host fault-control adapters now exist as an
 * operator-side executable.  The browser/operator bridge and exact-current
 * four-host run remain unexecuted, so this must not be presented as a live
 * acceptance result.
 */
export const DEMO_FRIDAY_BROWSER_ACCEPTANCE_DRIVER_STATUS =
	'CONCRETE_OPERATOR_ADAPTERS_NOT_BROWSER_BRIDGED_OR_LIVE_TESTED' as const

function fail(message: string): never { throw new Error(`PLEBEIAN_FRIDAY_ACCEPTANCE: ${message}`) }

export interface DemoFridayAcceptanceAuctionV1 {
	auctionId: string
	seller: string
	status: 'open' | 'closed'
	originalEndTime: number
	endTime: number
	extensionCount: number
	leaderActor: string
	leaderBidId: string
	leaderCommittedAt: number
	highBid: number
	winner: string
}

export interface DemoFridayAcceptanceValidatorV1 {
	slot: 1 | 2 | 3 | 4
	online: boolean
	canonicalCommitHeight: number
	commitSignatures: number
}

/**
 * This port must authenticate Comet state/commits; an HTTP 200 or an RPC
 * response without the pinned chain/commit proof is not an implementation.
 */
export interface DemoFridayAcceptanceConsensusPort {
	createAuctionExact(request: {
		auctionId: string
		sellerActor: string
		sellerPaymentPublicKey: string
		durationSeconds: number
		startingBid: number
		minIncrement: number
		reserve: number
	}): Promise<void>
	readAuctionExact(auctionId: string): Promise<DemoFridayAcceptanceAuctionV1>
	waitForLeaderExact(request: { auctionId: string; actor: string; amount: number }): Promise<DemoFridayAcceptanceAuctionV1>
	waitUntilLateWindowExact(request: { auctionId: string; windowSeconds: number }): Promise<DemoFridayAcceptanceAuctionV1>
	waitUntilCloseEligibleExact(auctionId: string): Promise<DemoFridayAcceptanceAuctionV1>
	closeAuctionExact(auctionId: string): Promise<void>
	waitUntilClosedExact(auctionId: string): Promise<DemoFridayAcceptanceAuctionV1>
	setValidatorOfflineExact(slot: 4): Promise<void>
	readValidatorsExact(): Promise<DemoFridayAcceptanceValidatorV1[]>
}

export interface DemoFridayBrowserAcceptanceInput {
	auctionId: string
	durationSeconds: number
	lateBidWindowSeconds: number
	lateBidExtensionSeconds: number
	maxTotalExtensionSeconds: number
	emergencyRecoverySeconds: number
	initialBid: number
	displacingBid: number
	lateBid: number
	bidderA: PlebeianFridayBrowserController
	bidderB: PlebeianFridayBrowserController
	seller: PlebeianFridayBrowserController
	consensus: DemoFridayAcceptanceConsensusPort
	reconnectAfterUnknown(request: { actor: string; fundingOperationId: string }):
		Promise<PlebeianFridayBrowserController>
}

export interface DemoFridayBrowserAcceptanceReceiptV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_COCO_ACCEPTANCE_V1'
	auctionId: string
	actors: { seller: string; bidderA: string; bidderB: string }
	funding: { bidderA: number; bidderB: number }
	outbidRefund: { actor: string; imported: number; finalBalance: number }
	outbidRefunds: readonly [
		{ actor: string; amount: number; imports: 1 },
		{ actor: string; amount: number; imports: 1 },
	]
	antiSniping: { originalEndTime: number; endTime: number; extensionCount: number }
	consensus: { offlineSlot: 4; onlineValidators: number; commitSignatures: number }
	payoutAuthorization: { authorizationDigest: string; maximumPayout: 50_000 }
	settlement: { winner: string; amount: number; sellerImports: number }
	conservation: {
		initialTotal: number
		fundedTotal: number
		finalTotal: number
		finalSpendable: readonly [number, number, number]
		unavailableTotal: 0
	}
}

export interface DemoFridayFiveMemberAcceptanceInput {
	auctionId: string
	durationSeconds: number
	lateBidWindowSeconds: number
	lateBidExtensionSeconds: number
	maxTotalExtensionSeconds: number
	emergencyRecoverySeconds: number
	fundingAmount: number
	bidAmounts: readonly [number, number, number, number]
	seller: PlebeianFridayBrowserController
	bidders: readonly [
		PlebeianFridayBrowserController,
		PlebeianFridayBrowserController,
		PlebeianFridayBrowserController,
		PlebeianFridayBrowserController,
	]
	consensus: DemoFridayAcceptanceConsensusPort
}

export interface DemoFridayFiveMemberAcceptanceReceiptV1 {
	schema: 'PLEBEIAN_FRIDAY_FIVE_MEMBER_COCO_ACCEPTANCE_V1'
	auctionId: string
	actors: {
		seller: string
		bidders: readonly [string, string, string, string]
	}
	funding: {
		amountPerActor: number
		finalizedBalances: readonly [number, number, number, number, number]
	}
	outbidRefunds: readonly [
		{ actor: string; amount: number; imports: 1 },
		{ actor: string; amount: number; imports: 1 },
		{ actor: string; amount: number; imports: 1 },
	]
	antiSniping: { originalEndTime: number; endTime: number; extensionCount: number }
	consensus: { offlineSlot: 4; onlineValidators: 3; commitSignatures: number; automaticClose: true }
	payoutAuthorization: { authorizationDigest: string; maximumPayout: 50_000 }
	settlement: { seller: string; winner: string; amount: number; sellerImports: 1 }
	conservation: {
		initialTotal: number
		fundedTotal: number
		finalTotal: number
		finalSpendable: readonly [number, number, number, number, number]
		unavailableTotal: 0
	}
}

function exactAuction(value: DemoFridayAcceptanceAuctionV1, auctionId: string): DemoFridayAcceptanceAuctionV1 {
	if (value.auctionId !== auctionId || !HEX32.test(value.seller)
		|| !Number.isSafeInteger(value.originalEndTime) || !Number.isSafeInteger(value.endTime)
		|| value.endTime < value.originalEndTime || !Number.isSafeInteger(value.extensionCount)
		|| value.extensionCount < 0 || !Number.isSafeInteger(value.highBid) || value.highBid < 0
		|| (value.leaderActor === '') !== (value.leaderBidId === '')
		|| (value.leaderBidId === '') !== (value.leaderCommittedAt === 0)
		|| (value.leaderActor !== '' && (!HEX32.test(value.leaderActor) || !HEX32.test(value.leaderBidId)))
		|| !Number.isSafeInteger(value.leaderCommittedAt) || value.leaderCommittedAt < 0
		|| (value.winner !== '' && !HEX32.test(value.winner))) fail('authenticated auction state is malformed')
	return structuredClone(value)
}

export function expectedDemoFridayAntiSnipingEnd(input: {
	originalEndTime: number
	priorEndTime: number
	committedAt: number
	lateBidExtensionSeconds: number
	maxTotalExtensionSeconds: number
}): number {
	if (![input.originalEndTime, input.priorEndTime, input.committedAt,
		input.lateBidExtensionSeconds, input.maxTotalExtensionSeconds].every(Number.isSafeInteger)
		|| input.originalEndTime < 1 || input.priorEndTime < input.originalEndTime
		|| input.committedAt < 1 || input.committedAt >= input.priorEndTime
		|| input.lateBidExtensionSeconds < 1 || input.maxTotalExtensionSeconds < input.lateBidExtensionSeconds
		|| input.committedAt > Number.MAX_SAFE_INTEGER - input.lateBidExtensionSeconds
		|| input.originalEndTime > Number.MAX_SAFE_INTEGER - input.maxTotalExtensionSeconds) {
		fail('authenticated late-bid timing is invalid or at/after the current end')
	}
	const candidate = input.committedAt + input.lateBidExtensionSeconds
	const cap = input.originalEndTime + input.maxTotalExtensionSeconds
	return Math.min(Math.max(input.priorEndTime, candidate), cap)
}

type ReconnectAfterUnknown = DemoFridayBrowserAcceptanceInput['reconnectAfterUnknown']

async function authorizeAuctionPayout(
	seller: PlebeianFridayBrowserController,
	auction: DemoFridayAcceptanceAuctionV1,
	policy: { startingBid: number; minIncrement: number; reserve: number; maximumEndTime: number; validUntil: number },
): Promise<string> {
	const request = { auctionId: auction.auctionId, startingBid: policy.startingBid,
		minIncrement: policy.minIncrement, reserve: policy.reserve, originalEndTime: auction.originalEndTime,
		maximumEndTime: policy.maximumEndTime, maximumPayout: 50_000, validUntil: policy.validUntil }
	const registered = await seller.authorizeAuctionPayout(request)
	const read = await seller.readAuctionPayout(auction.auctionId)
	if (registered.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_ENVELOPE_V1'
		|| !HEX32.test(registered.authorizationDigest) || read === null
		|| read.schema !== 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_AUTHORIZATION_ENVELOPE_V1'
		|| read.authorizationDigest !== registered.authorizationDigest
		|| read.authorization.sellerActor !== auction.seller
		|| read.authorization.auctionId !== request.auctionId
		|| read.authorization.startingBid !== request.startingBid
		|| read.authorization.minIncrement !== request.minIncrement
		|| read.authorization.reserve !== request.reserve
		|| read.authorization.originalEndTime !== request.originalEndTime
		|| read.authorization.maximumEndTime !== request.maximumEndTime
		|| read.authorization.maximumPayout !== request.maximumPayout
		|| read.authorization.validUntil !== request.validUntil) {
		fail('offline auction payout authorization was not registered and re-read exactly')
	}
	return registered.authorizationDigest
}

async function admitBid(controller: PlebeianFridayBrowserController,
	request: Parameters<PlebeianFridayBrowserController['placeBid']>[0],
	reconnectAfterUnknown?: ReconnectAfterUnknown): Promise<PlebeianFridayBrowserController> {
	let result = await controller.placeBid(request)
	if (result.status === 'seller_plan_pending') {
		fail('bid fell back to the retired per-bid seller-plan path')
	}
	if (result.status === 'unknown') {
		if (reconnectAfterUnknown === undefined) fail('uncertain bid requires a fresh controller recovery seam')
		const actor = await controller.actor()
		const recovered = await reconnectAfterUnknown({ actor, fundingOperationId: result.fundingOperationId })
		if (recovered === controller || await recovered.actor() !== actor) {
			fail('uncertain bid recovery did not reconstruct the same actor with a fresh controller')
		}
		controller = recovered
		result = await controller.placeBid(request)
	}
	if (result.status !== 'admitted' || !Number.isSafeInteger(result.committedHeight) || result.committedHeight! < 1) {
		fail(`bid did not reach authenticated admission (${result.status})`)
	}
	return controller
}

export async function runDemoFridayBrowserAcceptance(
	input: DemoFridayBrowserAcceptanceInput,
): Promise<DemoFridayBrowserAcceptanceReceiptV1> {
	if (!ID.test(input.auctionId) || !Number.isSafeInteger(input.durationSeconds) || input.durationSeconds < 600
		|| input.lateBidWindowSeconds !== 180 || input.lateBidExtensionSeconds !== 180
		|| input.maxTotalExtensionSeconds !== 1_800 || input.emergencyRecoverySeconds !== 900
		|| ![input.initialBid, input.displacingBid, input.lateBid].every((value) => Number.isSafeInteger(value) && value > 0)
		|| !(input.initialBid < input.displacingBid && input.displacingBid < input.lateBid)) {
		fail('acceptance policy or bid amounts differ from the reviewed Friday rules')
	}
	const [sellerActor, bidderAActor, bidderBActor, sellerPaymentPublicKey] = await Promise.all([
		input.seller.actor(), input.bidderA.actor(), input.bidderB.actor(), input.seller.sellerPaymentPublicKey(),
	])
	if (![sellerActor, bidderAActor, bidderBActor].every((value) => HEX32.test(value))
		|| new Set([sellerActor, bidderAActor, bidderBActor]).size !== 3
		|| !/^(?:02|03)[0-9a-f]{64}$/.test(sellerPaymentPublicKey)) fail('acceptance actors or seller payment key are invalid')
	let bidderAController = input.bidderA, bidderBController = input.bidderB
	let controllers = [input.seller, bidderAController, bidderBController] as const
	const initial = await Promise.all(controllers.map(async (controller) => exactAvailableBalance(await controller.balance())))
	if (initial.some((balance) => unavailable(balance) !== 0)) fail('acceptance wallets did not start fully available')
	await input.consensus.createAuctionExact({ auctionId: input.auctionId, sellerActor, sellerPaymentPublicKey,
		durationSeconds: input.durationSeconds, startingBid: input.initialBid, minIncrement: 100, reserve: 0 })
	const created = exactAuction(await input.consensus.readAuctionExact(input.auctionId), input.auctionId)
	if (created.seller !== sellerActor || created.status !== 'open' || created.leaderBidId !== '') fail('created auction differs from exact request')
	if (created.originalEndTime > Number.MAX_SAFE_INTEGER - input.maxTotalExtensionSeconds
		- input.emergencyRecoverySeconds) fail('auction payout authorization deadline overflows')
	const maximumEndTime = created.originalEndTime + input.maxTotalExtensionSeconds
	const payoutAuthorizationDigest = await authorizeAuctionPayout(input.seller, created, {
		startingBid: input.initialBid, minIncrement: 100, reserve: 0, maximumEndTime,
		validUntil: maximumEndTime + input.emergencyRecoverySeconds,
	})
	const [fundedA, fundedB] = await Promise.all([bidderAController.fundFake(10_000), bidderBController.fundFake(10_000)])
	const afterFunding = await Promise.all(controllers.map(async (controller) => exactAvailableBalance(await controller.balance())))
	if (fundedA.state !== 'finalized' || fundedB.state !== 'finalized'
		|| fundedA.balance !== initial[1].total + 10_000 || fundedB.balance !== initial[2].total + 10_000
		|| afterFunding[0].total !== initial[0].total
		|| afterFunding[1].available !== initial[1].available + 10_000
		|| afterFunding[2].available !== initial[2].available + 10_000
		|| afterFunding.some((balance) => unavailable(balance) !== 0)) {
		fail('Coco fake funding did not finalize at exact balance')
	}
	const locktime = created.originalEndTime + input.maxTotalExtensionSeconds + input.emergencyRecoverySeconds
	bidderAController = await admitBid(bidderAController, { auctionId: input.auctionId, bidAmount: input.initialBid,
		fullPoolAmount: input.initialBid, reservedPoolAmount: input.initialBid, replacesBidId: '', locktime },
	input.reconnectAfterUnknown)
	const first = exactAuction(await input.consensus.waitForLeaderExact({ auctionId: input.auctionId,
		actor: bidderAActor, amount: input.initialBid }), input.auctionId)
	bidderBController = await admitBid(bidderBController, { auctionId: input.auctionId, bidAmount: input.displacingBid,
		fullPoolAmount: input.displacingBid, reservedPoolAmount: input.displacingBid,
		replacesBidId: first.leaderBidId, locktime }, input.reconnectAfterUnknown)
	await input.consensus.waitForLeaderExact({ auctionId: input.auctionId, actor: bidderBActor, amount: input.displacingBid })
	const refund = await bidderAController.importAvailable(), balanceA = await bidderAController.balance()
	if (refund.refunds !== 1 || balanceA.available !== 10_000 || balanceA.locked !== 0
		|| balanceA.pending !== 0 || balanceA.unresolved !== 0 || balanceA.total !== 10_000) {
		fail('certified displacement did not produce one exact spendable Coco refund')
	}
	const late = exactAuction(await input.consensus.waitUntilLateWindowExact({ auctionId: input.auctionId,
		windowSeconds: input.lateBidWindowSeconds }), input.auctionId)
	bidderAController = await admitBid(bidderAController, { auctionId: input.auctionId, bidAmount: input.lateBid,
		fullPoolAmount: input.lateBid, reservedPoolAmount: input.lateBid,
		replacesBidId: late.leaderBidId, locktime }, input.reconnectAfterUnknown)
	const extended = exactAuction(await input.consensus.waitForLeaderExact({ auctionId: input.auctionId,
		actor: bidderAActor, amount: input.lateBid }), input.auctionId)
	const expectedExtendedEnd = expectedDemoFridayAntiSnipingEnd({ originalEndTime: late.originalEndTime,
		priorEndTime: late.endTime, committedAt: extended.leaderCommittedAt,
		lateBidExtensionSeconds: input.lateBidExtensionSeconds,
		maxTotalExtensionSeconds: input.maxTotalExtensionSeconds })
	if (extended.originalEndTime !== late.originalEndTime || expectedExtendedEnd <= late.endTime
		|| extended.endTime !== expectedExtendedEnd || extended.extensionCount !== late.extensionCount + 1) {
		fail('committed late bid did not apply the reviewed anti-sniping extension')
	}
	const refundB = await bidderBController.importAvailable(), balanceB = exactAvailableBalance(await bidderBController.balance())
	if (refundB.refunds !== 1 || refundB.winnerPayments !== 0
		|| balanceB.available !== afterFunding[2].available || unavailable(balanceB) !== 0) {
		fail('late displacement did not produce one exact spendable Coco refund')
	}
	await input.consensus.setValidatorOfflineExact(4)
	const validators = await input.consensus.readValidatorsExact()
	if (validators.length !== 4 || validators.filter((value) => value.online).length !== 3
		|| validators.find((value) => value.slot === 4)?.online !== false
		|| validators.some((value) => value.online && (value.canonicalCommitHeight < 1 || value.commitSignatures < 3))) {
		fail('one-validator-unavailable BFT evidence is invalid')
	}
	await input.consensus.waitUntilCloseEligibleExact(input.auctionId)
	await input.consensus.closeAuctionExact(input.auctionId)
	const closed = exactAuction(await input.consensus.waitUntilClosedExact(input.auctionId), input.auctionId)
	if (closed.status !== 'closed' || closed.winner !== bidderAActor || closed.highBid !== input.lateBid) {
		fail('authenticated close outcome differs from the committed leader')
	}
	const sellerImport = await input.seller.importAvailable()
	if (sellerImport.winnerPayments !== 1) fail('seller did not import and acknowledge exactly one winner payment')
	controllers = [input.seller, bidderAController, bidderBController] as const
	const final = await Promise.all(controllers.map(async (controller) => exactAvailableBalance(await controller.balance())))
	const initialTotal = initial.reduce((sum, balance) => sum + balance.total, 0)
	const fundedTotal = initialTotal + 20_000
	const finalTotal = final.reduce((sum, balance) => sum + balance.total, 0)
	const unavailableTotal = final.reduce((sum, balance) => sum + unavailable(balance), 0)
	const expectedAvailable = [initial[0].available + input.lateBid,
		initial[1].available + 10_000 - input.lateBid, initial[2].available + 10_000]
	if (finalTotal !== fundedTotal || unavailableTotal !== 0
		|| final.some((balance, index) => balance.available !== expectedAvailable[index])) {
		fail('final wallet vector or run-level conservation differs')
	}
	return Object.freeze({ schema: 'PLEBEIAN_FRIDAY_BROWSER_COCO_ACCEPTANCE_V1', auctionId: input.auctionId,
		actors: { seller: sellerActor, bidderA: bidderAActor, bidderB: bidderBActor },
		funding: { bidderA: fundedA.balance, bidderB: fundedB.balance },
		outbidRefund: { actor: bidderAActor, imported: refund.refunds, finalBalance: balanceA.available },
		outbidRefunds: [{ actor: bidderAActor, amount: input.initialBid, imports: 1 as const },
			{ actor: bidderBActor, amount: input.displacingBid, imports: 1 as const }] as const,
		antiSniping: { originalEndTime: extended.originalEndTime, endTime: extended.endTime,
			extensionCount: extended.extensionCount },
		consensus: { offlineSlot: 4 as const, onlineValidators: 3,
			commitSignatures: Math.min(...validators.filter((value) => value.online).map((value) => value.commitSignatures)) },
		payoutAuthorization: { authorizationDigest: payoutAuthorizationDigest, maximumPayout: 50_000 as const },
		settlement: { winner: closed.winner, amount: closed.highBid, sellerImports: sellerImport.winnerPayments },
		conservation: { initialTotal, fundedTotal, finalTotal,
			finalSpendable: final.map((balance) => balance.available) as [number, number, number],
			unavailableTotal: 0 as const } })
}

type ExactBrowserBalance = Awaited<ReturnType<PlebeianFridayBrowserController['balance']>>

function exactAvailableBalance(value: ExactBrowserBalance): ExactBrowserBalance {
	if (![value.available, value.reserved, value.locked, value.pending, value.unresolved, value.total]
		.every((amount) => Number.isSafeInteger(amount) && amount >= 0)
		|| value.available + value.reserved + value.locked + value.pending + value.unresolved !== value.total) {
		fail('Coco wallet balance is malformed or does not conserve its projections')
	}
	return structuredClone(value)
}

function unavailable(value: ExactBrowserBalance): number {
	return value.reserved + value.locked + value.pending + value.unresolved
}

/**
 * Five-member MVP journey: one seller and four distinct bidders.  Unlike the
 * historical three-role fault runner, close is observed rather than submitted
 * by the runner, so a pass requires the deployed automatic close trigger.
 */
export async function runDemoFridayFiveMemberAcceptance(
	input: DemoFridayFiveMemberAcceptanceInput,
): Promise<DemoFridayFiveMemberAcceptanceReceiptV1> {
	if (!ID.test(input.auctionId) || !Number.isSafeInteger(input.durationSeconds) || input.durationSeconds < 360
		|| input.lateBidWindowSeconds !== 180 || input.lateBidExtensionSeconds !== 180
		|| input.maxTotalExtensionSeconds !== 1_800 || input.emergencyRecoverySeconds !== 900
		|| !Number.isSafeInteger(input.fundingAmount) || input.fundingAmount < 1
		|| input.bidAmounts.some((amount) => !Number.isSafeInteger(amount) || amount < 1 || amount > input.fundingAmount)
		|| input.bidAmounts.some((amount, index) => index > 0 && amount <= input.bidAmounts[index - 1]!)) {
		fail('five-member acceptance policy, funding, or bid amounts are invalid')
	}
	const controllers = [input.seller, ...input.bidders] as const
	const [actors, sellerPaymentPublicKey, initial] = await Promise.all([
		Promise.all(controllers.map((controller) => controller.actor())),
		input.seller.sellerPaymentPublicKey(),
		Promise.all(controllers.map(async (controller) => exactAvailableBalance(await controller.balance()))),
	])
	if (actors.some((actor) => !HEX32.test(actor)) || new Set(actors).size !== 5
		|| !/^(?:02|03)[0-9a-f]{64}$/.test(sellerPaymentPublicKey)
		|| initial.some((balance) => unavailable(balance) !== 0)) {
		fail('five distinct actors, seller payment key, or clean starting wallets are invalid')
	}
	const [sellerActor, bidderA, bidderB, bidderC, bidderD] = actors as [string, string, string, string, string]
	await input.consensus.createAuctionExact({ auctionId: input.auctionId, sellerActor, sellerPaymentPublicKey,
		durationSeconds: input.durationSeconds, startingBid: input.bidAmounts[0], minIncrement: 100, reserve: 0 })
	const created = exactAuction(await input.consensus.readAuctionExact(input.auctionId), input.auctionId)
	if (created.seller !== sellerActor || created.status !== 'open' || created.leaderBidId !== '') {
		fail('five-member auction differs from the exact signed create request')
	}
	if (created.originalEndTime > Number.MAX_SAFE_INTEGER - input.maxTotalExtensionSeconds
		- input.emergencyRecoverySeconds) fail('five-member payout authorization deadline overflows')
	const maximumEndTime = created.originalEndTime + input.maxTotalExtensionSeconds
	const payoutAuthorizationDigest = await authorizeAuctionPayout(input.seller, created, {
		startingBid: input.bidAmounts[0], minIncrement: 100, reserve: 0, maximumEndTime,
		validUntil: maximumEndTime + input.emergencyRecoverySeconds,
	})
	const funded = await Promise.all(controllers.map((controller) => controller.fundFake(input.fundingAmount)))
	const afterFunding = await Promise.all(controllers.map(async (controller) => exactAvailableBalance(await controller.balance())))
	for (let index = 0; index < controllers.length; index += 1) {
		if (funded[index]!.state !== 'finalized' || !ID.test(funded[index]!.operationId)
			|| funded[index]!.balance !== afterFunding[index]!.total
			|| afterFunding[index]!.total !== initial[index]!.total + input.fundingAmount
			|| afterFunding[index]!.available !== initial[index]!.available + input.fundingAmount
			|| unavailable(afterFunding[index]!) !== 0) {
			fail('five-member Coco funding did not finalize as one exact wallet increase per actor')
		}
	}
	const locktime = created.originalEndTime + input.maxTotalExtensionSeconds + input.emergencyRecoverySeconds
	const earlyBidders = input.bidders.slice(0, 3) as readonly PlebeianFridayBrowserController[]
	const earlyActors = [bidderA, bidderB, bidderC]
	const refunds: Array<{ actor: string; amount: number; imports: 1 }> = []
	let priorBidId = ''
	for (let index = 0; index < earlyBidders.length; index += 1) {
		const amount = input.bidAmounts[index]!
		await admitBid(earlyBidders[index]!, { auctionId: input.auctionId, bidAmount: amount,
			fullPoolAmount: amount, reservedPoolAmount: amount, replacesBidId: priorBidId, locktime })
		const leader = exactAuction(await input.consensus.waitForLeaderExact({ auctionId: input.auctionId,
			actor: earlyActors[index]!, amount }), input.auctionId)
		priorBidId = leader.leaderBidId
		if (index > 0) {
			const displaced = earlyBidders[index - 1]!, displacedActor = earlyActors[index - 1]!
			const imported = await displaced.importAvailable(), balance = exactAvailableBalance(await displaced.balance())
			if (imported.refunds !== 1 || imported.winnerPayments !== 0
				|| balance.available !== afterFunding[index]!.available || unavailable(balance) !== 0) {
				fail('an early displaced bidder did not import exactly one full Coco return')
			}
			refunds.push({ actor: displacedActor, amount: input.bidAmounts[index - 1]!, imports: 1 })
		}
	}
	const late = exactAuction(await input.consensus.waitUntilLateWindowExact({ auctionId: input.auctionId,
		windowSeconds: input.lateBidWindowSeconds }), input.auctionId)
	const winningAmount = input.bidAmounts[3]
	await admitBid(input.bidders[3], { auctionId: input.auctionId, bidAmount: winningAmount,
		fullPoolAmount: winningAmount, reservedPoolAmount: winningAmount,
		replacesBidId: late.leaderBidId, locktime })
	const extended = exactAuction(await input.consensus.waitForLeaderExact({ auctionId: input.auctionId,
		actor: bidderD, amount: winningAmount }), input.auctionId)
	const expectedExtendedEnd = expectedDemoFridayAntiSnipingEnd({ originalEndTime: late.originalEndTime,
		priorEndTime: late.endTime, committedAt: extended.leaderCommittedAt,
		lateBidExtensionSeconds: input.lateBidExtensionSeconds,
		maxTotalExtensionSeconds: input.maxTotalExtensionSeconds })
	if (extended.originalEndTime !== late.originalEndTime || expectedExtendedEnd <= late.endTime
		|| extended.endTime !== expectedExtendedEnd || extended.extensionCount !== late.extensionCount + 1) {
		fail('five-member late bid did not apply the reviewed anti-sniping extension')
	}
	const displacedC = await input.bidders[2].importAvailable()
	const balanceC = exactAvailableBalance(await input.bidders[2].balance())
	if (displacedC.refunds !== 1 || displacedC.winnerPayments !== 0
		|| balanceC.available !== afterFunding[3]!.available || unavailable(balanceC) !== 0) {
		fail('late displacement did not return the third bidder full pool')
	}
	refunds.push({ actor: bidderC, amount: input.bidAmounts[2], imports: 1 })
	await input.consensus.setValidatorOfflineExact(4)
	const validators = await input.consensus.readValidatorsExact()
	if (validators.length !== 4 || validators.filter((value) => value.online).length !== 3
		|| validators.find((value) => value.slot === 4)?.online !== false
		|| validators.some((value) => value.online && (value.canonicalCommitHeight < 1 || value.commitSignatures < 3))) {
		fail('five-member one-validator-unavailable BFT evidence is invalid')
	}
	await input.consensus.waitUntilCloseEligibleExact(input.auctionId)
	const closed = exactAuction(await input.consensus.waitUntilClosedExact(input.auctionId), input.auctionId)
	if (closed.status !== 'closed' || closed.winner !== bidderD || closed.highBid !== winningAmount) {
		fail('automatic close outcome differs from the committed five-member leader')
	}
	const sellerImport = await input.seller.importAvailable()
	if (sellerImport.refunds !== 0 || sellerImport.winnerPayments !== 1) {
		fail('five-member seller did not import exactly one winning terminal payment')
	}
	const final = await Promise.all(controllers.map(async (controller) => exactAvailableBalance(await controller.balance())))
	const initialTotal = initial.reduce((sum, balance) => sum + balance.total, 0)
	const fundedTotal = initialTotal + input.fundingAmount * controllers.length
	const finalTotal = final.reduce((sum, balance) => sum + balance.total, 0)
	const unavailableTotal = final.reduce((sum, balance) => sum + unavailable(balance), 0)
	const expectedAvailable = [
		initial[0].available + input.fundingAmount + winningAmount,
		initial[1].available + input.fundingAmount,
		initial[2].available + input.fundingAmount,
		initial[3].available + input.fundingAmount,
		initial[4].available + input.fundingAmount - winningAmount,
	]
	if (finalTotal !== fundedTotal || unavailableTotal !== 0
		|| final.some((balance, index) => balance.available !== expectedAvailable[index])) {
		fail('five-member final wallet vector or run-level conservation differs')
	}
	if (refunds.length !== 3) fail('five-member acceptance did not retain exactly three outbid refunds')
	const outbidRefunds = [refunds[0]!, refunds[1]!, refunds[2]!] as const
	return Object.freeze({ schema: 'PLEBEIAN_FRIDAY_FIVE_MEMBER_COCO_ACCEPTANCE_V1', auctionId: input.auctionId,
		actors: { seller: sellerActor, bidders: [bidderA, bidderB, bidderC, bidderD] as const },
		funding: { amountPerActor: input.fundingAmount,
			finalizedBalances: afterFunding.map((balance) => balance.available) as [number, number, number, number, number] },
		outbidRefunds,
		antiSniping: { originalEndTime: extended.originalEndTime, endTime: extended.endTime,
			extensionCount: extended.extensionCount },
		consensus: { offlineSlot: 4 as const, onlineValidators: 3 as const,
			commitSignatures: Math.min(...validators.filter((value) => value.online).map((value) => value.commitSignatures)),
			automaticClose: true as const },
		payoutAuthorization: { authorizationDigest: payoutAuthorizationDigest, maximumPayout: 50_000 as const },
		settlement: { seller: sellerActor, winner: bidderD, amount: winningAmount, sellerImports: 1 as const },
		conservation: { initialTotal, fundedTotal, finalTotal,
			finalSpendable: final.map((balance) => balance.available) as [number, number, number, number, number],
			unavailableTotal: 0 as const } })
}
