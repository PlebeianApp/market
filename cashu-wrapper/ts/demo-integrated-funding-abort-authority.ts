/** Exact post-consensus refund authority for FundingAbortV1. */
import { bytesToHex } from '@noble/hashes/utils.js'

import type {
	DemoFridayFundingAbortCommitV1,
	DemoFridayLockedAbortEvidenceV1,
} from './demo-friday-funding-abort-service'
import type { DemoFridayFundingAbortCertificateV1 } from './demo-friday-funding-pool-lifecycle'
import {
	type DemoIntegratedTerminalAuthorityClaimV2,
	type DemoIntegratedTerminalAuthorityStore,
} from './demo-integrated-authority'
import {
	demoMaintainerExactTemplateDigest,
	validateDemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import { demoCashuSigAllDigest, demoOutputsDigest, demoSigAllSettlementCutoff } from './demo-sigall-settlement'
import { proofPoint } from './nut-client'

function fail(message: string): never { throw new Error(`DEMO_INTEGRATED_FUNDING_ABORT_AUTHORITY: ${message}`) }

export function deriveDemoIntegratedFundingAbortClaim(options: {
	certificate: DemoFridayFundingAbortCertificateV1
	commit: DemoFridayFundingAbortCommitV1
	evidence: DemoFridayLockedAbortEvidenceV1
	template: DemoMaintainerExactBranchTemplate
	store: DemoIntegratedTerminalAuthorityStore
	nowSeconds: number
}): Promise<{ claim: DemoIntegratedTerminalAuthorityClaimV2; template: DemoMaintainerExactBranchTemplate }> {
	const certificate = structuredClone(options.certificate)
	const commit = structuredClone(options.commit)
	const evidence = structuredClone(options.evidence)
	const template = validateDemoMaintainerExactBranchTemplate(options.template, 'refund')
	if (commit.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMIT_V1' || commit.origin !== 'committed_abort'
		|| commit.operationId !== certificate.operationId || commit.consensusEventId !== commit.abortCertificateDigest
		|| commit.actorAuthorizationEventId !== certificate.actorAbortEvent.id
		|| commit.height < 1 || commit.finalityHeight !== commit.height + 2
		|| (commit.commitSignerAddresses.length !== 3 && commit.commitSignerAddresses.length !== 4)
		|| commit.stateCommitHeight !== commit.stateHeight + 1 || commit.stateCommitAppHash !== commit.stateAppHash) {
		fail('FundingAbort commit lacks exact 3-of-4 BFT finality and S/S+1 state binding')
	}
	if (evidence.operationId !== certificate.operationId || evidence.auctionId !== certificate.auctionId
		|| evidence.actor !== certificate.actor || evidence.mintUrl !== certificate.mintUrl
		|| evidence.activeKeysetId !== certificate.activeKeysetId || evidence.amount !== certificate.amount
		|| evidence.poolDigest !== certificate.poolDigest
		|| JSON.stringify(evidence.proofYs) !== JSON.stringify(certificate.proofYs)
		|| evidence.returnPackageDigest !== certificate.returnPackageDigest
		|| evidence.returnCashuSigAllDigest !== certificate.returnCashuSigAllDigest
		|| evidence.bidderReturnSignature !== certificate.bidderReturnSignature
		|| evidence.fundingAuthorizationEventId !== certificate.fundingAuthorizationEventId
		|| evidence.dleqVerified !== true || evidence.ownerVerified !== true || evidence.returnPackageVerified !== true
		|| evidence.proofStates.some((entry) => entry.state !== 'UNSPENT')) {
		fail('durable Coco locked-token evidence differs from committed FundingAbort')
	}
	if (template.network !== certificate.authNetworkId || template.chainId !== certificate.chainId
		|| template.auctionId !== certificate.auctionId || template.operationId !== certificate.operationId
		|| template.bidderActorId !== certificate.actor || template.amount !== certificate.amount
		|| template.mintUrl !== certificate.mintUrl || template.mintSeal.activeSatKeysetId !== certificate.activeKeysetId
		|| template.inputFee !== 0 || template.mintSeal.inputFeePpk !== 0 || template.role !== 'refund'
		|| template.locktime !== certificate.locktime || template.bidderPublicKey !== certificate.paymentPublicKey
		|| template.refundPublicKey !== certificate.refundPublicKey
		|| template.committeePublicKey !== certificate.committeePublicKey) {
		fail('exact refund template differs from committed FundingAbort')
	}
	const proofStateRefs = template.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	if (JSON.stringify(proofStateRefs) !== JSON.stringify(certificate.proofYs)
		|| template.inputs.reduce((sum, proof) => sum + proof.amount, 0) !== certificate.amount
		|| template.outputs.reduce((sum, output) => sum + output.amount, 0) !== certificate.amount) {
		fail('refund template does not consume and return the exact full pool')
	}
	const templateDigest = demoMaintainerExactTemplateDigest(template)
	const cashuSigAllDigest = demoCashuSigAllDigest(template.inputs, template.outputs)
	if (templateDigest !== certificate.returnPackageDigest
		|| cashuSigAllDigest !== certificate.returnCashuSigAllDigest
		|| template.bidderMainSignature !== certificate.bidderReturnSignature) {
		fail('refund package or bidder SIG_ALL authorization differs from FundingAbort')
	}
	if (!Number.isSafeInteger(options.nowSeconds) || options.nowSeconds < commit.committedAt
		|| options.nowSeconds >= demoSigAllSettlementCutoff(template.locktime)) {
		fail('post-abort cooperative return is outside the admitted SIG_ALL window')
	}
	const claim: DemoIntegratedTerminalAuthorityClaimV2 = {
		schema: 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2', operationId: certificate.operationId,
		operationRoot: templateDigest, network: certificate.authNetworkId, chainId: certificate.chainId,
		auctionId: certificate.auctionId, bidId: certificate.operationId, successorBidId: '',
		cause: 'funding_abort', role: 'refund', outcomeHeight: commit.stateHeight,
		outcomeStateHash: commit.stateAppHash, outcomeEvidenceDigest: commit.consensusEventId,
		templateDigest, cashuSigAllDigest, outputsDigest: demoOutputsDigest(template.outputs), proofStateRefs,
		poolAmount: certificate.amount, admissionOperationId: certificate.operationId,
		admissionReceiptDigest: commit.consensusEventId, committeeKeysetId: certificate.committeeKeysetId,
		committeeKeysetVersion: certificate.committeeKeysetVersion, dkgRunId: certificate.dkgRunId,
		publicKeyPackageSha256: certificate.publicKeyPackageSha256,
		signerRosterDigest: certificate.signerRosterDigest, status: 'terminal_pending',
	}
	return options.store.claimTerminalDisposition(structuredClone(claim)).then((stored) => {
		if (JSON.stringify(stored.claim) !== JSON.stringify(claim)) fail('durable terminal authority conflicts')
		return { claim, template }
	})
}
