/** Separate terminal 3-of-4 SIG_ALL authority after committed FundingAbortV1. */
import type {
	DemoFridayFundingAbortCommitV1,
	DemoFridayLockedAbortEvidenceV1,
} from './demo-friday-funding-abort-service'
import type { DemoFridayFundingAbortCertificateV1 } from './demo-friday-funding-pool-lifecycle'
import { deriveDemoIntegratedFundingAbortClaim } from './demo-integrated-funding-abort-authority'
import type { DemoIntegratedTerminalAuthorityStore } from './demo-integrated-authority'
import type { DemoIntegratedRecoveryAuditPort } from './demo-integrated-outbid-return'
import {
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import {
	prepareDemoFridayFundingAbortCapsuleExact,
} from './demo-friday-funding-abort-capsule-executor'
import type {
	DemoFridayFundingAbortCapsuleStore,
	DemoFridayFundingAbortCapsuleTerminalStore,
} from './demo-friday-funding-abort-capsule'
import type { DemoFridayAuthorizedTerminalQueuePort } from './demo-friday-authorized-terminal-queue'
import type { DemoFridayCoordinatorRecordV2 } from './demo-friday-coordinator-runtime'
import {
	createDemoMaintainerTerminalThreshold3ProcessComposition,
	type DemoMaintainerTerminalThreshold3ProcessOptions,
} from './demo-maintainer-terminal-threshold3-process'
import type { DemoFrostParticipantPolicyPackage } from './demo-frost-participant-policy'

type ThresholdDependencies = Omit<DemoMaintainerTerminalThreshold3ProcessOptions,
	'authorityClaim' | 'authorityStore' | 'request' | 'policy'>

export interface DemoIntegratedThreshold3FundingAbortServiceOptions {
	certificate: DemoFridayFundingAbortCertificateV1
	commit: DemoFridayFundingAbortCommitV1
	evidence: DemoFridayLockedAbortEvidenceV1
	template: DemoMaintainerExactBranchTemplate
	authorityStore: DemoIntegratedTerminalAuthorityStore
	capsules: DemoFridayFundingAbortCapsuleStore
	capsuleTerminalStore: DemoFridayFundingAbortCapsuleTerminalStore
	policy: DemoFrostParticipantPolicyPackage
	federationRequest: DemoMaintainerTerminalThreshold3ProcessOptions['request']
	threshold: ThresholdDependencies
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	nowSeconds: number
}

export interface DemoIntegratedThreshold3FundingAbortQueuedResult {
	commit: DemoFridayFundingAbortCommitV1
	queued: DemoFridayCoordinatorRecordV2
}

function exactPolicy(options: DemoIntegratedThreshold3FundingAbortServiceOptions): void {
	const { certificate, commit, template, policy } = options
	const refs = [...certificate.proofYs]
	if (policy.role !== 'refund' || policy.network !== certificate.authNetworkId
		|| policy.chainId !== certificate.chainId || policy.auctionId !== certificate.auctionId
		|| policy.operationId !== certificate.operationId || policy.bidId !== certificate.operationId
		|| policy.bidEventId !== certificate.fundingAuthorizationEventId
		|| policy.bidderActorId !== certificate.actor || policy.outcomeHeight !== commit.stateHeight
		|| policy.appStateHash !== commit.stateAppHash || policy.amount !== certificate.amount
		|| policy.locktime !== certificate.locktime || policy.activeKeysetId !== certificate.activeKeysetId
		|| policy.inputFeePpk !== 0 || policy.recipientPublicKey !== template.recipientPublicKey
		|| policy.packageDigest !== template.templateDigest
		|| policy.cashuSigAllDigest !== template.cashuSigAllDigest
		|| JSON.stringify(policy.deposits.map(({ proofStateRef }) => proofStateRef)) !== JSON.stringify(refs)
		|| policy.certifiedClosure.evidenceDigest !== commit.consensusEventId
		|| policy.certifiedClosure.evidence.schema !== 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
		|| policy.certifiedClosure.evidence.kind !== 'funding_abort'
		|| policy.certifiedClosure.evidence.eventHeight !== commit.height
		|| policy.certifiedClosure.evidence.eventId !== commit.consensusEventId) {
		throw new Error('DEMO_INTEGRATED_T3_FUNDING_ABORT_POLICY: policy differs from committed abort and exact refund')
	}
}

export async function queueDemoIntegratedThreshold3FundingAbortReturn(
	options: DemoIntegratedThreshold3FundingAbortServiceOptions & { queue: DemoFridayAuthorizedTerminalQueuePort },
): Promise<DemoIntegratedThreshold3FundingAbortQueuedResult> {
	exactPolicy(options)
	const { claim } = await deriveDemoIntegratedFundingAbortClaim({ ...options, store: options.authorityStore })
	const threshold = await createDemoMaintainerTerminalThreshold3ProcessComposition({
		...options.threshold, request: structuredClone(options.federationRequest),
		policy: structuredClone(options.policy), authorityClaim: claim, authorityStore: options.authorityStore,
	})
	const { identity, prepared } = await prepareDemoFridayFundingAbortCapsuleExact({
		claim, executionBinding: threshold.executionBinding, capsules: options.capsules,
		terminalStore: options.capsuleTerminalStore, federation: threshold.federation,
		request: options.federationRequest,
	})
	const queued = await options.queue.enqueuePrepared({
		branch: 'funding_abort_return', claim, executionBinding: threshold.executionBinding,
		offlineIdentity: identity, prepared, recipientActorId: options.certificate.actor,
	})
	return { commit: structuredClone(options.commit), queued }
}
