/**
 * Fake-money-only authority for the Friday FROST/FIPS slice.
 *
 * This module does not trust a coordinator boolean. It accepts an outbid return only after an
 * injected verifier has authenticated the displacement commit and two canonical successors, then
 * atomically claims the exact proof-Y pool for one durable return operation. It deliberately keeps
 * the normal bidder+committee return distinct from the post-locktime unilateral refund.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { demoCashuSigAllDigest, demoOutputsDigest, demoSigAllSettlementCutoff } from './demo-sigall-settlement'
import {
	demoMaintainerExactTemplateDigest,
	validateDemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactBranchTemplate,
} from './demo-maintainer-offline'
import {
	demoIntegratedFundingAnyReceiptDigest,
	verifyDemoIntegratedFundingReceiptAny,
	type DemoIntegratedFundingReceiptAny,
} from './demo-integrated-admission-receipt-any'
import { proofPoint } from './nut-client'

export const DEMO_MAX_EXTENSION_SECONDS = 1_800
export const DEMO_EMERGENCY_RECOVERY_SECONDS = 900
export const DEMO_MAIN_CUTOFF_SECONDS = 300
export const DEMO_DISPLACEMENT_SUCCESSORS = 2

const HEX_32 = /^[0-9a-f]{64}$/

export interface DemoIntegratedTimingV1 {
	schema: 'COCO_DEMO_INTEGRATED_TIMING_V1'
	originalEndTime: number
	certifiedEndTime: number
	maximumEndTime: number
	locktime: number
	mainCutoff: number
}

export interface DemoCanonicalCommitV1 {
	height: number
	blockTime: number
	blockHash: string
	appHash: string
}

export interface DemoDisplacementStateCommitV1 {
	/** Current state S observed after finality; S may be later than event height H. */
	stateHeight: number
	stateAppHash: string
	/** Header S+1 commits the exact canonical application bytes observed at S. */
	bindingCommit: DemoCanonicalCommitV1
}

export interface DemoCertifiedDisplacementV1 {
	schema: 'COCO_DEMO_CERTIFIED_DISPLACEMENT_V1'
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	auctionId: string
	displacedBidId: string
	displacedBidEventId: string
	displacedBidderActorId: string
	displacedFundingOperationId: string
	replacementBidId: string
	replacementBidEventId: string
	replacementBidderActorId: string
	replacementAmount: number
	displacedPoolAmount: number
	proofStateRefs: string[]
	activeKeysetId: string
	inputFeePpk: 0
	/** Complete public admission receipt; bearer proofs remain absent. */
	admittedFundingReceipt: DemoIntegratedFundingReceiptAny
	timing: DemoIntegratedTimingV1
	commits: [DemoCanonicalCommitV1, DemoCanonicalCommitV1, DemoCanonicalCommitV1]
	displacementState: DemoDisplacementStateCommitV1
}

export interface DemoCertifiedDisplacementRequestV1 {
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	auctionId: string
	displacementHeight: number
	replacementBidEventId: string
}

export interface DemoCertifiedDisplacementVerifierPort {
	/**
	 * Read the consensus history from participant-local trust roots and derive
	 * the complete displaced/replacement facts. Returning caller-supplied
	 * certificate bytes without replaying history is not a valid implementation.
	 */
	verifyAndDerive(request: DemoCertifiedDisplacementRequestV1): Promise<DemoCertifiedDisplacementV1>
}

export interface DemoIntegratedAuthorityClaim {
	schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1'
	operationId: string
	operationRoot: string
	network: string
	chainId: string
	auctionId: string
	displacedBidId: string
	replacementBidId: string
	displacementHeight: number
	templateDigest: string
	cashuSigAllDigest: string
	outputsDigest: string
	proofStateRefs: string[]
	poolAmount: number
	admissionOperationId: string
	admissionReceiptDigest: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	status: 'outbid_return_pending'
}

/**
 * One terminal disposition of an admitted proof pool.  V2 is deliberately
 * generic: the same durable uniqueness domain covers seller payout and the
 * two full-pool return causes.  The public outcome digest is derived from
 * participant-local Comet history; it is not a coordinator assertion.
 */
