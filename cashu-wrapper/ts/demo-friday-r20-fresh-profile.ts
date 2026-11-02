/**
 * Pure, inert R20 DKG profile boundary.
 *
 * This module creates no files, identities, locks, processes, or network
 * connections.  It verifies that a separately created predecessor-abort
 * record was acknowledged by all four R18 DKG identities, then exposes the
 * sole allowed fresh-run layout.  The actual abort installation and the
 * fresh per-host enrollment remain separately reviewed operations.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgManifestDigest,
	exactDemoFridayDkgManifest,
	type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const PARTICIPANTS = [1, 2, 3, 4] as const

export const DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA = 'PLEBEIAN_FRIDAY_DKG_ABORT_RECORD_V1' as const
export const DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA = 'PLEBEIAN_FRIDAY_DKG_ABORT_ACKNOWLEDGEMENT_V1' as const
export const DEMO_FRIDAY_R20_PROFILE_SCHEMA = 'PLEBEIAN_FRIDAY_FRESH_DKG_PROFILE_V2' as const

export const DEMO_FRIDAY_R20_DEPLOYMENT_ID = 'friday-demo-20261023-r20' as const
export const DEMO_FRIDAY_R20_APPLICATION_RUN_ID = 'friday-demo-20261023-r20-run1' as const
export const DEMO_FRIDAY_R20_DKG_RUN_ID = 'friday-demo-20261023-r20-dkg2' as const
export const DEMO_FRIDAY_R20_KEYSET_ID = 'friday-demo-frost-keyset-v2' as const
export const DEMO_FRIDAY_R20_KEYSET_VERSION = '2' as const
export const DEMO_FRIDAY_R20_FRESH_PARENT = '/var/lib/plebeian-auctions-friday/frost-v2' as const
export const DEMO_FRIDAY_R20_KEYSET_ROOT = `${DEMO_FRIDAY_R20_FRESH_PARENT}/keyset-v2` as const
export const DEMO_FRIDAY_R20_INPUT_ROOT = `${DEMO_FRIDAY_R20_FRESH_PARENT}/r20-inputs` as const
export const DEMO_FRIDAY_R20_MANIFEST_PATH = `${DEMO_FRIDAY_R20_KEYSET_ROOT}/manifest.json` as const
export const DEMO_FRIDAY_R20_MANIFEST_DIGEST_PATH =
	`${DEMO_FRIDAY_R20_KEYSET_ROOT}/owner-approved-manifest-digest.txt` as const
export const DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH =
	`${DEMO_FRIDAY_R20_INPUT_ROOT}/predecessor-manifest.json` as const
export const DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH =
	`${DEMO_FRIDAY_R20_INPUT_ROOT}/bound-manifest.json` as const
export const DEMO_FRIDAY_R20_COORDINATOR_ROOT = '/var/lib/plebeian-auctions-friday/coordinator-v2' as const
export const DEMO_FRIDAY_R20_OPERATOR_ROOT = '/var/lib/plebeian-auctions-friday-operator/dkg-r20' as const

export interface DemoFridayR18AbortRecordV1 {
	schema: typeof DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	predecessorManifestDigest: string
	predecessorDeploymentId: string
	predecessorApplicationRunId: string
	predecessorDkgRunId: string
	predecessorCommitteeKeysetId: string
	predecessorCommitteeKeysetVersion: string
	persistTransportReceiptDigests: readonly [string, string, string, string]
	slot1DeadProcessIdentityDigest: string
	slot1LockMetadataDigest: string
	slot1JournalMetadataDigest: string
	slot1StateObservationDigest: string
	serviceSealDigest: string
	abortReason: 'ROUND1_OUTCOME_INDETERMINATE'
}

export interface DemoFridayR18AbortAcknowledgementV1 {
	schema: typeof DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA
	abortDigest: string
	participantId: 1 | 2 | 3 | 4
	dkgIdentity: string
	signature: string
}

export interface DemoFridayR20FreshDkgProfileV2 {
	schema: typeof DEMO_FRIDAY_R20_PROFILE_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	deploymentId: typeof DEMO_FRIDAY_R20_DEPLOYMENT_ID
	applicationRunId: typeof DEMO_FRIDAY_R20_APPLICATION_RUN_ID
	dkgRunId: typeof DEMO_FRIDAY_R20_DKG_RUN_ID
	committeeKeysetId: typeof DEMO_FRIDAY_R20_KEYSET_ID
	committeeKeysetVersion: typeof DEMO_FRIDAY_R20_KEYSET_VERSION
	keysetRoot: typeof DEMO_FRIDAY_R20_KEYSET_ROOT
	configPath: `${typeof DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`
	transportSecretsPath: `${typeof DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`
	stateDirectory: `${typeof DEMO_FRIDAY_R20_KEYSET_ROOT}/state`
	exchangeDirectory: `${typeof DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${typeof DEMO_FRIDAY_R20_DKG_RUN_ID}`
	coordinatorRoot: typeof DEMO_FRIDAY_R20_COORDINATOR_ROOT
	operatorRoot: typeof DEMO_FRIDAY_R20_OPERATOR_ROOT
	predecessorManifestDigest: string
	predecessorAbortDigest: string
	abortAcknowledgementsDigest: string
}

function fail(message: string): never {
	throw new Error(`DEMO_FRIDAY_R20_PROFILE: ${message}`)
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function exactHex32(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HEX_32.test(value)) fail(`${label} must be canonical 32-byte hex`)
	return value
}

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([domain, ...fields]))))
}

export function exactDemoFridayR18AbortRecord(options: {
	predecessorManifest: unknown
	record: unknown
}): DemoFridayR18AbortRecordV1 {
	const manifest = exactDemoFridayDkgManifest(options.predecessorManifest)
	const raw = exactObject(options.record, [
		'schema', 'valueProfile', 'predecessorManifestDigest', 'predecessorDeploymentId',
		'predecessorApplicationRunId', 'predecessorDkgRunId', 'predecessorCommitteeKeysetId',
		'predecessorCommitteeKeysetVersion', 'persistTransportReceiptDigests',
		'slot1DeadProcessIdentityDigest', 'slot1LockMetadataDigest', 'slot1JournalMetadataDigest',
		'slot1StateObservationDigest', 'serviceSealDigest', 'abortReason',
	], 'abort record')
	if (raw.schema !== DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| raw.abortReason !== 'ROUND1_OUTCOME_INDETERMINATE') fail('abort record profile is invalid')
	const predecessorManifestDigest = exactHex32(raw.predecessorManifestDigest, 'predecessorManifestDigest')
	if (predecessorManifestDigest !== demoFridayDkgManifestDigest(manifest)
		|| raw.predecessorDeploymentId !== manifest.deploymentId
		|| raw.predecessorApplicationRunId !== manifest.applicationRunId
		|| raw.predecessorDkgRunId !== manifest.dkgRunId
		|| raw.predecessorCommitteeKeysetId !== manifest.committeeKeysetId
		|| raw.predecessorCommitteeKeysetVersion !== manifest.committeeKeysetVersion) {
		fail('abort record differs from the exact predecessor manifest')
	}
	if (!Array.isArray(raw.persistTransportReceiptDigests)
		|| raw.persistTransportReceiptDigests.length !== 4) fail('abort record requires four persist-transport receipts')
	const persistTransportReceiptDigests = raw.persistTransportReceiptDigests.map((value, index) =>
		exactHex32(value, `persistTransportReceiptDigests[${index}]`)) as [string, string, string, string]
	const result: DemoFridayR18AbortRecordV1 = {
		schema: DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		predecessorManifestDigest,
		predecessorDeploymentId: manifest.deploymentId,
		predecessorApplicationRunId: manifest.applicationRunId,
		predecessorDkgRunId: manifest.dkgRunId,
		predecessorCommitteeKeysetId: manifest.committeeKeysetId,
		predecessorCommitteeKeysetVersion: manifest.committeeKeysetVersion,
		persistTransportReceiptDigests,
		slot1DeadProcessIdentityDigest: exactHex32(raw.slot1DeadProcessIdentityDigest, 'slot1DeadProcessIdentityDigest'),
		slot1LockMetadataDigest: exactHex32(raw.slot1LockMetadataDigest, 'slot1LockMetadataDigest'),
		slot1JournalMetadataDigest: exactHex32(raw.slot1JournalMetadataDigest, 'slot1JournalMetadataDigest'),
		slot1StateObservationDigest: exactHex32(raw.slot1StateObservationDigest, 'slot1StateObservationDigest'),
		serviceSealDigest: exactHex32(raw.serviceSealDigest, 'serviceSealDigest'),
		abortReason: 'ROUND1_OUTCOME_INDETERMINATE',
	}
	return structuredClone(result)
}

export function demoFridayR18AbortDigest(record: DemoFridayR18AbortRecordV1): string {
	return digest('PLEBEIAN_FRIDAY_DKG_ABORT_RECORD_V1', [
		record.valueProfile, record.predecessorManifestDigest, record.predecessorDeploymentId,
		record.predecessorApplicationRunId, record.predecessorDkgRunId,
		record.predecessorCommitteeKeysetId, record.predecessorCommitteeKeysetVersion,
		record.persistTransportReceiptDigests, record.slot1DeadProcessIdentityDigest,
		record.slot1LockMetadataDigest, record.slot1JournalMetadataDigest,
		record.slot1StateObservationDigest, record.serviceSealDigest, record.abortReason,
	])
}

export function demoFridayR18AbortAcknowledgementDigest(options: {
	abortDigest: string
	participantId: 1 | 2 | 3 | 4
	dkgIdentity: string
}): string {
	return digest('PLEBEIAN_FRIDAY_DKG_ABORT_ACKNOWLEDGEMENT_V1', [
		exactHex32(options.abortDigest, 'abortDigest'), options.participantId,
		exactHex32(options.dkgIdentity, 'dkgIdentity'),
	])
}

function verifyAcknowledgements(options: {
	manifest: DemoFridayDkgPublicManifestV1
	abortDigest: string
	acknowledgements: unknown
}): DemoFridayR18AbortAcknowledgementV1[] {
	if (!Array.isArray(options.acknowledgements) || options.acknowledgements.length !== 4) {
		fail('exactly four abort acknowledgements are required')
	}
	const acknowledgements = options.acknowledgements
	return PARTICIPANTS.map((participantId, index) => {
		const raw = exactObject(acknowledgements[index], [
			'schema', 'abortDigest', 'participantId', 'dkgIdentity', 'signature',
		], `abort acknowledgement ${participantId}`)
		const expectedIdentity = options.manifest.participants[index]!.dkgIdentity
		if (raw.schema !== DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA || raw.abortDigest !== options.abortDigest
			|| raw.participantId !== participantId || raw.dkgIdentity !== expectedIdentity
			|| typeof raw.signature !== 'string' || !HEX_64.test(raw.signature)) {
			fail(`abort acknowledgement ${participantId} binding is invalid`)
		}
		const acknowledgementDigest = demoFridayR18AbortAcknowledgementDigest({
			abortDigest: options.abortDigest, participantId, dkgIdentity: expectedIdentity,
		})
		if (!schnorr.verify(hexToBytes(raw.signature), hexToBytes(acknowledgementDigest), hexToBytes(expectedIdentity))) {
			fail(`abort acknowledgement ${participantId} signature is invalid`)
		}
		return {
			schema: DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA, abortDigest: options.abortDigest,
			participantId, dkgIdentity: expectedIdentity, signature: raw.signature,
		}
	})
}

export function verifyDemoFridayR20FreshDkgProfile(options: {
	predecessorManifest: unknown
	abortRecord: unknown
	acknowledgements: unknown
	expectedPredecessorAbortDigest: string
}): DemoFridayR20FreshDkgProfileV2 {
	const manifest = exactDemoFridayDkgManifest(options.predecessorManifest)
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest: manifest, record: options.abortRecord })
	const abortDigest = demoFridayR18AbortDigest(record)
	if (abortDigest !== exactHex32(options.expectedPredecessorAbortDigest, 'expectedPredecessorAbortDigest')) {
		fail('abort digest differs from the independent owner pin')
	}
	const acknowledgements = verifyAcknowledgements({ manifest, abortDigest, acknowledgements: options.acknowledgements })
	const abortAcknowledgementsDigest = digest('PLEBEIAN_FRIDAY_DKG_ABORT_ACKNOWLEDGEMENT_SET_V1',
		acknowledgements.map((value) => [value.participantId, value.dkgIdentity, value.signature]))
	return Object.freeze({
		schema: DEMO_FRIDAY_R20_PROFILE_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID,
		applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
		dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID,
		committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
		committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION,
		keysetRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
		configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
		transportSecretsPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`,
		stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		exchangeDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`,
		coordinatorRoot: DEMO_FRIDAY_R20_COORDINATOR_ROOT,
		operatorRoot: DEMO_FRIDAY_R20_OPERATOR_ROOT,
		predecessorManifestDigest: record.predecessorManifestDigest,
		predecessorAbortDigest: abortDigest,
		abortAcknowledgementsDigest,
	})
}

export function assertDemoFridayR20BoundRecord(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	value: unknown
	kind: 'host-pin' | 'coordinator' | 'manifest'
}): void {
	const raw = exactObject(options.value, [
		'deploymentId', 'applicationRunId', 'dkgRunId', 'committeeKeysetId',
		'committeeKeysetVersion', 'keysetRoot', 'coordinatorRoot', 'predecessorManifestDigest',
		'predecessorAbortDigest', 'abortAcknowledgementsDigest',
	], options.kind)
	const expected: Record<string, unknown> = {
		deploymentId: options.profile.deploymentId,
		applicationRunId: options.profile.applicationRunId,
		dkgRunId: options.profile.dkgRunId,
		committeeKeysetId: options.profile.committeeKeysetId,
		committeeKeysetVersion: options.profile.committeeKeysetVersion,
		keysetRoot: options.profile.keysetRoot,
		coordinatorRoot: options.profile.coordinatorRoot,
		predecessorManifestDigest: options.profile.predecessorManifestDigest,
		predecessorAbortDigest: options.profile.predecessorAbortDigest,
		abortAcknowledgementsDigest: options.profile.abortAcknowledgementsDigest,
	}
	if (JSON.stringify(raw) !== JSON.stringify(expected)) fail(`${options.kind} differs from the exact R20 profile`)
}
