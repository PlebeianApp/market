import { describe, expect, test } from 'bun:test'

import {
	createDemoFridayBrowserPaymentOperation, createDemoFridayBrowserPaymentState,
	validateDemoFridayFakeFundingRecord,
} from './demo-friday-browser-payment-state'

const actor = '1'.repeat(64)
const committee = `02${'2'.repeat(64)}`

function deterministicRandom() {
	let scalar = 3
	return (bytes: Uint8Array): Uint8Array => {
		bytes.fill(0); bytes[31] = scalar; scalar += 1
		return bytes
	}
}

describe('Friday browser private payment state', () => {
	test('recomputes the immutable V2 fake-funding policy digest', () => {
		const record = {
			schema: 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2' as const, revision: 0,
			actor, environmentId: 'friday-live', fundingOperationId: 'funding-1',
			canonicalMintUrl: 'https://172.105.95.57', amount: 10_000,
			browserWalletAdvisoryMaxResultingBalance: 50_000, maxPerRequest: 10_000,
			policySchema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1' as const,
			policyDigest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069',
			phase: 'intent' as const,
		}
		expect(() => validateDemoFridayFakeFundingRecord(record)).not.toThrow()
		expect(() => validateDemoFridayFakeFundingRecord({ ...record, policyDigest: '44'.repeat(32) }))
			.toThrow(/record is malformed/)
	})

	test('persists distinct total-bid and reserved-delta terms with operation-bound keys', () => {
		const operation = createDemoFridayBrowserPaymentOperation({
			actor, environmentId: 'friday-live', authNetworkId: 'friday-network', chainId: 'friday-chain',
			auctionId: 'auction-1', fundingOperationId: 'funding-raise-1',
			canonicalMintUrl: 'https://172.105.64.142', mintPublicKey: `02${'3'.repeat(64)}`,
			mintServerVersion: 'Nutshell/0.19.2', bidAmount: 5_000, fullPoolAmount: 5_000,
			reservedPoolAmount: 600, replacesBidId: 'a'.repeat(64), keysetId: '00deadbeef',
			priorLeaderActor: 'e'.repeat(64), winnerRecipientPublicKey: `03${'4'.repeat(64)}`,
			winnerRecipientCapabilityDigest: 'f'.repeat(64), winnerOutputsDigest: '1'.repeat(64),
			denominationKeyDigest: 'b'.repeat(64), denominationAmounts: [1, 2, 4], mintNuts: [4, 7, 9, 10, 11, 12],
			inputFeePpk: 0, committeePublicKey: committee, committeeKeysetId: 'committee-1',
			committeeKeysetVersion: 'version-1', dkgRunId: 'dkg-1', publicKeyPackageSha256: 'c'.repeat(64),
			signerRosterDigest: 'd'.repeat(64), locktime: 10_000,
		}, deterministicRandom())

		expect(operation.bidAmount).toBe(5_000)
		expect(operation.reservedPoolAmount).toBe(600)
		expect(operation.lock.bidderPubkey).toBe(operation.paymentPublicKey)
		expect(operation.lock.refundPubkey).toBe(operation.refundPublicKey)
		expect(operation.paymentSecret).not.toBe(operation.refundSecret)
		expect(JSON.stringify({
			actor: operation.actor, operation: operation.fundingOperationId, bidAmount: operation.bidAmount,
			reservedPoolAmount: operation.reservedPoolAmount, lock: operation.lock,
		})).not.toContain(operation.paymentSecret)
	})

	test('rejects an internal transport identity and an invalid own-raise delta', () => {
		const base = {
			actor, environmentId: 'friday-live', authNetworkId: 'friday-network', chainId: 'friday-chain',
			auctionId: 'auction-1', fundingOperationId: 'funding-raise-1', mintPublicKey: `02${'3'.repeat(64)}`,
			mintServerVersion: 'Nutshell/0.19.2', bidAmount: 5_000, fullPoolAmount: 5_000,
			reservedPoolAmount: 600, replacesBidId: 'a'.repeat(64), keysetId: '00deadbeef',
			priorLeaderActor: 'e'.repeat(64), winnerRecipientPublicKey: `03${'4'.repeat(64)}`,
			winnerRecipientCapabilityDigest: 'f'.repeat(64), winnerOutputsDigest: '1'.repeat(64),
			denominationKeyDigest: 'b'.repeat(64), denominationAmounts: [1, 2, 4], mintNuts: [4, 7, 9, 10, 11, 12],
			inputFeePpk: 0 as const, committeePublicKey: committee, committeeKeysetId: 'committee-1',
			committeeKeysetVersion: 'version-1', dkgRunId: 'dkg-1', publicKeyPackageSha256: 'c'.repeat(64),
			signerRosterDigest: 'd'.repeat(64), locktime: 10_000,
		}
		expect(() => createDemoFridayBrowserPaymentOperation({
			...base, canonicalMintUrl: 'http://[fd42::1]:3338',
		}, deterministicRandom())).toThrow(/public HTTPS origin/)
		expect(() => createDemoFridayBrowserPaymentOperation({
			...base, canonicalMintUrl: 'https://172.105.64.142', reservedPoolAmount: 5_001,
		}, deterministicRandom())).toThrow(/terms are invalid/)
	})
})


test('wallet lease forwards acquisition signal and guards a late callback from an old lock adapter', async () => {
	let callback!: () => Promise<void>, seenName = '', seenSignal: AbortSignal | undefined
	const locks = { request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, run: () => Promise<T>): Promise<T> {
		seenName = name; seenSignal = options.signal; callback = run as () => Promise<void>
		return new Promise<T>(() => {})
	} }
	const state = createDemoFridayBrowserPaymentState({ indexedDB: {} as IDBFactory, locks })
	const abort = new AbortController(); let effects = 0
	void state.runWalletExclusive({ actor, environmentId: 'friday-live' }, async () => { effects++ }, abort.signal)
	expect(seenName).toBe(`plebeian-friday-private:wallet:friday-live\u0000${actor}`)
	expect(seenSignal).toBe(abort.signal); abort.abort()
	await expect(callback()).rejects.toThrow(); expect(effects).toBe(0)
})