export type DemoIntegratedTerminalCause = 'outbid' | 'winner' | 'reserve_unmet' | 'rejected' | 'funding_abort'

export interface DemoIntegratedTerminalAuthorityClaimV2 {
	schema: 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2'
	operationId: string
	operationRoot: string
	network: string
	chainId: string
	auctionId: string
	bidId: string
	successorBidId: string
	cause: DemoIntegratedTerminalCause
	role: 'winner_settlement' | 'refund'
	/** Authenticated current observation height S, not the event height H. */
	outcomeHeight: number
	/** AppHash of exact state bytes at S, committed by header S+1. */
	outcomeStateHash: string
	outcomeEvidenceDigest: string
	templateDigest: string
	cashuSigAllDigest: string
	outputsDigest: string
	proofStateRefs: string[]
	poolAmount: number
	admissionOperationId: string
	admissionReceiptDigest: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	status: 'terminal_pending'
}

export type DemoIntegratedAnyAuthorityClaim = DemoIntegratedAuthorityClaim | DemoIntegratedTerminalAuthorityClaimV2

export type DemoIntegratedLifecycleStatus =
	| 'outbid_return_pending'
	| 'terminal_pending'
	| 'execution_pending'
	| 'execution_unknown'
	| 'mint_unknown'
	| 'retry_ready'
	| 'recipient_pending'
	| 'recipient_imported'
	| 'quarantined'

export interface DemoIntegratedLifecycleRecord {
	schema: 'COCO_DEMO_INTEGRATED_LIFECYCLE_V1'
	revision: number
	claim: DemoIntegratedAnyAuthorityClaim
	status: DemoIntegratedLifecycleStatus
	/** Public digest/terminal identity only; never bearer proofs or output openings. */
	evidenceDigest?: string
}

/**
 * Durable, explicit join between the payment authority's recovery root and
 * the Rust FROST authorization root. They are different protocol digests and
 * must never be treated as aliases merely because both refer to one operation.
 */
export interface DemoIntegratedExecutionRootBindingV1 {
	schema: 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1'
	operationId: string
	authorityOperationRoot: string
	frostOperationRoot: string
	network: string
	chainId: string
	auctionId: string
	displacedBidId: string
	replacementBidId: string
	displacementHeight: number
	templateDigest: string
	cashuSigAllDigest: string
	outputsDigest: string
	proofPoolDigest: string
	poolAmount: number
	admissionReceiptDigest: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	processRosterDigest: string
	policyPackageDigest: string
	bindingDigest: string
}

export interface DemoIntegratedExecutionRootBindingV2 {
	schema: 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V2'
	operationId: string
	authorityOperationRoot: string
	frostOperationRoot: string
	network: string
	chainId: string
	auctionId: string
	bidId: string
	successorBidId: string
	cause: DemoIntegratedTerminalCause
	role: 'winner_settlement' | 'refund'
	outcomeHeight: number
	outcomeStateHash: string
	outcomeEvidenceDigest: string
	templateDigest: string
	cashuSigAllDigest: string
	outputsDigest: string
	proofPoolDigest: string
	poolAmount: number
	admissionReceiptDigest: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	processRosterDigest: string
	policyPackageDigest: string
	bindingDigest: string
}

export type DemoIntegratedAnyExecutionRootBinding = DemoIntegratedExecutionRootBindingV1 | DemoIntegratedExecutionRootBindingV2

export interface DemoIntegratedAuthorityStore {
	/** Atomically claims every proofStateRef globally, or returns the identical prior claim. */
	claimOutbidReturn(claim: DemoIntegratedAuthorityClaim): Promise<{ claim: DemoIntegratedAuthorityClaim; created: boolean }>
	/** Persist the exact authority-root -> FROST-root join before signing or mint execution. */
	bindExecutionRoot(binding: DemoIntegratedExecutionRootBindingV1): Promise<{ binding: DemoIntegratedExecutionRootBindingV1; created: boolean }>
	readExecutionRoot(operationId: string): Promise<DemoIntegratedExecutionRootBindingV1 | null>
	readLifecycle(operationId: string): Promise<DemoIntegratedLifecycleRecord | null>
	transitionLifecycle(request: {
		operationId: string
		expectedRevision: number
		expectedStatus: DemoIntegratedLifecycleStatus
		nextStatus: DemoIntegratedLifecycleStatus
		evidenceDigest?: string
	}): Promise<DemoIntegratedLifecycleRecord>
}

