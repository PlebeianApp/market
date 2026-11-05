/**
 * Fixed-composition Friday authority boundary.
 *
 * Public requests never carry a consensus reader, rollback anchor, signer
 * process, mint port, or queue capability.  Those capabilities are captured
 * once by the trusted source/runtime supplied by the reviewed process entry
 * point.  Terminal work is pulled from authenticated durable history; it is
 * not triggered by a browser route.
 */
import type { DemoFridayTerminalAuthorityRuntime } from './demo-friday-terminal-authority-runtime'
import type {
	DemoIntegratedThreshold3QueuedTerminalResult,
	DemoIntegratedThreshold3TerminalRequest,
} from './demo-integrated-threshold3-terminal-service'
import {
	verifyDemoFridayBrowserFundingAuthorization,
	type DemoFridayBrowserFundingAuthorizationV1,
} from './demo-friday-browser-funding-authorization'
import type { DemoFridayV4FundingAdmissionPort } from './demo-friday-v4-funding-service'
import type {
	DemoFridayCocoTerminalAckV1,
	DemoFridayCocoTerminalExchangeSqlite,
} from './demo-friday-coco-terminal-exchange'
import type { DemoFridayBrowserTrustService } from './demo-friday-browser-trust-service'
import type {
	DemoFridayBrowserAbortPreparationV1,
	DemoFridayBrowserAbortStatusV1,
} from './demo-friday-browser-funding-abort'
import type { DemoFridayFundingAbortNostrEventV1 } from './demo-friday-funding-pool-lifecycle'
import type { DemoFridayFundingAbortRecoveryCapsuleV1 } from './demo-friday-funding-abort-capsule'
import type {
	DemoFridayRecoveryOnlyAction,
	DemoFridayRecoveryOnlyGuardPort,
} from './demo-friday-recovery-only'
import { DemoIntegratedAuthorityRefusedError } from './demo-integrated-authority'
import { DemoIntegratedCloseAuthorityRefusedError } from './demo-integrated-close-authority'
import { DemoIntegratedRejectedAuthorityRefusedError } from './demo-integrated-rejected-authority'

export const DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT = 8_181 as const
const MAX_BODY = 32 * 1024
const ID = /^[A-Za-z0-9_-]{1,160}$/

export interface DemoFridayTrustedTerminalCandidateV1 {
	reference: string
	request: DemoIntegratedThreshold3TerminalRequest
}

export interface DemoFridayTrustedTerminalSourcePort {
	/** Read the next operation solely from authenticated consensus/private stores. */
	nextExact(): Promise<DemoFridayTrustedTerminalCandidateV1 | null>
	/** Durable acknowledgement after the exact queue operation succeeds. */
	markQueuedExact(reference: string, result: DemoIntegratedThreshold3QueuedTerminalResult): Promise<void>
	/** Permanently isolate one authenticated reference only after a typed certified cutoff. */
	markExpiredExact?(reference: string, code: DemoFridayPermanentTerminalCutoffCode): Promise<void>
}

export type DemoFridayPermanentTerminalCutoffCode =
	| 'DEMO_CLOSE_CUTOFF' | 'DEMO_REJECT_CUTOFF' | 'DEMO_AUTHORITY_CUTOFF'

export function demoFridayPermanentTerminalCutoffCode(error: unknown): DemoFridayPermanentTerminalCutoffCode | null {
	if (error instanceof DemoIntegratedCloseAuthorityRefusedError && error.code === 'DEMO_CLOSE_CUTOFF') return error.code
	if (error instanceof DemoIntegratedRejectedAuthorityRefusedError && error.code === 'DEMO_REJECT_CUTOFF') return error.code
	if (error instanceof DemoIntegratedAuthorityRefusedError && error.code === 'DEMO_AUTHORITY_CUTOFF') return error.code
	return null
}

export interface DemoFridayAuthorityHealthPort {
	/** Must check the coordinator rollback anchor and trusted reader pins. */
	readExact(): Promise<{
		deploymentId: string
		quarantined: boolean
		queuePending: number
		lastCommittedHeight: number
		consensusAvailable?: boolean
	}>
}

export interface DemoFridayFixedAuthorityService {
	drainOne(): Promise<'idle' | 'queued'>
	handle(request: Request): Promise<Response>
}

