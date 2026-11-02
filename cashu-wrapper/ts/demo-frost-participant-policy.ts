/**
 * Participant-local policy validation for demo FROST authorization.
 *
 * Cashu's NUT-11 SIG_ALL message includes each proof secret and C. For this fake-Testnut demo only,
 * the bidder explicitly approved disclosing the exact `(amount,id,secret,C)` tuples to the four
 * authenticated validator processes. Every participant therefore recomputes the digest locally.
 * The payload deliberately excludes the bidder witness/private keys and recipient output openings.
 *
 * The closure and signed-bid verifier ports are likewise participant-local trust boundaries. Test
 * doubles exercise binding/refusal behavior only; they are not authenticated deployment evidence.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	type DemoDispositionRole,
	type DemoRecipientCapability,
} from './demo-sigall-settlement'
import type { DemoMaintainerPackageAuthorization } from './demo-maintainer-offline'
import { proofPoint, parseP2PKSecret } from './nut-client'

const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const X_ONLY_KEY = /^[0-9a-f]{64}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

export interface DemoFrostPublicDeposit {
	proofStateRef: string
	amount: number
	keysetId: string
}

export interface DemoFrostPublicOutput {
	amount: number
	id: string
	B_: string
}

export type DemoFrostParticipantLocalEvidence =
	| {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1'
		source: 'participant-local'
	}
	| {
		/**
		 * Network-runnable lookup identity. The coordinator cannot choose an
		 * outcome: every signer replays this exact Comet event from its own RPC.
		 */
		schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
		source: 'participant-local'
		kind: 'outbid'
		eventHeight: number
		eventId: string
	}
	| {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
		source: 'participant-local'
		kind: 'close'
		eventHeight: number
	}
	| {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
		source: 'participant-local'
		kind: 'rejected'
		eventHeight: number
		eventId: string
	}
	| {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
		source: 'participant-local'
		kind: 'funding_abort'
		eventHeight: number
		/** Consensus FundingAbort certificate digest, never a coordinator-local journal ID. */
		eventId: string
	}
	| {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1'
		source: 'participant-local'
	}

export interface DemoFrostEvidenceEnvelope {
	evidenceDigest: string
	evidence: DemoFrostParticipantLocalEvidence
}

/**
 * Sensitive fake-Testnut input disclosed only over the authenticated
 * four-validator transport. DLEQ is optional at the generic schema boundary,
 * but the concrete Friday signer requires and verifies it before signing.
 */
export interface DemoFrostCommitteeLockedProof {
	amount: number
	id: string
	secret: string
	C: string
	dleq?: { e: string; s: string; r?: string }
}

export type DemoFrostActorPackageAuthorization = DemoMaintainerPackageAuthorization

export interface DemoFrostParticipantPolicyPackage {
	schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1'
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	role: DemoDispositionRole
	outcomeHeight: number
	appStateHash: string
	amount: number
	inputFee: number
	inputFeePpk: number
	mintUrl: string
	unit: 'sat'
	activeKeysetId: string
	locktime: number
	bidderPublicKey: string
	committeePublicKey: string
	sellerRecipientPublicKey: string
	recipientPublicKey: string
	deposits: DemoFrostPublicDeposit[]
	committeeLockedProofs: DemoFrostCommitteeLockedProof[]
	outputs: DemoFrostPublicOutput[]
	/** Recipient-signed binding to these exact blinded outputs; contains no output openings. */
	recipientCapability: DemoRecipientCapability
	packageDigest: string
	cashuSigAllDigest: string
	actorPackageAuthorization: DemoFrostActorPackageAuthorization
	certifiedClosure: DemoFrostEvidenceEnvelope
	signedBid: DemoFrostEvidenceEnvelope
}

export interface DemoFrostVerifiedClosureDisposition {
	evidenceDigest: string
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	role: DemoDispositionRole
	outcomeHeight: number
	appStateHash: string
	amount: number
	locktime: number
	proofStateRefs: string[]
	recipientPublicKey: string
}