/**
 * Extended store used by the complete terminal service.  Separate method
 * names prevent a legacy outbid-only caller from accidentally treating a V2
 * terminal binding as the older displacement-only record.
 */
export interface DemoIntegratedTerminalAuthorityStore extends DemoIntegratedAuthorityStore {
	claimTerminalDisposition(claim: DemoIntegratedTerminalAuthorityClaimV2): Promise<{ claim: DemoIntegratedTerminalAuthorityClaimV2; created: boolean }>
	bindTerminalExecutionRoot(binding: DemoIntegratedExecutionRootBindingV2): Promise<{ binding: DemoIntegratedExecutionRootBindingV2; created: boolean }>
	readTerminalExecutionRoot(operationId: string): Promise<DemoIntegratedExecutionRootBindingV2 | null>
}

export class DemoIntegratedAuthorityRefusedError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoIntegratedAuthorityRefusedError'
	}
}

function refuse(code: string, message: string): never { throw new DemoIntegratedAuthorityRefusedError(code, message) }

function exactKeys(value: unknown, expected: string[], field: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('DEMO_AUTHORITY_SHAPE', `${field} must be an object`)
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		refuse('DEMO_AUTHORITY_SHAPE', `${field} contains missing or unexpected fields`)
	}
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('DEMO_AUTHORITY_CANONICAL', 'non-safe-integer number')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') refuse('DEMO_AUTHORITY_CANONICAL', 'unsupported canonical value')
	const object = value as Record<string, unknown>
	return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

function hash(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonicalJson(value)))) }

export function demoIntegratedProofPoolDigest(proofStateRefs: string[]): string {
	return hash(['COCO_DEMO_INTEGRATED_PROOF_POOL_V1', [...proofStateRefs]])
}

export function demoIntegratedExecutionRootBindingDigest(
	value: Omit<DemoIntegratedExecutionRootBindingV1, 'bindingDigest'>,
): string {
	return hash([
		value.schema, value.operationId, value.authorityOperationRoot, value.frostOperationRoot,
		value.network, value.chainId, value.auctionId, value.displacedBidId, value.replacementBidId,
		value.displacementHeight, value.templateDigest, value.cashuSigAllDigest, value.outputsDigest,
		value.proofPoolDigest, value.poolAmount, value.admissionReceiptDigest,
		value.committeeKeysetId, value.committeeKeysetVersion, value.dkgRunId,
		value.publicKeyPackageSha256, value.signerRosterDigest, value.processRosterDigest,
		value.policyPackageDigest,
	])
}

export function demoIntegratedExecutionRootBindingV2Digest(
	value: Omit<DemoIntegratedExecutionRootBindingV2, 'bindingDigest'>,
): string {
	return hash([
		value.schema, value.operationId, value.authorityOperationRoot, value.frostOperationRoot,
		value.network, value.chainId, value.auctionId, value.bidId, value.successorBidId,
		value.cause, value.role, value.outcomeHeight, value.outcomeStateHash, value.outcomeEvidenceDigest,
		value.templateDigest, value.cashuSigAllDigest, value.outputsDigest, value.proofPoolDigest,
		value.poolAmount, value.admissionReceiptDigest, value.committeeKeysetId,
		value.committeeKeysetVersion, value.dkgRunId, value.publicKeyPackageSha256,
		value.signerRosterDigest, value.processRosterDigest, value.policyPackageDigest,
	])
}