export interface DemoFridayBrowserFundingAbortServicePort {
	recoverOnePendingExact?(): Promise<'idle' | 'recovered'>
	registerBrowserCapsuleExact(capsule: DemoFridayFundingAbortRecoveryCapsuleV1): Promise<{ capsuleDigest: string }>
	prepareBrowserExact(input: { operationId: string; actor: string;
		abortReason: 'prebroadcast_client_abandonment' | 'prebroadcast_service_failure'
	}): Promise<DemoFridayBrowserAbortPreparationV1>
	submitBrowserExact(input: { preparationId: string; actorAbortEvent: DemoFridayFundingAbortNostrEventV1 }):
		Promise<DemoFridayBrowserAbortStatusV1>
	readBrowserExact(input: { preparationId: string; actor: string; operationId: string }):
		Promise<DemoFridayBrowserAbortStatusV1>
}

function exactOrigin(value: string): string {
	const url = new URL(value)
	if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.pathname !== '/'
		|| url.search !== '' || url.hash !== '' || url.origin !== value.replace(/\/$/, '')) {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CONFIG: public origin must be one exact HTTPS origin')
	}
	return url.origin
}

function json(status: number, body: unknown): Response {
	return new Response(`${JSON.stringify(body)}\n`, {
		status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	})
}

async function boundedJson(request: Request): Promise<unknown> {
	const declared = request.headers.get('content-length')
	if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BODY)) {
		throw new Error('request body is too large')
	}
	if (request.body === null) throw new Error('request body is absent')
	const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
	try {
		for (;;) {
			const next = await reader.read(); if (next.done) break
			size += next.value.byteLength
			if (size > MAX_BODY) { await reader.cancel(); throw new Error('request body is too large') }
			chunks.push(next.value)
		}
	} finally { reader.releaseLock() }
	if (size === 0) throw new Error('request body size is invalid')
	const bytes = new Uint8Array(size); let offset = 0
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}

