/**
 * Create-once R18 abort/seal primitives for the fixed R20 recovery profile.
 *
 * This module never generates identities and never exports private material.
 * The executable wrapper fixes every production path; the root parameter on
 * the durable writer exists only so its fail-closed filesystem behavior can
 * be exercised with disposable directories.
 */
import { constants } from 'node:fs'
import { mkdir, open, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgManifestDigest,
	exactDemoFridayDkgManifest,
	exactDemoFridayLocalTransportSecrets,
	type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA,
	DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA,
	demoFridayR18AbortAcknowledgementDigest,
	demoFridayR18AbortDigest,
	exactDemoFridayR18AbortRecord,
	verifyDemoFridayR20FreshDkgProfile,
	type DemoFridayR18AbortAcknowledgementV1,
	type DemoFridayR18AbortRecordV1,
} from './demo-friday-r20-fresh-profile'

const HEX_32 = /^[0-9a-f]{64}$/
const R18_DEPLOYMENT = 'friday-demo-20261023-r14'
const R18_APPLICATION_RUN = 'friday-demo-20261023-r14-run1'
const R18_DKG_RUN = 'friday-demo-20261023-r14-dkg1'
const R18_KEYSET = 'friday-demo-frost-keyset-v1'
const R18_KEYSET_VERSION = '1'
export const DEMO_FRIDAY_R18_ABORT_EVIDENCE_SCHEMA = 'PLEBEIAN_FRIDAY_R18_ABORT_EVIDENCE_V1' as const
export const DEMO_FRIDAY_R18_ABORT_SEAL_SCHEMA = 'PLEBEIAN_FRIDAY_R18_ABORT_SEAL_V1' as const

export const DEMO_FRIDAY_R18_ROOT = '/var/lib/plebeian-auctions-friday/frost/keyset-v1' as const
export const DEMO_FRIDAY_R20_ABORT_OPERATOR_ROOT = '/var/lib/plebeian-auctions-friday-operator/dkg-r20' as const
export const DEMO_FRIDAY_R18_ABORT_RECORD_ROOT = `${DEMO_FRIDAY_R20_ABORT_OPERATOR_ROOT}/predecessor-abort` as const
export const DEMO_FRIDAY_R18_HOST_ABORT_ROOT = DEMO_FRIDAY_R18_ROOT

export interface DemoFridayR18AbortEvidenceV1 {
	schema: typeof DEMO_FRIDAY_R18_ABORT_EVIDENCE_SCHEMA
	predecessorManifestDigest: string
	persistTransportReceiptDigests: [string, string, string, string]
	slot1DeadProcessIdentityDigest: string
	slot1LockMetadataDigest: string
	slot1JournalMetadataDigest: string
	slot1StateObservationDigest: string
	serviceSealDigest: string
}