export function demoIntegratedTiming(originalEndTime: number, certifiedEndTime: number): DemoIntegratedTimingV1 {
	if (!Number.isSafeInteger(originalEndTime) || originalEndTime < 1 || !Number.isSafeInteger(certifiedEndTime)) {
		refuse('DEMO_AUTHORITY_TIMING', 'auction end times must be positive safe Unix seconds')
	}
	const maximumEndTime = originalEndTime + DEMO_MAX_EXTENSION_SECONDS
	if (certifiedEndTime < originalEndTime || certifiedEndTime > maximumEndTime) {
		refuse('DEMO_AUTHORITY_TIMING', 'certified end is outside the approved extension window')
	}
	const locktime = maximumEndTime + DEMO_EMERGENCY_RECOVERY_SECONDS
	return {
		schema: 'COCO_DEMO_INTEGRATED_TIMING_V1', originalEndTime, certifiedEndTime,
		maximumEndTime, locktime, mainCutoff: locktime - DEMO_MAIN_CUTOFF_SECONDS,
	}
}

function validateTiming(value: DemoIntegratedTimingV1): DemoIntegratedTimingV1 {
	exactKeys(value, ['schema', 'originalEndTime', 'certifiedEndTime', 'maximumEndTime', 'locktime', 'mainCutoff'], 'timing')
	const expected = demoIntegratedTiming(value.originalEndTime, value.certifiedEndTime)
	if (JSON.stringify(value) !== JSON.stringify(expected)) refuse('DEMO_AUTHORITY_TIMING', 'timing does not use the selected demo policy')
	return expected
}

function validateCommit(value: DemoCanonicalCommitV1, index: number): DemoCanonicalCommitV1 {
	exactKeys(value, ['height', 'blockTime', 'blockHash', 'appHash'], `commits[${index}]`)
	if (!Number.isSafeInteger(value.height) || value.height < 1 || !Number.isSafeInteger(value.blockTime) || value.blockTime < 1
		|| !HEX_32.test(value.blockHash) || !HEX_32.test(value.appHash)) {
		refuse('DEMO_AUTHORITY_COMMIT', `commits[${index}] is malformed`)
	}
	return { ...value }
}

function validateDisplacementState(value: DemoDisplacementStateCommitV1): DemoDisplacementStateCommitV1 {
	exactKeys(value, ['stateHeight', 'stateAppHash', 'bindingCommit'], 'displacementState')
	if (!Number.isSafeInteger(value.stateHeight) || value.stateHeight < 1 || !HEX_32.test(value.stateAppHash)) {
		refuse('DEMO_AUTHORITY_STATE', 'authenticated state height or app hash is malformed')
	}
	const bindingCommit = validateCommit(value.bindingCommit, 0)
	if (bindingCommit.height !== value.stateHeight + 1 || bindingCommit.appHash !== value.stateAppHash) {
		refuse('DEMO_AUTHORITY_STATE', 'state app hash is not committed by the next Comet header')
	}
	return { stateHeight: value.stateHeight, stateAppHash: value.stateAppHash, bindingCommit }
}