export interface DemoFrostVerifiedSignedBid {
	evidenceDigest: string
	network: string
	chainId: string
	auctionId: string
	operationId: string
	bidId: string
	bidEventId: string
	bidderActorId: string
	amount: number
	locktime: number
	bidderPublicKey: string
	sellerRecipientPublicKey: string
	deposits: DemoFrostPublicDeposit[]
}

export interface DemoFrostCertifiedClosureVerifierPort {
	/** Verify the complete certificate/history evidence against participant-local trust roots. */
	verifyAndDerive(evidence: unknown): Promise<DemoFrostVerifiedClosureDisposition>
}

export interface DemoFrostSignedBidVerifierPort {
	/** Verify the original signed bid/event and derive its exact public deposit/actor facts. */
	verifyAndDerive(evidence: unknown): Promise<DemoFrostVerifiedSignedBid>
}

export interface DemoFrostParticipantProofUsePort {
	/** Durable participant-local exclusivity check against reusing a deposit under another bid. */
	assertExclusive(request: {
		network: string
		chainId: string
		mintUrl: string
		unit: 'sat'
		activeKeysetId: string
		auctionId: string
		operationId: string
		bidId: string
		policyPackageDigest: string
		proofStateRefs: string[]
	}): Promise<void>
}

export interface DemoFrostParticipantPolicyPorts {
	closureVerifier: DemoFrostCertifiedClosureVerifierPort
	signedBidVerifier: DemoFrostSignedBidVerifierPort
	proofUse: DemoFrostParticipantProofUsePort
}

export interface DemoFrostParticipantPolicyEvidence {
	schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1'
	policyPackageDigest: string
	closureEvidenceDigest: string
	signedBidEvidenceDigest: string
	committeeLockedProofsDigest: string
	authenticatedPackageDigest: string
	derivedCashuSigAllDigest: string
}

export class DemoFrostParticipantPolicyRefusedError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(`${code}: ${message}`)
		this.name = 'DemoFrostParticipantPolicyRefusedError'
		this.code = code
	}
}

function refuse(code: string, message: string): never {
	throw new DemoFrostParticipantPolicyRefusedError(code, message)
}

function exactKeys(value: unknown, expected: string[], field: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		refuse('DEMO_FROST_POLICY_SHAPE', `${field} must be an object`)
	}
	const actual = Object.keys(value).sort()
	if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
		refuse('DEMO_FROST_POLICY_SHAPE', `${field} contains missing or unexpected fields`)
	}
}

function requireText(value: string, field: string): void {
	if (value.length === 0 || value.trim() !== value) refuse('DEMO_FROST_POLICY_TEXT', `${field} must be non-empty and trimmed`)
}

function requireAmount(value: number, field: string, allowZero = false): void {
	if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
		refuse('DEMO_FROST_POLICY_AMOUNT', `${field} is not a valid safe integer amount`)
	}
}

function requireHex32(value: string, field: string): void {
	if (!HEX_32.test(value)) refuse('DEMO_FROST_POLICY_DIGEST', `${field} must be 32 lowercase hex bytes`)
}

function requireKey(value: string, field: string): void {
	if (!COMPRESSED_KEY.test(value)) refuse('DEMO_FROST_POLICY_PUBLIC_KEY', `${field} must be compressed public key hex`)
}

