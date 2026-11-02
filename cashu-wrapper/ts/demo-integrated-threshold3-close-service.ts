/** Runnable winner-payout or reserve-unmet return composition after close. */
import {
	deriveAndAuthorizeDemoIntegratedClose,
	demoIntegratedCloseDigest,
	type DemoCertifiedCloseRequestV1,
	type DemoCertifiedCloseV1,
	type DemoCertifiedCloseVerifierPort,
} from './demo-integrated-close-authority'
import type { DemoIntegratedTerminalAuthorityStore } from './demo-integrated-authority'
import {
	executeAuthorizedDemoIntegratedTerminal,
	type DemoIntegratedTerminalExecutionResult,
} from './demo-integrated-terminal-execution'
import type { DemoIntegratedRecoveryAuditPort } from './demo-integrated-outbid-return'
import {
	createDemoMaintainerOfflineExecutor,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerFinalOutcome,
	type DemoMaintainerOfflineIdentity,
} from './demo-maintainer-offline'
import type { DemoFridayAuthorizedTerminalQueuePort } from './demo-friday-authorized-terminal-queue'
import type { DemoFridayCoordinatorRecordV2, DemoFridayTerminalBranch } from './demo-friday-coordinator-runtime'
import {
	createDemoMaintainerTerminalThreshold3ProcessComposition,
	type DemoMaintainerTerminalThreshold3ProcessOptions,
} from './demo-maintainer-terminal-threshold3-process'
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'

type OfflineExecutorDependencies = Omit<Parameters<typeof createDemoMaintainerOfflineExecutor>[0], 'federation' | 'outcomes'>
type ThresholdDependencies = Omit<
	DemoMaintainerTerminalThreshold3ProcessOptions,
	'authorityClaim' | 'authorityStore' | 'request' | 'policy'
>

export interface DemoIntegratedThreshold3CloseServiceOptions {
	closeRequest: DemoCertifiedCloseRequestV1
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	closeVerifier: DemoCertifiedCloseVerifierPort
	authorityStore: DemoIntegratedTerminalAuthorityStore
	policy: DemoFrostParticipantPolicyPackage
	federationRequest: DemoMaintainerTerminalThreshold3ProcessOptions['request']
	threshold: ThresholdDependencies
	executor: OfflineExecutorDependencies
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	nowSeconds: number
}

export interface DemoIntegratedThreshold3CloseServiceResult {
	certificate: DemoCertifiedCloseV1
	payment: DemoIntegratedTerminalExecutionResult
}

export interface DemoIntegratedThreshold3CloseQueuedResult {
	certificate: DemoCertifiedCloseV1
	queued: DemoFridayCoordinatorRecordV2
}

function exactClosePolicy(
	certificate: DemoCertifiedCloseV1,
	template: DemoMaintainerExactBranchTemplate,
	policy: DemoFrostParticipantPolicyPackage,
): void {
	const role = certificate.cause === 'winner' ? 'winner_settlement' : 'refund'
	const evidenceDigest = demoIntegratedCloseDigest(certificate)
	const refs = [...certificate.proofStateRefs].sort()
	const policyRefs = policy.deposits.map(({ proofStateRef }) => proofStateRef).sort()
	if (policy.role !== role || policy.network !== certificate.network || policy.chainId !== certificate.chainId
		|| policy.auctionId !== certificate.auctionId || policy.operationId !== certificate.fundingOperationId
		|| policy.bidId !== certificate.fundingOperationId || policy.bidEventId !== certificate.fundingOperationId
		|| policy.bidderActorId !== certificate.bidderActorId
		|| policy.outcomeHeight !== certificate.closeState.stateHeight
		|| policy.appStateHash !== certificate.closeState.stateAppHash
		|| policy.amount !== certificate.poolAmount || policy.locktime !== certificate.timing.locktime
		|| policy.activeKeysetId !== certificate.activeKeysetId || policy.inputFeePpk !== 0
		|| policy.recipientPublicKey !== template.recipientPublicKey
		|| policy.packageDigest !== template.templateDigest || policy.cashuSigAllDigest !== template.cashuSigAllDigest
		|| JSON.stringify(policyRefs) !== JSON.stringify(refs)
		|| policy.certifiedClosure.evidenceDigest !== evidenceDigest) {
		throw new Error('DEMO_INTEGRATED_T3_CLOSE_POLICY: threshold policy differs from participant-local close history')
	}
}