function validateCertificate(value: DemoCertifiedDisplacementV1): DemoCertifiedDisplacementV1 {
	let certificate: DemoCertifiedDisplacementV1
	try { certificate = structuredClone(value) }
	catch { return refuse('DEMO_AUTHORITY_CERTIFICATE', 'certificate must be immutable cloneable data') }
	exactKeys(certificate, [
		'schema', 'network', 'chainId', 'genesisHash', 'validatorRosterVersion', 'auctionId', 'displacedBidId',
		'displacedBidEventId', 'displacedBidderActorId', 'displacedFundingOperationId', 'replacementBidId', 'replacementBidEventId',
		'replacementBidderActorId', 'replacementAmount', 'displacedPoolAmount', 'proofStateRefs',
		'activeKeysetId', 'inputFeePpk', 'admittedFundingReceipt', 'timing', 'commits', 'displacementState',
	], 'certificate')
	for (const field of ['network', 'chainId', 'validatorRosterVersion', 'auctionId', 'displacedBidId', 'displacedFundingOperationId', 'replacementBidId', 'activeKeysetId'] as const) {
		if (certificate[field].length === 0 || certificate[field].trim() !== certificate[field]) refuse('DEMO_AUTHORITY_CERTIFICATE', `${field} is invalid`)
	}
	for (const field of ['genesisHash', 'displacedBidEventId', 'displacedBidderActorId', 'replacementBidEventId', 'replacementBidderActorId'] as const) {
		if (!HEX_32.test(certificate[field])) refuse('DEMO_AUTHORITY_CERTIFICATE', `${field} must be exact lowercase hex`)
	}
	if (certificate.schema !== 'COCO_DEMO_CERTIFIED_DISPLACEMENT_V1' || certificate.displacedBidId === certificate.replacementBidId
		|| certificate.displacedBidderActorId === certificate.replacementBidderActorId
		|| !Number.isSafeInteger(certificate.replacementAmount) || certificate.replacementAmount < 1
		|| !Number.isSafeInteger(certificate.displacedPoolAmount) || certificate.displacedPoolAmount < 1
		|| certificate.inputFeePpk !== 0) refuse('DEMO_AUTHORITY_CERTIFICATE', 'displacement identity, amounts, or zero-fee policy is invalid')
	if (!Array.isArray(certificate.proofStateRefs) || certificate.proofStateRefs.length === 0
		|| certificate.proofStateRefs.some((value) => !/^(?:02|03)[0-9a-f]{64}$/.test(value))
		|| new Set(certificate.proofStateRefs.map((value) => value.slice(2))).size !== certificate.proofStateRefs.length
		|| JSON.stringify(certificate.proofStateRefs) !== JSON.stringify([...certificate.proofStateRefs].sort())) {
		refuse('DEMO_AUTHORITY_PROOFS', 'proof references must be distinct and canonically ordered')
	}
	certificate.timing = validateTiming(certificate.timing)
	let receipt: DemoIntegratedFundingReceiptAny
	try { receipt = verifyDemoIntegratedFundingReceiptAny(certificate.admittedFundingReceipt) }
	catch (error) { return refuse('DEMO_AUTHORITY_RECEIPT', error instanceof Error ? error.message : 'admission receipt is invalid') }
	if (receipt.auction_id !== certificate.auctionId || receipt.funding_operation_id !== certificate.displacedFundingOperationId
		|| receipt.bidder !== certificate.displacedBidderActorId || receipt.bid_amount !== certificate.displacedPoolAmount
		|| receipt.pool_amount !== certificate.displacedPoolAmount
		|| JSON.stringify(receipt.proof_state_refs) !== JSON.stringify(certificate.proofStateRefs)
		|| receipt.active_keyset_id !== certificate.activeKeysetId || receipt.input_fee_ppk !== certificate.inputFeePpk
		|| receipt.locktime !== certificate.timing.locktime) {
		refuse('DEMO_AUTHORITY_RECEIPT', 'certificate differs from the exact threshold-signed admission receipt')
	}
	certificate.admittedFundingReceipt = receipt
	if (!Array.isArray(certificate.commits) || certificate.commits.length !== DEMO_DISPLACEMENT_SUCCESSORS + 1) {
		refuse('DEMO_AUTHORITY_COMMIT', 'displacement requires its commit plus two successors')
	}
	certificate.commits = certificate.commits.map(validateCommit) as DemoCertifiedDisplacementV1['commits']
	for (let index = 1; index < certificate.commits.length; index++) {
		if (certificate.commits[index]!.height !== certificate.commits[index - 1]!.height + 1
			|| certificate.commits[index]!.blockTime < certificate.commits[index - 1]!.blockTime) {
			refuse('DEMO_AUTHORITY_COMMIT', 'successor commits must be consecutive and time-monotonic')
		}
	}
	certificate.displacementState = validateDisplacementState(certificate.displacementState)
	if (certificate.displacementState.stateHeight < certificate.commits[2].height) {
		refuse('DEMO_AUTHORITY_STATE', 'observed displacement state predates the H+2 finality history')
	}
	return certificate
}

export function demoIntegratedDisplacementDigest(value: DemoCertifiedDisplacementV1): string {
	return hash(validateCertificate(value))
}

/**
 * Stable terminal-policy identity for a certified displacement.
 *
 * The participant still authenticates a current application state S against
 * header S+1 before this is returned. S is deliberately excluded here because
 * independent signers may observe later valid states while the immutable
 * displacement transaction and H/H+1/H+2 finality history stay identical.
 */
