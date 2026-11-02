/** Exact refund authority for a V4 bid that Comet committed as a deterministic business rejection. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoIntegratedTiming,
	type DemoIntegratedTerminalAuthorityClaimV2,
	type DemoIntegratedTerminalAuthorityStore,
} from './demo-integrated-authority'
import {
	DEMO_REJECTION_REASONS,
	type DemoCertifiedRejectedFundingRequestV1,
	type DemoCertifiedRejectedFundingV1,
	type DemoCertifiedRejectedFundingVerifierPort,
} from './demo-comet-rejected-funding-verifier'
import { demoIntegratedFundingV4ReceiptDigest } from './demo-integrated-funding-receipt-v4'
import {
	demoMaintainerExactTemplateDigest,
	validateDemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import { demoCashuSigAllDigest, demoOutputsDigest, demoSigAllSettlementCutoff } from './demo-sigall-settlement'
import { proofPoint } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const KEY = /^(?:02|03)[0-9a-f]{64}$/
const ACTOR = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

export class DemoIntegratedRejectedAuthorityRefusedError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`); this.name = 'DemoIntegratedRejectedAuthorityRefusedError'
	}
}
function refuse(code: string, message: string): never { throw new DemoIntegratedRejectedAuthorityRefusedError(code, message) }

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') { if (!Number.isSafeInteger(value)) refuse('DEMO_REJECT_CANONICAL', 'non-safe integer'); return JSON.stringify(value) }
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') refuse('DEMO_REJECT_CANONICAL', 'unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}
function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonicalJson(value)))) }

function validateCertificate(value: DemoCertifiedRejectedFundingV1): DemoCertifiedRejectedFundingV1 {
	const certificate = structuredClone(value)
	if (certificate.schema !== 'COCO_DEMO_CERTIFIED_REJECTED_FUNDING_V1'
		|| !ID.test(certificate.network) || !ID.test(certificate.chainId) || !ID.test(certificate.validatorRosterVersion)
		|| !ID.test(certificate.auctionId) || !ID.test(certificate.fundingOperationId)
		|| !HEX_32.test(certificate.genesisHash) || !HEX_32.test(certificate.bidEventId)
		|| !ACTOR.test(certificate.sellerActorId) || !ACTOR.test(certificate.bidderActorId)
		|| !KEY.test(certificate.sellerPaymentPublicKey) || !DEMO_REJECTION_REASONS.includes(certificate.rejectionReason)
		|| !Number.isSafeInteger(certificate.poolAmount) || certificate.poolAmount < 1
		|| certificate.inputFeePpk !== 0 || !ID.test(certificate.activeKeysetId)
		|| !Array.isArray(certificate.proofStateRefs) || certificate.proofStateRefs.length === 0
		|| certificate.proofStateRefs.some((proof) => !KEY.test(proof))
		|| new Set(certificate.proofStateRefs.map((proof) => proof.slice(2))).size !== certificate.proofStateRefs.length
		|| JSON.stringify(certificate.proofStateRefs) !== JSON.stringify([...certificate.proofStateRefs].sort())) {
		refuse('DEMO_REJECT_CERTIFICATE', 'rejected funding identity, amount, keyset, or proof pool is malformed')
	}
	if (!Array.isArray(certificate.commits) || certificate.commits.length !== 3
		|| certificate.commits.some((commit, index) => commit.height !== certificate.commits[0]!.height + index
			|| !Number.isSafeInteger(commit.blockTime) || commit.blockTime < 1 || !HEX_32.test(commit.blockHash) || !HEX_32.test(commit.appHash))
		|| certificate.fundingState.stateHeight < certificate.commits[2]!.height
		|| certificate.fundingState.bindingCommit.height !== certificate.fundingState.stateHeight + 1
		|| certificate.fundingState.bindingCommit.appHash !== certificate.fundingState.stateAppHash) {
		refuse('DEMO_REJECT_FINALITY', 'rejected funding lacks H/H+1/H+2 and S/S+1 authentication')
	}
	const timing = demoIntegratedTiming(certificate.timing.originalEndTime, certificate.timing.certifiedEndTime)
	if (canonicalJson(timing) !== canonicalJson(certificate.timing)) refuse('DEMO_REJECT_TIMING', 'rejected funding timing is noncanonical')
	certificate.timing = timing
	const receipt = certificate.admittedFundingReceipt
	if (receipt.funding_operation_id !== certificate.fundingOperationId || receipt.auction_id !== certificate.auctionId
		|| receipt.bidder !== certificate.bidderActorId || receipt.pool_amount !== certificate.poolAmount
		|| receipt.bid_amount !== certificate.poolAmount || receipt.active_keyset_id !== certificate.activeKeysetId
		|| receipt.input_fee_ppk !== 0 || JSON.stringify(receipt.proof_state_refs) !== JSON.stringify(certificate.proofStateRefs)
		|| receipt.locktime !== certificate.timing.locktime) {
		refuse('DEMO_REJECT_RECEIPT', 'rejected funding differs from its admitted V4 receipt')
	}
	return certificate
}

export function demoIntegratedRejectedFundingDigest(value: DemoCertifiedRejectedFundingV1): string {
	return digest(validateCertificate(value))
}

export async function deriveAndAuthorizeDemoIntegratedRejectedReturn(options: {
	request: DemoCertifiedRejectedFundingRequestV1
	template: DemoMaintainerExactBranchTemplate
	rejectedVerifier: DemoCertifiedRejectedFundingVerifierPort
	store: DemoIntegratedTerminalAuthorityStore
	nowSeconds: number
	validateBeforeClaim?: (certificate: DemoCertifiedRejectedFundingV1) => void
}): Promise<{ certificate: DemoCertifiedRejectedFundingV1; claim: DemoIntegratedTerminalAuthorityClaimV2 }> {
	let certificate: DemoCertifiedRejectedFundingV1
	try { certificate = validateCertificate(await options.rejectedVerifier.verifyAndDerive(structuredClone(options.request))) }
	catch (error) {
		if (error instanceof DemoIntegratedRejectedAuthorityRefusedError) throw error
		return refuse('DEMO_REJECT_HISTORY', error instanceof Error ? error.message : 'rejected funding history verification failed')
	}
	options.validateBeforeClaim?.(structuredClone(certificate))
	const template = validateDemoMaintainerExactBranchTemplate(options.template, 'refund')
	const receipt = certificate.admittedFundingReceipt
	if (template.network !== certificate.network || template.chainId !== certificate.chainId
		|| template.auctionId !== certificate.auctionId || template.operationId !== certificate.fundingOperationId
		|| template.bidId !== certificate.fundingOperationId || template.bidEventId !== certificate.fundingOperationId
		|| template.bidderActorId !== certificate.bidderActorId || template.amount !== certificate.poolAmount
		|| template.locktime !== certificate.timing.locktime || template.role !== 'refund') {
		refuse('DEMO_REJECT_TEMPLATE', 'return template differs from the rejected funding pool')
	}
	if (!Number.isSafeInteger(options.nowSeconds) || options.nowSeconds < certificate.commits[2]!.blockTime
		|| options.nowSeconds >= certificate.timing.mainCutoff || options.nowSeconds >= demoSigAllSettlementCutoff(template.locktime)) {
		refuse('DEMO_REJECT_CUTOFF', 'rejected return is outside the certified MAIN window')
	}
	if (template.inputFee !== 0 || template.mintSeal.inputFeePpk !== 0
		|| template.mintSeal.activeSatKeysetId !== certificate.activeKeysetId
		|| template.inputs.some((input) => input.id !== certificate.activeKeysetId)
		|| template.outputs.some((output) => output.id !== certificate.activeKeysetId)) {
		refuse('DEMO_REJECT_KEYSET', 'return template changed the admitted zero-fee keyset')
	}
	const inputTotal = template.inputs.reduce((sum, proof) => sum + proof.amount, 0)
	const outputTotal = template.outputs.reduce((sum, output) => sum + output.amount, 0)
	if (inputTotal !== certificate.poolAmount || outputTotal !== certificate.poolAmount) {
		refuse('DEMO_REJECT_POOL', 'rejected return must consume and return the complete pool')
	}
	let proofStateRefs: string[]
	try { proofStateRefs = template.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort() }
	catch { return refuse('DEMO_REJECT_PROOFS', 'return input cannot derive its proof Y') }
	if (JSON.stringify(proofStateRefs) !== JSON.stringify(certificate.proofStateRefs)) {
		refuse('DEMO_REJECT_PROOFS', 'return inputs differ from the certified proof pool')
	}
	const templateDigest = demoMaintainerExactTemplateDigest(template)
	const cashuSigAllDigest = demoCashuSigAllDigest(template.inputs, template.outputs)
	if (templateDigest !== receipt.return_package_digest || cashuSigAllDigest !== receipt.return_cashu_sigall_digest
		|| template.bidderMainSignature !== receipt.bidder_return_signature
		|| template.bidderPublicKey !== receipt.bidder_public_key || template.refundPublicKey !== receipt.refund_public_key
		|| template.committeePublicKey !== receipt.committee_public_key
		|| template.committeeKeysetId !== receipt.committee_keyset_id
		|| template.committeeKeysetVersion !== receipt.committee_keyset_version) {
		refuse('DEMO_REJECT_ADMISSION', 'return template is not the exact package admitted by the committee')
	}
	const claim: DemoIntegratedTerminalAuthorityClaimV2 = {
		schema: 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2', operationId: certificate.fundingOperationId,
		operationRoot: templateDigest, network: certificate.network, chainId: certificate.chainId,
		auctionId: certificate.auctionId, bidId: certificate.fundingOperationId, successorBidId: '',
		cause: 'rejected', role: 'refund', outcomeHeight: certificate.fundingState.stateHeight,
		outcomeStateHash: certificate.fundingState.stateAppHash,
		outcomeEvidenceDigest: demoIntegratedRejectedFundingDigest(certificate), templateDigest, cashuSigAllDigest,
		outputsDigest: demoOutputsDigest(template.outputs), proofStateRefs, poolAmount: certificate.poolAmount,
		admissionOperationId: certificate.fundingOperationId,
		admissionReceiptDigest: demoIntegratedFundingV4ReceiptDigest(receipt),
		committeeKeysetId: receipt.committee_keyset_id, committeeKeysetVersion: receipt.committee_keyset_version,
		dkgRunId: receipt.dkg_run_id, publicKeyPackageSha256: receipt.public_key_package_sha256,
		signerRosterDigest: receipt.signer_roster_digest, status: 'terminal_pending',
	}
	const stored = await options.store.claimTerminalDisposition(structuredClone(claim))
	if (JSON.stringify(stored.claim) !== JSON.stringify(claim)) refuse('DEMO_REJECT_CONFLICT', 'durable authority returned a conflicting claim')
	return { certificate, claim }
}
