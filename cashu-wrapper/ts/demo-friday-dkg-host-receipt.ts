import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { type DemoFridayDkgPublicManifestV1 } from './demo-friday-per-validator-dkg-bootstrap'

const IDS = [1, 2, 3, 4] as const
export type DemoFridayDkgReceiptParticipantId = typeof IDS[number]
export const DEMO_FRIDAY_DKG_HOST_RECEIPT_SCHEMA = 'PLEBEIAN_FRIDAY_DKG_HOST_STAGE_RECEIPT_V2' as const
export const DEMO_FRIDAY_DKG_HOST_RECEIPT_DOMAIN = 'PLEBEIAN_FRIDAY_DKG_HOST_STAGE_RECEIPT_SIGNATURE_V2' as const
const STAGES = [
	'enroll', 'confirm-transport', 'persist-transport', 'round1', 'round1-agree',
	'round2', 'finalize', 'inspect', 'attest',
] as const
export type DemoFridayDkgReceiptStage = typeof STAGES[number]
export type DemoFridayDkgReceiptStatus = 'completed' | 'already_completed' | 'lock_recovered'
const STATUSES = ['completed', 'already_completed', 'lock_recovered'] as const
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

export interface DemoFridayDkgAuthenticatedHostReceiptV2 {
	schema: typeof DEMO_FRIDAY_DKG_HOST_RECEIPT_SCHEMA
	manifestDigest: string
	participantId: DemoFridayDkgReceiptParticipantId
	stage: DemoFridayDkgReceiptStage
	status: DemoFridayDkgReceiptStatus
	evidenceDigest: string
	dkgIdentity: string
	signature: string
}

function fail(message: string): never {
	throw new Error(`FRIDAY_DKG_HOST_RECEIPT: ${message}`)
}

function exactObject(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
			'schema', 'manifestDigest', 'participantId', 'stage', 'status', 'evidenceDigest', 'dkgIdentity', 'signature',
		].sort())) fail('receipt has missing or unexpected fields')
	return value as Record<string, unknown>
}

function exactParticipant(value: unknown): DemoFridayDkgReceiptParticipantId {
	if (!Number.isInteger(value) || !IDS.includes(value as DemoFridayDkgReceiptParticipantId)) fail('participant is invalid')
	return value as DemoFridayDkgReceiptParticipantId
}

function exactStage(value: unknown): DemoFridayDkgReceiptStage {
	if (typeof value !== 'string' || !STAGES.includes(value as DemoFridayDkgReceiptStage)) fail('stage is invalid')
	return value as DemoFridayDkgReceiptStage
}

function exactStatus(value: unknown): DemoFridayDkgReceiptStatus {
	if (typeof value !== 'string' || !STATUSES.includes(value as DemoFridayDkgReceiptStatus)) fail('status is invalid')
	return value as DemoFridayDkgReceiptStatus
}

function unsignedReceipt(value: unknown): Omit<DemoFridayDkgAuthenticatedHostReceiptV2, 'signature'> {
	const raw = exactObject(value)
	const participantId = exactParticipant(raw.participantId)
	if (raw.schema !== DEMO_FRIDAY_DKG_HOST_RECEIPT_SCHEMA
		|| typeof raw.manifestDigest !== 'string' || !HEX_32.test(raw.manifestDigest)
		|| typeof raw.evidenceDigest !== 'string' || !HEX_32.test(raw.evidenceDigest)
		|| typeof raw.dkgIdentity !== 'string' || !HEX_32.test(raw.dkgIdentity)) fail('receipt binding is invalid')
	return {
		schema: DEMO_FRIDAY_DKG_HOST_RECEIPT_SCHEMA,
		manifestDigest: raw.manifestDigest,
		participantId,
		stage: exactStage(raw.stage),
		status: exactStatus(raw.status),
		evidenceDigest: raw.evidenceDigest,
		dkgIdentity: raw.dkgIdentity,
	}
}

function messageDigest(value: Omit<DemoFridayDkgAuthenticatedHostReceiptV2, 'signature'>): Uint8Array {
	return sha256(utf8ToBytes(JSON.stringify([
		DEMO_FRIDAY_DKG_HOST_RECEIPT_DOMAIN,
		value.schema, value.manifestDigest, value.participantId, value.stage,
		value.status, value.evidenceDigest, value.dkgIdentity,
	])))
}

export function createDemoFridayDkgAuthenticatedHostReceiptV2(options: {
	manifestDigest: string
	participantId: DemoFridayDkgReceiptParticipantId
	stage: DemoFridayDkgReceiptStage
	status: DemoFridayDkgReceiptStatus
	evidenceDigest: string
	dkgIdentityPrivateKey: Uint8Array
}): DemoFridayDkgAuthenticatedHostReceiptV2 {
	if (!HEX_32.test(options.manifestDigest) || !HEX_32.test(options.evidenceDigest)
		|| options.dkgIdentityPrivateKey.length !== 32) fail('receipt creation input is invalid')
	const dkgIdentity = bytesToHex(schnorr.getPublicKey(options.dkgIdentityPrivateKey))
	const unsigned = unsignedReceipt({
		schema: DEMO_FRIDAY_DKG_HOST_RECEIPT_SCHEMA,
		manifestDigest: options.manifestDigest,
		participantId: options.participantId,
		stage: options.stage,
		status: options.status,
		evidenceDigest: options.evidenceDigest,
		dkgIdentity,
		signature: '0'.repeat(128),
	})
	const digest = messageDigest(unsigned)
	return {
		...unsigned,
		signature: bytesToHex(schnorr.sign(
			digest, options.dkgIdentityPrivateKey,
			sha256(utf8ToBytes(JSON.stringify([`${DEMO_FRIDAY_DKG_HOST_RECEIPT_DOMAIN}_AUX`, bytesToHex(digest)]))),
		)),
	}
}

export function verifyDemoFridayDkgAuthenticatedHostReceiptV2(options: {
	receipt: unknown
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	expectedParticipantId: DemoFridayDkgReceiptParticipantId
	expectedStage: DemoFridayDkgReceiptStage
	expectedStatus?: DemoFridayDkgReceiptStatus
}): DemoFridayDkgAuthenticatedHostReceiptV2 {
	const raw = exactObject(options.receipt)
	if (typeof raw.signature !== 'string' || !HEX_64.test(raw.signature)) fail('receipt signature is invalid')
	const unsigned = unsignedReceipt(raw)
	const expectedIdentity = options.manifest.participants[options.expectedParticipantId - 1]?.dkgIdentity
	if (unsigned.manifestDigest !== options.expectedManifestDigest
		|| unsigned.participantId !== options.expectedParticipantId
		|| unsigned.stage !== options.expectedStage
		|| options.expectedStatus && unsigned.status !== options.expectedStatus
		|| unsigned.dkgIdentity !== expectedIdentity) fail('receipt does not match the pinned host, manifest or stage')
	if (!schnorr.verify(hexToBytes(raw.signature), messageDigest(unsigned), hexToBytes(unsigned.dkgIdentity))) {
		fail('receipt DKG identity signature is invalid')
	}
	return { ...unsigned, signature: raw.signature }
}