export function createDemoFridayFixedAuthorityService(options: {
	publicOrigin: string
	authNetworkId: string
	chainId: string
	mintUrl: string
	nowSeconds: () => number
	terminalSource: DemoFridayTrustedTerminalSourcePort
	terminalRuntime: DemoFridayTerminalAuthorityRuntime
	health: DemoFridayAuthorityHealthPort
 /** Composite availability; absent always refuses new work. */
 readiness?: { readExact(): Promise<{ ready: boolean; reason: string; height: number }> }
 /** Existing journal classifier, used on degraded normal-mode requests too. */
 degradedRecovery?: DemoFridayRecoveryOnlyGuardPort
 readinessPins?: import('./demo-friday-readiness').FridayHealthPins
 readinessConfigSha256?: string
	/** Omit to keep the public route fail-closed (the default deployment). */
	fundingAdmission?: DemoFridayV4FundingAdmissionPort
	/** Omit to keep browser Coco terminal delivery fail-closed. */
	terminalExchange?: Pick<DemoFridayCocoTerminalExchangeSqlite, 'readExact' | 'acknowledgeExact'>
	/** Omit to keep every trusted browser-read and seller-plan route fail-closed. */
	browserTrust?: DemoFridayBrowserTrustService
	/** Omit until FundingAbortV1 has exact consensus/FROST/Coco adapters. */
	fundingAbort?: DemoFridayBrowserFundingAbortServicePort
	/**
	 * When present, new funding/seller intent is disabled and every remaining
	 * mutating route must prove its exact operation existed durably before the
	 * mode was enabled. This is a server boundary, not a browser flag.
	 */
	recoveryOnly?: DemoFridayRecoveryOnlyGuardPort
}): DemoFridayFixedAuthorityService {
	const publicOrigin = exactOrigin(options.publicOrigin)
	for (const [label, value] of [['auth network', options.authNetworkId], ['chain', options.chainId]] as const) {
		if (!ID.test(value)) throw new Error(`DEMO_FRIDAY_AUTHORITY_CONFIG: ${label} is invalid`)
	}
	const mint = new URL(options.mintUrl)
	if (!['http:', 'https:'].includes(mint.protocol) || mint.username !== '' || mint.password !== ''
		|| mint.search !== '' || mint.hash !== '' || mint.pathname !== '/') {
		throw new Error('DEMO_FRIDAY_AUTHORITY_CONFIG: mint origin is invalid')
	}
	let draining = false
	return Object.freeze({
		async drainOne() {
			if (draining) throw new Error('DEMO_FRIDAY_AUTHORITY_DRAIN: another drain is active')
			draining = true
			try {
				const health = await options.health.readExact()
				if (health.quarantined) throw new Error('DEMO_FRIDAY_AUTHORITY_QUARANTINED: trusted anchor requires operator review')
    if (health.consensusAvailable === false) return 'idle'
			if (options.fundingAbort !== undefined
				&& await options.fundingAbort.recoverOnePendingExact?.() === 'recovered') return 'queued'
				const candidate = await options.terminalSource.nextExact()
				if (candidate === null) return 'idle'
				if (!ID.test(candidate.reference)) throw new Error('DEMO_FRIDAY_AUTHORITY_SOURCE: trusted operation reference is invalid')
				let result: DemoIntegratedThreshold3QueuedTerminalResult
				try { result = await options.terminalRuntime.queueTerminal(candidate.request) }
				catch (error) {
					const code = demoFridayPermanentTerminalCutoffCode(error)
					if (code === null || options.terminalSource.markExpiredExact === undefined) throw error
					await options.terminalSource.markExpiredExact(candidate.reference, code)
					return 'queued'
				}
				await options.terminalSource.markQueuedExact(candidate.reference, result)
				return 'queued'
			} finally { draining = false }
		},
		async handle(request: Request) {
			const url = new URL(request.url)
			if (url.search !== '' || url.hash !== '') return json(404, { error: 'not_found' })
			if (url.pathname === '/api/friday/status' && request.method === 'GET') {
				try {
					const [status, readiness] = await Promise.all([options.health.readExact(),
      options.readiness?.readExact() ?? { ready: false, reason: 'not_configured', height: 0 }])
     return json(status.quarantined || !readiness.ready || options.recoveryOnly !== undefined ? 503 : 200, {
						schema: 'PLEBEIAN_FRIDAY_AUTHORITY_STATUS_V1', ...status,
      newOperationsReady: readiness.ready && !status.quarantined && options.recoveryOnly === undefined,
      readinessReason: readiness.reason, readinessPins: options.readinessPins,
      readinessConfigSha256: options.readinessConfigSha256,
						mode: options.recoveryOnly === undefined ? 'normal' : 'recovery_only',
						funding: options.recoveryOnly !== undefined ? 'recovery_only_existing_operations'
							: options.fundingAdmission === undefined
							? 'disabled_pending_integrated_test' : 'enabled_two_step_nip07',
					})
				} catch { return json(503, { error: 'authority_quarantined' }) }
			}
			const prepareFunding = url.pathname === '/api/friday/funding'
			const confirmFunding = url.pathname === '/api/friday/funding/confirm'
			const recoverFunding = url.pathname === '/api/friday/funding/status'
			const readTerminal = url.pathname === '/api/friday/terminal/read'
			const ackTerminal = url.pathname === '/api/friday/terminal/ack'
			const readDeployment = url.pathname === '/api/friday/deployment'
			const issueSellerIntent = url.pathname === '/api/friday/seller-plan/intent'
			const readSellerChallenge = url.pathname === '/api/friday/seller-plan/challenge'
			const listSellerChallenges = url.pathname === '/api/friday/seller-plan/pending'
			const readSellerPlan = url.pathname === '/api/friday/seller-plan/read'
			const registerSellerPlan = url.pathname === '/api/friday/seller-plan/register'
			const readAuctionFunding = url.pathname === '/api/friday/auction-funding/read'
			const prepareAbort = url.pathname === '/api/friday/funding-abort/prepare'
			const registerAbortCapsule = url.pathname === '/api/friday/funding-abort/capsule'
			const requestAbort = url.pathname === '/api/friday/funding-abort/request'
			const readAbort = url.pathname === '/api/friday/funding-abort/status'
			const abortRoute = registerAbortCapsule || prepareAbort || requestAbort || readAbort
			const browserTrustRoute = readDeployment || issueSellerIntent || readSellerChallenge || listSellerChallenges
				|| readSellerPlan || registerSellerPlan || readAuctionFunding
			if ((!prepareFunding && !confirmFunding && !recoverFunding && !readTerminal && !ackTerminal
				&& !browserTrustRoute && !abortRoute)
				|| request.method !== 'POST') return json(404, { error: 'not_found' })
			if (request.headers.get('origin') !== publicOrigin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
				return json(403, { error: 'same_origin_required' })
			}
			let body: unknown
			try { body = await boundedJson(request) }
			catch { return json(422, { error: 'funding_authorization_rejected' }) }
   // Read/recovery APIs do not acquire new funding authority. Every degraded
   // mutation below must independently prove an existing durable operation.
   if (options.recoveryOnly === undefined && (prepareFunding || issueSellerIntent || confirmFunding || registerSellerPlan)) {
    let ready = false
    try { ready = options.recoveryOnly === undefined && (await options.readiness?.readExact())?.ready === true }
    catch { /* dependency errors fail closed */ }
    if (!ready) {
     if (prepareFunding || issueSellerIntent) return json(503, { error: 'new_operations_unready' })
     try {
      if (options.degradedRecovery === undefined) throw new Error('no recovery classifier')
      await options.degradedRecovery.assertRecordedExact(confirmFunding ? 'funding_confirm' : 'seller_register', body)
     } catch { return json(503, { error: 'new_operations_unready' }) }
    }
   }
			if (options.recoveryOnly !== undefined) {
				if (prepareFunding || issueSellerIntent) {
					return json(409, { error: 'recovery_only_new_operation_disabled' })
				}
				let action: DemoFridayRecoveryOnlyAction | undefined
				if (confirmFunding) action = 'funding_confirm'
				else if (recoverFunding) action = 'funding_status'
				else if (readTerminal) action = 'terminal_read'
				else if (ackTerminal) action = 'terminal_ack'
				else if (readSellerChallenge) action = 'seller_challenge'
				else if (readSellerPlan) action = 'seller_read'
				else if (registerSellerPlan) action = 'seller_register'
				else if (readAuctionFunding) action = 'auction_funding_read'
				else if (registerAbortCapsule) action = 'abort_capsule'
				else if (prepareAbort) action = 'abort_prepare'
				else if (requestAbort) action = 'abort_request'
				else if (readAbort) action = 'abort_status'
				if (action !== undefined) {
					try { await options.recoveryOnly.assertRecordedExact(action, body) }
					catch { return json(409, { error: 'recovery_only_operation_not_recorded' }) }
				}
			}
			if (abortRoute) {
				if (options.fundingAbort === undefined) return json(503, { error: 'funding_abort_disabled' })
				try {
					if (registerAbortCapsule) {
						return json(201, await options.fundingAbort.registerBrowserCapsuleExact(
							body as DemoFridayFundingAbortRecoveryCapsuleV1,
						))
					}
					if (prepareAbort) {
						const value = body as Record<string, unknown>
						return json(201, await options.fundingAbort.prepareBrowserExact({
							operationId: String(value.fundingOperationId), actor: String(value.actor),
							abortReason: String(value.abortReason) as 'prebroadcast_client_abandonment' | 'prebroadcast_service_failure',
						}))
					}
					if (requestAbort) return json(202, await options.fundingAbort.submitBrowserExact(body as {
						preparationId: string; actorAbortEvent: DemoFridayFundingAbortNostrEventV1
					}))
					const value = body as Record<string, unknown>
					return json(200, await options.fundingAbort.readBrowserExact({
						preparationId: String(value.preparationId), actor: String(value.actor),
						operationId: String(value.fundingOperationId),
					}))
				} catch { return json(422, { error: 'funding_abort_rejected' }) }
			}
			if (browserTrustRoute) {
				if (options.browserTrust === undefined) return json(503, { error: 'browser_trust_disabled' })
				try {
					if (readDeployment) {
						if (JSON.stringify(body) !== JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_READ_V1' })) {
							throw new Error('deployment read request changed')
						}
						return json(200, await options.browserTrust.readDeploymentExact())
					}
					if (issueSellerIntent) return json(201, await options.browserTrust.issueSellerPlanChallengeExact(body))
					if (listSellerChallenges) {
						const raw = body as Record<string, unknown>
						if (raw?.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_READ_V1') throw new Error('pending read schema differs')
						return json(200, { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_RESULT_V1',
							challenges: await options.browserTrust.listSellerPlanChallengesExact(String(raw.sellerActor)) })
					}
					if (readSellerChallenge) {
						const raw = body as Record<string, unknown>
						if (raw?.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_READ_V1') throw new Error('challenge read schema differs')
						return json(200, await options.browserTrust.readSellerPlanChallengeExact({ sellerActor: String(raw.sellerActor),
							auctionId: String(raw.auctionId), fundingOperationId: String(raw.fundingOperationId) }))
					}
					if (readSellerPlan) {
						const raw = body as Record<string, unknown>
						if (raw?.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_V1') throw new Error('seller read schema differs')
						return json(200, { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_RESULT_V1',
							registered: await options.browserTrust.readSellerPlanExact({ sellerActor: String(raw.sellerActor),
								auctionId: String(raw.auctionId), fundingOperationId: String(raw.fundingOperationId) }) })
					}
					if (registerSellerPlan) {
						const envelope = await options.browserTrust.registerSellerPlanExact(body)
						return json(201, { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_REGISTERED_V1', status: 'registered',
							planDigest: envelope.planDigest, plan: envelope.plan })
					}
					const raw = body as Record<string, unknown>
					if (raw?.schema !== 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_READ_V1') throw new Error('auction funding read schema differs')
					return json(200, await options.browserTrust.readAuctionFundingExact({ auctionId: String(raw.auctionId),
						fundingOperationId: String(raw.fundingOperationId), fullPoolAmount: Number(raw.fullPoolAmount) }))
				} catch { return json(422, { error: 'browser_trust_rejected' }) }
			}
			if (readTerminal || ackTerminal) {
				if (options.terminalExchange === undefined) return json(503, { error: 'terminal_coco_disabled' })
				try {
					if (readTerminal) return json(200, options.terminalExchange.readExact(body as { actor: string; fundingOperationId: string }))
					return json(200, options.terminalExchange.acknowledgeExact(body as DemoFridayCocoTerminalAckV1))
				} catch { return json(422, { error: 'terminal_coco_rejected' }) }
			}
			if (options.fundingAdmission !== undefined) {
				try {
					if (prepareFunding) return json(202, await options.fundingAdmission.prepareExact(body))
					if (confirmFunding) return json(201, await options.fundingAdmission.confirmExact(body))
					return json(200, await options.fundingAdmission.readExact(body as Parameters<DemoFridayV4FundingAdmissionPort['readExact']>[0]))
				} catch { return json(422, { error: 'funding_admission_rejected' }) }
			}
			if (confirmFunding || recoverFunding) return json(503, { error: 'funding_disabled_pending_integrated_test' })
			let authorization: DemoFridayBrowserFundingAuthorizationV1
			try {
				authorization = verifyDemoFridayBrowserFundingAuthorization(body, {
					authNetworkId: options.authNetworkId, chainId: options.chainId,
					mintUrl: options.mintUrl, nowSeconds: options.nowSeconds(),
				})
			} catch { return json(422, { error: 'funding_authorization_rejected' }) }
			// Deliberately fail closed. V4 framing now exists in TypeScript, Go and
			// Rust, but this public route is not yet composed with encrypted package
			// persistence, authenticated Comet confirmation, and one unified real
			// throwaway-mint/FROST/FIPS run. Authorization validation here creates no
			// reservation and never reports funding success.
			return json(503, {
				error: 'funding_disabled_pending_integrated_test',
				operation: authorization.content.fundingOperationId,
			})
		},
	})
}

/** Source-complete entrypoint. Calling it starts a loopback-only server. */
export function serveDemoFridayFixedAuthority(options: Parameters<typeof createDemoFridayFixedAuthorityService>[0]) {
	const service = createDemoFridayFixedAuthorityService(options)
	return Bun.serve({
		hostname: '127.0.0.1', port: DEMO_FRIDAY_AUTHORITY_LOOPBACK_PORT,
		maxRequestBodySize: MAX_BODY,
		fetch: (request) => service.handle(request),
	})
}