export function demoIntegratedDisplacementFinalityDigest(value: DemoCertifiedDisplacementV1): string {
	const certificate = validateCertificate(value)
	const { displacementState: _currentObservation, ...stableFinality } = certificate
	return hash(['COCO_DEMO_DISPLACEMENT_FINALITY_V1', stableFinality])
}

async function authorizeDerivedOutbidReturn(options: {
	certificate: DemoCertifiedDisplacementV1
	template: DemoMaintainerExactBranchTemplate
	store: DemoIntegratedAuthorityStore
	nowSeconds: number
}): Promise<DemoIntegratedAuthorityClaim> {
	const certificate = validateCertificate(options.certificate)
	const template = validateDemoMaintainerExactBranchTemplate(options.template, 'refund')
	const admitted = certificate.admittedFundingReceipt
	if (template.role !== 'refund' || template.network !== certificate.network || template.chainId !== certificate.chainId
		|| template.auctionId !== certificate.auctionId || template.bidId !== admitted.funding_operation_id
		|| template.bidEventId !== admitted.funding_operation_id || template.bidderActorId !== certificate.displacedBidderActorId
		|| template.operationId !== certificate.displacedFundingOperationId
		|| template.amount !== certificate.displacedPoolAmount || template.locktime !== certificate.timing.locktime) {
		refuse('DEMO_AUTHORITY_TEMPLATE', 'cooperative return template differs from the certified displaced full pool')
	}
	if (!Number.isSafeInteger(options.nowSeconds) || options.nowSeconds < certificate.commits[2].blockTime
		|| options.nowSeconds >= certificate.timing.mainCutoff
		|| options.nowSeconds >= demoSigAllSettlementCutoff(template.locktime)) {
		refuse('DEMO_AUTHORITY_CUTOFF', 'cooperative return is not within the certified pre-locktime committee window')
	}
	if (template.inputFee !== 0 || template.mintSeal.inputFeePpk !== 0
		|| template.mintSeal.activeSatKeysetId !== certificate.activeKeysetId
		|| template.inputs.some((input) => input.id !== certificate.activeKeysetId)
		|| template.outputs.some((output) => output.id !== certificate.activeKeysetId)) {
		refuse('DEMO_AUTHORITY_KEYSET', 'template changed the zero-fee active keyset selected at admission')
	}
	const inputTotal = template.inputs.reduce((sum, proof) => sum + proof.amount, 0)
	const outputTotal = template.outputs.reduce((sum, output) => sum + output.amount, 0)
	if (inputTotal !== certificate.displacedPoolAmount || outputTotal !== certificate.displacedPoolAmount) {
		refuse('DEMO_AUTHORITY_POOL', 'cooperative outbid return must return the entire auction-scoped pool')
	}
	let proofStateRefs: string[]
	try { proofStateRefs = template.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort() }
	catch { return refuse('DEMO_AUTHORITY_PROOFS', 'template input cannot derive its proof state reference') }
	if (JSON.stringify(proofStateRefs) !== JSON.stringify(certificate.proofStateRefs)) {
		refuse('DEMO_AUTHORITY_PROOFS', 'template inputs differ from the certified exclusive proof pool')
	}
	const templateDigest = demoMaintainerExactTemplateDigest(template)
	const cashuSigAllDigest = demoCashuSigAllDigest(template.inputs, template.outputs)
	if (templateDigest !== admitted.return_package_digest || cashuSigAllDigest !== admitted.return_cashu_sigall_digest
		|| template.bidderMainSignature !== admitted.bidder_return_signature
		|| template.bidderPublicKey !== admitted.bidder_public_key || template.refundPublicKey !== admitted.refund_public_key
		|| template.committeePublicKey !== admitted.committee_public_key
		|| template.committeeKeysetId !== admitted.committee_keyset_id
		|| template.committeeKeysetVersion !== admitted.committee_keyset_version) {
		refuse('DEMO_AUTHORITY_ADMISSION_TEMPLATE', 'return template is not the exact package threshold-attested at admission')
	}
	const admissionReceiptDigest = demoIntegratedFundingAnyReceiptDigest(admitted)
	const operationId = admitted.funding_operation_id
	const claim: DemoIntegratedAuthorityClaim = {
		schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1', operationId,
		operationRoot: templateDigest,
		network: certificate.network, chainId: certificate.chainId, auctionId: certificate.auctionId,
		displacedBidId: admitted.funding_operation_id, replacementBidId: certificate.replacementBidId,
		displacementHeight: certificate.commits[0].height, templateDigest, cashuSigAllDigest,
		outputsDigest: demoOutputsDigest(template.outputs), proofStateRefs, poolAmount: certificate.displacedPoolAmount,
		admissionOperationId: admitted.funding_operation_id, admissionReceiptDigest,
		committeeKeysetId: admitted.committee_keyset_id, committeeKeysetVersion: admitted.committee_keyset_version,
		dkgRunId: admitted.dkg_run_id, publicKeyPackageSha256: admitted.public_key_package_sha256,
		signerRosterDigest: admitted.signer_roster_digest,
		status: 'outbid_return_pending',
	}
	const stored = await options.store.claimOutbidReturn(structuredClone(claim))
	if (JSON.stringify(stored.claim) !== JSON.stringify(claim)) refuse('DEMO_AUTHORITY_CONFLICT', 'durable authority returned a conflicting claim')
	return claim
}

