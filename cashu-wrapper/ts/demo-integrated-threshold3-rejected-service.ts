/** Threshold-authorized exact return for a deterministically rejected V4 funding transaction. */
import type {
	DemoCertifiedRejectedFundingRequestV1,
	DemoCertifiedRejectedFundingV1,
	DemoCertifiedRejectedFundingVerifierPort,
} from './demo-comet-rejected-funding-verifier'
import {
	deriveAndAuthorizeDemoIntegratedRejectedReturn,
	demoIntegratedRejectedFundingDigest,
} from './demo-integrated-rejected-authority'
import type { DemoIntegratedTerminalAuthorityStore } from './demo-integrated-authority'
import type { DemoIntegratedRecoveryAuditPort } from './demo-integrated-outbid-return'
import {
	createDemoMaintainerOfflineExecutor,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerFinalOutcome,
	type DemoMaintainerOfflineIdentity,
} from './demo-maintainer-offline'
import type { DemoFridayAuthorizedTerminalQueuePort } from './demo-friday-authorized-terminal-queue'
import type { DemoFridayCoordinatorRecordV2 } from './demo-friday-coordinator-runtime'
import {
	createDemoMaintainerTerminalThreshold3ProcessComposition,
	type DemoMaintainerTerminalThreshold3ProcessOptions,
} from './demo-maintainer-terminal-threshold3-process'
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'

type ExecutorDependencies = Omit<Parameters<typeof createDemoMaintainerOfflineExecutor>[0], 'federation' | 'outcomes'>
type ThresholdDependencies = Omit<DemoMaintainerTerminalThreshold3ProcessOptions, 'authorityClaim' | 'authorityStore' | 'request' | 'policy'>

export interface DemoIntegratedThreshold3RejectedServiceOptions {
	rejectedRequest: DemoCertifiedRejectedFundingRequestV1
	template: DemoMaintainerExactBranchTemplate
	offlineIdentity: DemoMaintainerOfflineIdentity
	rejectedVerifier: DemoCertifiedRejectedFundingVerifierPort
	authorityStore: DemoIntegratedTerminalAuthorityStore
	policy: DemoFrostParticipantPolicyPackage
	federationRequest: DemoMaintainerTerminalThreshold3ProcessOptions['request']
	threshold: ThresholdDependencies
	executor: ExecutorDependencies
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	nowSeconds: number
}

export interface DemoIntegratedThreshold3RejectedQueuedResult {
	certificate: DemoCertifiedRejectedFundingV1
	queued: DemoFridayCoordinatorRecordV2
}

function exactPolicy(
	certificate: DemoCertifiedRejectedFundingV1,
	template: DemoMaintainerExactBranchTemplate,
	policy: DemoFrostParticipantPolicyPackage,
): void {
	const refs = [...certificate.proofStateRefs].sort()
	const policyRefs = policy.deposits.map(({ proofStateRef }) => proofStateRef).sort()
	if (policy.role !== 'refund' || policy.network !== certificate.network || policy.chainId !== certificate.chainId
		|| policy.auctionId !== certificate.auctionId || policy.operationId !== certificate.fundingOperationId
		|| policy.bidId !== certificate.fundingOperationId || policy.bidEventId !== certificate.fundingOperationId
		|| policy.bidderActorId !== certificate.bidderActorId
		|| policy.outcomeHeight !== certificate.fundingState.stateHeight
		|| policy.appStateHash !== certificate.fundingState.stateAppHash
		|| policy.amount !== certificate.poolAmount || policy.locktime !== certificate.timing.locktime
		|| policy.activeKeysetId !== certificate.activeKeysetId || policy.inputFeePpk !== 0
		|| policy.recipientPublicKey !== template.recipientPublicKey
		|| policy.packageDigest !== template.templateDigest || policy.cashuSigAllDigest !== template.cashuSigAllDigest
		|| JSON.stringify(policyRefs) !== JSON.stringify(refs)
		|| policy.certifiedClosure.evidenceDigest !== demoIntegratedRejectedFundingDigest(certificate)) {
		throw new Error('DEMO_INTEGRATED_T3_REJECTED_POLICY: threshold policy differs from participant-local rejected history')
	}
}

export async function queueDemoIntegratedThreshold3RejectedReturn(
	options: DemoIntegratedThreshold3RejectedServiceOptions & { queue: DemoFridayAuthorizedTerminalQueuePort },
): Promise<DemoIntegratedThreshold3RejectedQueuedResult> {
	const template = structuredClone(options.template)
	const policy = structuredClone(options.policy)
	const { certificate, claim } = await deriveAndAuthorizeDemoIntegratedRejectedReturn({
		request: structuredClone(options.rejectedRequest), template, rejectedVerifier: options.rejectedVerifier,
		store: options.authorityStore, nowSeconds: options.nowSeconds,
		validateBeforeClaim(value) { exactPolicy(value, template, policy) },
	})
	const threshold = await createDemoMaintainerTerminalThreshold3ProcessComposition({
		...options.threshold, request: structuredClone(options.federationRequest), policy,
		authorityClaim: claim, authorityStore: options.authorityStore,
	})
	const outcome: DemoMaintainerFinalOutcome = {
		schema: 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1', network: certificate.network,
		chainId: certificate.chainId, auctionId: certificate.auctionId, operationId: certificate.fundingOperationId,
		bidId: certificate.fundingOperationId, bidEventId: certificate.fundingOperationId,
		bidderActorId: certificate.bidderActorId, role: 'refund', amount: certificate.poolAmount,
		outcomeHeight: certificate.fundingState.stateHeight, appStateHash: certificate.fundingState.stateAppHash,
		policyPackageDigest: demoFrostParticipantPolicyDigest(policy),
		closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
		signedBidEvidenceDigest: policy.signedBid.evidenceDigest,
		committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
	}
	const executor = createDemoMaintainerOfflineExecutor({
		...options.executor, federation: threshold.federation,
		outcomes: { async readExact(identity) {
			if (identity.scope !== options.offlineIdentity.scope || identity.bundleDigest !== options.offlineIdentity.bundleDigest) return null
			return structuredClone(outcome)
		} },
	})
	const identity: DemoMaintainerOfflineIdentity = {
		...structuredClone(options.offlineIdentity), expectedRole: 'refund',
		expectedOperationId: claim.operationId, expectedOperationRoot: claim.operationRoot,
		expectedFrostOperationRoot: threshold.executionBinding.frostOperationRoot,
	}
	const prepared = await executor.prepareExact(identity)
	const queued = await options.queue.enqueuePrepared({
		branch: 'rejected_return', claim, executionBinding: threshold.executionBinding,
		offlineIdentity: identity, prepared, recipientActorId: certificate.bidderActorId,
	})
	return { certificate, queued }
}
