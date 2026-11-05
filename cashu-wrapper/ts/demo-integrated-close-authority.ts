/**
 * Participant-local authority for the two terminal close branches of an
 * admitted threshold-funded bid: exact seller payout or full-pool no-sale
 * return.  It shares the durable operation/proof uniqueness domain with the
 * cooperative outbid return, but never treats a coordinator outcome flag as
 * authority.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoIntegratedTiming,
	demoIntegratedProofPoolDigest,
	type DemoCanonicalCommitV1,
	type DemoDisplacementStateCommitV1,
	type DemoIntegratedTerminalAuthorityClaimV2,
	type DemoIntegratedTerminalAuthorityStore,
	type DemoIntegratedTimingV1,
} from './demo-integrated-authority'
import {
	demoIntegratedFundingAnyReceiptDigest,
	verifyDemoIntegratedFundingReceiptAny,
	type DemoIntegratedFundingReceiptAny,
} from './demo-integrated-admission-receipt-any'
import {
	demoMaintainerExactTemplateDigest,
	validateDemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import { demoCashuSigAllDigest, demoOutputsDigest, demoSigAllSettlementCutoff } from './demo-sigall-settlement'
import { proofPoint } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const ACTOR = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

export type DemoIntegratedCloseCause = 'winner' | 'reserve_unmet'

export interface DemoCertifiedCloseV1 {
	schema: 'COCO_DEMO_CERTIFIED_CLOSE_V1'
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	auctionId: string
	sellerActorId: string
	sellerPaymentPublicKey?: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	fundingOperationId: string
	cause: DemoIntegratedCloseCause
	poolAmount: number
	reserveAmount: number
	proofStateRefs: string[]
	activeKeysetId: string
	inputFeePpk: 0
	admittedFundingReceipt: DemoIntegratedFundingReceiptAny
	timing: DemoIntegratedTimingV1
	commits: [DemoCanonicalCommitV1, DemoCanonicalCommitV1, DemoCanonicalCommitV1]
	closeState: DemoDisplacementStateCommitV1
}

export interface DemoCertifiedCloseRequestV1 {
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	auctionId: string
	closeHeight: number
}

export interface DemoCertifiedCloseVerifierPort {
	verifyAndDerive(request: DemoCertifiedCloseRequestV1): Promise<DemoCertifiedCloseV1>
}

export class DemoIntegratedCloseAuthorityRefusedError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoIntegratedCloseAuthorityRefusedError'
	}
}

function refuse(code: string, message: string): never { throw new DemoIntegratedCloseAuthorityRefusedError(code, message) }

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('DEMO_CLOSE_CANONICAL', 'non-safe-integer number')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') refuse('DEMO_CLOSE_CANONICAL', 'unsupported value')
	const object = value as Record<string, unknown>
	return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonicalJson(value)))) }

function exactCommit(value: DemoCanonicalCommitV1, height: number): void {
	if (value.height !== height || !Number.isSafeInteger(value.blockTime) || value.blockTime < 1
		|| !HEX_32.test(value.blockHash) || !HEX_32.test(value.appHash)) {
		refuse('DEMO_CLOSE_COMMIT', 'close commit history is malformed')
	}
}

function validateCertificate(value: DemoCertifiedCloseV1): DemoCertifiedCloseV1 {
	const certificate = structuredClone(value)
	if (certificate.schema !== 'COCO_DEMO_CERTIFIED_CLOSE_V1'
		|| !ID.test(certificate.network) || !ID.test(certificate.chainId) || !ID.test(certificate.validatorRosterVersion)
		|| !ID.test(certificate.auctionId) || !ID.test(certificate.bidId) || !ID.test(certificate.fundingOperationId)
		|| !HEX_32.test(certificate.genesisHash) || !ACTOR.test(certificate.sellerActorId)
		|| !HEX_32.test(certificate.bidEventId) || !ACTOR.test(certificate.bidderActorId)
		|| !['winner', 'reserve_unmet'].includes(certificate.cause)
		|| !Number.isSafeInteger(certificate.poolAmount) || certificate.poolAmount < 1
		|| !Number.isSafeInteger(certificate.reserveAmount) || certificate.reserveAmount < 0
		|| certificate.inputFeePpk !== 0 || !ID.test(certificate.activeKeysetId)
		|| !Array.isArray(certificate.proofStateRefs) || certificate.proofStateRefs.length === 0
		|| certificate.proofStateRefs.some((proof) => !/^(?:02|03)[0-9a-f]{64}$/.test(proof))
		|| new Set(certificate.proofStateRefs.map((proof) => proof.slice(2))).size !== certificate.proofStateRefs.length
		|| JSON.stringify(certificate.proofStateRefs) !== JSON.stringify([...certificate.proofStateRefs].sort())) {
		refuse('DEMO_CLOSE_CERTIFICATE', 'close certificate identity, amount, keyset, or proof pool is malformed')
	}
	if (certificate.cause === 'winner' ? certificate.poolAmount < certificate.reserveAmount
		: certificate.reserveAmount === 0 || certificate.poolAmount >= certificate.reserveAmount) {
		refuse('DEMO_CLOSE_RESERVE', 'close cause contradicts the certified reserve and winning amount')
	}
	const timing = demoIntegratedTiming(certificate.timing.originalEndTime, certificate.timing.certifiedEndTime)
	if (canonicalJson(timing) !== canonicalJson(certificate.timing)) {
		refuse('DEMO_CLOSE_TIMING', 'close timing does not use the selected maximum-end emergency policy')
	}
	certificate.timing = timing
	if (!Array.isArray(certificate.commits) || certificate.commits.length !== 3) refuse('DEMO_CLOSE_COMMIT', 'close needs H/H+1/H+2 commits')
	certificate.commits.forEach((commit, index) => exactCommit(commit, certificate.commits[0]!.height + index))
	exactCommit(certificate.closeState.bindingCommit, certificate.closeState.stateHeight + 1)
	if (certificate.commits[1]!.blockTime < certificate.commits[0]!.blockTime
		|| certificate.commits[2]!.blockTime < certificate.commits[1]!.blockTime
		|| certificate.closeState.stateHeight < certificate.commits[2]!.height
		|| certificate.closeState.bindingCommit.height !== certificate.closeState.stateHeight + 1
		|| certificate.closeState.bindingCommit.appHash !== certificate.closeState.stateAppHash) {
		refuse('DEMO_CLOSE_STATE', 'observed close state is not bound to S+1 or predates H+2 finality')
	}
	let receipt: DemoIntegratedFundingReceiptAny
	try { receipt = verifyDemoIntegratedFundingReceiptAny(certificate.admittedFundingReceipt) }
	catch (error) { return refuse('DEMO_CLOSE_RECEIPT', error instanceof Error ? error.message : 'admission receipt is invalid') }
	if (receipt.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
		&& !/^(?:02|03)[0-9a-f]{64}$/.test(certificate.sellerPaymentPublicKey ?? '')) {
		refuse('DEMO_CLOSE_RECIPIENT', 'V4 close certificate lacks the auction-committed Coco seller key')
	}
	if (receipt.auction_id !== certificate.auctionId || receipt.funding_operation_id !== certificate.fundingOperationId
		|| receipt.bidder !== certificate.bidderActorId || receipt.pool_amount !== certificate.poolAmount
		|| receipt.bid_amount !== certificate.poolAmount || receipt.active_keyset_id !== certificate.activeKeysetId
		|| receipt.input_fee_ppk !== 0 || JSON.stringify(receipt.proof_state_refs) !== JSON.stringify(certificate.proofStateRefs)
		|| receipt.locktime !== certificate.timing.locktime) {
		refuse('DEMO_CLOSE_RECEIPT', 'close facts differ from the admitted funding receipt')
	}
	certificate.admittedFundingReceipt = receipt
	return certificate
}

export function demoIntegratedCloseDigest(value: DemoCertifiedCloseV1): string { return digest(validateCertificate(value)) }

/**
 * Stable terminal-policy identity for a certified close. Every participant
 * still authenticates a current state witness; the moving witness is excluded
 * because later valid reads observe later heights after the same final close.
 */
