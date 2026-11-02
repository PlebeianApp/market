/**
 * Admission-to-consensus composition for an integrated bid.  The service is
 * runnable only when supplied a real authenticated 3-of-4 admission signer;
 * the existing disposition-only Rust signer is intentionally not adapted or
 * relabelled as that signer.
 */
import {
	validateDemoIntegratedAdmission,
	type DemoIntegratedAdmissionDkgBindingV1,
	type DemoIntegratedAdmissionPolicyEvidenceV1,
} from './demo-integrated-admission-policy'
import {
	demoIntegratedFundingAdmissionSignatureDigest,
	demoIntegratedFundingReceiptDigest,
	finalizeDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptUnsigned,
	type DemoIntegratedFundingReceiptV2,
} from './demo-integrated-funding-receipt'
import type { DemoIntegratedFundingReceiptAnyUnsigned } from './demo-integrated-admission-receipt-any'
import {
	persistDemoMaintainerTemplatesBeforeAdmission,
	type DemoMaintainerExactTemplateBundle,
	type DemoMaintainerOfflineIdentity,
	type DemoMaintainerOfflineStore,
} from './demo-maintainer-offline'
import type { DemoCanonicalCommitV1 } from './demo-integrated-authority'

type Four<T> = [T, T, T, T]
type Three<T> = [T, T, T]

export interface DemoAdmissionParticipantPolicyRequestV1 {
	receipt: DemoIntegratedFundingReceiptAnyUnsigned
	bundle: DemoMaintainerExactTemplateBundle
	nowSeconds: number
	dkgBinding: DemoIntegratedAdmissionDkgBindingV1
}

export interface DemoAdmissionParticipantPorts {
	participantId: 1 | 2 | 3 | 4
	/**
	 * This method is the participant service boundary. A conforming four-host
	 * implementation executes mint, proof-use, and Comet reads in that
	 * participant's process; exposing those raw ports to the coordinator is not
	 * conforming. createInProcessDemoAdmissionParticipant exists only for
	 * focused unit fixtures.
	 */
	validateExact(request: DemoAdmissionParticipantPolicyRequestV1): Promise<DemoIntegratedAdmissionPolicyEvidenceV1>
}

export interface DemoIntegratedAdmissionThreshold3AuthorizationV1 {
	schema: 'COCO_DEMO_INTEGRATED_ADMISSION_THRESHOLD3_AUTHORIZATION_V1'
	domain: 'COCO_DEMO_FROST_ADMISSION_3OF4_V1'
	receiptDigest: string
	signatureDigest: string
	receiptBytesSha256: string
	participantEvidenceDigest: string
	operationRoot: string
	sessionId: string
	bidIntentId: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	participantIds: [number, number, number]
	transcriptHash: string
	validFrom: number
	validUntil: number
	committeeSignature: string
}

export interface DemoIntegratedAdmissionThreshold3Port {
	/**
	 * Must be a distinct admission authorization domain implemented by four
	 * authenticated participant processes.  A disposition SIG_ALL signature or
	 * coordinator-local Schnorr signature is not a conforming implementation.
	 */
	signExact(request: {
		receipt: DemoIntegratedFundingReceiptAnyUnsigned
		bundle: DemoMaintainerExactTemplateBundle
		nowSeconds: number
		receiptDigest: string
		dkgBinding: DemoIntegratedAdmissionDkgBindingV1
		participantEvidence: Three<DemoIntegratedAdmissionPolicyEvidenceV1>
	}): Promise<DemoIntegratedAdmissionThreshold3AuthorizationV1>
}

export interface DemoIntegratedAdmissionConsensusCommitV1 {
	schema: 'COCO_DEMO_INTEGRATED_ADMISSION_COMMIT_V1'
	height: number
	stateHeight: number
	stateBindingHeight: number
	appStateHash: string
	broadcastTxHash: string
	commits: [DemoCanonicalCommitV1, DemoCanonicalCommitV1, DemoCanonicalCommitV1]
	bidId: string
	fundingOperationId: string
	/**
	 * The transaction is immutably committed in every case.  disposition only
	 * describes what authenticated state S says by the time H/H+1/H+2 and S/S+1
	 * are available; it must never turn a displaced committed bid into an
	 * apparent admission failure.
	 */
	disposition:
		| { kind: 'active' }
		| { kind: 'displaced'; branch: 'outbid_return'; successorBidId: string }
		| { kind: 'superseded'; successorBidId: string }
		| { kind: 'terminal'; branch: 'winner_payout' | 'reserve_unmet_return' }
	receipt: DemoIntegratedFundingReceiptV2
}

export interface DemoIntegratedBidConsensusPort {
	/** Build/sign the Nostr bid with the actor's current signer, broadcast it, and authenticate the committed H/H+1 result. */
	broadcastAndConfirm(receipt: DemoIntegratedFundingReceiptV2): Promise<DemoIntegratedAdmissionConsensusCommitV1>
}

