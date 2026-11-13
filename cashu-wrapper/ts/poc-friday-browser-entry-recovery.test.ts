import { expect, spyOn, test } from 'bun:test'

import * as paymentStateModule from './demo-friday-browser-payment-state'
import * as trustHttpModule from './demo-friday-browser-trust-http'
import * as cocoClientModule from './demo-friday-browser-coco-client'
import * as sellerClientModule from './demo-friday-browser-coco-seller-client'

const STORAGE_KEY = 'plebeian-friday-browser-public-operations-v1'
const actor = 'aa'.repeat(32)
const otherActor = 'bb'.repeat(32)
const sellerActor = 'cc'.repeat(32)

function pending(overrides: Record<string, unknown> = {}) {
	return {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_PENDING_BID_V1', actor, environmentId: 'deployment-one',
		sellerActor, auctionId: 'auction-one', fundingOperationId: 'operation-one', bidAmount: 700,
		fullPoolAmount: 700, reservedPoolAmount: 700, replacesBidId: '', locktime: 2_000_000_000,
		expiresAt: Math.floor(Date.now() / 1_000) - 120, ...overrides,
	}
}

function publicState(entries: unknown[], sellerOperations: unknown[] = [], auctionPayouts: unknown[] = []) {
	return JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1', pendingBids: entries,
		sellerOperations, ...(auctionPayouts.length === 0 ? {} : { auctionPayouts }) })
}

