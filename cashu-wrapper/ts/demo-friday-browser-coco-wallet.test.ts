import { describe, expect, test } from 'bun:test'
import { getEncodedToken, MemoryRepositories } from '@cashu/coco-core'

import type { CocoMintSnapshot, CocoRailPort } from './coco-rail'
import { demoFridayBrowserCocoWalletOverDomain, openDemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import type { DemoFridayFakeFundingPolicyV1, DemoFridayFakeFundingRecord } from './demo-friday-browser-payment-state'
import { buildDemoSigAllSecret } from './demo-sigall-settlement'
import { openWalletDomain, type WalletDomain } from './open-wallet'
import { createMemorySeedStore } from './seed-store'

const actor = 'a'.repeat(64)
const mintUrl = 'https://mint.example'
const snapshot: CocoMintSnapshot = {
	mintUrl, mintPublicKey: '02'.padEnd(66, '1'), serverVersion: 'Nutshell/0.19.2',
	activeSatKeysetId: '00deadbeef', denominationKeyDigest: 'b'.repeat(64), denominationAmounts: [1, 2, 4],
	inputFeePpk: 0, nuts: [4, 7, 9, 11],
}
const lock = {
	bidderPubkey: `02${'1'.repeat(64)}`, committeePubkey: `03${'2'.repeat(64)}`,
	refundPubkey: `02${'3'.repeat(64)}`, locktime: 4_200,
}
const lockedToken = getEncodedToken({
	mint: mintUrl, unit: 'sat', proofs: [{
		amount: 2_500, id: snapshot.activeSatKeysetId,
		secret: buildDemoSigAllSecret({ nonce: '4'.repeat(64), bidderPublicKey: lock.bidderPubkey,
			committeePublicKey: lock.committeePubkey, refundPublicKey: lock.refundPubkey, locktime: lock.locktime }),
		C: `02${'5'.repeat(64)}`,
	}],
} as never)

function fixture(overrides: Partial<CocoRailPort> = {}) {
	const calls: string[] = []
	const rail = {
		async inspectMint() { calls.push('inspect'); return snapshot },
		async listPendingMintQuotes() { calls.push('quotes:list'); return [] },
		async createMintQuote() { calls.push('quote:create'); return { quoteId: 'quote-1', mintUrl, unit: 'sat', amount: 10_000, state: 'UNPAID' } },
		async refreshMintQuote() { calls.push('quote:refresh'); return { quoteId: 'quote-1', mintUrl, unit: 'sat', amount: 10_000, state: 'PAID' } },
		async prepareMintOperation() { calls.push('mint:prepare'); return { operationId: 'mint-1', quoteId: 'quote-1', state: 'prepared' } },
		async resumeMintOperation() { calls.push('mint:resume'); return { operationId: 'mint-1', quoteId: 'quote-1', state: 'finalized' } },
		async sendThresholdSigAll(input: { operationId: string }) { calls.push(`send:${input.operationId}`); return { operationId: input.operationId, state: 'pending' } },
		async prepareThresholdSigAll(input: { operationId: string }) { calls.push(`prepare:${input.operationId}`); return { operationId: input.operationId, state: 'prepared' } },
		async ensureThresholdSigAll(input: { operationId: string }) { calls.push(`ensure:${input.operationId}`); return { operationId: input.operationId, state: 'pending' } },
		async resumeThresholdSigAll(input: { operationId: string }) { calls.push(`resume:${input.operationId}`); return { operationId: input.operationId, state: 'pending', token: lockedToken } },
		async lockedToken(input: { operationId: string }) { calls.push(`token:${input.operationId}`); return { token: lockedToken, unit: 'sat', mintUrl } },
		async receive(input: { operationId?: string }) { calls.push(`receive:${input.operationId}`); return { operationId: input.operationId!, state: 'finalized' } },
		...overrides,
	} as unknown as CocoRailPort
	const domain = {
		rail,
		runtime: { async balance() {
			const funded = calls.some((call) => call === 'mint:resume') ? 10_000 : 0
			return { available: 7_500 + funded, reserved: 2_500, locked: 0, pending: 0, unresolved: 0, total: 10_000 + funded }
		} },
		paymentKey: {
			async getPublicKey() { return lock.bidderPubkey },
			async signDigest() { return new Uint8Array(64).fill(7) },
		},
		async dispose() { calls.push('dispose') },
	} as unknown as WalletDomain
	return { calls, wallet: demoFridayBrowserCocoWalletOverDomain({ actor, mintUrl, seedLocation: 'indexeddb', snapshot, domain }) }
}

function fundingJournal() {
	const rows = new Map<string, DemoFridayFakeFundingRecord>()
	return {
		rows,
		async loadFakeFunding(identity: { fundingOperationId: string }) {
			return structuredClone(rows.get(identity.fundingOperationId) ?? null)
		},
		async saveFakeFunding(record: DemoFridayFakeFundingRecord, expectedRevision: number | null) {
			const prior = rows.get(record.fundingOperationId)
			if ((expectedRevision === null && prior !== undefined)
				|| (expectedRevision !== null && prior?.revision !== expectedRevision)) throw new Error('journal revision conflict')
			rows.set(record.fundingOperationId, structuredClone(record))
		},
	}
}

const reviewedFundingPolicy: DemoFridayFakeFundingPolicyV1 = {
	schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
	browserWalletAdvisoryMaxResultingBalance: 50_000,
	digest: '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069',
}

describe('Friday browser Coco v2 adapter', () => {
	test('requires the configured mint to equal the browser HTTPS origin', async () => {
		await expect(openDemoFridayBrowserCocoWallet({
			actor, mintUrl, environmentId: 'friday-demo', browserOrigin: 'https://site.example',
		})).rejects.toThrow(/must equal the browser HTTPS origin/)
	})

	test('uses Coco durable send and receive operations instead of a parallel wallet', async () => {
		const { calls, wallet } = fixture()
		expect(await wallet.prepareThresholdFundingOperation({
			amount: 2_500, operationId: 'funding-1', lock,
		})).toEqual({ operationId: 'funding-1', state: 'prepared' })
		const prepared = await wallet.prepareThresholdFunding({
			amount: 2_500, operationId: 'funding-1', lock,
		})
		expect(prepared).toEqual({ operationId: 'funding-1', token: lockedToken, state: 'pending', amount: 2_500,
			keysetId: snapshot.activeSatKeysetId })
		expect(await wallet.recoverThresholdFunding({ amount: 2_500, operationId: 'funding-1',
			keysetId: snapshot.activeSatKeysetId, lock })).toMatchObject({ token: lockedToken, amount: 2_500 })
		expect(await wallet.importTerminalToken({ operationId: 'return-1', token: 'cashuBRETURN' }))
			.toEqual({ operationId: 'return-1', state: 'finalized' })
		expect(calls).toEqual(['prepare:funding-1', 'resume:funding-1', 'token:funding-1',
			'resume:funding-1', 'token:funding-1', 'receive:return-1'])
	})

	test('keeps the seller payment key inside the Coco domain and restricts the outward signing role', async () => {
		const { wallet } = fixture()
		expect(await wallet.sellerRecipientKey.getPublicKey()).toBe(lock.bidderPubkey)
		expect(await wallet.sellerRecipientKey.signRecipientCapability({
			digest: 'a'.repeat(64), recipientPublicKey: lock.bidderPubkey,
			operationId: 'seller-operation-1', role: 'winner_settlement',
		})).toBe('07'.repeat(64))
		await expect(wallet.sellerRecipientKey.signTerminalAck({
			digest: 'a'.repeat(64), recipientPublicKey: lock.refundPubkey,
			operationId: 'seller-operation-1', role: 'winner_settlement',
		})).rejects.toThrow(/differs from Coco keyring/)
	})

	test('funds through Coco and enforces the browser-wallet advisory resulting-balance limit', async () => {
		const { calls, wallet } = fixture()
		const journal = fundingJournal()
		expect(await wallet.fundFake({ amount: 10_000, operationId: 'faucet-1', environmentId: 'friday-demo', journal }))
			.toEqual({ operationId: 'faucet-1', state: 'finalized', balance: 20_000 })
		expect(calls).toContain('mint:resume')
		expect(journal.rows.get('faucet-1')?.phase).toBe('finalized')
		await expect(wallet.fundFake({ amount: 10_000, operationId: 'faucet-2', environmentId: 'friday-demo',
			browserWalletAdvisoryMaxResultingBalance: 20_000, journal }))
			.rejects.toThrow(/browser-wallet advisory balance limit exceeded/)
	})

	test('replays the exact journaled mint operation after its response is lost', async () => {
		let lose = true
		const { calls, wallet } = fixture({ async resumeMintOperation() {
			calls.push('mint:resume')
			if (lose) { lose = false; throw new Error('mint response lost') }
			return { operationId: 'mint-1', quoteId: 'quote-1', state: 'finalized' }
		} })
		const journal = fundingJournal(), request = { amount: 10_000, operationId: 'faucet-recovery',
			environmentId: 'friday-demo', journal }
		await expect(wallet.fundFake(request)).rejects.toThrow(/response lost/)
		expect(journal.rows.get(request.operationId)?.phase).toBe('operation_bound')
		expect(await wallet.fundFake(request)).toMatchObject({ operationId: request.operationId, state: 'finalized' })
		expect(calls.filter((value) => value === 'quote:create')).toHaveLength(1)
		expect(calls.filter((value) => value === 'mint:prepare')).toHaveLength(1)
		expect(calls.filter((value) => value === 'mint:resume')).toHaveLength(2)
	})

	test('binds the V2 record to the runtime policy and rejects a changed-policy retry', async () => {
		const { wallet } = fixture({ async resumeMintOperation() { throw new Error('mint response lost') } })
		const journal = fundingJournal(), request = { amount: 10_000, operationId: 'faucet-v2-policy',
			environmentId: 'friday-demo', policy: reviewedFundingPolicy, journal }
		await expect(wallet.fundFake(request)).rejects.toThrow(/response lost/)
		expect(journal.rows.get(request.operationId)).toMatchObject({
			schema: 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2',
			browserWalletAdvisoryMaxResultingBalance: 50_000,
			policyDigest: reviewedFundingPolicy.digest,
		})
		await expect(wallet.fundFake({ ...request, policy: { ...reviewedFundingPolicy,
			browserWalletAdvisoryMaxResultingBalance: 60_000,
			digest: 'df27096dfb352a3de08f170ba6da94e80c6b8482b07159d69bca7cda73686efe' } }))
			.rejects.toThrow(/immutable intent/)
		await expect(wallet.fundFake({ ...request, browserWalletAdvisoryMaxResultingBalance: 40_000 }))
			.rejects.toThrow(/fake funding request is invalid/)
	})

	test('recovers an exact golden legacy record without rewriting its policy identity', async () => {
		let lose = true
		const { wallet } = fixture({ async resumeMintOperation() {
			if (lose) { lose = false; throw new Error('mint response lost') }
			return { operationId: 'mint-1', quoteId: 'quote-1', state: 'finalized' }
		} })
		const journal = fundingJournal(), legacy = { amount: 10_000, operationId: 'faucet-legacy-policy',
			environmentId: 'friday-demo', journal }
		await expect(wallet.fundFake(legacy)).rejects.toThrow(/response lost/)
		expect(journal.rows.get(legacy.operationId)?.schema).toBe('PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1')
		await expect(wallet.fundFake({ ...legacy, policy: reviewedFundingPolicy })).resolves.toMatchObject({
			operationId: legacy.operationId, state: 'finalized',
		})
		expect(journal.rows.get(legacy.operationId)?.schema).toBe('PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1')
	})

	test('never creates a second quote when the first quote response is lost and cannot be recovered', async () => {
		let createCalls = 0, listCalls = 0
		const { wallet } = fixture({
			async listPendingMintQuotes() {
				listCalls += 1
				return [{ quoteId: 'unrelated-same-amount', mintUrl, unit: 'sat', amount: 10_000, state: 'PAID' }]
			},
			async createMintQuote() { createCalls += 1; throw new Error('quote response lost') },
		})
		const journal = fundingJournal(), request = { amount: 10_000, operationId: 'faucet-quote-unknown',
			environmentId: 'friday-demo', journal }
		await expect(wallet.fundFake(request)).rejects.toThrow(/response lost/)
		expect(journal.rows.get(request.operationId)?.phase).toBe('quote_requested')
		await expect(wallet.fundFake(request)).rejects.toThrow(/response is unknown/)
		expect(createCalls).toBe(1)
		expect(listCalls).toBe(0)
	})

	test('fails closed on operation state, mint identity, keyset drift and non-final import', async () => {
		const changed = fixture({ async inspectMint() { return { ...snapshot, activeSatKeysetId: 'changed' } } })
		await expect(changed.wallet.inspect()).rejects.toThrow(/keyset changed/)
		const absent = fixture({ async lockedToken() { return null } })
		await expect(absent.wallet.prepareThresholdFunding({
			amount: 1, operationId: 'funding-2', lock,
		})).rejects.toThrow(/token is absent/)
		const pending = fixture({ async receive(input) { return { operationId: input.operationId!, state: 'pending' } } })
		await expect(pending.wallet.importTerminalToken({ operationId: 'return-2', token: 'cashuBRETURN' })).rejects.toThrow(/not finalized/)
	})
})


function deferredOpen() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes }); return { promise, resolve } }

