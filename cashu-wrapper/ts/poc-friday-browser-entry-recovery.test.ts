import { expect, spyOn, test } from 'bun:test'

import * as paymentStateModule from './demo-friday-browser-payment-state'
import * as trustHttpModule from './demo-friday-browser-trust-http'

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

function publicState(entries: unknown[]) {
	return JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1', pendingBids: entries,
		sellerOperations: [] })
}

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