test('post-lock bid failure returns one typed exact-resume operation instead of an ordinary failure', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const storage = new Map<string, string>([[STORAGE_KEY, publicState([pending({
		expiresAt: Math.floor(Date.now() / 1_000) + 240,
	})])]])
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	const operation = { phase: 'coco_locked', auctionId: 'auction-one', bidAmount: 700,
		fundingOperationId: 'operation-one' }
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadOperation() { return operation },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one', participants: [] } } } as never)
	const payoutSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserAuctionPayoutHttp').mockReturnValue({
		async readExact() { return { authorizationDigest: '11'.repeat(32) } },
	} as never)
	let attempts = 0, signed = 0
	const progress: string[] = []
	const clientSpy = spyOn(cocoClientModule, 'createDemoFridayBrowserCocoClient').mockReturnValue({
		async prepareAndFinalize(_request: unknown, observe?: (value: { phase: string }) => void) {
			observe?.({ phase: 'reserving_funds' })
			attempts++
			if (attempts === 1) throw new Error('HTTP 413 after Coco retained the operation')
			return { status: 'admitted', fundingOperationId: 'operation-one', committedHeight: 42 }
		},
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { signed++; throw new Error('retained bid must not sign another intent') },
		})
		await expect(controller.placeBid({ auctionId: 'auction-one', bidAmount: 700, fullPoolAmount: 700,
			reservedPoolAmount: 700, replacesBidId: '', locktime: 2_000_000_000 },
			(value) => progress.push(value.phase))).resolves.toEqual({
			status: 'resume_required', fundingOperationId: 'operation-one', retainedBidAmount: 700,
			recoveryStage: 'funds_locked',
		})
		await expect(controller.resumeBid!('operation-one', () => { throw new Error('UI observer failed') })).resolves.toEqual({ status: 'admitted',
			fundingOperationId: 'operation-one', committedHeight: 42, retainedBidAmount: 700 })
		expect({ attempts, signed }).toEqual({ attempts: 2, signed: 0 })
		expect(progress).toEqual(['checking_identity', 'reserving_funds'])
		expect(JSON.parse(storage.get(STORAGE_KEY)!).pendingBids[0].admitted).toBe(true)
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); payoutSpy.mockRestore(); clientSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('fresh bid progress emits the exact intent stage and isolates throwing presentation observers', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const storage = new Map<string, string>()
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadOperation() { return null },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp').mockReturnValue({
		async readExact() { return { environmentId: 'deployment-one', authNetworkId: 'network-one',
			chainId: 'chain-one', canonicalMintUrl: 'https://mint.example', participants: [] } },
	} as never)
	const intentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserSellerPlanIntentHttp').mockReturnValue({
		async issueExact() { return { sellerActor } },
	} as never)
	const payoutSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserAuctionPayoutHttp').mockReturnValue({
		async readExact() { return { authorizationDigest: '11'.repeat(32) } },
	} as never)
	const clientSpy = spyOn(cocoClientModule, 'createDemoFridayBrowserCocoClient').mockReturnValue({
		async prepareAndFinalize(request: { fundingOperationId: string }, observe?: (value: { phase: string }) => void) {
			observe?.({ phase: 'awaiting_funding_signature' })
			observe?.({ phase: 'awaiting_bid_signature' })
			return { status: 'admitted', fundingOperationId: request.fundingOperationId, committedHeight: 44 }
		},
	} as never)
	let signs = 0
	const progress: string[] = []
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent(value) { signs++; return { ...value, pubkey: actor,
				id: '11'.repeat(32), sig: '22'.repeat(64) } },
		})
		const result = await controller.placeBid({ auctionId: 'auction-one', bidAmount: 700, fullPoolAmount: 700,
			reservedPoolAmount: 700, replacesBidId: '', locktime: 2_000_000_000 }, (value) => {
			progress.push(value.phase)
			if (value.phase === 'awaiting_funding_signature') throw new Error('presentation observer failed')
		})
		expect(result).toMatchObject({ status: 'admitted', committedHeight: 44 })
		expect(progress).toEqual(['checking_identity', 'awaiting_intent_signature', 'checking_auction',
			'awaiting_funding_signature', 'awaiting_bid_signature'])
		expect(signs).toBe(1)
		expect(JSON.parse(storage.get(STORAGE_KEY)!).pendingBids[0]).toMatchObject({ admitted: true,
			auctionId: 'auction-one', bidAmount: 700 })
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); intentSpy.mockRestore(); payoutSpy.mockRestore(); clientSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('expired pre-lock discard is exact and refuses every state-bearing or identity-changing case', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const storage = new Map<string, string>()
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	let currentActor = actor, deploymentId = 'deployment-one', operation: unknown = null, abort: unknown = null
	let registered: unknown = null, signed = 0, publicLocks = 0, operationLocks = 0, planReads = 0
	let afterAbort: (() => void) | null = null, afterPlan: (() => void) | null = null
	const state = {
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { publicLocks++; return run() },
		async runOperationExclusive<T>(_identity: unknown, run: () => Promise<T>) { operationLocks++; return run() },
		async loadOperation() { return operation }, async loadFundingAbort() {
			const value = abort; afterAbort?.(); return value
		},
	}
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue(state as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: deploymentId } } } as never)
	const plansSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserSellerPlanHttp').mockReturnValue({
		async readExact() { planReads++; const value = registered; afterPlan?.(); return value },
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return currentActor },
			async signEvent() { signed++; throw new Error('recovery must not sign') },
		})
		const reset = (entries: unknown[] = [pending()]) => {
			storage.set(STORAGE_KEY, publicState(entries)); currentActor = actor; deploymentId = 'deployment-one'
			operation = null; abort = null; registered = null; planReads = 0; afterAbort = null; afterPlan = null
		}
		const unchangedAfter = async (change: () => void, message: RegExp) => {
			reset(); change(); const before = storage.get(STORAGE_KEY)
			await expect(controller.discardExpiredPrelockPending('operation-one')).rejects.toThrow(message)
			expect(storage.get(STORAGE_KEY)).toBe(before)
		}

		reset()
		expect(await controller.expiredPrelockPending()).toEqual([{
			auctionId: 'auction-one', fundingOperationId: 'operation-one', bidAmount: 700,
			expiresAt: pending().expiresAt,
		}])
		const result = await controller.discardExpiredPrelockPending('operation-one')
		expect(result).toEqual({ status: 'discarded_prelock', auctionId: 'auction-one',
			fundingOperationId: 'operation-one' })
		expect(JSON.parse(storage.get(STORAGE_KEY)!).pendingBids).toEqual([])
		expect({ signed, planReads, publicLocks, operationLocks }).toEqual({ signed: 0, planReads: 1,
			publicLocks: 2, operationLocks: 1 })

		await unchangedAfter(() => { currentActor = otherActor }, /another actor or deployment/)
		await unchangedAfter(() => { deploymentId = 'deployment-two' }, /another actor or deployment/)
		reset([pending({ expiresAt: Math.floor(Date.now() / 1_000) - 30 })])
		const beforeGrace = storage.get(STORAGE_KEY)
		await expect(controller.discardExpiredPrelockPending('operation-one')).rejects.toThrow(/recovery grace/)
		expect(storage.get(STORAGE_KEY)).toBe(beforeGrace)
		reset([pending({ admitted: true })])
		const beforeAdmission = storage.get(STORAGE_KEY)
		await expect(controller.discardExpiredPrelockPending('operation-one')).rejects.toThrow(/terminal recovery/)
		expect(storage.get(STORAGE_KEY)).toBe(beforeAdmission)
		await unchangedAfter(() => { operation = { phase: 'keys_ready' } }, /durable payment state exists/)
		await unchangedAfter(() => { abort = { phase: 'signed' } }, /cancellation journal exists/)
		await unchangedAfter(() => { registered = { status: 'registered' } }, /seller authorization is registered/)
		await unchangedAfter(() => { afterAbort = () => { currentActor = otherActor } }, /actor or deployment changed/)
		reset(); const beforeConcurrentChange = storage.get(STORAGE_KEY)
		afterPlan = () => storage.set(STORAGE_KEY, publicState([pending({ bidAmount: 701,
			fullPoolAmount: 701, reservedPoolAmount: 701 })]))
		await expect(controller.discardExpiredPrelockPending('operation-one')).rejects.toThrow(/discovery changed/)
		expect(storage.get(STORAGE_KEY)).not.toBe(beforeConcurrentChange)

		reset([pending(), pending({ auctionId: 'auction-two' })])
		const beforeDuplicate = storage.get(STORAGE_KEY)
		await expect(controller.discardExpiredPrelockPending('operation-one')).rejects.toThrow(/not uniquely retained/)
		expect(storage.get(STORAGE_KEY)).toBe(beforeDuplicate)
		expect(signed).toBe(0)
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); plansSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('one failed retained return does not starve a later exact return or prevent durable cleanup', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const storage = new Map<string, string>()
	storage.set(STORAGE_KEY, publicState([
		pending({ fundingOperationId: 'operation-broken', auctionId: 'auction-broken' }),
		pending({ fundingOperationId: 'operation-ready', auctionId: 'auction-ready' }),
	]))
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	const state = {
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadFundingAbort() { return null },
	}
	const imported: string[] = []
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue(state as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one', participants: [] } } } as never)
	const clientSpy = spyOn(cocoClientModule, 'createDemoFridayBrowserCocoClient').mockReturnValue({
		async importRefundExact(identity: { fundingOperationId: string }) {
			if (identity.fundingOperationId === 'operation-broken') throw new Error('retained operation is unavailable')
			imported.push(identity.fundingOperationId)
			return { imported: true, alreadyImported: false }
		},
	} as never)
	const sellerSpy = spyOn(sellerClientModule, 'createDemoFridayBrowserCocoSellerClient').mockReturnValue({
		async importWinnerExact() { throw new Error('unused') },
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('automatic return import must not sign') },
		})
		await expect(controller.importAvailable()).rejects.toThrow(/1 exact payment import.*remain pending/)
		expect(imported).toEqual(['operation-ready'])
		const retained = JSON.parse(storage.get(STORAGE_KEY)!).pendingBids as Array<{ fundingOperationId: string }>
		expect(retained.map(({ fundingOperationId }) => fundingOperationId)).toEqual(['operation-broken'])
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); clientSpy.mockRestore(); sellerSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('auction payout import status reopens from its durable seller acknowledgement', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	let remoteAck = false
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: () => null, setItem: () => undefined },
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = JSON.parse(String(init?.body)) as { actor: string; fundingOperationId: string }
			if (new URL(String(input)).pathname !== '/api/friday/terminal/status') throw new Error('unexpected HTTP status read')
			return new Response(JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_STATUS_V1',
				actor: request.actor, fundingOperationId: request.fundingOperationId,
				noticePresent: remoteAck, acknowledged: remoteAck }), {
				status: 200, headers: { 'content-type': 'application/json' },
			})
		},
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	let ack: null | { auctionId: string; acknowledged?: true } = null
	let bidOperation: null | { pendingTerminalAck?: unknown; terminalAckConfirmed?: true } = null
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadSellerTerminalAck() { return ack },
		async loadOperation() { return bidOperation },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one' } } } as never)
	const payoutSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserAuctionPayoutHttp').mockReturnValue({
		async readExact() { return { authorization: { sellerActor: actor, auctionId: 'auction-one' }, authorizationDigest: '11'.repeat(32) } },
		async readWinnerExact() { return { auctionId: 'auction-one', authorizationDigest: '11'.repeat(32),
			selection: { fundingOperationId: 'operation-one' } } },
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('status reads must not sign') },
		})
		const readStatus = controller.readAuctionPayoutImportStatus!
		expect(await readStatus('auction-one')).toBe('pending')
		ack = { auctionId: 'auction-one', acknowledged: true }
		expect(await readStatus('auction-one')).toBe('settled')
		ack = { auctionId: 'auction-other' }
		await expect(readStatus('auction-one')).rejects.toThrow(/another auction/)
		const readReturn = controller.readBidReturnImportStatus!
		expect(await readReturn('operation-one')).toBeNull()
		bidOperation = {}
		expect(await readReturn('operation-one')).toBe('pending')
		bidOperation = { pendingTerminalAck: { imported: true }, terminalAckConfirmed: true }
		expect(await readReturn('operation-one')).toBe('settled')
		bidOperation = null; remoteAck = true
		expect(await readReturn('operation-one')).toBe('settled')
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); payoutSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('wallet import and terminal settlement acknowledgement remain distinct exact statuses', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const payoutDiscovery = { schema: 'PLEBEIAN_FRIDAY_BROWSER_AUCTION_PAYOUT_V1', actor,
		environmentId: 'deployment-one', auctionId: 'auction-one', authorizationDigest: '11'.repeat(32) }
	const storage = new Map<string, string>([[STORAGE_KEY, publicState([pending()], [], [payoutDiscovery])]])
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	let sellerAck: null | { auctionId: string; acknowledged?: true } = null
	let bidOperation: null | { pendingTerminalAck?: unknown; terminalAckConfirmed?: true } = {}
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadSellerTerminalAck() { return sellerAck },
		async loadOperation() { return bidOperation },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one' } } } as never)
	const payoutSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserAuctionPayoutHttp').mockReturnValue({
		async readExact() { return { authorization: { sellerActor: actor, auctionId: 'auction-one' }, authorizationDigest: '11'.repeat(32) } },
		async readWinnerExact() { return { auctionId: 'auction-one', authorizationDigest: '11'.repeat(32),
			selection: { fundingOperationId: 'operation-one' } } },
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('status reads must not sign') },
		})
		const payoutStatus = controller.readAuctionPayoutImportStatus!
		const returnStatus = controller.readBidReturnImportStatus!
		expect(await payoutStatus('auction-one')).toBe('pending')
		expect(await returnStatus('operation-one')).toBe('pending')
		sellerAck = { auctionId: 'auction-one' }; bidOperation = { pendingTerminalAck: { exact: true } }
		expect(await payoutStatus('auction-one')).toBe('wallet_imported_ack_pending')
		expect(await returnStatus('operation-one')).toBe('wallet_imported_ack_pending')
		sellerAck = { auctionId: 'auction-one', acknowledged: true }
		bidOperation = { pendingTerminalAck: { exact: true }, terminalAckConfirmed: true }
		expect(await payoutStatus('auction-one')).toBe('settled')
		expect(await returnStatus('operation-one')).toBe('settled')
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); payoutSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('an upgrade repairs a private refund acknowledgement after its public discovery pointer is already absent', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: () => publicState([]), setItem: () => undefined },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	let operation: null | { pendingTerminalAck: unknown; terminalAckConfirmed?: true } = {
		pendingTerminalAck: { exact: true },
	}
	const identities: unknown[] = []
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadOperation() { return structuredClone(operation) },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one', participants: [] } } } as never)
	const clientSpy = spyOn(cocoClientModule, 'createDemoFridayBrowserCocoClient').mockReturnValue({
		async importRefundExact(identity) {
			identities.push(structuredClone(identity)); operation = { ...operation!, terminalAckConfirmed: true }
			return { imported: true, alreadyImported: true }
		},
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('acknowledgement repair must not sign or create a payment') },
		})
		expect(await controller.repairBidReturnAcknowledgement!('operation-one')).toBe('settled')
		expect(await controller.repairBidReturnAcknowledgement!('operation-one')).toBe('settled')
		expect(identities).toEqual([{ actor, environmentId: 'deployment-one', fundingOperationId: 'operation-one' }])
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); clientSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('a current public refund pointer gives one acknowledgement attempt per import pass, never an upgrade retry too', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const storage = new Map<string, string>([[STORAGE_KEY, publicState([pending()])]])
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	const operation = { pendingTerminalAck: { exact: true } }
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadOperation() { return operation }, async loadFundingAbort() { return null },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one', participants: [] } } } as never)
	let acknowledgementAttempts = 0
	const clientSpy = spyOn(cocoClientModule, 'createDemoFridayBrowserCocoClient').mockReturnValue({
		async importRefundExact() { acknowledgementAttempts++; throw new Error('terminal acknowledgement unavailable') },
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('current acknowledgement recovery must not sign') },
		})
		expect(await controller.repairBidReturnAcknowledgement!('operation-one')).toBe('not_applicable')
		await expect(controller.importAvailable()).rejects.toThrow(/1 exact payment import.*remain pending/)
		expect(acknowledgementAttempts).toBe(1)
		expect(await controller.repairBidReturnAcknowledgement!('operation-one')).toBe('not_applicable')
		await expect(controller.importAvailable()).rejects.toThrow(/1 exact payment import.*remain pending/)
		expect(acknowledgementAttempts).toBe(2)
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); clientSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('seller payout discovery is repaired idempotently from the exact registered authorization', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const storage = new Map<string, string>([[STORAGE_KEY, publicState([])]])
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	let sellerAck: null | { auctionId: string; acknowledged?: true } = null
	let winner: null | { auctionId: string; authorizationDigest: string; selection: { fundingOperationId: string } } = null
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async loadSellerTerminalAck() { return sellerAck },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one' } } } as never)
	const payoutSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserAuctionPayoutHttp').mockReturnValue({
		async readExact() { return { authorization: { sellerActor: actor, auctionId: 'auction-one' },
			authorizationDigest: '11'.repeat(32) } },
		async readWinnerExact() { return winner },
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('discovery repair must not sign') },
		})
		expect(await controller.repairAuctionPayoutDiscovery!('auction-one')).toBe('retained')
		expect(await controller.repairAuctionPayoutDiscovery!('auction-one')).toBe('retained')
		const retained = JSON.parse(storage.get(STORAGE_KEY)!).auctionPayouts
		expect(retained).toEqual([{ schema: 'PLEBEIAN_FRIDAY_BROWSER_AUCTION_PAYOUT_V1', actor,
			environmentId: 'deployment-one', auctionId: 'auction-one', authorizationDigest: '11'.repeat(32) }])
		winner = { auctionId: 'auction-one', authorizationDigest: '11'.repeat(32),
			selection: { fundingOperationId: 'operation-one' } }
		sellerAck = { auctionId: 'auction-one', acknowledged: true }
		storage.set(STORAGE_KEY, publicState([]))
		expect(await controller.repairAuctionPayoutDiscovery!('auction-one')).toBe('settled')
		expect(JSON.parse(storage.get(STORAGE_KEY)!).auctionPayouts ?? []).toEqual([])
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); payoutSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})