test('wallet opening propagates cancellation to mint inspection and disposes before rejecting', async () => {
	const abort = new AbortController(), entered = deferredOpen(), cleanup = deferredOpen(), closed = deferredOpen()
	let disposed = 0, requestSignal: AbortSignal | null | undefined
	const pending = openDemoFridayBrowserCocoWallet({ actor, mintUrl, environmentId: 'friday-demo', browserOrigin: mintUrl,
		signal: abort.signal, seedStore: createMemorySeedStore(new Uint8Array(64).fill(1)),
		fetchImpl: (async (_input, init) => {
			requestSignal = init?.signal; entered.resolve()
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
			})
		}) as typeof fetch,
		async openDomain(options) {
			expect(options.signal).toBe(abort.signal)
			return { runtime: {} as never, paymentKey: {} as never,
				rail: { async trustMint() { return { mintUrl, trusted: true } }, async inspectMint() {
					await options.requestFetch!(mintUrl+'/v1/info'); return snapshot
				} } as never,
				async dispose() { disposed++; cleanup.resolve(); await closed.promise },
			}
		},
	})
	let outcome = 'pending'; const observed = pending.then(() => { outcome = 'open' }, () => { outcome = 'cancelled' })
	await entered.promise; abort.abort(); await cleanup.promise
	expect(requestSignal?.aborted).toBe(true); expect(disposed).toBe(1); expect(outcome).toBe('pending')
	closed.resolve(); await observed; expect(outcome).toBe('cancelled')
})

test('late actual Coco manager initialization is disposed after cancellation before opener settles', async () => {
	const repositories = new MemoryRepositories(), entered = deferredOpen(), release = deferredOpen(), abort = new AbortController()
	const initialize = repositories.init.bind(repositories)
	repositories.init = async () => { entered.resolve(); await release.promise; await initialize() }
	let outcome = 'pending'
	const opening = openWalletDomain({ account: { accountId: actor, environmentId: 'friday-demo' },
		seedStore: createMemorySeedStore(new Uint8Array(64).fill(1)), repositories,
		signal: abort.signal, requestFetch: (async (_input: Parameters<typeof fetch>[0]) => { throw new Error('test forbids network') }) as unknown as typeof fetch,
	}).then(() => { outcome = 'open' }, () => { outcome = 'cancelled' })
	await entered.promise; abort.abort(); await new Promise((resolve) => setTimeout(resolve,0))
	expect(outcome).toBe('pending')
	release.resolve(); await opening
	expect(outcome).toBe('cancelled'); expect(repositories.getAuthorityState()).toBe('released')
})