export function demoIntegratedCloseFinalityDigest(value: DemoCertifiedCloseV1): string {
	const certificate = validateCertificate(value)
	const { closeState: _currentObservation, ...stableFinality } = certificate
	if (stableFinality.sellerPaymentPublicKey === undefined) delete stableFinality.sellerPaymentPublicKey
	return digest(['COCO_DEMO_CLOSE_FINALITY_V1', stableFinality])
}

export async function deriveAndAuthorizeDemoIntegratedClose(options: {
	request: DemoCertifiedCloseRequestV1
	template: DemoMaintainerExactBranchTemplate
	closeVerifier: DemoCertifiedCloseVerifierPort
	store: DemoIntegratedTerminalAuthorityStore
	nowSeconds: number
	validateBeforeClaim?: (certificate: DemoCertifiedCloseV1) => void
}): Promise<{ certificate: DemoCertifiedCloseV1; claim: DemoIntegratedTerminalAuthorityClaimV2 }> {
	let certificate: DemoCertifiedCloseV1
	try { certificate = validateCertificate(await options.closeVerifier.verifyAndDerive(structuredClone(options.request))) }
	catch (error) {
		if (error instanceof DemoIntegratedCloseAuthorityRefusedError) throw error
		return refuse('DEMO_CLOSE_HISTORY', error instanceof Error ? error.message : 'close history verification failed')
	}
	options.validateBeforeClaim?.(structuredClone(certificate))
	const role = certificate.cause === 'winner' ? 'winner_settlement' : 'refund'
	const template = validateDemoMaintainerExactBranchTemplate(options.template, role)
	const receipt = certificate.admittedFundingReceipt
	if (template.role !== role || template.network !== certificate.network || template.chainId !== certificate.chainId
		|| template.auctionId !== certificate.auctionId || template.operationId !== certificate.fundingOperationId
		// Templates are prepared before the admission signature and therefore
		// bind the stable funding-operation intent slot, not the unknowable final
		// Nostr event id.  The authenticated certificate still proves which
		// concrete committed event owns that operation.
		|| template.bidId !== receipt.funding_operation_id || template.bidEventId !== receipt.funding_operation_id
		|| template.bidderActorId !== certificate.bidderActorId || template.amount !== certificate.poolAmount
		|| template.locktime !== certificate.timing.locktime) {
		refuse('DEMO_CLOSE_TEMPLATE', 'terminal template differs from the certified active funding pool')
	}
	if (receipt.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
		&& (template.schema !== 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2'
			|| template.sellerPaymentPublicKey !== certificate.sellerPaymentPublicKey
			|| (role === 'winner_settlement' && template.recipientPublicKey !== certificate.sellerPaymentPublicKey))) {
		refuse('DEMO_CLOSE_RECIPIENT', 'V4 terminal template changed the auction-committed Coco seller key')
	}
	if (!Number.isSafeInteger(options.nowSeconds) || options.nowSeconds < certificate.commits[2].blockTime
		|| options.nowSeconds >= certificate.timing.mainCutoff
		|| options.nowSeconds >= demoSigAllSettlementCutoff(template.locktime)) {
		refuse('DEMO_CLOSE_CUTOFF', 'terminal committee execution is outside the certified MAIN window')
	}
	if (template.inputFee !== 0 || template.mintSeal.inputFeePpk !== 0
		|| template.mintSeal.activeSatKeysetId !== certificate.activeKeysetId
		|| template.inputs.some((input) => input.id !== certificate.activeKeysetId)
		|| template.outputs.some((output) => output.id !== certificate.activeKeysetId)) {
		refuse('DEMO_CLOSE_KEYSET', 'terminal template changed the admitted zero-fee keyset')
	}
	const inputTotal = template.inputs.reduce((sum, proof) => sum + proof.amount, 0)
	const outputTotal = template.outputs.reduce((sum, output) => sum + output.amount, 0)
	if (inputTotal !== certificate.poolAmount || outputTotal !== certificate.poolAmount) {
		refuse('DEMO_CLOSE_POOL', 'terminal branch must consume and deliver the complete admitted pool')
	}
	let proofStateRefs: string[]
	try { proofStateRefs = template.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort() }
	catch { return refuse('DEMO_CLOSE_PROOFS', 'terminal input cannot derive its Cashu proof Y') }
	if (JSON.stringify(proofStateRefs) !== JSON.stringify(certificate.proofStateRefs)) {
		refuse('DEMO_CLOSE_PROOFS', 'terminal template inputs differ from the certified proof pool')
	}
	const templateDigest = demoMaintainerExactTemplateDigest(template)
	const cashuSigAllDigest = demoCashuSigAllDigest(template.inputs, template.outputs)
	const admittedTemplate = role === 'winner_settlement' ? receipt.winner_package_digest : receipt.return_package_digest
	if (templateDigest !== admittedTemplate || (role === 'refund'
		&& (cashuSigAllDigest !== receipt.return_cashu_sigall_digest
			|| template.bidderMainSignature !== receipt.bidder_return_signature))
		|| template.bidderPublicKey !== receipt.bidder_public_key || template.refundPublicKey !== receipt.refund_public_key
		|| template.committeePublicKey !== receipt.committee_public_key
		|| template.committeeKeysetId !== receipt.committee_keyset_id
		|| template.committeeKeysetVersion !== receipt.committee_keyset_version) {
		refuse('DEMO_CLOSE_ADMISSION_TEMPLATE', 'terminal template is not the exact package bound at admission')
	}
	const outcomeEvidenceDigest = demoIntegratedCloseFinalityDigest(certificate)
	const finality = certificate.commits[2]
	const claim: DemoIntegratedTerminalAuthorityClaimV2 = {
		schema: 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2', operationId: receipt.funding_operation_id,
		operationRoot: templateDigest, network: certificate.network, chainId: certificate.chainId,
		auctionId: certificate.auctionId, bidId: receipt.funding_operation_id, successorBidId: '', cause: certificate.cause,
		role, outcomeHeight: finality.height, outcomeStateHash: finality.appHash,
		outcomeEvidenceDigest, templateDigest, cashuSigAllDigest, outputsDigest: demoOutputsDigest(template.outputs),
		proofStateRefs, poolAmount: certificate.poolAmount, admissionOperationId: receipt.funding_operation_id,
		admissionReceiptDigest: demoIntegratedFundingAnyReceiptDigest(receipt), committeeKeysetId: receipt.committee_keyset_id,
		committeeKeysetVersion: receipt.committee_keyset_version, dkgRunId: receipt.dkg_run_id,
		publicKeyPackageSha256: receipt.public_key_package_sha256, signerRosterDigest: receipt.signer_roster_digest,
		status: 'terminal_pending',
	}
	if (demoIntegratedProofPoolDigest(claim.proofStateRefs).length !== 64) refuse('DEMO_CLOSE_PROOFS', 'proof pool digest failed')
	const stored = await options.store.claimTerminalDisposition(structuredClone(claim))
	if (JSON.stringify(stored.claim) !== JSON.stringify(claim)) refuse('DEMO_CLOSE_CONFLICT', 'durable authority returned another terminal branch')
	return { certificate, claim }
}
