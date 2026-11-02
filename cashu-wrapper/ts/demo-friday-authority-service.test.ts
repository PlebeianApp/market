import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { createDemoFridayFixedAuthorityService } from './demo-friday-authority-service'
import { demoFridayFundingAuthorizationUnsignedEvent, demoFridayFundingKeyAuthorizationDigest } from './demo-friday-browser-funding-authorization'

const secret = hexToBytes('1'.padStart(64, '0'))
const actor = bytesToHex(schnorr.getPublicKey(secret))
const compressed = (n: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(n.toString(16).padStart(64, '0')), true))
const paymentSecret = hexToBytes('2'.padStart(64, '0'))
const refundSecret = hexToBytes('3'.padStart(64, '0'))

function signedFunding() {
	const returnCashuSigAllDigest = '8'.repeat(64)
	const terms = {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1', authNetworkId: 'friday-demo', chainId: 'friday-chain',
		auctionId: 'auction-1', amount: 2_500, mintUrl: 'http://127.0.0.1:3438/',
		paymentPublicKey: compressed(2), refundPublicKey: compressed(3), fundingOperationId: 'funding-1',
		bundleDigest: '4'.repeat(64), returnPackageDigest: '5'.repeat(64), returnCashuSigAllDigest,
		bidderReturnSignature: bytesToHex(schnorr.sign(hexToBytes(returnCashuSigAllDigest), paymentSecret)), expiresAt: 1_200,
	} as const
	const keyDigest = demoFridayFundingKeyAuthorizationDigest(actor, terms)
	const unsigned = demoFridayFundingAuthorizationUnsignedEvent(actor, 1_000, {
		...terms,
		paymentKeyAuthorizationSignature: bytesToHex(schnorr.sign(hexToBytes(keyDigest), paymentSecret)),
		refundKeyAuthorizationSignature: bytesToHex(schnorr.sign(hexToBytes(keyDigest), refundSecret)),
	})
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)) }
}

function fixture() {
	let sourceReads = 0, queued = 0
	const service = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
		publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
		mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_100,
		terminalSource: {
			async nextExact() { sourceReads += 1; return null },
			async markQueuedExact() { queued += 1 },
		},
		terminalRuntime: { async queueTerminal() { throw new Error('must not be called') } },
		health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false, queuePending: 0, lastCommittedHeight: 42 } } },
	})
	return { service, counts: () => ({ sourceReads, queued }) }
}