test('bidder-client initialization failure cannot starve an independent retained seller import lane', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const sellerOperation = { schema: 'PLEBEIAN_FRIDAY_BROWSER_SELLER_OPERATION_V1', actor,
		environmentId: 'deployment-one', auctionId: 'auction-one', fundingOperationId: 'operation-one' }
	const storage = new Map<string, string>([[STORAGE_KEY, publicState([], [sellerOperation])]])
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp')
		.mockReturnValue({ async readExact() { return { environmentId: 'deployment-one', participants: [] } } } as never)
	const clientSpy = spyOn(cocoClientModule, 'createDemoFridayBrowserCocoClient')
		.mockImplementation(() => { throw new Error('bidder client unavailable') })
	let sellerImports = 0
	const sellerSpy = spyOn(sellerClientModule, 'createDemoFridayBrowserCocoSellerClient').mockReturnValue({
		async importWinnerExact() { sellerImports++; return { alreadyImported: false } },
	} as never)
	try {
		const { createPlebeianFridayBrowserController } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('seller import must not sign') },
		})
		await expect(controller.importAvailable()).resolves.toEqual({ refunds: 0, winnerPayments: 1,
			winnerAuctionIds: ['auction-one'], refundOperationIds: [] })
		expect(sellerImports).toBe(1)
		expect(JSON.parse(storage.get(STORAGE_KEY)!).sellerOperations).toEqual([])
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); clientSpy.mockRestore(); sellerSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})