export async function deriveAndAuthorizeDemoCooperativeOutbidReturn(options: {
	request: DemoCertifiedDisplacementRequestV1
	template: DemoMaintainerExactBranchTemplate
	displacementVerifier: DemoCertifiedDisplacementVerifierPort
	store: DemoIntegratedAuthorityStore
	nowSeconds: number
	/** Optional pure composition check that must pass before the proof pool is claimed. */
	validateBeforeClaim?: (certificate: DemoCertifiedDisplacementV1) => void
}): Promise<{ certificate: DemoCertifiedDisplacementV1; claim: DemoIntegratedAuthorityClaim }> {
	let certificate: DemoCertifiedDisplacementV1
	try { certificate = validateCertificate(await options.displacementVerifier.verifyAndDerive(structuredClone(options.request))) }
	catch (error) {
		if (error instanceof DemoIntegratedAuthorityRefusedError) throw error
		return refuse('DEMO_AUTHORITY_HISTORY', error instanceof Error ? error.message : 'consensus history verification failed')
	}
	options.validateBeforeClaim?.(structuredClone(certificate))
	const claim = await authorizeDerivedOutbidReturn({
		certificate, template: options.template, store: options.store, nowSeconds: options.nowSeconds,
	})
	return { certificate, claim }
}

export async function authorizeDemoCooperativeOutbidReturn(options: {
	certificate: DemoCertifiedDisplacementV1
	template: DemoMaintainerExactBranchTemplate
	displacementVerifier: DemoCertifiedDisplacementVerifierPort
	store: DemoIntegratedAuthorityStore
	nowSeconds: number
}): Promise<DemoIntegratedAuthorityClaim> {
	const certificate = validateCertificate(options.certificate)
	let derived: DemoCertifiedDisplacementV1
	try {
		derived = validateCertificate(await options.displacementVerifier.verifyAndDerive({
			network: certificate.network, chainId: certificate.chainId, genesisHash: certificate.genesisHash,
			validatorRosterVersion: certificate.validatorRosterVersion, auctionId: certificate.auctionId,
			displacementHeight: certificate.commits[0].height, replacementBidEventId: certificate.replacementBidEventId,
		}))
	} catch (error) {
		if (error instanceof DemoIntegratedAuthorityRefusedError) throw error
		return refuse('DEMO_AUTHORITY_HISTORY', error instanceof Error ? error.message : 'consensus history verification failed')
	}
	if (canonicalJson(derived) !== canonicalJson(certificate)) {
		refuse('DEMO_AUTHORITY_HISTORY', 'caller certificate differs from participant-local consensus history')
	}
	return authorizeDerivedOutbidReturn({
		certificate, template: options.template, store: options.store, nowSeconds: options.nowSeconds,
	})
}