export interface DemoIntegratedAdmissionServiceResult {
	receipt: DemoIntegratedFundingReceiptV2
	offlineIdentity: DemoMaintainerOfflineIdentity
	committeeAuthorization: DemoIntegratedAdmissionThreshold3AuthorizationV1
	commit: DemoIntegratedAdmissionConsensusCommitV1
}

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

function safePolicyRefusal(value: unknown): string {
	const message = value instanceof Error ? value.message : 'participant refused without an error'
	return message.replace(/[0-9a-fA-F]{48,}/g, '[hex-redacted]')
		.replace(/[A-Za-z0-9+/]{64,}={0,2}/g, '[base64-redacted]')
		.replace(/[^\x20-\x7e]/g, '?').slice(0, 240)
}

export async function admitDemoIntegratedThreshold3Bid(options: {
	unsignedReceipt: DemoIntegratedFundingReceiptUnsigned
	bundle: DemoMaintainerExactTemplateBundle
	nowSeconds: number
	dkgBinding: DemoIntegratedAdmissionDkgBindingV1
	participants: Four<DemoAdmissionParticipantPorts>
	committee: DemoIntegratedAdmissionThreshold3Port
	offlineStore: DemoMaintainerOfflineStore
	consensus: DemoIntegratedBidConsensusPort
	policyTimeoutMs?: number
}): Promise<DemoIntegratedAdmissionServiceResult> {
	// Bearer inputs and both exact branches must be durable before any committee
	// nonce or consensus-visible funding receipt can be produced.
	const offlineIdentity = await persistDemoMaintainerTemplatesBeforeAdmission({
		bundle: structuredClone(options.bundle), store: options.offlineStore, nowSeconds: () => options.nowSeconds,
	})
	if (options.participants.some((participant, index) => participant.participantId !== index + 1)) {
		throw new Error('DEMO_INTEGRATED_ADMISSION_SERVICE: four ordered participant policy services are required')
	}
	const policyRequest: DemoAdmissionParticipantPolicyRequestV1 = {
		receipt: structuredClone(options.unsignedReceipt), bundle: structuredClone(options.bundle),
		nowSeconds: options.nowSeconds, dkgBinding: structuredClone(options.dkgBinding),
	}
	const timeoutMs = options.policyTimeoutMs ?? 5_000
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
		throw new Error('DEMO_INTEGRATED_ADMISSION_SERVICE: policy timeout is invalid')
	}
	const attempts = await Promise.allSettled(options.participants.map(async (participant) => {
		let timeout: ReturnType<typeof setTimeout> | undefined
		try {
			return await Promise.race([
				participant.validateExact(structuredClone(policyRequest)),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error(`participant ${participant.participantId} policy timeout`)), timeoutMs)
				}),
			])
		} finally { if (timeout !== undefined) clearTimeout(timeout) }
	}))
	const successful = attempts.flatMap((attempt, index) => attempt.status === 'fulfilled'
		? [{ participant: options.participants[index]!, evidence: attempt.value }]
		: [])
		.sort((left, right) => left.participant.participantId - right.participant.participantId)
	if (successful.length < 3) {
		const refusals = attempts.flatMap((attempt, index) => attempt.status === 'rejected'
			? [`p${options.participants[index]!.participantId}:${safePolicyRefusal(attempt.reason)}`] : [])
		throw new Error(`DEMO_INTEGRATED_ADMISSION_SERVICE: fewer than three authenticated participant policy services approved (${refusals.join('; ')})`)
	}
	const selected = successful.slice(0, 3)
	const evidence = selected.map(({ participant, evidence: value }) => {
		if (value.participantId !== participant.participantId) {
			throw new Error('DEMO_INTEGRATED_ADMISSION_SERVICE: participant policy identity mismatch')
		}
		return structuredClone(value)
	}) as Three<DemoIntegratedAdmissionPolicyEvidenceV1>
	const receiptDigest = demoIntegratedFundingReceiptDigest(options.unsignedReceipt)
	if (evidence.some((entry) => entry.receiptDigest !== receiptDigest
		|| entry.bundleDigest !== options.bundle.bundleDigest
		|| JSON.stringify(entry.proofStateRefs) !== JSON.stringify(evidence[0].proofStateRefs)
		|| entry.poolAmount !== evidence[0].poolAmount)) {
		throw new Error('DEMO_INTEGRATED_ADMISSION_SERVICE: participant admission evidence disagrees')
	}
	const authorization = await options.committee.signExact({
		receipt: structuredClone(options.unsignedReceipt), bundle: structuredClone(options.bundle),
		nowSeconds: options.nowSeconds, receiptDigest,
		dkgBinding: structuredClone(options.dkgBinding), participantEvidence: structuredClone(evidence),
	})
	if (authorization.schema !== 'COCO_DEMO_INTEGRATED_ADMISSION_THRESHOLD3_AUTHORIZATION_V1'
		|| authorization.domain !== 'COCO_DEMO_FROST_ADMISSION_3OF4_V1'
		|| authorization.receiptDigest !== receiptDigest || authorization.dkgRunId !== options.dkgBinding.dkgRunId
		|| authorization.publicKeyPackageSha256 !== options.dkgBinding.publicKeyPackageSha256
		|| authorization.signerRosterDigest !== options.dkgBinding.signerRosterDigest
		|| authorization.participantIds.length !== 3 || new Set(authorization.participantIds).size !== 3
		|| authorization.participantIds.some((id, index) => ![1, 2, 3, 4].includes(id)
			|| (index > 0 && authorization.participantIds[index - 1]! >= id))
		|| authorization.signatureDigest !== demoIntegratedFundingAdmissionSignatureDigest(
			options.unsignedReceipt, authorization.participantEvidenceDigest,
		)
		|| [authorization.receiptBytesSha256, authorization.participantEvidenceDigest,
			authorization.operationRoot, authorization.sessionId, authorization.bidIntentId,
			authorization.transcriptHash].some((value) => !HEX_32.test(value))
		|| authorization.validFrom !== options.unsignedReceipt.attested_at
		|| authorization.validUntil !== options.unsignedReceipt.expires_at
		|| !HEX_64.test(authorization.committeeSignature)) {
		throw new Error('DEMO_INTEGRATED_ADMISSION_SERVICE: threshold admission authorization is malformed')
	}
	const receipt = finalizeDemoIntegratedFundingReceipt(
		options.unsignedReceipt, authorization.participantEvidenceDigest, authorization.committeeSignature,
	)
	const commit = await options.consensus.broadcastAndConfirm(structuredClone(receipt))
	if (commit.schema !== 'COCO_DEMO_INTEGRATED_ADMISSION_COMMIT_V1'
		|| !Number.isSafeInteger(commit.height) || commit.height < 1 || !HEX_32.test(commit.appStateHash)
		|| !Number.isSafeInteger(commit.stateHeight) || commit.stateHeight < commit.height + 2
		|| commit.stateBindingHeight !== commit.stateHeight + 1 || !HEX_32.test(commit.broadcastTxHash)
		|| commit.commits.length !== 3 || commit.commits.some((value, index) => value.height !== commit.height + index
			|| !HEX_32.test(value.blockHash) || !HEX_32.test(value.appHash))
		|| !HEX_32.test(commit.bidId) || commit.fundingOperationId !== receipt.funding_operation_id
		|| JSON.stringify(commit.receipt) !== JSON.stringify(receipt)
		|| !exactCommittedDisposition(commit.disposition)) {
		throw new Error('DEMO_INTEGRATED_ADMISSION_SERVICE: consensus did not authenticate the exact committed funding receipt')
	}
	return { receipt, offlineIdentity, committeeAuthorization: structuredClone(authorization), commit: structuredClone(commit) }
}

