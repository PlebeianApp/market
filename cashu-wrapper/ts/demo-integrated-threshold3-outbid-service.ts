/**
 * Runnable composition for the smallest integrated Friday payment slice:
 * one consensus-certified displacement, four separately transported FROST
 * participants with threshold three, durable exact mint recovery, and exact
 * recipient import of the displaced bidder's full pool.
 *
 * This service deliberately does not claim to implement winner close or
 * reserve-unmet/no-sale. Those require a separate authenticated close-history
 * authority and lifecycle records; callers cannot route either branch through
 * this outbid-only entry point.
 */
import {
	deriveAndAuthorizeDemoCooperativeOutbidReturn,
	demoIntegratedDisplacementDigest,
	type DemoCertifiedDisplacementV1,
	type DemoCertifiedDisplacementRequestV1,
	type DemoCertifiedDisplacementVerifierPort,
	type DemoIntegratedAuthorityStore,
} from './demo-integrated-authority'
import {
	executeAuthorizedDemoIntegratedOutbidReturn,
	type DemoIntegratedOutbidReturnResult,
	type DemoIntegratedRecoveryAuditPort,
} from './demo-integrated-outbid-return'
import {
	createDemoMaintainerOfflineExecutor,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerFinalOutcome,
	type DemoMaintainerOfflineIdentity,
} from './demo-maintainer-offline'
import type { DemoFridayAuthorizedTerminalQueuePort } from './demo-friday-authorized-terminal-queue'
import type { DemoFridayCoordinatorRecordV2 } from './demo-friday-coordinator-runtime'
import {
	createDemoMaintainerThreshold3ProcessComposition,
	type DemoMaintainerThreshold3ProcessOptions,
} from './demo-maintainer-threshold3-process'
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'

type OfflineExecutorDependencies = Omit<
	Parameters<typeof createDemoMaintainerOfflineExecutor>[0],
	'federation' | 'outcomes'
>

type ThresholdProcessDependencies = Omit<
	DemoMaintainerThreshold3ProcessOptions,
	'authorityClaim' | 'authorityStore' | 'request' | 'policy'
>

export interface DemoIntegratedThreshold3OutbidServiceOptions {
	displacementRequest: DemoCertifiedDisplacementRequestV1
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	displacementVerifier: DemoCertifiedDisplacementVerifierPort
	authorityStore: DemoIntegratedAuthorityStore
	policy: DemoFrostParticipantPolicyPackage
	federationRequest: DemoMaintainerThreshold3ProcessOptions['request']
	threshold: ThresholdProcessDependencies
	executor: OfflineExecutorDependencies
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	nowSeconds: number
}

export interface DemoIntegratedThreshold3OutbidServiceResult {
	certificate: DemoCertifiedDisplacementV1
	payment: DemoIntegratedOutbidReturnResult
}

export interface DemoIntegratedThreshold3OutbidQueuedResult {
	certificate: DemoCertifiedDisplacementV1
	queued: DemoFridayCoordinatorRecordV2
}

function exactOutbidPolicy(
	certificate: DemoCertifiedDisplacementV1,
	template: DemoMaintainerExactBranchTemplate,
	policy: DemoFrostParticipantPolicyPackage,
): void {
	const certificateDigest = demoIntegratedDisplacementDigest(certificate)
	const proofRefs = [...certificate.proofStateRefs].sort()
	const policyRefs = policy.deposits.map(({ proofStateRef }) => proofStateRef).sort()
	if (policy.role !== 'refund' || policy.network !== certificate.network || policy.chainId !== certificate.chainId
		|| policy.auctionId !== certificate.auctionId || policy.operationId !== certificate.displacedFundingOperationId
		|| policy.bidId !== certificate.displacedFundingOperationId || policy.bidEventId !== certificate.displacedFundingOperationId
		|| policy.bidderActorId !== certificate.displacedBidderActorId
		|| policy.outcomeHeight !== certificate.displacementState.stateHeight
		|| policy.appStateHash !== certificate.displacementState.stateAppHash
		|| policy.amount !== certificate.displacedPoolAmount || policy.locktime !== certificate.timing.locktime
		|| policy.activeKeysetId !== certificate.activeKeysetId || policy.inputFeePpk !== 0
		|| policy.recipientPublicKey !== template.recipientPublicKey
		|| policy.packageDigest !== template.templateDigest || policy.cashuSigAllDigest !== template.cashuSigAllDigest
		|| JSON.stringify(policyRefs) !== JSON.stringify(proofRefs)
		|| policy.certifiedClosure.evidenceDigest !== certificateDigest) {
		throw new Error('DEMO_INTEGRATED_T3_OUTBID_POLICY: threshold policy differs from participant-verifiable displacement history')
	}
}