export interface DemoFridayR18AbortSealV1 {
	schema: typeof DEMO_FRIDAY_R18_ABORT_SEAL_SCHEMA
	abortDigest: string
	predecessorManifestDigest: string
	participantId: 1 | 2 | 3 | 4
	dkgIdentity: string
	acknowledgementDigest: string
	status: 'ABORTED_R18_NO_REPLAY'
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R20_ABORT: ${message}`) }

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function exactHex(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HEX_32.test(value)) fail(`${label} is not canonical SHA-256 hex`)
	return value
}

function exactPredecessor(value: unknown): DemoFridayDkgPublicManifestV1 {
	const manifest = exactDemoFridayDkgManifest(value)
	if (manifest.deploymentId !== R18_DEPLOYMENT || manifest.applicationRunId !== R18_APPLICATION_RUN
		|| manifest.dkgRunId !== R18_DKG_RUN || manifest.committeeKeysetId !== R18_KEYSET
		|| manifest.committeeKeysetVersion !== R18_KEYSET_VERSION) fail('predecessor is not the exact stopped R18 run')
	return manifest
}

function exactEvidence(value: unknown, manifestDigest: string): DemoFridayR18AbortEvidenceV1 {
	const raw = exactObject(value, [
		'schema', 'predecessorManifestDigest', 'persistTransportReceiptDigests',
		'slot1DeadProcessIdentityDigest', 'slot1LockMetadataDigest', 'slot1JournalMetadataDigest',
		'slot1StateObservationDigest', 'serviceSealDigest',
	], 'abort evidence')
	if (raw.schema !== DEMO_FRIDAY_R18_ABORT_EVIDENCE_SCHEMA
		|| raw.predecessorManifestDigest !== manifestDigest
		|| !Array.isArray(raw.persistTransportReceiptDigests)
		|| raw.persistTransportReceiptDigests.length !== 4) fail('abort evidence profile differs')
	return {
		schema: DEMO_FRIDAY_R18_ABORT_EVIDENCE_SCHEMA,
		predecessorManifestDigest: manifestDigest,
		persistTransportReceiptDigests: raw.persistTransportReceiptDigests.map((entry, index) =>
			exactHex(entry, `persistTransportReceiptDigests[${index}]`)) as [string, string, string, string],
		slot1DeadProcessIdentityDigest: exactHex(raw.slot1DeadProcessIdentityDigest, 'slot1DeadProcessIdentityDigest'),
		slot1LockMetadataDigest: exactHex(raw.slot1LockMetadataDigest, 'slot1LockMetadataDigest'),
		slot1JournalMetadataDigest: exactHex(raw.slot1JournalMetadataDigest, 'slot1JournalMetadataDigest'),
		slot1StateObservationDigest: exactHex(raw.slot1StateObservationDigest, 'slot1StateObservationDigest'),
		serviceSealDigest: exactHex(raw.serviceSealDigest, 'serviceSealDigest'),
	}
}

export function composeDemoFridayR18AbortRecord(options: {
	predecessorManifest: unknown
	evidence: unknown
	expectedManifestDigest: string
	expectedAbortDigest: string
}): { record: DemoFridayR18AbortRecordV1; abortDigest: string } {
	const manifest = exactPredecessor(options.predecessorManifest)
	const manifestDigest = demoFridayDkgManifestDigest(manifest)
	if (manifestDigest !== exactHex(options.expectedManifestDigest, 'expectedManifestDigest')) {
		fail('predecessor manifest differs from the independent pin')
	}
	const evidence = exactEvidence(options.evidence, manifestDigest)
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest: manifest, record: {
		schema: DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		predecessorManifestDigest: manifestDigest, predecessorDeploymentId: manifest.deploymentId,
		predecessorApplicationRunId: manifest.applicationRunId, predecessorDkgRunId: manifest.dkgRunId,
		predecessorCommitteeKeysetId: manifest.committeeKeysetId,
		predecessorCommitteeKeysetVersion: manifest.committeeKeysetVersion,
		persistTransportReceiptDigests: evidence.persistTransportReceiptDigests,
		slot1DeadProcessIdentityDigest: evidence.slot1DeadProcessIdentityDigest,
		slot1LockMetadataDigest: evidence.slot1LockMetadataDigest,
		slot1JournalMetadataDigest: evidence.slot1JournalMetadataDigest,
		slot1StateObservationDigest: evidence.slot1StateObservationDigest,
		serviceSealDigest: evidence.serviceSealDigest, abortReason: 'ROUND1_OUTCOME_INDETERMINATE',
	} })
	const abortDigest = demoFridayR18AbortDigest(record)
	if (abortDigest !== exactHex(options.expectedAbortDigest, 'expectedAbortDigest')) {
		fail('abort record differs from the independent owner pin')
	}
	return { record, abortDigest }
}

export function createDemoFridayR18AbortAcknowledgement(options: {
	predecessorManifest: unknown
	abortRecord: unknown
	expectedAbortDigest: string
	participantId: 1 | 2 | 3 | 4
	localTransportSecrets: unknown
}): { acknowledgement: DemoFridayR18AbortAcknowledgementV1; seal: DemoFridayR18AbortSealV1 } {
	const manifest = exactPredecessor(options.predecessorManifest)
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest: manifest, record: options.abortRecord })
	const abortDigest = demoFridayR18AbortDigest(record)
	if (abortDigest !== exactHex(options.expectedAbortDigest, 'expectedAbortDigest')) fail('abort digest differs')
	const transport = exactDemoFridayLocalTransportSecrets(manifest, options.localTransportSecrets)
	if (transport.participant_id !== options.participantId) fail('local transport identity belongs to another slot')
	const privateKey = hexToBytes(transport.identity_signing_key_hex)
	try {
		const dkgIdentity = bytesToHex(schnorr.getPublicKey(privateKey))
		const digest = demoFridayR18AbortAcknowledgementDigest({
			abortDigest, participantId: options.participantId, dkgIdentity,
		})
		const acknowledgement: DemoFridayR18AbortAcknowledgementV1 = {
			schema: DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA, abortDigest,
			participantId: options.participantId, dkgIdentity,
			signature: bytesToHex(schnorr.sign(hexToBytes(digest), privateKey)),
		}
		const acknowledgementDigest = bytesToHex(sha256(utf8ToBytes(`${JSON.stringify(acknowledgement)}\n`)))
		return { acknowledgement, seal: {
			schema: DEMO_FRIDAY_R18_ABORT_SEAL_SCHEMA, abortDigest,
			predecessorManifestDigest: record.predecessorManifestDigest,
			participantId: options.participantId, dkgIdentity, acknowledgementDigest,
			status: 'ABORTED_R18_NO_REPLAY',
		} }
	} finally { privateKey.fill(0) }
}

/** Verify the completed public record before any R20 tool accepts it. */
export function verifyDemoFridayR18AbortSealBundle(options: {
	predecessorManifest: unknown
	abortRecord: unknown
	acknowledgements: unknown
	expectedAbortDigest: string
}): void {
	verifyDemoFridayR20FreshDkgProfile({
		predecessorManifest: options.predecessorManifest, abortRecord: options.abortRecord,
		acknowledgements: options.acknowledgements,
		expectedPredecessorAbortDigest: options.expectedAbortDigest,
	})
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try { await handle.sync() } finally { await handle.close() }
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
	try { await handle.writeFile(bytes); await handle.sync(); await handle.chmod(0o600) } finally { await handle.close() }
}

/**
 * Durable directory bundle: any existing destination or staging directory is
 * a hard refusal. A crash leaves evidence in place and cannot silently replay.
 */
export async function writeDemoFridayAbortBundleCreateOnce(options: {
	parent: string
	name: string
	files: Readonly<Record<string, unknown>>
}): Promise<void> {
	if (!options.parent.startsWith('/') || resolve(options.parent) !== options.parent || options.parent === '/'
		|| !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(options.name)) fail('bundle destination is not canonical')
	const parent = await realpath(options.parent)
	if (parent !== options.parent) fail('bundle parent is not canonical')
	const parentStat = await stat(parent)
	if (!parentStat.isDirectory() || (parentStat.mode & 0o022) !== 0) fail('bundle parent is writable by an untrusted group or user')
	const target = join(parent, options.name)
	await mkdir(target, { mode: 0o700 })
	await syncDirectory(parent)
	try {
		const entries = Object.entries(options.files).sort(([left], [right]) => left.localeCompare(right))
		if (entries.length === 0 || entries.some(([name]) => !/^[a-z0-9][a-z0-9.-]{0,63}\.json$/.test(name))) {
			fail('bundle file name is invalid')
		}
		for (const [name, value] of entries) {
			await writeExclusive(join(target, name), new TextEncoder().encode(`${JSON.stringify(value)}\n`))
		}
		await syncDirectory(target)
		await writeExclusive(join(target, 'complete.json'), new TextEncoder().encode(`${JSON.stringify({
			schema: 'PLEBEIAN_FRIDAY_R20_ABORT_BUNDLE_COMPLETE_V1', files: entries.map(([name]) => name),
		})}\n`))
		await syncDirectory(target)
		await syncDirectory(parent)
	} catch (error) {
		// Preserve any partial target. A later attempt sees the exclusive directory
		// and refuses rather than replaying after an uncertain crash.
		throw error
	}
}