async function preparedDemoIntegratedThreshold3Close(
	options: DemoIntegratedThreshold3CloseServiceOptions,
	expectedCause: 'winner' | 'reserve_unmet',
) {
	const template = structuredClone(options.template)
	const policy = structuredClone(options.policy)
	const { certificate, claim } = await deriveAndAuthorizeDemoIntegratedClose({
		request: structuredClone(options.closeRequest), template, closeVerifier: options.closeVerifier,
		store: options.authorityStore, nowSeconds: options.nowSeconds,
		validateBeforeClaim(value) {
			// This runs before claimTerminalDisposition, participant nonces,
			// mint calls, or recipient import. A caller may never execute one
			// committed branch and reject it only after the effect.
			if (value.cause !== expectedCause) {
				throw new Error('DEMO_INTEGRATED_TERMINAL_SERVICE: committed close chose another terminal branch')
			}
			exactClosePolicy(value, template, policy)
		},
	})
	const threshold = await createDemoMaintainerTerminalThreshold3ProcessComposition({
		...options.threshold, request: structuredClone(options.federationRequest), policy,
		authorityClaim: claim, authorityStore: options.authorityStore,
	})
	const outcome: DemoMaintainerFinalOutcome = {
		schema: 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1', network: certificate.network,
		chainId: certificate.chainId, auctionId: certificate.auctionId,
		operationId: certificate.fundingOperationId, bidId: certificate.fundingOperationId,
		bidEventId: certificate.fundingOperationId, bidderActorId: certificate.bidderActorId,
		role: claim.role, amount: certificate.poolAmount, outcomeHeight: certificate.closeState.stateHeight,
		appStateHash: certificate.closeState.stateAppHash,
		policyPackageDigest: demoFrostParticipantPolicyDigest(policy),
		closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
		signedBidEvidenceDigest: policy.signedBid.evidenceDigest,
		committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
	}
	const executor = createDemoMaintainerOfflineExecutor({
		...options.executor, federation: threshold.federation,
		outcomes: {
			async readExact(identity) {
				if (identity.scope !== options.offlineIdentity.scope || identity.bundleDigest !== options.offlineIdentity.bundleDigest) return null
				return structuredClone(outcome)
			},
		},
	})
	return { certificate, claim, template, executor, executionBinding: threshold.executionBinding }
}

export async function executeDemoIntegratedThreshold3Close(
	options: DemoIntegratedThreshold3CloseServiceOptions,
	expectedCause: 'winner' | 'reserve_unmet',
): Promise<DemoIntegratedThreshold3CloseServiceResult> {
	const { certificate, claim, template, executor, executionBinding } = await preparedDemoIntegratedThreshold3Close(options, expectedCause)
	const payment = await executeAuthorizedDemoIntegratedTerminal({
		claim, template, offlineIdentity: structuredClone(options.offlineIdentity), store: options.authorityStore,
		executor, recoveryAudit: options.recoveryAudit, executionBinding,
	})
	return { certificate, payment }
}

export async function queueDemoIntegratedThreshold3Close(
	options: DemoIntegratedThreshold3CloseServiceOptions & { queue: DemoFridayAuthorizedTerminalQueuePort },
	expectedCause: 'winner' | 'reserve_unmet',
): Promise<DemoIntegratedThreshold3CloseQueuedResult> {
	const { certificate, claim, executor, executionBinding } = await preparedDemoIntegratedThreshold3Close(options, expectedCause)
	const role = expectedCause === 'winner' ? 'winner_settlement' : 'refund'
	const branch: DemoFridayTerminalBranch = expectedCause === 'winner' ? 'winner_payout' : 'reserve_unmet_return'
	const identity: DemoMaintainerOfflineIdentity = {
		...structuredClone(options.offlineIdentity), expectedRole: role,
		expectedOperationId: claim.operationId, expectedOperationRoot: claim.operationRoot,
		expectedFrostOperationRoot: executionBinding.frostOperationRoot,
	}
	const prepared = await executor.prepareExact(identity)
	const queued = await options.queue.enqueuePrepared({
		branch, claim, executionBinding, offlineIdentity: identity, prepared,
		recipientActorId: expectedCause === 'winner' ? certificate.sellerActorId : certificate.bidderActorId,
	})
	return { certificate, queued }
}
