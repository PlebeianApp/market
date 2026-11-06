import { expect, spyOn, test } from 'bun:test'

import * as paymentStateModule from './demo-friday-browser-payment-state'
import * as trustHttpModule from './demo-friday-browser-trust-http'
import * as walletModule from './demo-friday-browser-coco-wallet'

const STORAGE_KEY = 'plebeian-friday-browser-public-operations-v1'
const actor = 'aa'.repeat(32)
const otherActor = 'bb'.repeat(32)
const environmentId = 'deployment-one'

function legacyState(owner = otherActor) {
	return {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1', pendingBids: [], sellerOperations: [],
		pendingFaucet: { actor: owner, environmentId, fundingOperationId: 'faucet-legacy', amount: 200,
			policyDigest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069' },
	}
}

test('foreign legacy faucet recovery is preserved without blocking another actor', async () => {
	const saved = new Map<string, PropertyDescriptor | undefined>()
	const storage = new Map<string, string>([[STORAGE_KEY, JSON.stringify(legacyState())]])
	for (const [key, value] of Object.entries({
		location: { origin: 'https://auction.example' },
		localStorage: { getItem: (name: string) => storage.get(name) ?? null,
			setItem: (name: string, next: string) => { storage.set(name, next) } },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
	let walletOpens = 0, funded = 0, disposals = 0
	const stateSpy = spyOn(paymentStateModule, 'createDemoFridayBrowserPaymentState').mockReturnValue({
		async runPublicIndexExclusive<T>(run: () => Promise<T>) { return run() },
		async runWalletExclusive<T>(_identity: unknown, run: () => Promise<T>) { return run() },
	} as never)
	const deploymentSpy = spyOn(trustHttpModule, 'createDemoFridayBrowserTrustedDeploymentHttp').mockReturnValue({
		async readExact() { return { environmentId, canonicalMintUrl: 'https://auction.example' } },
	} as never)
	const walletSpy = spyOn(walletModule, 'createDemoFridayBrowserCocoWalletFactory').mockReturnValue({
		async openExact() {
			walletOpens += 1
			return {
				async fundFake(value: { operationId: string; amount: number }) {
					funded += 1
					return { operationId: value.operationId, state: 'finalized', balance: value.amount }
				},
				async dispose() { disposals += 1 },
			}
		},
	} as never)
	try {
		const { createPlebeianFridayBrowserController, validateDemoFridayBrowserPublicState } = await import('./poc-friday-browser-entry')
		const controller = createPlebeianFridayBrowserController({
			async getPublicKey() { return actor },
			async signEvent() { throw new Error('fake funding recovery must not sign') },
		})
		expect(await controller.pendingFakeFunding()).toBeNull()
		expect(walletOpens).toBe(0)
		await expect(controller.fundFake(100)).resolves.toMatchObject({ state: 'finalized', balance: 100 })
		expect({ walletOpens, funded, disposals }).toEqual({ walletOpens: 1, funded: 1, disposals: 1 })
		const migrated = JSON.parse(storage.get(STORAGE_KEY)!)
		expect(migrated).toEqual({
			schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V2', pendingBids: [], sellerOperations: [],
			pendingFaucets: [legacyState().pendingFaucet],
		})
		expect(() => validateDemoFridayBrowserPublicState({ ...migrated,
			pendingFaucets: [legacyState().pendingFaucet, { ...legacyState().pendingFaucet, fundingOperationId: 'faucet-other' }],
		})).toThrow(/duplicate fake funding recovery/)
	} finally {
		stateSpy.mockRestore(); deploymentSpy.mockRestore(); walletSpy.mockRestore()
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
})