/** Explicitly unit-test-only adapter; runnable integration must use separate participant services. */
export function createInProcessDemoAdmissionParticipant(options: {
	participantId: 1 | 2 | 3 | 4
	mintVerifier: Parameters<typeof validateDemoIntegratedAdmission>[0]['mintVerifier']
	proofUse: Parameters<typeof validateDemoIntegratedAdmission>[0]['proofUse']
	consensus: Parameters<typeof validateDemoIntegratedAdmission>[0]['consensus']
}): DemoAdmissionParticipantPorts {
	return Object.freeze({
		participantId: options.participantId,
		async validateExact(request: DemoAdmissionParticipantPolicyRequestV1) {
			return validateDemoIntegratedAdmission({
				...structuredClone(request), participantId: options.participantId, mintVerifier: options.mintVerifier,
				proofUse: options.proofUse, consensus: options.consensus,
			})
		},
	})
}

function exactCommittedDisposition(value: DemoIntegratedAdmissionConsensusCommitV1['disposition']): boolean {
	if (value.kind === 'active') return Object.keys(value).length === 1
	if (value.kind === 'displaced') {
		return value.branch === 'outbid_return' && HEX_32.test(value.successorBidId)
			&& Object.keys(value).sort().join(',') === 'branch,kind,successorBidId'
	}
	if (value.kind === 'superseded') {
		return HEX_32.test(value.successorBidId)
			&& Object.keys(value).sort().join(',') === 'kind,successorBidId'
	}
	return value.kind === 'terminal'
		&& (value.branch === 'winner_payout' || value.branch === 'reserve_unmet_return')
		&& Object.keys(value).sort().join(',') === 'branch,kind'
}