describe('fixed Friday authority API', () => {
	test('uses captured trusted terminal source and never a request-supplied reader', async () => {
		const held = fixture()
		expect(await held.service.drainOne()).toBe('idle')
		expect(held.counts()).toEqual({ sourceReads: 1, queued: 0 })
	})

	test('recovers one persisted FundingAbort row before scanning terminal discovery', async () => {
		const events: string[] = []
		const service = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
			mintUrl: 'https://172.105.64.142', nowSeconds: () => 1_100,
			terminalSource: { async nextExact() { events.push('source'); return null }, async markQueuedExact() {} },
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { events.push('anchor'); return {
				deploymentId: 'friday-blue', quarantined: false, queuePending: 0, lastCommittedHeight: 42,
			} } },
			fundingAbort: {
				async recoverOnePendingExact() { events.push('abort-recover'); return 'recovered' },
				async registerBrowserCapsuleExact() { throw new Error('not used') },
				async prepareBrowserExact() { throw new Error('not used') },
				async submitBrowserExact() { throw new Error('not used') },
				async readBrowserExact() { throw new Error('not used') },
			},
		})
		expect(await service.drainOne()).toBe('queued')
		expect(events).toEqual(['anchor', 'abort-recover'])
	})

	test('queues one trusted-source terminal and acknowledges only after the exact runtime succeeds', async () => {
		const opaqueRequest = { branch: 'outbid_return', options: { captured: true } } as never
		const queuedResult = { branch: 'outbid_return', result: { queued: { scope: 'scope-1' } } } as never
		const events: string[] = []
		const service = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
			mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_100,
			terminalSource: {
				async nextExact() { events.push('source'); return { reference: 'terminal-1', request: opaqueRequest } },
				async markQueuedExact(reference, result) {
					expect(reference).toBe('terminal-1'); expect(result).toBe(queuedResult); events.push('ack')
				},
			},
			terminalRuntime: { async queueTerminal(request) { expect(request).toBe(opaqueRequest); events.push('queue'); return queuedResult } },
			health: { async readExact() { events.push('anchor'); return { deploymentId: 'friday-blue', quarantined: false, queuePending: 0, lastCommittedHeight: 42 } } },
		})
		expect(await service.drainOne()).toBe('queued')
		expect(events).toEqual(['anchor', 'source', 'queue', 'ack'])
	})

	test('authenticates same-origin browser authorization but keeps funding fail-closed', async () => {
		const held = fixture()
		const accepted = await held.service.handle(new Request('http://127.0.0.1:8181/api/friday/funding', {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: JSON.stringify(signedFunding()),
		}))
		expect(accepted.status).toBe(503)
		expect(await accepted.json()).toEqual({ error: 'funding_disabled_pending_integrated_test', operation: 'funding-1' })
		const crossOrigin = await held.service.handle(new Request('http://127.0.0.1:8181/api/friday/funding', {
			method: 'POST', headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: JSON.stringify(signedFunding()),
		}))
		expect(crossOrigin.status).toBe(403)
	})

	test('passes one same-origin envelope only to the fixed captured funding service', async () => {
		const calls: Array<{ method: string; value: unknown }> = []
		const challenge = {
			schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_CHALLENGE_V1' as const, status: 'signature_required' as const,
			fundingAuthorizationEventId: '1'.repeat(64), fundingOperationId: 'operation-1',
			receiptDigest: '4'.repeat(64),
			preparationId: '1'.repeat(64), bidAmount: 1_000, reservedPoolAmount: 1_000,
			canonicalMintUrl: 'http://127.0.0.1:3438/',
			unsignedEvent: { pubkey: actor, created_at: 1_000, kind: 28_641 as const, tags: [] as string[][], content: '{}' },
		}
		const admitted = {
			schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_RESULT_V1' as const, status: 'admitted' as const,
			fundingAuthorizationEventId: '1'.repeat(64), fundingOperationId: 'operation-1',
			bidEventId: '2'.repeat(64), transactionHash: '3'.repeat(64), committedHeight: 50,
			receiptDigest: '4'.repeat(64), bidAmount: 1_000, reservedPoolAmount: 1_000,
			canonicalMintUrl: 'http://127.0.0.1:3438/',
		}
		const service = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
			mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_100,
			terminalSource: { async nextExact() { return null }, async markQueuedExact() {} },
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false, queuePending: 0, lastCommittedHeight: 42 } } },
			fundingAdmission: {
				async prepareExact(value) { calls.push({ method: 'prepare', value }); return challenge },
				async confirmExact(value) { calls.push({ method: 'confirm', value }); return admitted },
				async readExact(value) { calls.push({ method: 'read', value }); return {
					schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_STATUS_V1', status: 'admitted',
					preparationId: value.preparationId, fundingAuthorizationEventId: value.fundingAuthorizationEventId,
					fundingOperationId: value.fundingOperationId, bidAmount: 1_000, reservedPoolAmount: 1_000,
					canonicalMintUrl: 'http://127.0.0.1:3438/', signedBidEventId: admitted.bidEventId,
					receiptDigest: admitted.receiptDigest, transactionHash: admitted.transactionHash,
					committedHeight: admitted.committedHeight,
				} },
			},
		})
		const envelope = { schema: 'PLEBEIAN_FRIDAY_PREPARED_FUNDING_ENVELOPE_V1', authorization: signedFunding(), bundle: { opaque: true } }
		const response = await service.handle(new Request('http://127.0.0.1:8181/api/friday/funding', {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: JSON.stringify(envelope),
		}))
		expect(response.status).toBe(202)
		expect(calls).toEqual([{ method: 'prepare', value: envelope }])
		expect(await response.json()).toMatchObject({ status: 'signature_required', fundingOperationId: 'operation-1' })
		const confirmation = { schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_CONFIRMATION_V1', fundingAuthorizationEventId: '1'.repeat(64), signedEvent: { opaque: true } }
		const confirmed = await service.handle(new Request('http://127.0.0.1:8181/api/friday/funding/confirm', {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: JSON.stringify(confirmation),
		}))
		expect(confirmed.status).toBe(201)
		expect(calls).toEqual([{ method: 'prepare', value: envelope }, { method: 'confirm', value: confirmation }])
		expect(await confirmed.json()).toMatchObject({ status: 'admitted', committedHeight: 50 })
		const status = await service.handle(new Request('http://127.0.0.1:8181/api/friday/status'))
		expect(await status.json()).toMatchObject({ funding: 'enabled_two_step_nip07' })
	})

	test('recovery-only mode blocks every new operation and requires a durable exact identity before mutation', async () => {
		const calls: string[] = []
		const service = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
			mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_100,
			terminalSource: { async nextExact() { return null }, async markQueuedExact() {} },
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false, queuePending: 1, lastCommittedHeight: 42 } } },
			fundingAdmission: {
				async prepareExact() { calls.push('prepare'); throw new Error('must not create') },
				async confirmExact() { calls.push('confirm'); return { status: 'admitted' } as never },
				async readExact() { calls.push('read'); return { status: 'unknown' } as never },
			},
			browserTrust: {
				async readDeploymentExact() { return { schema: 'deployment' } as never },
				async issueSellerPlanChallengeExact() { calls.push('intent'); throw new Error('must not create') },
				async readSellerPlanChallengeExact() { return { schema: 'challenge' } as never },
				async listSellerPlanChallengesExact() { return [] },
				async registerSellerPlanExact() { calls.push('seller-register'); return { planDigest: 'a'.repeat(64), plan: {} } as never },
				async readSellerPlanExact() { return null },
				async readAuctionFundingExact() { return { schema: 'auction' } as never },
				async assertRegisteredWinnerExact() { throw new Error('not an HTTP route') },
			},
			recoveryOnly: {
				async assertRecordedExact(action, value) {
					calls.push(`guard:${action}`)
					const eventId = (value as { fundingAuthorizationEventId?: string }).fundingAuthorizationEventId
					if (eventId === '3'.repeat(64) && action === 'funding_confirm') {
						throw new Error('prepared operation was never broadcast')
					}
					if (eventId !== '1'.repeat(64) && eventId !== '3'.repeat(64)) {
						throw new Error('operation is absent')
					}
				},
			},
		})
		const post = (path: string, body: unknown) => service.handle(new Request(`http://127.0.0.1:8181${path}`, {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}))
		expect((await post('/api/friday/funding', { operation: 'new' })).status).toBe(409)
		expect((await post('/api/friday/seller-plan/intent', { operation: 'new' })).status).toBe(409)
		expect(calls).toEqual([])
		expect((await post('/api/friday/funding/confirm', { fundingAuthorizationEventId: '2'.repeat(64) })).status).toBe(409)
		expect(calls).toEqual(['guard:funding_confirm'])
		expect((await post('/api/friday/funding/confirm', { fundingAuthorizationEventId: '3'.repeat(64) })).status).toBe(409)
		expect(calls).toEqual(['guard:funding_confirm', 'guard:funding_confirm'])
		expect((await post('/api/friday/funding/confirm', { fundingAuthorizationEventId: '1'.repeat(64) })).status).toBe(201)
		expect(calls).toEqual(['guard:funding_confirm', 'guard:funding_confirm', 'guard:funding_confirm', 'confirm'])
		const status = await service.handle(new Request('http://127.0.0.1:8181/api/friday/status'))
		expect(await status.json()).toMatchObject({ mode: 'recovery_only', funding: 'recovery_only_existing_operations' })
	})

	test('maps the browser abort prepare, signed request, and read-only recovery to one captured service', async () => {
		const calls: Array<{ method: string; value: unknown }> = []
		const preparation = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1',
			preparationId: 'a'.repeat(64), terms: { operationId: 'funding-1' } } as never
		const pending = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1',
			preparationId: 'a'.repeat(64), actor, fundingOperationId: 'funding-1', status: 'PENDING' } as const
		const service = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
			mintUrl: 'https://172.105.64.142', nowSeconds: () => 1_100,
			terminalSource: { async nextExact() { return null }, async markQueuedExact() {} },
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false, queuePending: 0, lastCommittedHeight: 42 } } },
			fundingAbort: {
				async registerBrowserCapsuleExact(value) { calls.push({ method: 'capsule', value }); return { capsuleDigest: 'c'.repeat(64) } },
				async prepareBrowserExact(value) { calls.push({ method: 'prepare', value }); return preparation },
				async submitBrowserExact(value) { calls.push({ method: 'request', value }); return pending },
				async readBrowserExact(value) { calls.push({ method: 'read', value }); return pending },
			},
		})
		const post = (path: string, body: unknown) => service.handle(new Request(`http://127.0.0.1:8181${path}`, {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}))
		expect((await post('/api/friday/funding-abort/prepare', { fundingOperationId: 'funding-1', actor,
			abortReason: 'prebroadcast_client_abandonment' })).status).toBe(201)
		expect((await post('/api/friday/funding-abort/request', { preparationId: 'a'.repeat(64),
			actorAbortEvent: { id: 'b'.repeat(64) } })).status).toBe(202)
		expect((await post('/api/friday/funding-abort/status', { preparationId: 'a'.repeat(64), actor,
			fundingOperationId: 'funding-1' })).status).toBe(200)
		expect(calls.map((value) => value.method)).toEqual(['prepare', 'request', 'read'])
	})

	test('reports quarantine without exposing trusted reader details', async () => {
		const held = fixture()
		const response = await held.service.handle(new Request('http://127.0.0.1:8181/api/friday/status'))
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({ funding: 'disabled_pending_integrated_test', lastCommittedHeight: 42 })
		const quarantined = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
			mintUrl: 'http://127.0.0.1:3438/', nowSeconds: () => 1_100,
			terminalSource: { async nextExact() { return null }, async markQueuedExact() {} },
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: true, queuePending: 1, lastCommittedHeight: 42 } } },
		})
		expect((await quarantined.handle(new Request('http://127.0.0.1:8181/api/friday/status'))).status).toBe(503)
	})

	test('maps only fixed same-origin browser trust routes and leaves them disabled when absent', async () => {
		const base = fixture()
		const disabled = await base.service.handle(new Request('http://127.0.0.1:8181/api/friday/deployment', {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_READ_V1' }),
		}))
		expect(disabled.status).toBe(503)

		const calls: string[] = []
		const service = createDemoFridayFixedAuthorityService({
  readiness: { async readExact() { return { ready: true, reason: 'test_fixture', height: 42 } } },
			publicOrigin: 'https://172.105.64.142', authNetworkId: 'friday-demo', chainId: 'friday-chain',
			mintUrl: 'https://172.105.64.142', nowSeconds: () => 1_100,
			terminalSource: { async nextExact() { return null }, async markQueuedExact() {} },
			terminalRuntime: { async queueTerminal() { throw new Error('must not run') } },
			health: { async readExact() { return { deploymentId: 'friday-blue', quarantined: false, queuePending: 0, lastCommittedHeight: 42 } } },
			browserTrust: {
				async readDeploymentExact() { calls.push('deployment'); return { schema: 'deployment' } as never },
				async issueSellerPlanChallengeExact(value) { calls.push(`intent:${(value as { id: string }).id}`); return { schema: 'challenge' } as never },
				async readSellerPlanChallengeExact(value) { calls.push(`challenge:${value.fundingOperationId}`); return { schema: 'challenge' } as never },
				async listSellerPlanChallengesExact(value) { calls.push(`pending:${value}`); return [] },
				async registerSellerPlanExact() { calls.push('register'); return { planDigest: 'a'.repeat(64), plan: { auctionId: 'auction-1' } } as never },
				async readSellerPlanExact(value) { calls.push(`plan:${value.fundingOperationId}`); return null },
				async readAuctionFundingExact(value) { calls.push(`auction:${value.fundingOperationId}`); return { schema: 'auction' } as never },
				async assertRegisteredWinnerExact() { throw new Error('not an HTTP route') },
			},
		})
		const post = (path: string, body: unknown) => service.handle(new Request(`http://127.0.0.1:8181${path}`, {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}))
		expect((await post('/api/friday/deployment', { schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_READ_V1' })).status).toBe(200)
		expect((await post('/api/friday/seller-plan/intent', { id: 'i' })).status).toBe(201)
		expect((await post('/api/friday/seller-plan/challenge', { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_READ_V1',
			sellerActor: '1'.repeat(64), auctionId: 'auction-1', fundingOperationId: 'funding-1' })).status).toBe(200)
		expect((await post('/api/friday/seller-plan/pending', { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_READ_V1',
			sellerActor: '1'.repeat(64) })).status).toBe(200)
		expect((await post('/api/friday/seller-plan/read', { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_V1',
			sellerActor: '1'.repeat(64), auctionId: 'auction-1', fundingOperationId: 'funding-1' })).status).toBe(200)
		expect((await post('/api/friday/seller-plan/register', { schema: 'envelope' })).status).toBe(201)
		expect((await post('/api/friday/auction-funding/read', { schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_READ_V1',
			auctionId: 'auction-1', fundingOperationId: 'funding-1', fullPoolAmount: 600 })).status).toBe(200)
		expect(calls).toEqual(['deployment', 'intent:i', 'challenge:funding-1', `pending:${'1'.repeat(64)}`,
			'plan:funding-1', 'register', 'auction:funding-1'])
	})

	test('rejects an oversized streamed body before JSON processing', async () => {
		const held = fixture()
		const response = await held.service.handle(new Request('http://127.0.0.1:8181/api/friday/funding', {
			method: 'POST', headers: { origin: 'https://172.105.64.142', 'content-type': 'application/json' },
			body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32_769)); controller.close() } }),
		}))
		expect(response.status).toBe(422)
	})
})