function canonicalJson(value: unknown, field = 'value'): string {
	if (value === null) return 'null'
	if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('DEMO_FROST_POLICY_CANONICAL', `${field} contains a non-safe-integer number`)
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map((entry, index) => canonicalJson(entry, `${field}[${index}]`)).join(',')}]`
	if (typeof value !== 'object') refuse('DEMO_FROST_POLICY_CANONICAL', `${field} is not canonical JSON data`)
	const object = value as Record<string, unknown>
	const keys = Object.keys(object).sort()
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key], `${field}.${key}`)}`).join(',')}}`
}

function hashCanonical(value: unknown): string {
	return bytesToHex(sha256(utf8ToBytes(canonicalJson(value))))
}

function canonicalDeposits(value: DemoFrostPublicDeposit[]): DemoFrostPublicDeposit[] {
	if (!Array.isArray(value) || value.length === 0) refuse('DEMO_FROST_POLICY_DEPOSIT', 'at least one public deposit reference is required')
	const deposits = value.map((deposit, index) => {
		exactKeys(deposit, ['proofStateRef', 'amount', 'keysetId'], `deposits[${index}]`)
		requireKey(deposit.proofStateRef, `deposits[${index}].proofStateRef`)
		requireAmount(deposit.amount, `deposits[${index}].amount`)
		requireText(deposit.keysetId, `deposits[${index}].keysetId`)
		return { ...deposit }
	})
	if (new Set(deposits.map((deposit) => deposit.proofStateRef.slice(2))).size !== deposits.length) {
		refuse('DEMO_FROST_POLICY_DEPOSIT', 'deposit proof references must have distinct x-coordinates')
	}
	if (JSON.stringify(deposits.map((deposit) => deposit.proofStateRef)) !== JSON.stringify(deposits.map((deposit) => deposit.proofStateRef).sort())) {
		refuse('DEMO_FROST_POLICY_DEPOSIT', 'deposit proof references must be in canonical order')
	}
	return deposits
}

function canonicalCommitteeLockedProofs(value: DemoFrostCommitteeLockedProof[]): DemoFrostCommitteeLockedProof[] {
	if (!Array.isArray(value) || value.length === 0) {
		refuse('DEMO_FROST_POLICY_PROOF', 'at least one committee-locked proof tuple is required')
	}
	const proofs = value.map((proof, index) => {
		exactKeys(proof, proof.dleq === undefined
			? ['amount', 'id', 'secret', 'C']
			: ['amount', 'id', 'secret', 'C', 'dleq'], `committeeLockedProofs[${index}]`)
		requireAmount(proof.amount, `committeeLockedProofs[${index}].amount`)
		requireText(proof.id, `committeeLockedProofs[${index}].id`)
		requireText(proof.secret, `committeeLockedProofs[${index}].secret`)
		requireKey(proof.C, `committeeLockedProofs[${index}].C`)
		if (proof.dleq !== undefined) {
			exactKeys(proof.dleq, proof.dleq.r === undefined ? ['e', 's'] : ['e', 's', 'r'], `committeeLockedProofs[${index}].dleq`)
			requireHex32(proof.dleq.e, `committeeLockedProofs[${index}].dleq.e`)
			requireHex32(proof.dleq.s, `committeeLockedProofs[${index}].dleq.s`)
			if (proof.dleq.r !== undefined) requireHex32(proof.dleq.r, `committeeLockedProofs[${index}].dleq.r`)
		}
		return {
			amount: proof.amount, id: proof.id, secret: proof.secret, C: proof.C,
			...(proof.dleq === undefined ? {} : { dleq: { ...proof.dleq } }),
		}
	})
	if (new Set(proofs.map((proof) => proof.C.slice(2))).size !== proofs.length
		|| new Set(proofs.map((proof) => proof.secret)).size !== proofs.length) {
		refuse('DEMO_FROST_POLICY_PROOF', 'committee-locked proof points and secrets must be distinct')
	}
	return proofs
}

export function demoFrostCommitteeLockedProofsDigest(value: DemoFrostCommitteeLockedProof[]): string {
	return hashCanonical(canonicalCommitteeLockedProofs(value))
}

function canonicalOutputs(value: DemoFrostPublicOutput[]): DemoFrostPublicOutput[] {
	if (!Array.isArray(value) || value.length === 0) refuse('DEMO_FROST_POLICY_OUTPUT', 'at least one blinded output is required')
	const outputs = value.map((output, index) => {
		exactKeys(output, ['amount', 'id', 'B_'], `outputs[${index}]`)
		requireAmount(output.amount, `outputs[${index}].amount`)
		requireText(output.id, `outputs[${index}].id`)
		requireKey(output.B_, `outputs[${index}].B_`)
		return { ...output }
	})
	if (new Set(outputs.map((output) => output.B_.slice(2))).size !== outputs.length) {
		refuse('DEMO_FROST_POLICY_OUTPUT', 'blinded outputs must have distinct x-coordinates')
	}
	return outputs
}

function canonicalEnvelope(
	value: DemoFrostEvidenceEnvelope,
	field: string,
	expectedSchema: DemoFrostParticipantLocalEvidence['schema'],
): DemoFrostEvidenceEnvelope {
	exactKeys(value, ['evidenceDigest', 'evidence'], field)
	requireHex32(value.evidenceDigest, `${field}.evidenceDigest`)
	const allowedNetworkClosure = expectedSchema === 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1'
		&& value.evidence.schema === 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2'
	if (value.evidence.schema === 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2') {
		exactKeys(value.evidence, value.evidence.kind === 'outbid' || value.evidence.kind === 'rejected'
			|| value.evidence.kind === 'funding_abort'
			? ['schema', 'source', 'kind', 'eventHeight', 'eventId']
			: ['schema', 'source', 'kind', 'eventHeight'], `${field}.evidence`)
		if (!allowedNetworkClosure || value.evidence.source !== 'participant-local'
			|| !['outbid', 'close', 'rejected', 'funding_abort'].includes(value.evidence.kind)
			|| !Number.isSafeInteger(value.evidence.eventHeight) || value.evidence.eventHeight < 1
			|| ((value.evidence.kind === 'outbid' || value.evidence.kind === 'rejected'
				|| value.evidence.kind === 'funding_abort') && !HEX_32.test(value.evidence.eventId))) {
			refuse('DEMO_FROST_POLICY_EVIDENCE_SOURCE', `${field} network lookup evidence is malformed`)
		}
		return { evidenceDigest: value.evidenceDigest, evidence: { ...value.evidence } }
	}
	exactKeys(value.evidence, ['schema', 'source'], `${field}.evidence`)
	if (value.evidence.schema !== expectedSchema || value.evidence.source !== 'participant-local') {
		refuse('DEMO_FROST_POLICY_EVIDENCE_SOURCE', `${field} evidence must be resolved from the participant-local source`)
	}
	return { evidenceDigest: value.evidenceDigest, evidence: { ...value.evidence } }
}

function canonicalPolicy(value: DemoFrostParticipantPolicyPackage): DemoFrostParticipantPolicyPackage {
	exactKeys(value, [
		'schema', 'network', 'chainId', 'auctionId', 'operationId', 'bidId', 'bidEventId', 'bidderActorId',
		'role', 'outcomeHeight', 'appStateHash', 'amount', 'inputFee', 'inputFeePpk', 'mintUrl', 'unit',
		'activeKeysetId', 'locktime', 'bidderPublicKey', 'committeePublicKey', 'sellerRecipientPublicKey', 'recipientPublicKey',
		'deposits', 'committeeLockedProofs', 'outputs', 'packageDigest', 'cashuSigAllDigest', 'actorPackageAuthorization',
		'recipientCapability',
		'certifiedClosure', 'signedBid',
	], 'policy')
	if (value.schema !== 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1') refuse('DEMO_FROST_POLICY_SCHEMA', 'unsupported participant policy')
	for (const [field, text] of Object.entries({
		network: value.network,
		chainId: value.chainId,
		auctionId: value.auctionId,
		operationId: value.operationId,
		bidId: value.bidId,
		mintUrl: value.mintUrl,
		activeKeysetId: value.activeKeysetId,
	})) requireText(text, field)
	requireHex32(value.bidEventId, 'bidEventId')
	if (!X_ONLY_KEY.test(value.bidderActorId)) refuse('DEMO_FROST_POLICY_ACTOR', 'bidderActorId must be x-only public key hex')
	if (value.role !== 'winner_settlement' && value.role !== 'refund') refuse('DEMO_FROST_POLICY_ROLE', 'unsupported disposition role')
	requireAmount(value.outcomeHeight, 'outcomeHeight')
	requireHex32(value.appStateHash, 'appStateHash')
	requireAmount(value.amount, 'amount')
	requireAmount(value.inputFee, 'inputFee', true)
	requireAmount(value.inputFeePpk, 'inputFeePpk', true)
	if (value.inputFeePpk > 100) refuse('DEMO_FROST_POLICY_FEE', 'inputFeePpk exceeds the bounded demo policy')
	if (value.unit !== 'sat') refuse('DEMO_FROST_POLICY_UNIT', 'participant policy must use sat')
	requireAmount(value.locktime, 'locktime')
	requireKey(value.bidderPublicKey, 'bidderPublicKey')
	requireKey(value.committeePublicKey, 'committeePublicKey')
	if (value.committeePublicKey.slice(2) === value.bidderPublicKey.slice(2)) {
		refuse('DEMO_FROST_POLICY_PUBLIC_KEY', 'bidder and committee keys must have distinct x-coordinates')
	}
	requireKey(value.sellerRecipientPublicKey, 'sellerRecipientPublicKey')
	requireKey(value.recipientPublicKey, 'recipientPublicKey')
	requireHex32(value.packageDigest, 'packageDigest')
	requireHex32(value.cashuSigAllDigest, 'cashuSigAllDigest')
	const deposits = canonicalDeposits(value.deposits)
	const committeeLockedProofs = canonicalCommitteeLockedProofs(value.committeeLockedProofs)
	const outputs = canonicalOutputs(value.outputs)
	exactKeys(value.recipientCapability, [
		'schema', 'network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl', 'unit',
		'recipientPublicKey', 'outputsDigest', 'signature',
	], 'recipientCapability')
	if ('schema' in value.actorPackageAuthorization) {
		exactKeys(value.actorPackageAuthorization, ['schema', 'paymentPublicKey', 'packageDigest', 'signature'], 'actorPackageAuthorization')
		if (value.actorPackageAuthorization.schema !== 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1'
			|| !COMPRESSED_KEY.test(value.actorPackageAuthorization.paymentPublicKey)) {
			refuse('DEMO_FROST_POLICY_ACTOR', 'payment-key package authorization is invalid')
		}
	} else {
		exactKeys(value.actorPackageAuthorization, ['actorId', 'packageDigest', 'signature'], 'actorPackageAuthorization')
		if (!X_ONLY_KEY.test(value.actorPackageAuthorization.actorId)) refuse('DEMO_FROST_POLICY_ACTOR', 'actor authorization key is invalid')
	}
	requireHex32(value.actorPackageAuthorization.packageDigest, 'actorPackageAuthorization.packageDigest')
	if (!HEX_64.test(value.actorPackageAuthorization.signature)) refuse('DEMO_FROST_POLICY_ACTOR', 'actor authorization signature is invalid')
	return {
		...value,
		deposits,
		committeeLockedProofs,
		outputs,
		recipientCapability: { ...value.recipientCapability },
		actorPackageAuthorization: { ...value.actorPackageAuthorization },
		certifiedClosure: canonicalEnvelope(
			value.certifiedClosure,
			'certifiedClosure',
			'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1',
		),
		signedBid: canonicalEnvelope(
			value.signedBid,
			'signedBid',
			'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1',
		),
	}
}

export function demoFrostParticipantPolicyDigest(value: DemoFrostParticipantPolicyPackage): string {
	return hashCanonical(canonicalPolicy(value))
}

export function cloneDemoFrostParticipantPolicy(value: DemoFrostParticipantPolicyPackage): DemoFrostParticipantPolicyPackage {
	return canonicalPolicy(structuredClone(value))
}

function publicFacts(policy: DemoFrostParticipantPolicyPackage): Omit<DemoFrostVerifiedSignedBid, 'evidenceDigest' | 'deposits'> {
	return {
		network: policy.network,
		chainId: policy.chainId,
		auctionId: policy.auctionId,
		operationId: policy.operationId,
		bidId: policy.bidId,
		bidEventId: policy.bidEventId,
		bidderActorId: policy.bidderActorId,
		amount: policy.amount,
		locktime: policy.locktime,
		bidderPublicKey: policy.bidderPublicKey,
		sellerRecipientPublicKey: policy.sellerRecipientPublicKey,
	}
}

function assertExactVerifiedBid(policy: DemoFrostParticipantPolicyPackage, verified: DemoFrostVerifiedSignedBid): void {
	requireHex32(verified.evidenceDigest, 'verifiedBid.evidenceDigest')
	if (verified.evidenceDigest !== policy.signedBid.evidenceDigest) refuse('DEMO_FROST_POLICY_SIGNED_BID', 'signed-bid evidence digest mismatch')
	const expected = publicFacts(policy)
	for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
		if (verified[field] !== expected[field]) refuse('DEMO_FROST_POLICY_SIGNED_BID', `signed bid ${field} mismatch`)
	}
	if (canonicalJson(verified.deposits) !== canonicalJson(policy.deposits)) {
		refuse('DEMO_FROST_POLICY_SIGNED_BID', 'signed bid deposit manifest mismatch')
	}
}

function assertExactClosure(policy: DemoFrostParticipantPolicyPackage, verified: DemoFrostVerifiedClosureDisposition): void {
	requireHex32(verified.evidenceDigest, 'verifiedClosure.evidenceDigest')
	if (verified.evidenceDigest !== policy.certifiedClosure.evidenceDigest) refuse('DEMO_FROST_POLICY_CLOSURE', 'closure evidence digest mismatch')
	const expected = {
		network: policy.network,
		chainId: policy.chainId,
		auctionId: policy.auctionId,
		operationId: policy.operationId,
		bidId: policy.bidId,
		bidEventId: policy.bidEventId,
		bidderActorId: policy.bidderActorId,
		role: policy.role,
		outcomeHeight: policy.outcomeHeight,
		appStateHash: policy.appStateHash,
		amount: policy.amount,
		locktime: policy.locktime,
		recipientPublicKey: policy.recipientPublicKey,
	}
	for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
		if (verified[field] !== expected[field]) refuse('DEMO_FROST_POLICY_CLOSURE', `certified closure ${field} mismatch`)
	}
	if (canonicalJson(verified.proofStateRefs) !== canonicalJson(policy.deposits.map((deposit) => deposit.proofStateRef))) {
		refuse('DEMO_FROST_POLICY_CLOSURE', 'certified closure deposit references mismatch')
	}
}

function verifyActorAuthorization(policy: DemoFrostParticipantPolicyPackage): void {
	const authorization = policy.actorPackageAuthorization
	const expectedSigner = 'schema' in authorization ? policy.bidderPublicKey.slice(2) : policy.bidderActorId
	const actualSigner = 'schema' in authorization ? authorization.paymentPublicKey.slice(2) : authorization.actorId
	if (('schema' in authorization && authorization.paymentPublicKey !== policy.bidderPublicKey)
		|| actualSigner !== expectedSigner || authorization.packageDigest !== policy.packageDigest) {
		refuse('DEMO_FROST_POLICY_ACTOR', 'actor package authorization scope mismatch')
	}
	let valid = false
	try {
		valid = schnorr.verify(
			hexToBytes(authorization.signature),
			hexToBytes(policy.packageDigest),
			hexToBytes(expectedSigner),
		)
	} catch {
		valid = false
	}
	if (!valid) refuse('DEMO_FROST_POLICY_ACTOR', 'actor package authorization signature is invalid')
}

function verifyRecipientCapability(policy: DemoFrostParticipantPolicyPackage): void {
	const capability = policy.recipientCapability
	if (capability.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1') {
		refuse('DEMO_FROST_POLICY_RECIPIENT_CAPABILITY', 'unsupported recipient capability schema')
	}
	for (const field of ['network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl', 'unit', 'recipientPublicKey'] as const) {
		if (capability[field] !== policy[field]) {
			refuse('DEMO_FROST_POLICY_RECIPIENT_CAPABILITY', `recipient capability ${field} mismatch`)
		}
	}
	const exactOutputsDigest = demoOutputsDigest(policy.outputs)
	if (capability.outputsDigest !== exactOutputsDigest) {
		refuse('DEMO_FROST_POLICY_RECIPIENT_CAPABILITY', 'recipient capability does not bind the exact blinded outputs')
	}
	if (!HEX_64.test(capability.signature)) {
		refuse('DEMO_FROST_POLICY_RECIPIENT_CAPABILITY', 'recipient capability signature is malformed')
	}
	let valid = false
	try {
		valid = schnorr.verify(
			hexToBytes(capability.signature),
			hexToBytes(demoRecipientCapabilityDigest(capability)),
			hexToBytes(capability.recipientPublicKey.slice(2)),
		)
	} catch {
		valid = false
	}
	if (!valid) refuse('DEMO_FROST_POLICY_RECIPIENT_CAPABILITY', 'recipient capability signature is invalid')
}

function validateValuePolicy(policy: DemoFrostParticipantPolicyPackage): void {
	if (policy.deposits.some((deposit) => deposit.keysetId !== policy.activeKeysetId)
		|| policy.outputs.some((output) => output.id !== policy.activeKeysetId)) {
		refuse('DEMO_FROST_POLICY_KEYSET', 'deposit or output keyset differs from the exact active keyset policy')
	}
	const inputTotal = policy.deposits.reduce((sum, deposit) => sum + deposit.amount, 0)
	const outputTotal = policy.outputs.reduce((sum, output) => sum + output.amount, 0)
	if (!Number.isSafeInteger(inputTotal) || !Number.isSafeInteger(outputTotal)
		|| inputTotal !== policy.amount + policy.inputFee || outputTotal !== policy.amount) {
		refuse('DEMO_FROST_POLICY_BALANCE', 'public deposits, exact disposition amount, outputs, and fee do not balance')
	}
	if (Math.ceil((policy.inputFeePpk * policy.deposits.length) / 1000) !== policy.inputFee) {
		refuse('DEMO_FROST_POLICY_FEE', 'input fee differs from the exact input-count and ppk policy')
	}
	const firstLock = parseP2PKSecret(policy.committeeLockedProofs[0]?.secret ?? '')
	const refundTags = firstLock?.tags.filter(([name]) => name === 'refund') ?? []
	if (refundTags.length !== 1) refuse('DEMO_FROST_POLICY_REFUND_KEY', 'locked proof must contain exactly one refund key')
	const refundPublicKey = refundTags[0]?.[1] ?? ''
	requireKey(refundPublicKey, 'refundPublicKey')
	if (refundPublicKey.slice(2) === policy.bidderPublicKey.slice(2)
		|| refundPublicKey.slice(2) === policy.committeePublicKey.slice(2)) {
		refuse('DEMO_FROST_POLICY_REFUND_KEY', 'refund, bidder, and committee keys must have distinct x-coordinates')
	}
	const expectedRecipient = policy.role === 'winner_settlement' ? policy.sellerRecipientPublicKey : refundPublicKey
	if (policy.recipientPublicKey !== expectedRecipient) {
		refuse('DEMO_FROST_POLICY_RECIPIENT', 'disposition recipient differs from the signed role policy')
	}
}

function validateCommitteeLockedProofs(policy: DemoFrostParticipantPolicyPackage): string {
	if (policy.committeeLockedProofs.length !== policy.deposits.length) {
		refuse('DEMO_FROST_POLICY_PROOF', 'disclosed proof count differs from the signed deposit manifest')
	}
	for (const [index, proof] of policy.committeeLockedProofs.entries()) {
		const deposit = policy.deposits[index]
		let proofStateRef: string
		try {
			proofStateRef = bytesToHex(proofPoint(proof).toBytes(true))
		} catch (error) {
			return refuse('DEMO_FROST_POLICY_PROOF', error instanceof Error ? error.message : 'invalid proof state reference')
		}
		if (proof.amount !== deposit.amount || proof.id !== deposit.keysetId || proofStateRef !== deposit.proofStateRef) {
			refuse('DEMO_FROST_POLICY_PROOF', `committeeLockedProofs[${index}] differs from the signed deposit manifest`)
		}
		const parsed = parseP2PKSecret(proof.secret)
		if (parsed === null) refuse('DEMO_FROST_POLICY_PROOF', `committeeLockedProofs[${index}] is not a P2PK proof`)
		const refundTags = parsed.tags.filter(([name]) => name === 'refund')
		if (refundTags.length !== 1) refuse('DEMO_FROST_POLICY_REFUND_KEY', `committeeLockedProofs[${index}] must contain exactly one refund key`)
		const refundPublicKey = refundTags[0]?.[1] ?? ''
		requireKey(refundPublicKey, `committeeLockedProofs[${index}].refundPublicKey`)
		if (refundPublicKey.slice(2) === policy.bidderPublicKey.slice(2)
			|| refundPublicKey.slice(2) === policy.committeePublicKey.slice(2)) {
			refuse('DEMO_FROST_POLICY_REFUND_KEY', 'refund, bidder, and committee keys must have distinct x-coordinates')
		}
		let rebuilt: string
		try {
			rebuilt = buildDemoSigAllSecret({
				nonce: parsed.nonce,
				bidderPublicKey: policy.bidderPublicKey,
				committeePublicKey: policy.committeePublicKey,
				locktime: policy.locktime,
				refundPublicKey,
			})
		} catch (error) {
			return refuse('DEMO_FROST_POLICY_PROOF', error instanceof Error ? error.message : 'invalid committee-locked proof')
		}
		if (rebuilt !== proof.secret) {
			refuse('DEMO_FROST_POLICY_PROOF', `committeeLockedProofs[${index}] is not the exact bidder-plus-committee SIG_ALL lock`)
		}
	}
	return demoCashuSigAllDigest(policy.committeeLockedProofs, policy.outputs)
}

/**
 * Run inside one participant process before it creates a FROST round-one nonce commitment.
 */
export async function validateDemoFrostParticipantPolicy(options: {
	policy: DemoFrostParticipantPolicyPackage
	expectedPackageDigest: string
	expectedCashuSigAllDigest: string
	ports: DemoFrostParticipantPolicyPorts
}): Promise<DemoFrostParticipantPolicyEvidence> {
	const policy = cloneDemoFrostParticipantPolicy(options.policy)
	const policyPackageDigest = demoFrostParticipantPolicyDigest(policy)
	if (policy.packageDigest !== options.expectedPackageDigest) {
		refuse('DEMO_FROST_POLICY_PACKAGE_DIGEST', 'caller package digest differs from the immutable participant policy')
	}
	if (policy.cashuSigAllDigest !== options.expectedCashuSigAllDigest) {
		refuse('DEMO_FROST_POLICY_CALLER_DIGEST', 'caller-supplied Cashu digest differs from the immutable participant policy')
	}
	validateValuePolicy(policy)
	verifyActorAuthorization(policy)
	verifyRecipientCapability(policy)
	const derivedCashuSigAllDigest = validateCommitteeLockedProofs(policy)
	if (derivedCashuSigAllDigest !== policy.cashuSigAllDigest
		|| derivedCashuSigAllDigest !== options.expectedCashuSigAllDigest) {
		refuse('DEMO_FROST_POLICY_DERIVED_DIGEST', 'participant-derived Cashu digest differs from the policy or caller digest')
	}
	let closure: DemoFrostVerifiedClosureDisposition
	let bid: DemoFrostVerifiedSignedBid
	try {
		;[closure, bid] = await Promise.all([
			options.ports.closureVerifier.verifyAndDerive(structuredClone(policy.certifiedClosure.evidence)),
			options.ports.signedBidVerifier.verifyAndDerive(structuredClone(policy.signedBid.evidence)),
		])
	} catch (error) {
		if (error instanceof DemoFrostParticipantPolicyRefusedError) throw error
		return refuse('DEMO_FROST_POLICY_EVIDENCE_AUTHENTICATION', error instanceof Error ? error.message : 'closure or signed-bid verification failed')
	}
	assertExactClosure(policy, closure)
	assertExactVerifiedBid(policy, bid)
	try {
		await options.ports.proofUse.assertExclusive({
			network: policy.network,
			chainId: policy.chainId,
			mintUrl: policy.mintUrl,
			unit: policy.unit,
			activeKeysetId: policy.activeKeysetId,
			auctionId: policy.auctionId,
			operationId: policy.operationId,
			bidId: policy.bidId,
			policyPackageDigest,
			proofStateRefs: policy.deposits.map((deposit) => deposit.proofStateRef),
		})
	} catch (error) {
		if (error instanceof DemoFrostParticipantPolicyRefusedError) throw error
		return refuse('DEMO_FROST_POLICY_PROOF_REUSE', error instanceof Error ? error.message : 'deposit proof exclusivity failed')
	}
	return {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1',
		policyPackageDigest,
		closureEvidenceDigest: closure.evidenceDigest,
		signedBidEvidenceDigest: bid.evidenceDigest,
		committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
		authenticatedPackageDigest: policy.packageDigest,
		derivedCashuSigAllDigest,
	}
}
