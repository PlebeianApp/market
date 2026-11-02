/** Exact TypeScript contract for the distinct FundingAbortV1 FROST domain. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayFundingAbortCommitteeDigest,
	type DemoFridayFundingAbortCertificateV1,
} from './demo-friday-funding-pool-lifecycle'

export const DEMO_FROST_FUNDING_ABORT_VERSION = 'COCO_DEMO_FROST_FUNDING_ABORT_3OF4_V1' as const
const AUTH_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_FUNDING_ABORT_AUTH_V1')
const ROOT_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_FUNDING_ABORT_OPERATION_ROOT_V1')
const TRANSCRIPT_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_FUNDING_ABORT_TRANSCRIPT_V1')
const HEX_32 = /^[0-9a-f]{64}$/
const COMPRESSED = /^(?:02|03)[0-9a-f]{64}$/
type ParticipantId = 1 | 2 | 3 | 4

export type DemoFridayFundingAbortCommitteeUnsignedV1 = Omit<DemoFridayFundingAbortCertificateV1,
	'committeeAbortSignature'>

export interface DemoFundingAbortParticipantEvidenceV1 {
	schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1'
	participantId: ParticipantId
	operationId: string
	poolDigest: string
	proofYsDigest: string
	activeKeysetId: string
	returnPackageDigest: string
	returnCashuSigAllDigest: string
	mintEvidenceDigest: string
	consensusEvidenceDigest: string
	evidenceDigest: string
}

export interface DemoFrostFundingAbortAuthorizationV1 {
	version: typeof DEMO_FROST_FUNDING_ABORT_VERSION
	dkg_run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	public_key_package_sha256: string
	signer_roster_digest: string
	committee_public_key: string
	operation_id: string
	operation_root: string
	session_id: string
	committee_unsigned_hex: string
	committee_unsigned_sha256: string
	committee_digest: string
	participant_policy_digest: string
	valid_from: number
	valid_until: number
	roster: [1, 2, 3, 4]
	threshold: 3
}

export interface DemoFrostFundingAbortCommitmentV1 {
	version: typeof DEMO_FROST_FUNDING_ABORT_VERSION
	operation_id: string
	session_id: string
	authorization_digest: string
	participant_id: ParticipantId
	durable_binding: {
		version: typeof DEMO_FROST_FUNDING_ABORT_VERSION
		participant_id: ParticipantId
		dkg_run_id: string
		public_key_package_sha256: string
		signer_roster_digest: string
		state_directory_identity: string
		journal_generation: string
		restart_epoch: number
	}
	hiding_hex: string
	binding_hex: string
}

export interface DemoFrostFundingAbortShareV1 {
	version: typeof DEMO_FROST_FUNDING_ABORT_VERSION
	operation_id: string
	session_id: string
	authorization_digest: string
	commitments_digest: string
	participant_id: ParticipantId
	durable_binding: DemoFrostFundingAbortCommitmentV1['durable_binding']
	share_hex: string
}

export interface DemoFrostFundingAbortAggregateV1 {
	version: typeof DEMO_FROST_FUNDING_ABORT_VERSION
	operation_id: string
	operation_root: string
	session_id: string
	authorization_digest: string
	commitments_digest: string
	committee_digest: string
	participant_policy_digest: string
	signer_roster_digest: string
	participant_ids: ParticipantId[]
	signature_hex: string
}

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error('DEMO_FROST_ABORT_CANONICAL: invalid integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') throw new Error('DEMO_FROST_ABORT_CANONICAL: unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function frame(value: Uint8Array): Uint8Array {
	const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, value.length, false)
	return concatBytes(length, value)
}
function u64(value: number): Uint8Array {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('DEMO_FROST_ABORT_INTEGER: invalid u64')
	const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false); return bytes
}
function u16(value: number): Uint8Array {
	const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, false); return bytes
}
function hash(value: Uint8Array | string): string {
	return bytesToHex(sha256(typeof value === 'string' ? utf8ToBytes(value) : value))
}
function canonicalEvidence(value: DemoFundingAbortParticipantEvidenceV1[]): DemoFundingAbortParticipantEvidenceV1[] {
	const result = structuredClone(value).sort((left, right) => left.participantId - right.participantId)
	if (result.length !== 3 || new Set(result.map(({ participantId }) => participantId)).size !== 3
		|| result.some(({ participantId }) => ![1, 2, 3, 4].includes(participantId))) {
		throw new Error('DEMO_FROST_ABORT_POLICY: exact three-participant evidence required')
	}
	for (const evidence of result) {
		for (const digest of [evidence.poolDigest, evidence.proofYsDigest, evidence.returnPackageDigest,
			evidence.returnCashuSigAllDigest, evidence.mintEvidenceDigest, evidence.consensusEvidenceDigest,
			evidence.evidenceDigest]) if (!HEX_32.test(digest)) throw new Error('DEMO_FROST_ABORT_POLICY: malformed evidence digest')
	}
	return result
}

export function demoFrostFundingAbortParticipantPolicyDigest(value: DemoFundingAbortParticipantEvidenceV1[]): string {
	return hash(canonical(['COCO_DEMO_FROST_FUNDING_ABORT_PARTICIPANT_POLICY_V1', canonicalEvidence(value)]))
}

function root(value: Omit<DemoFrostFundingAbortAuthorizationV1, 'operation_root' | 'session_id'>): string {
	const fields = [value.dkg_run_id, value.committee_keyset_id, value.committee_keyset_version,
		value.public_key_package_sha256, value.signer_roster_digest, value.committee_public_key,
		value.operation_id, value.committee_unsigned_sha256, value.committee_digest, value.participant_policy_digest]
	return hash(concatBytes(ROOT_CONTEXT, ...fields.map((field) => frame(utf8ToBytes(field))),
		u64(value.valid_from), u64(value.valid_until), ...value.roster.map(u16), u16(value.threshold)))
}

export function demoFrostFundingAbortAuthorization(input: {
	committeeUnsigned: DemoFridayFundingAbortCommitteeUnsignedV1
	participantEvidence: [DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1,
		DemoFundingAbortParticipantEvidenceV1]
	sessionId: string
}): DemoFrostFundingAbortAuthorizationV1 {
	const unsigned = structuredClone(input.committeeUnsigned)
	const policy = demoFrostFundingAbortParticipantPolicyDigest(input.participantEvidence)
	if (unsigned.participantPolicyDigest !== policy || !HEX_32.test(input.sessionId)
		|| !COMPRESSED.test(unsigned.committeePublicKey)) {
		throw new Error('DEMO_FROST_ABORT_AUTHORIZATION: policy, session, or committee key differs')
	}
	const canonicalUnsigned = canonical(unsigned)
	const base = {
		version: DEMO_FROST_FUNDING_ABORT_VERSION,
		dkg_run_id: unsigned.dkgRunId, committee_keyset_id: unsigned.committeeKeysetId,
		committee_keyset_version: unsigned.committeeKeysetVersion,
		public_key_package_sha256: unsigned.publicKeyPackageSha256,
		signer_roster_digest: unsigned.signerRosterDigest, committee_public_key: unsigned.committeePublicKey,
		operation_id: unsigned.operationId, committee_unsigned_hex: bytesToHex(utf8ToBytes(canonicalUnsigned)),
		committee_unsigned_sha256: hash(canonicalUnsigned), committee_digest: demoFridayFundingAbortCommitteeDigest(unsigned),
		participant_policy_digest: policy, valid_from: unsigned.abortNotBefore, valid_until: unsigned.abortExpiresAt,
		roster: [1, 2, 3, 4] as [1, 2, 3, 4], threshold: 3 as const,
	}
	return { ...base, operation_root: root(base), session_id: input.sessionId }
}

export function demoFrostFundingAbortAuthorizationDigest(value: DemoFrostFundingAbortAuthorizationV1): string {
	const fields = [value.dkg_run_id, value.committee_keyset_id, value.committee_keyset_version,
		value.public_key_package_sha256, value.signer_roster_digest, value.committee_public_key,
		value.operation_id, value.operation_root, value.session_id, value.committee_unsigned_sha256,
		value.committee_digest, value.participant_policy_digest]
	return hash(concatBytes(AUTH_CONTEXT, ...fields.map((field) => frame(utf8ToBytes(field))),
		u64(value.valid_from), u64(value.valid_until), ...value.roster.map(u16), u16(value.threshold)))
}

export function demoFrostFundingAbortTranscriptDigest(
	authorizationDigest: string,
	commitments: DemoFrostFundingAbortCommitmentV1[],
): string {
	if (!HEX_32.test(authorizationDigest)) throw new Error('DEMO_FROST_ABORT_TRANSCRIPT: authorization digest malformed')
	const sorted = structuredClone(commitments).sort((left, right) => left.participant_id - right.participant_id)
	return hash(concatBytes(TRANSCRIPT_CONTEXT, hexToBytes(authorizationDigest), ...sorted.flatMap((entry) => [
		u16(entry.participant_id), frame(utf8ToBytes(entry.hiding_hex)), frame(utf8ToBytes(entry.binding_hex)),
	])))
}