/**
 * Execute the exact outbid-return operation. The admitted bundle must already
 * be durably present in the executor-private store. This function first claims
 * global proof ownership, then persists the authority/FROST root join before
 * any participant nonce or mint call can occur.
 */
async function preparedDemoIntegratedThreshold3OutbidReturn(
	options: DemoIntegratedThreshold3OutbidServiceOptions,
) {
	const template = structuredClone(options.template)
	const policy = structuredClone(options.policy)
	const authorized = await deriveAndAuthorizeDemoCooperativeOutbidReturn({
		request: structuredClone(options.displacementRequest), template,
		displacementVerifier: options.displacementVerifier,
		store: options.authorityStore, nowSeconds: options.nowSeconds,
		validateBeforeClaim(certificate) { exactOutbidPolicy(certificate, template, policy) },
	})
	const { certificate, claim } = authorized
	const threshold = await createDemoMaintainerThreshold3ProcessComposition({
		...options.threshold, request: structuredClone(options.federationRequest), policy,
		authorityClaim: claim, authorityStore: options.authorityStore,
	})
	const outcome: DemoMaintainerFinalOutcome = {
		schema: 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1', network: certificate.network,
		chainId: certificate.chainId, auctionId: certificate.auctionId,
		operationId: certificate.displacedFundingOperationId, bidId: certificate.displacedFundingOperationId,
		bidEventId: certificate.displacedFundingOperationId, bidderActorId: certificate.displacedBidderActorId,
		role: 'refund', amount: certificate.displacedPoolAmount,
		outcomeHeight: certificate.displacementState.stateHeight, appStateHash: certificate.displacementState.stateAppHash,
		policyPackageDigest: demoFrostParticipantPolicyDigest(policy),
		closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
		signedBidEvidenceDigest: policy.signedBid.evidenceDigest,
		committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
	}
	const executor = createDemoMaintainerOfflineExecutor({
		...options.executor, federation: threshold.federation,
		outcomes: {
			async readExact(identity) {
				if (identity.scope !== options.offlineIdentity.scope
					|| identity.bundleDigest !== options.offlineIdentity.bundleDigest) return null
				return structuredClone(outcome)
			},
		},
	})
	return { certificate, claim, template, executor, executionBinding: threshold.executionBinding }
}

export async function executeDemoIntegratedThreshold3OutbidReturn(
	options: DemoIntegratedThreshold3OutbidServiceOptions,
): Promise<DemoIntegratedThreshold3OutbidServiceResult> {
	const { certificate, claim, template, executor, executionBinding } = await preparedDemoIntegratedThreshold3OutbidReturn(options)
	const payment = await executeAuthorizedDemoIntegratedOutbidReturn({
		claim, template, offlineIdentity: structuredClone(options.offlineIdentity), store: options.authorityStore,
		executor, recoveryAudit: options.recoveryAudit, executionBinding,
	})
	return { certificate, payment }
}

/**
 * Prepare the real threshold authorization and queue the exact payment without
 * contacting the mint. The persistent child later executes/reconciles the same
 * encrypted operation; this call cannot report a payment as completed.
 */
export async function queueDemoIntegratedThreshold3OutbidReturn(
	options: DemoIntegratedThreshold3OutbidServiceOptions & { queue: DemoFridayAuthorizedTerminalQueuePort },
): Promise<DemoIntegratedThreshold3OutbidQueuedResult> {
	const { certificate, claim, executor, executionBinding } = await preparedDemoIntegratedThreshold3OutbidReturn(options)
	const identity: DemoMaintainerOfflineIdentity = {
		...structuredClone(options.offlineIdentity), expectedRole: 'refund',
		expectedOperationId: claim.operationId, expectedOperationRoot: claim.operationRoot,
		expectedFrostOperationRoot: executionBinding.frostOperationRoot,
	}
	const prepared = await executor.prepareExact(identity)
	const queued = await options.queue.enqueuePrepared({
		branch: 'outbid_return', claim, executionBinding, offlineIdentity: identity,
		prepared, recipientActorId: certificate.displacedBidderActorId,
	})
	return { certificate, queued }
}
