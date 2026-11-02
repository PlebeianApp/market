#!/usr/bin/env bun
/**
 * DEMO-ONLY per-validator DKG host driver.
 *
 * This executable never generates identity material and never moves artifacts
 * between hosts. It consumes one host's pre-provisioned DKG/X25519 secrets,
 * fixed public relay inputs, and the authenticated bootstrap checkpoint. Each
 * invocation advances exactly one durable phase under a create-once lock.
 */
import { constants } from 'node:fs'
import {
	chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rmdir, unlink,
	type FileHandle,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgManifestDigest,
	exactDemoFridayLocalTransportSecrets,
	verifyDemoFridayDkgRound1Transcript,
	type DemoFridayDkgEnrollmentAttestationV1,
	type DemoFridayDkgFinalPublicPackageV1,
	type DemoFridayDkgPairwiseConfirmationV1,
	type DemoFridayDkgPublicInspectionV1,
	type DemoFridayDkgPublicManifestV1,
	type DemoFridayDkgRound1AgreementBundleV1,
	type DemoFridayDkgRound1BundleV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	createDemoFridayDkgEnrollmentAttestationV2,
	createDemoFridayDkgFinalAttestationV2,
	deriveDemoFridayDkgProvisionalV2,
	exactDemoFridayDkgPinnedManifestV2,
	finalizeDemoFridayDkgTransportV2,
	verifyDemoFridayDkgEnrollmentsV2,
	type DemoFridayDkgFinalAttestationV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
	DEMO_FRIDAY_PER_VALIDATOR_BINARY,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
	demoFridayPerValidatorDkgPlan,
	type DemoFridayParticipantId,
} from './demo-friday-per-validator-dkg-plan'
import { createDemoFridayDkgAuthenticatedHostReceiptV2 } from './demo-friday-dkg-host-receipt'

const PARTICIPANTS = [1, 2, 3, 4] as const
const HEX_24 = /^[0-9a-f]{48}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_JSON_BYTES = 1024 * 1024
const MAX_CHILD_DIAGNOSTIC_BYTES = 64 * 1024

export const DEMO_FRIDAY_DKG_HOST_JOURNAL_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1' as const
export const DEMO_FRIDAY_DKG_HOST_FAILURE_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_FAILURE_V1' as const
export const DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_CONFIRMATION_BUNDLE_V1' as const
export const DEMO_FRIDAY_DKG_ENROLLMENT_BUNDLE_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_BUNDLE_V1' as const
export const DEMO_FRIDAY_DKG_HOST_LOCK_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_LOCK_V2' as const
export const DEMO_FRIDAY_PER_VALIDATOR_INSPECTOR = '/opt/plebeian-auctions-friday/bin/coco-demo-frost-public-inspect' as const

export const DEMO_FRIDAY_DKG_HOST_STAGES = [
	'enroll', 'confirm-transport', 'persist-transport', 'round1', 'round1-agree',
	'round2', 'finalize', 'inspect', 'attest',
] as const
export type DemoFridayDkgHostStage = typeof DEMO_FRIDAY_DKG_HOST_STAGES[number]
type StageStatus = 'started' | 'indeterminate' | 'completed'
type FailurePhase = 'pre_spawn_validation' | 'child_process' | 'post_spawn_verification' | 'stage_action_unknown'
type FailureClass =
	| 'spawn_refused' | 'timeout' | 'signal' | 'nonzero_exit' | 'stdout_refused'
	| 'diagnostic_overflow' | 'pre_spawn_rejected' | 'post_spawn_rejected' | 'outcome_unavailable'
type DiagnosticClass =
	| 'none' | 'usage' | 'path_missing' | 'permission_denied' | 'config_binding_invalid'
	| 'transport_binding_invalid' | 'transport_roster_invalid' | 'secret_metadata_invalid'
	| 'state_path_invalid' | 'state_conflict' | 'redacted_nonempty' | 'unavailable'

interface SanitizedChildFailure {
	failurePhase: FailurePhase
	failureClass: FailureClass
	childStarted: boolean
	exitCode: number | null
	signalCode: string | null
	timedOut: boolean
	stdoutBytes: number | null
	stderrBytes: number | null
	diagnosticClass: DiagnosticClass
}

class PinnedChildFailure extends Error {
	constructor(readonly sanitized: SanitizedChildFailure) {
		super('pinned participant child failed; diagnostic retained only as a sanitized classification')
	}
}

class ChildDiagnosticOverflow extends Error {}

interface ConfirmationBundleV1 {
	schema: typeof DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA
	manifestDigest: string
	participantId: DemoFridayParticipantId
	entries: DemoFridayDkgPairwiseConfirmationV1[]
}

interface HostJournalRecordV1 {
	schema: typeof DEMO_FRIDAY_DKG_HOST_JOURNAL_SCHEMA
	manifestDigest: string
	participantId: DemoFridayParticipantId
	stage: DemoFridayDkgHostStage
	status: StageStatus
	evidenceDigest: string | null
}

export interface DemoFridayDkgHostFilesystemProfile {
	/** Filesystem mirror of the fixed logical root. Production uses the same path. */
	filesystemRoot: string
	participantBinary: string
	inspectorBinary: string
	/** Test profiles override these; the production CLI fixes root ownership and the complete parent chain. */
	trustedBinaryOwnerUid?: number
	trustedBinaryParentRoot?: string
}

export interface DemoFridayDkgHostStageOptions {
	stage: DemoFridayDkgHostStage
	participantId: DemoFridayParticipantId
	runId: string
	/** Test seam only. The CLI always uses the fixed production profile. */
	profile?: DemoFridayDkgHostFilesystemProfile
	/** Fresh-run adapter seam; legacy CLI omits it and uses its separately installed pin file. */
	externalManifestDigest?: string
	/** Test seam only. The CLI always spawns pinned binaries. */
	runCommand?: (command: readonly string[]) => Promise<void>
	/** Test seam that runs after hashing and immediately before the mandatory pre-spawn identity recheck. */
	beforeSpawnRecheck?: () => Promise<void>
}

export interface DemoFridayDkgHostStageResult {
	stage: DemoFridayDkgHostStage
	status: 'completed' | 'already_completed'
	evidenceDigest: string
}

export interface DemoFridayDkgHostRecoveryOptions {
	participantId: DemoFridayParticipantId
	runId: string
	/** Test seam only. Production uses the fixed profile. */
	profile?: DemoFridayDkgHostFilesystemProfile
}

export interface DemoFridayDkgHostRecoveryResult {
	stage: DemoFridayDkgHostStage
	status: 'lock_recovered'
	evidenceDigest: string
}

interface HostPaths {
	root: string
	manifest: string
	manifestDigestPin: string
	config: string
	dkgIdentitySecret: string
	kexSecret: string
	transportSecrets: string
	exchange: string
	enrollment: string
	enrollmentsBundle: string
	confirmations: string
	peerConfirmationsBundle: string
	round1Output: string
	round1Bundle: string
	agreementOutput: string
	agreementBundle: string
	round2OutputDirectory: string
	round2Bundle: string
	finalPublicOutput: string
	inspectionOutput: string
	attestationOutput: string
	journal: string
	lock: string
}

interface HostContext {
	manifest: DemoFridayDkgPublicManifestV1
	manifestDigest: string
	expectedManifestDigest: string
	participantId: DemoFridayParticipantId
	runId: string
	profile: DemoFridayDkgHostFilesystemProfile
	paths: HostPaths
}

interface HostLockOwnerV2 {
	schema: typeof DEMO_FRIDAY_DKG_HOST_LOCK_SCHEMA
	pid: number
	bootId: string
	processStartTicks: string
	manifestDigest: string
	participantId: DemoFridayParticipantId
}

function fail(message: string): never {
	throw new Error(`DEMO_FRIDAY_PER_VALIDATOR_HOST: ${message}`)
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function exactParticipant(value: unknown): DemoFridayParticipantId {
	if (!Number.isInteger(value) || !PARTICIPANTS.includes(value as DemoFridayParticipantId)) fail('participant must be 1..4')
	return value as DemoFridayParticipantId
}

function exactIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${label} is invalid`)
	return value
}

function exactStage(value: unknown): DemoFridayDkgHostStage {
	if (typeof value !== 'string' || !(DEMO_FRIDAY_DKG_HOST_STAGES as readonly string[]).includes(value)) fail('stage is invalid')
	return value as DemoFridayDkgHostStage
}

function canonicalAbsolute(value: string, label: string): string {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || resolve(value) !== value) {
		fail(`${label} must be a dedicated canonical absolute path`)
	}
	return value
}

function productionProfile(): DemoFridayDkgHostFilesystemProfile {
	return {
		filesystemRoot: DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
		participantBinary: DEMO_FRIDAY_PER_VALIDATOR_BINARY,
		inspectorBinary: DEMO_FRIDAY_PER_VALIDATOR_INSPECTOR,
		trustedBinaryOwnerUid: 0,
		trustedBinaryParentRoot: '/',
	}
}

function hostPaths(root: string, participantId: DemoFridayParticipantId, runId: string): HostPaths {
	const exchange = join(root, 'exchange', runId)
	return {
		root, manifest: join(root, 'manifest.json'), manifestDigestPin: join(root, 'owner-approved-manifest-digest.txt'),
		config: join(root, 'participant.config.json'),
		dkgIdentitySecret: join(root, 'identity-signing-key.hex'), kexSecret: join(root, 'kex-private-key.hex'),
		transportSecrets: join(root, 'transport-secrets.json'), exchange,
		enrollment: join(exchange, `participant-${participantId}.enrollment.json`),
		enrollmentsBundle: join(exchange, 'enrollments.bundle.json'),
		confirmations: join(exchange, `participant-${participantId}.confirmations.json`),
		peerConfirmationsBundle: join(exchange, `participant-${participantId}.peer-confirmations.bundle.json`),
		round1Output: join(exchange, `participant-${participantId}.round1.json`),
		round1Bundle: join(exchange, 'round1.bundle.json'),
		agreementOutput: join(exchange, `participant-${participantId}.agreement.json`),
		agreementBundle: join(exchange, 'agreement.bundle.json'),
		round2OutputDirectory: join(exchange, `participant-${participantId}.round2-out`),
		round2Bundle: join(exchange, `participant-${participantId}.round2.bundle.json`),
		finalPublicOutput: join(exchange, `participant-${participantId}.public.json`),
		inspectionOutput: join(exchange, `participant-${participantId}.inspection.json`),
		attestationOutput: join(exchange, `participant-${participantId}.final-attestation.json`),
		journal: join(exchange, `participant-${participantId}.host-journal.jsonl`),
		lock: join(exchange, `participant-${participantId}.host.lock`),
	}
}

function failurePath(context: HostContext, stage: DemoFridayDkgHostStage): string {
	return join(context.paths.exchange, `participant-${context.participantId}.${stage}.failure.json`)
}

function diagnosticClass(value: string): DiagnosticClass {
	if (value === '') return 'none'
	if (value.startsWith('usage:')) return 'usage'
	if (value.includes('No such file or directory')) return 'path_missing'
	if (value.includes('Permission denied')) return 'permission_denied'
	if (value.includes('invalid config version') || value.includes('three-of-four demo committee')) return 'config_binding_invalid'
	if (value.includes('transport credentials belong to another')) return 'transport_binding_invalid'
	if (value.includes('transport identity roster') || value.includes('transport pairwise keys')) return 'transport_roster_invalid'
	if (value.includes('secret file must be')) return 'secret_metadata_invalid'
	if (value.includes('state directory must') || value.includes('state path must')) return 'state_path_invalid'
	if (value.includes('DKG state already exists') || value.includes('DKG already finalized')) return 'state_conflict'
	return 'redacted_nonempty'
}

async function exactOwnedMode(path: string, mode: number, label: string): Promise<void> {
	const metadata = await lstat(path)
	const uid = process.geteuid?.()
	if (uid === undefined || !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== uid
		|| (metadata.mode & 0o777) !== mode || await realpath(path) !== path) {
		fail(`${label} must be an owned regular ${mode.toString(8)} file without symlinks`)
	}
}

async function exactDirectory(path: string, create: boolean): Promise<void> {
	if (create) {
		try { await mkdir(path, { mode: 0o700 }) }
		catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
		}
	}
	const metadata = await lstat(path)
	const uid = process.geteuid?.()
	if (uid === undefined || !metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid
		|| (metadata.mode & 0o777) !== 0o700 || await realpath(path) !== path) {
		fail('ceremony directory must be an owned real 0700 directory')
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY)
	try { await handle.sync() } finally { await handle.close() }
}

async function readBounded(path: string, label: string, secret = false): Promise<Uint8Array> {
	let handle: FileHandle
	try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ELOOP') fail(`${label} must be a regular file without symlinks`)
		throw error
	}
	try {
		const before = await handle.stat()
		const uid = process.geteuid?.()
		if (uid === undefined || !before.isFile() || before.nlink !== 1 || before.uid !== uid
			|| (secret ? (before.mode & 0o777) !== 0o600 : (before.mode & 0o022) !== 0)
			|| await realpath(path) !== path) {
			fail(`${label} must be an owned, single-link, non-writable-by-others regular file without symlinks`)
		}
		if (before.size === 0 || before.size > MAX_JSON_BYTES) fail(`${label} has an invalid size`)
		const bytes = new Uint8Array(await handle.readFile())
		const after = await handle.stat()
		if (before.dev !== after.dev || before.ino !== after.ino || before.nlink !== after.nlink
			|| before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			fail(`${label} changed while it was being read`)
		}
		return bytes
	} finally { await handle.close() }
}

async function readJson(path: string, label: string, secret = false): Promise<unknown> {
	const bytes = await readBounded(path, label, secret)
	try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown }
	catch { fail(`${label} is not valid JSON`) }
}

async function readSecretKey(path: string, label: string): Promise<Uint8Array> {
	const text = new TextDecoder().decode(await readBounded(path, label, true))
	if (!/^[0-9a-f]{64}\n$/.test(text)) fail(`${label} must contain one canonical 32-byte hex value`)
	return hexToBytes(text.trim())
}

async function writeCreateOnce(path: string, value: string, label: string): Promise<void> {
	const bytes = utf8ToBytes(value)
	const parent = dirname(path)
	await exactDirectory(parent, false)
	const temporary = `${path}.tmp-${process.pid}`
	let handle: FileHandle | undefined
	try {
		handle = await open(temporary, 'wx', 0o600)
		await handle.writeFile(bytes)
		await handle.sync()
		await handle.chmod(0o600)
		await handle.close(); handle = undefined
		try { await link(temporary, path) }
		catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
			await exactOwnedMode(path, 0o600, label)
			const existing = new Uint8Array(await readFile(path))
			if (bytesToHex(sha256(existing)) !== bytesToHex(sha256(bytes)) || new TextDecoder().decode(existing) !== value) {
				fail(`${label} already exists with different bytes`)
			}
		}
		await unlink(temporary)
		await syncDirectory(parent)
	} catch (error) {
		try { await handle?.close() } catch { /* preserve primary error */ }
		try { await unlink(temporary) } catch { /* absent or deliberately retained target */ }
		throw error
	}
}

async function writeJsonCreateOnce(path: string, value: unknown, label: string): Promise<void> {
	await writeCreateOnce(path, `${JSON.stringify(value)}\n`, label)
}

async function assertAbsent(path: string, label: string): Promise<void> {
	try { await lstat(path); fail(`${label} already exists without exact durable completion`) }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
		throw error
	}
}

function fileDigest(bytes: Uint8Array): string {
	return bytesToHex(sha256(bytes))
}

interface BinarySnapshot {
	path: string
	digest: string
	dev: number
	ino: number
	size: number
	mtimeMs: number
	ctimeMs: number
}

async function exactProtectedBinaryParentChain(
	path: string,
	trustedRoot: string,
	trustedUid: number,
	label: string,
): Promise<void> {
	if (!trustedRoot.startsWith('/') || (trustedRoot !== '/' && (trustedRoot.endsWith('/') || trustedRoot.includes('//')))
		|| resolve(trustedRoot) !== trustedRoot) fail(`${label} trusted parent root must be canonical and absolute`)
	const relativePrefix = trustedRoot === '/' ? '/' : `${trustedRoot}/`
	if (path !== trustedRoot && !path.startsWith(relativePrefix)) fail(`${label} is outside its trusted parent root`)
	let current = dirname(path)
	for (;;) {
		const metadata = await lstat(current)
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== trustedUid
			|| (metadata.mode & 0o022) !== 0 || await realpath(current) !== current) {
			fail(`${label} parent chain is not protected by its trusted owner`)
		}
		if (current === trustedRoot) break
		const parent = dirname(current)
		if (parent === current) fail(`${label} trusted parent root was not reached`)
		current = parent
	}
}

async function exactBinarySnapshot(
	path: string,
	expected: string,
	label: string,
	profile: DemoFridayDkgHostFilesystemProfile,
): Promise<BinarySnapshot> {
	canonicalAbsolute(path, label)
	const trustedUid = profile.trustedBinaryOwnerUid ?? 0
	const trustedRoot = profile.trustedBinaryParentRoot ?? '/'
	await exactProtectedBinaryParentChain(path, trustedRoot, trustedUid, label)
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const before = await handle.stat()
		if (!before.isFile() || before.nlink !== 1 || before.uid !== trustedUid || (before.mode & 0o111) === 0
			|| (before.mode & 0o022) !== 0 || await realpath(path) !== path) {
			fail(`${label} is not a protected single-link executable owned by the trusted uid`)
		}
		const bytes = new Uint8Array(await handle.readFile())
		const after = await handle.stat()
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			fail(`${label} changed while it was being hashed`)
		}
		const actual = fileDigest(bytes)
		if (actual !== expected) fail(`${label} hash differs from the enrolled manifest`)
		return {
			path, digest: actual, dev: after.dev, ino: after.ino, size: after.size,
			mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs,
		}
	} finally { await handle.close() }
}

async function assertBinarySnapshot(
	snapshot: BinarySnapshot,
	label: string,
	profile: DemoFridayDkgHostFilesystemProfile,
): Promise<void> {
	const current = await exactBinarySnapshot(snapshot.path, snapshot.digest, label, profile)
	if (current.dev !== snapshot.dev || current.ino !== snapshot.ino || current.size !== snapshot.size
		|| current.mtimeMs !== snapshot.mtimeMs || current.ctimeMs !== snapshot.ctimeMs) {
		fail(`${label} identity changed after verification and before spawn`)
	}
}

function exactEnrollmentBundle(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
	expectedManifestDigest: string,
): DemoFridayDkgEnrollmentAttestationV1[] {
	const raw = exactObject(value, ['schema', 'manifestDigest', 'entries'], 'enrollment bundle')
	if (raw.schema !== DEMO_FRIDAY_DKG_ENROLLMENT_BUNDLE_SCHEMA
		|| raw.manifestDigest !== demoFridayDkgManifestDigest(manifest) || !Array.isArray(raw.entries)) fail('enrollment bundle binding is invalid')
	return verifyDemoFridayDkgEnrollmentsV2({
		manifest, expectedManifestDigest, enrollments: raw.entries as DemoFridayDkgEnrollmentAttestationV1[],
	})
}

function exactConfirmationBundle(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
	participantId: DemoFridayParticipantId,
): DemoFridayDkgPairwiseConfirmationV1[] {
	const raw = exactObject(value, ['schema', 'manifestDigest', 'participantId', 'entries'], 'confirmation bundle')
	if (raw.schema !== DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA
		|| raw.manifestDigest !== demoFridayDkgManifestDigest(manifest) || raw.participantId !== participantId
		|| !Array.isArray(raw.entries) || raw.entries.length !== 3) fail('confirmation bundle binding is invalid')
	return structuredClone(raw.entries as DemoFridayDkgPairwiseConfirmationV1[])
}

function rustFrame(context: string, fields: readonly Uint8Array[]): Uint8Array {
	const contextBytes = utf8ToBytes(context)
	const output = new Uint8Array(contextBytes.length + fields.reduce((total, field) => total + 4 + field.length, 0))
	output.set(contextBytes)
	let offset = contextBytes.length
	for (const field of fields) {
		new DataView(output.buffer).setUint32(offset, field.length, false); offset += 4
		output.set(field, offset); offset += field.length
	}
	return output
}

function u16(value: DemoFridayParticipantId): Uint8Array { return Uint8Array.of(0, value) }

function exactLocalRound1(value: unknown, context: HostContext): Record<string, unknown> {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'sender', 'payload_hex', 'auth_signature_hex',
	], 'local round-one envelope')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== context.manifest.dkgRunId
		|| raw.committee_keyset_id !== context.manifest.committeeKeysetId
		|| raw.committee_keyset_version !== context.manifest.committeeKeysetVersion || raw.sender !== context.participantId
		|| typeof raw.payload_hex !== 'string' || !/^[0-9a-f]+$/.test(raw.payload_hex) || raw.payload_hex.length % 2 !== 0
		|| raw.payload_hex.length > 131_072
		|| typeof raw.auth_signature_hex !== 'string' || !HEX_64.test(raw.auth_signature_hex)) fail('local round-one envelope binding is invalid')
	const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', [
		utf8ToBytes(raw.version), utf8ToBytes(raw.run_id), utf8ToBytes(raw.committee_keyset_id),
		utf8ToBytes(raw.committee_keyset_version), u16(context.participantId), utf8ToBytes(raw.payload_hex),
	])
	// k256's `Signer` implementation hashes the framed message once with SHA-256 before BIP-340 signing.
	if (!schnorr.verify(hexToBytes(raw.auth_signature_hex), sha256(message),
		hexToBytes(context.manifest.participants[context.participantId - 1]!.dkgIdentity))) fail('local round-one signature is invalid')
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
		run_id: context.manifest.dkgRunId,
		committee_keyset_id: context.manifest.committeeKeysetId,
		committee_keyset_version: context.manifest.committeeKeysetVersion,
		sender: context.participantId, payload_hex: raw.payload_hex, auth_signature_hex: raw.auth_signature_hex,
	}
}

function canonicalRound1Digest(bundle: DemoFridayDkgRound1BundleV1, context: HostContext): string {
	const raw = exactObject(bundle, ['version', 'entries'], 'round-one bundle')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || !Array.isArray(raw.entries) || raw.entries.length !== 4) {
		fail('round-one bundle is incomplete')
	}
	const bySender = new Map<DemoFridayParticipantId, Record<string, unknown>>()
	for (const entry of raw.entries) {
		const probe = exactObject(entry, [
			'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'sender', 'payload_hex', 'auth_signature_hex',
		], 'round-one envelope')
		const participantId = exactParticipant(probe.sender)
		if (bySender.has(participantId)) fail('round-one bundle contains a duplicate participant')
		bySender.set(participantId, exactLocalRound1(entry, { ...context, participantId }))
	}
	const entries = PARTICIPANTS.map((participantId) => {
		const entry = bySender.get(participantId)
		if (!entry) fail('round-one bundle is missing a participant')
		return entry
	})
	return fileDigest(utf8ToBytes(JSON.stringify(entries)))
}

function exactLocalAgreement(value: unknown, context: HostContext, round1Digest: string): Record<string, unknown> {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id', 'round1_digest', 'auth_signature_hex',
	], 'local agreement')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== context.manifest.dkgRunId
		|| raw.committee_keyset_id !== context.manifest.committeeKeysetId
		|| raw.committee_keyset_version !== context.manifest.committeeKeysetVersion || raw.participant_id !== context.participantId
		|| raw.round1_digest !== round1Digest || typeof raw.auth_signature_hex !== 'string' || !HEX_64.test(raw.auth_signature_hex)) {
		fail('local agreement binding is invalid')
	}
	const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', [
		utf8ToBytes(raw.version), utf8ToBytes(raw.run_id), utf8ToBytes(raw.committee_keyset_id),
		utf8ToBytes(raw.committee_keyset_version), u16(context.participantId), utf8ToBytes(round1Digest),
	])
	if (!schnorr.verify(hexToBytes(raw.auth_signature_hex), sha256(message),
		hexToBytes(context.manifest.participants[context.participantId - 1]!.dkgIdentity))) fail('local agreement signature is invalid')
	return raw
}

function exactFinalPackage(value: unknown, context: HostContext): DemoFridayDkgFinalPublicPackageV1 {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id',
		'public_key_package_hex', 'public_key_package_sha256',
	], 'final public package')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== context.manifest.dkgRunId
		|| raw.committee_keyset_id !== context.manifest.committeeKeysetId
		|| raw.committee_keyset_version !== context.manifest.committeeKeysetVersion || raw.participant_id !== context.participantId
		|| typeof raw.public_key_package_hex !== 'string' || !/^[0-9a-f]+$/.test(raw.public_key_package_hex)
		|| raw.public_key_package_hex.length % 2 !== 0 || raw.public_key_package_hex.length > 131_072
		|| raw.public_key_package_sha256 !== fileDigest(hexToBytes(raw.public_key_package_hex))) fail('final public package is invalid')
	return structuredClone(raw) as unknown as DemoFridayDkgFinalPublicPackageV1
}

function exactPrivateEnvelope(value: unknown, context: HostContext, recipient: DemoFridayParticipantId, digest: string): void {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'round1_digest', 'sender',
		'recipient', 'nonce_hex', 'ciphertext_hex',
	], 'round-two envelope')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== context.manifest.dkgRunId
		|| raw.committee_keyset_id !== context.manifest.committeeKeysetId
		|| raw.committee_keyset_version !== context.manifest.committeeKeysetVersion || raw.round1_digest !== digest
		|| raw.sender !== context.participantId || raw.recipient !== recipient || typeof raw.nonce_hex !== 'string'
		|| !HEX_24.test(raw.nonce_hex) || typeof raw.ciphertext_hex !== 'string'
		|| !/^[0-9a-f]{32,}$/.test(raw.ciphertext_hex) || raw.ciphertext_hex.length % 2 !== 0) fail('round-two envelope binding is invalid')
}

async function loadContext(options: DemoFridayDkgHostStageOptions): Promise<HostContext> {
	const participantId = exactParticipant(options.participantId)
	const runId = exactIdentifier(options.runId, 'runId')
	const profile = options.profile ?? productionProfile()
	canonicalAbsolute(profile.filesystemRoot, 'filesystem root')
	canonicalAbsolute(profile.participantBinary, 'participant binary')
	canonicalAbsolute(profile.inspectorBinary, 'inspector binary')
	await exactDirectory(profile.filesystemRoot, false)
	const exchangeRoot = join(profile.filesystemRoot, 'exchange')
	await exactDirectory(exchangeRoot, true)
	await exactDirectory(join(exchangeRoot, runId), true)
	const paths = hostPaths(profile.filesystemRoot, participantId, runId)
	const pinText = new TextDecoder().decode(await readBounded(paths.manifestDigestPin, 'owner-approved manifest digest pin', true))
	if (!/^[0-9a-f]{64}\n$/.test(pinText)) fail('owner-approved manifest digest pin must contain one canonical digest')
	const expectedManifestDigest = pinText.trim()
	if (options.externalManifestDigest !== undefined && options.externalManifestDigest !== expectedManifestDigest) {
		fail('installed manifest pin differs from the fresh-run external binding')
	}
	const manifest = exactDemoFridayDkgPinnedManifestV2({
		manifest: await readJson(paths.manifest, 'manifest') as DemoFridayDkgPublicManifestV1,
		expectedManifestDigest,
	})
	if (manifest.dkgRunId !== runId) fail('requested run differs from the manifest')
	return { manifest, manifestDigest: expectedManifestDigest, expectedManifestDigest, participantId, runId, profile, paths }
}

async function exactConfig(context: HostContext): Promise<void> {
	const raw = exactObject(await readJson(context.paths.config, 'participant config'), [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id',
		'max_signers', 'min_signers', 'roster',
	], 'participant config')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== context.manifest.dkgRunId
		|| raw.committee_keyset_id !== context.manifest.committeeKeysetId
		|| raw.committee_keyset_version !== context.manifest.committeeKeysetVersion
		|| raw.participant_id !== context.participantId || raw.max_signers !== 4 || raw.min_signers !== 3
		|| JSON.stringify(raw.roster) !== JSON.stringify(PARTICIPANTS)) fail('participant config differs from the authenticated manifest')
}

async function readEnrollments(context: HostContext): Promise<DemoFridayDkgEnrollmentAttestationV1[]> {
	return exactEnrollmentBundle(
		await readJson(context.paths.enrollmentsBundle, 'enrollment bundle'), context.manifest, context.expectedManifestDigest,
	)
}

async function verifyEnrollment(context: HostContext): Promise<string> {
	await exactOwnedMode(context.paths.enrollment, 0o600, 'local enrollment')
	const local = await readJson(context.paths.enrollment, 'local enrollment')
	const dkgPrivate = await readSecretKey(context.paths.dkgIdentitySecret, 'DKG identity secret')
	let expected: DemoFridayDkgEnrollmentAttestationV1
	try {
		expected = createDemoFridayDkgEnrollmentAttestationV2({
			manifest: context.manifest, expectedManifestDigest: context.expectedManifestDigest,
			participantId: context.participantId, dkgIdentityPrivateKey: dkgPrivate,
		})
	} finally { dkgPrivate.fill(0) }
	if (JSON.stringify(local) !== JSON.stringify(expected)) fail('stored local enrollment differs from its exact signed value')
	return fileDigest(utf8ToBytes(JSON.stringify(expected)))
}

async function verifyConfirmations(context: HostContext): Promise<string> {
	await exactOwnedMode(context.paths.confirmations, 0o600, 'local confirmations')
	const raw = exactObject(await readJson(context.paths.confirmations, 'local confirmations'), [
		'schema', 'manifestDigest', 'participantId', 'entries',
	], 'local confirmations')
	if (raw.schema !== DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA || raw.manifestDigest !== context.manifestDigest
		|| raw.participantId !== context.participantId || !Array.isArray(raw.entries) || raw.entries.length !== 3) {
		fail('local confirmation output binding is invalid')
	}
	const expected = await deriveLocal(context)
	if (JSON.stringify(raw.entries) !== JSON.stringify(expected.confirmationsToSend)) {
		fail('local confirmation output differs from the exact locally derived confirmations')
	}
	return fileDigest(utf8ToBytes(JSON.stringify(raw)))
}

async function deriveLocal(context: HostContext) {
	const [enrollments, dkgIdentityPrivateKey, kexPrivateKey] = await Promise.all([
		readEnrollments(context), readSecretKey(context.paths.dkgIdentitySecret, 'DKG identity secret'),
		readSecretKey(context.paths.kexSecret, 'KEX secret'),
	])
	try {
		return deriveDemoFridayDkgProvisionalV2({
			manifest: context.manifest, expectedManifestDigest: context.expectedManifestDigest,
			enrollments, participantId: context.participantId,
			dkgIdentityPrivateKey, kexPrivateKey,
		})
	} finally { dkgIdentityPrivateKey.fill(0); kexPrivateKey.fill(0) }
}

async function verifyTransport(context: HostContext): Promise<string> {
	const value = exactDemoFridayLocalTransportSecrets(
		context.manifest, await readJson(context.paths.transportSecrets, 'transport secrets', true),
	)
	if (value.participant_id !== context.participantId) fail('transport secrets belong to another participant')
	const provisional = await deriveLocal(context)
	const peerConfirmations = exactConfirmationBundle(
		await readJson(context.paths.peerConfirmationsBundle, 'peer confirmation bundle'), context.manifest, context.participantId,
	)
	const expected = finalizeDemoFridayDkgTransportV2({
		manifest: context.manifest, expectedManifestDigest: context.expectedManifestDigest,
		provisional, peerConfirmations,
	})
	if (JSON.stringify(value) !== JSON.stringify(expected)) fail('transport secrets differ from the confirmed endpoint derivation')
	return fileDigest(utf8ToBytes(JSON.stringify(value)))
}

async function verifyRound1(context: HostContext): Promise<string> {
	await exactOwnedMode(context.paths.round1Output, 0o600, 'round-one output')
	const raw = exactLocalRound1(await readJson(context.paths.round1Output, 'round-one output'), context)
	return fileDigest(utf8ToBytes(JSON.stringify(raw)))
}

async function readRound1Bundle(context: HostContext): Promise<DemoFridayDkgRound1BundleV1> {
	return structuredClone(await readJson(context.paths.round1Bundle, 'round-one bundle')) as DemoFridayDkgRound1BundleV1
}

async function readAgreementBundle(context: HostContext): Promise<DemoFridayDkgRound1AgreementBundleV1> {
	return structuredClone(await readJson(context.paths.agreementBundle, 'agreement bundle')) as DemoFridayDkgRound1AgreementBundleV1
}

async function verifyAgreement(context: HostContext): Promise<string> {
	await exactOwnedMode(context.paths.agreementOutput, 0o600, 'agreement output')
	const round1Digest = canonicalRound1Digest(await readRound1Bundle(context), context)
	const raw = exactLocalAgreement(await readJson(context.paths.agreementOutput, 'agreement output'), context, round1Digest)
	return fileDigest(utf8ToBytes(JSON.stringify(raw)))
}

async function verifiedTranscript(context: HostContext): Promise<string> {
	return verifyDemoFridayDkgRound1Transcript({
		manifest: context.manifest, round1Bundle: await readRound1Bundle(context),
		agreementBundle: await readAgreementBundle(context),
	})
}

async function verifyRound2(context: HostContext): Promise<string> {
	const digest = await verifiedTranscript(context)
	const recipients = PARTICIPANTS.filter((value) => value !== context.participantId)
	await exactDirectory(context.paths.round2OutputDirectory, false)
	const entries = await readdir(context.paths.round2OutputDirectory)
	const expected = recipients.map((recipient) => `to-${recipient}.private.json`)
	if (JSON.stringify(entries.sort()) !== JSON.stringify(expected.sort())) fail('round-two output directory has unexpected entries')
	const artifactHashes: string[] = []
	for (const recipient of recipients) {
		const path = join(context.paths.round2OutputDirectory, `to-${recipient}.private.json`)
		const bytes = await readBounded(path, 'round-two recipient envelope', true)
		exactPrivateEnvelope(JSON.parse(new TextDecoder().decode(bytes)) as unknown, context, recipient, digest)
		artifactHashes.push(fileDigest(bytes))
	}
	return fileDigest(utf8ToBytes(JSON.stringify(artifactHashes)))
}

async function verifyFinal(context: HostContext): Promise<string> {
	await exactOwnedMode(context.paths.finalPublicOutput, 0o600, 'final public package')
	const value = exactFinalPackage(await readJson(context.paths.finalPublicOutput, 'final public package'), context)
	return fileDigest(utf8ToBytes(JSON.stringify(value)))
}

async function expectedFinalAttestation(context: HostContext): Promise<DemoFridayDkgFinalAttestationV2> {
	const [enrollments, dkgIdentityPrivateKey, round1Bundle, agreementBundle, finalPublicPackage, publicInspection] = await Promise.all([
		readEnrollments(context), readSecretKey(context.paths.dkgIdentitySecret, 'DKG identity secret'),
		readRound1Bundle(context), readAgreementBundle(context),
		readJson(context.paths.finalPublicOutput, 'final public package'), readJson(context.paths.inspectionOutput, 'public inspection'),
	])
	try {
		return createDemoFridayDkgFinalAttestationV2({
			manifest: context.manifest, expectedManifestDigest: context.expectedManifestDigest,
			enrollments, participantId: context.participantId, dkgIdentityPrivateKey,
			round1Bundle, agreementBundle,
			finalPublicPackage: finalPublicPackage as DemoFridayDkgFinalPublicPackageV1,
			publicInspection: publicInspection as DemoFridayDkgPublicInspectionV1,
		})
	} finally { dkgIdentityPrivateKey.fill(0) }
}

async function verifyInspection(context: HostContext): Promise<string> {
	await exactOwnedMode(context.paths.inspectionOutput, 0o600, 'public inspection')
	const attestation = await expectedFinalAttestation(context)
	return fileDigest(utf8ToBytes(attestation.publicSummaryDigest))
}

async function verifyAttestation(context: HostContext): Promise<string> {
	await exactOwnedMode(context.paths.attestationOutput, 0o600, 'final attestation')
	const actual = await readJson(context.paths.attestationOutput, 'final attestation')
	const expected = await expectedFinalAttestation(context)
	if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('stored final attestation differs from exact authenticated evidence')
	return fileDigest(utf8ToBytes(JSON.stringify(expected)))
}

async function verifyParticipantRuntime(context: HostContext): Promise<BinarySnapshot> {
	await exactConfig(context)
	const snapshot = await exactBinarySnapshot(context.profile.participantBinary,
		context.manifest.participants[context.participantId - 1]!.participantBinarySha256, 'participant binary', context.profile)
	await verifyTransport(context)
	return snapshot
}

function exactJournalRecord(value: unknown, context: HostContext): HostJournalRecordV1 {
	const raw = exactObject(value, [
		'schema', 'manifestDigest', 'participantId', 'stage', 'status', 'evidenceDigest',
	], 'host journal record')
	exactStage(raw.stage)
	if (raw.schema !== DEMO_FRIDAY_DKG_HOST_JOURNAL_SCHEMA || raw.manifestDigest !== context.manifestDigest
		|| raw.participantId !== context.participantId
		|| !['started', 'indeterminate', 'completed'].includes(String(raw.status))
		|| (raw.status === 'completed' ? typeof raw.evidenceDigest !== 'string' || !HEX_32.test(raw.evidenceDigest) : raw.evidenceDigest !== null)) {
		fail('host journal record is invalid or belongs to another ceremony')
	}
	return structuredClone(raw) as unknown as HostJournalRecordV1
}

async function openJournal(context: HostContext): Promise<{ handle: FileHandle; records: HostJournalRecordV1[] }> {
	let handle: FileHandle
	try { handle = await open(context.paths.journal, 'ax+', 0o600) }
	catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
		await exactOwnedMode(context.paths.journal, 0o600, 'host journal')
		handle = await open(context.paths.journal, 'r+')
	}
	await handle.chmod(0o600)
	const text = await handle.readFile('utf8')
	if (text !== '' && !text.endsWith('\n')) { await handle.close(); fail('host journal has a torn trailing record') }
	const records = text === '' ? [] : text.trim().split('\n').map((line) => {
		try { return exactJournalRecord(JSON.parse(line) as unknown, context) }
		catch { fail('host journal contains an invalid record') }
	})
	return { handle, records }
}

async function appendJournal(handle: FileHandle, record: HostJournalRecordV1): Promise<void> {
	await handle.appendFile(`${JSON.stringify(record)}\n`, 'utf8')
	await handle.sync()
}

async function currentBootId(): Promise<string> {
	const value = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
	if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)) fail('kernel boot identity is unavailable or malformed')
	return value
}

async function processStartTicks(pid: number): Promise<string | null> {
	let text: string
	try { text = await readFile(`/proc/${pid}/stat`, 'utf8') }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
		throw error
	}
	const close = text.lastIndexOf(')')
	const fields = close < 0 ? [] : text.slice(close + 1).trim().split(/\s+/)
	const startTicks = fields[19]
	if (!startTicks || !/^[0-9]+$/.test(startTicks)) fail(`process ${pid} start identity is unavailable or malformed`)
	return startTicks
}

function exactHostLockOwner(value: unknown, context: HostContext): HostLockOwnerV2 {
	const raw = exactObject(value, [
		'schema', 'pid', 'bootId', 'processStartTicks', 'manifestDigest', 'participantId',
	], 'host lock owner')
	if (raw.schema !== DEMO_FRIDAY_DKG_HOST_LOCK_SCHEMA || !Number.isSafeInteger(raw.pid) || Number(raw.pid) < 1
		|| typeof raw.bootId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(raw.bootId)
		|| typeof raw.processStartTicks !== 'string' || !/^[0-9]+$/.test(raw.processStartTicks)
		|| raw.manifestDigest !== context.manifestDigest || raw.participantId !== context.participantId) {
		fail('host lock owner is malformed or belongs to another ceremony')
	}
	return structuredClone(raw) as unknown as HostLockOwnerV2
}

async function readLockOwner(context: HostContext): Promise<{ owner: HostLockOwnerV2; encoded: string }> {
	await exactDirectory(context.paths.lock, false)
	const ownerPath = join(context.paths.lock, 'owner.json')
	const handle = await open(ownerPath, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const before = await handle.stat(); const uid = process.geteuid?.()
		if (uid === undefined || !before.isFile() || ![1, 2].includes(before.nlink) || before.uid !== uid
			|| (before.mode & 0o777) !== 0o600 || before.size < 2 || before.size > MAX_JSON_BYTES
			|| await realpath(ownerPath) !== ownerPath) fail('host lock owner inode is unsafe')
		const encoded = await handle.readFile('utf8'); const after = await handle.stat()
		if (before.dev !== after.dev || before.ino !== after.ino || before.nlink !== after.nlink
			|| before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
			|| !encoded.endsWith('\n')) fail('host lock owner changed while read')
		let parsed: unknown
		try { parsed = JSON.parse(encoded) as unknown } catch { fail('host lock owner is not valid JSON') }
		return { owner: exactHostLockOwner(parsed, context), encoded }
	} finally { await handle.close() }
}

async function assertLockOwnerDead(owner: HostLockOwnerV2): Promise<void> {
	const bootId = await currentBootId()
	if (bootId !== owner.bootId) return
	const liveStartTicks = await processStartTicks(owner.pid)
	if (liveStartTicks === null || liveStartTicks !== owner.processStartTicks) return
	fail('host lock owner is still live; recovery is forbidden')
}

async function reconcileCreateOnceHardlink(path: string, ownerPid: number, label: string): Promise<void> {
	let target
	try { target = await lstat(path) }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
		throw error
	}
	if (target.nlink === 1) return
	if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 2 || (target.mode & 0o777) !== 0o600
		|| target.uid !== process.geteuid?.()) fail(`${label} has an unsafe stranded inode`)
	const temporary = `${path}.tmp-${ownerPid}`
	const candidate = await lstat(temporary)
	if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.dev !== target.dev || candidate.ino !== target.ino
		|| candidate.nlink !== 2 || candidate.uid !== target.uid || (candidate.mode & 0o777) !== 0o600) {
		fail(`${label} stranded link is not the exact owner temporary inode`)
	}
	await unlink(temporary)
	await syncDirectory(dirname(path))
	await exactOwnedMode(path, 0o600, label)
}

function createOnceOutputForStage(context: HostContext, stage: DemoFridayDkgHostStage): string | null {
	if (stage === 'enroll') return context.paths.enrollment
	if (stage === 'confirm-transport') return context.paths.confirmations
	if (stage === 'persist-transport') return context.paths.transportSecrets
	if (stage === 'attest') return context.paths.attestationOutput
	return null
}

async function openExistingJournal(context: HostContext): Promise<{ handle: FileHandle; records: HostJournalRecordV1[] }> {
	await exactOwnedMode(context.paths.journal, 0o600, 'host journal')
	const handle = await open(context.paths.journal, 'r+')
	const text = await handle.readFile('utf8')
	if (text === '' || !text.endsWith('\n')) { await handle.close(); fail('host journal is empty or has a torn trailing record') }
	const records = text.trim().split('\n').map((line) => {
		try { return exactJournalRecord(JSON.parse(line) as unknown, context) }
		catch { fail('host journal contains an invalid record') }
	})
	return { handle, records }
}

async function acquireHostLock(context: HostContext): Promise<() => Promise<void>> {
	const startTicks = await processStartTicks(process.pid)
	if (startTicks === null) fail('current process identity disappeared before lock creation')
	const bootId = await currentBootId()
	try { await mkdir(context.paths.lock, { mode: 0o700 }) }
	catch { fail('host ceremony lock already exists or is stranded; refusing concurrent or guessed recovery') }
	const ownerPath = join(context.paths.lock, 'owner.json')
	const owner = `${JSON.stringify({
		schema: DEMO_FRIDAY_DKG_HOST_LOCK_SCHEMA, pid: process.pid, bootId,
		processStartTicks: startTicks, manifestDigest: context.manifestDigest, participantId: context.participantId,
	})}\n`
	try { await writeCreateOnce(ownerPath, owner, 'host lock owner') }
	catch (error) { try { await rmdir(context.paths.lock) } catch { /* preserve evidence */ }; throw error }
	let released = false
	return async () => {
		if (released) return
		if (await readFile(ownerPath, 'utf8') !== owner) fail('host lock owner changed; refusing cleanup')
		await unlink(ownerPath); await rmdir(context.paths.lock); await syncDirectory(context.paths.exchange); released = true
	}
}

const PREVIOUS_STAGE: Partial<Record<DemoFridayDkgHostStage, DemoFridayDkgHostStage>> = {
	'confirm-transport': 'enroll', 'persist-transport': 'confirm-transport', round1: 'persist-transport',
	'round1-agree': 'round1', round2: 'round1-agree', finalize: 'round2', inspect: 'finalize', attest: 'inspect',
}

async function boundedDiagnostic(stream: ReadableStream<Uint8Array>, stop: () => void): Promise<string> {
	const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0
	try {
		for (;;) {
			const next = await reader.read(); if (next.done) break
			size += next.value.byteLength
			if (size > MAX_CHILD_DIAGNOSTIC_BYTES) { stop(); throw new ChildDiagnosticOverflow() }
			chunks.push(next.value)
		}
	} finally { reader.releaseLock() }
	const output = new Uint8Array(size); let offset = 0
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
	return new TextDecoder().decode(output)
}

function spawnPinnedChild(command: readonly string[]) {
	return Bun.spawn([...command], {
		stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC' },
	})
}

type PinnedChildHandle = Pick<ReturnType<typeof spawnPinnedChild>,
	'stdout' | 'stderr' | 'exited' | 'kill' | 'exitCode' | 'signalCode'>

async function awaitPinnedChild(child: PinnedChildHandle): Promise<void> {
	let killTimer: ReturnType<typeof setTimeout> | undefined
	let timedOut = false
	const stop = (): void => { try { child.kill(9) } catch { /* already exited */ } }
	const termTimer = setTimeout(() => {
		timedOut = true
		try { child.kill(15) } catch { /* already exited */ }
		killTimer = setTimeout(stop, 5_000)
	}, 120_000)
	let exit: number; let stdout: string; let stderr: string
	try {
		try {
			[exit, stdout, stderr] = await Promise.all([
				child.exited, boundedDiagnostic(child.stdout, stop), boundedDiagnostic(child.stderr, stop),
			])
		} catch (error) {
			stop()
			try { await child.exited } catch { /* the fixed failure category below remains authoritative */ }
			throw new PinnedChildFailure({
				failurePhase: 'child_process',
				failureClass: error instanceof ChildDiagnosticOverflow ? 'diagnostic_overflow' : 'outcome_unavailable',
				childStarted: true,
				exitCode: child.exitCode, signalCode: child.signalCode, timedOut,
				stdoutBytes: null, stderrBytes: null, diagnosticClass: 'unavailable',
			})
		}
	} finally {
		clearTimeout(termTimer)
		if (killTimer) clearTimeout(killTimer)
	}
	if (exit !== 0 || stdout !== '') {
		throw new PinnedChildFailure({
			failurePhase: 'child_process',
			failureClass: timedOut ? 'timeout' : child.signalCode !== null ? 'signal' : exit !== 0 ? 'nonzero_exit' : 'stdout_refused',
			childStarted: true, exitCode: child.exitCode ?? exit, signalCode: child.signalCode, timedOut,
			stdoutBytes: new TextEncoder().encode(stdout).byteLength,
			stderrBytes: new TextEncoder().encode(stderr).byteLength,
			diagnosticClass: diagnosticClass(stderr.trim()),
		})
	}
}

async function defaultRunCommand(command: readonly string[]): Promise<void> {
	let child: ReturnType<typeof spawnPinnedChild>
	try {
		child = spawnPinnedChild(command)
	} catch {
		throw new PinnedChildFailure({
			failurePhase: 'child_process', failureClass: 'spawn_refused', childStarted: false,
			exitCode: null, signalCode: null, timedOut: false, stdoutBytes: null, stderrBytes: null,
			diagnosticClass: 'unavailable',
		})
	}
	await awaitPinnedChild(child)
}

/** Exact child-stream classifier exposed only for a deterministic failure fixture. */
export async function runDemoFridayPinnedChildClassifierFixture(child: PinnedChildHandle): Promise<void> {
	await awaitPinnedChild(child)
}

const contextRunCommand = new WeakMap<HostContext, (command: readonly string[]) => Promise<void>>()
const contextBeforeSpawnRecheck = new WeakMap<HostContext, () => Promise<void>>()
const contextChildAttempted = new WeakSet<HostContext>()
const contextChildCompleted = new WeakSet<HostContext>()

async function runPinnedCommand(
	context: HostContext,
	command: readonly string[],
	snapshot: BinarySnapshot,
	label: string,
): Promise<void> {
	const beforeRecheck = contextBeforeSpawnRecheck.get(context)
	if (beforeRecheck) {
		contextBeforeSpawnRecheck.delete(context)
		await beforeRecheck()
	}
	await assertBinarySnapshot(snapshot, label, context.profile)
	contextChildAttempted.add(context)
	await (contextRunCommand.get(context) ?? defaultRunCommand)(command)
	contextChildCompleted.add(context)
}

function mapPlanCommand(context: HostContext, command: readonly string[]): string[] {
	return command.map((value, index) => {
		if (index === 0) return context.profile.participantBinary
		if (value === DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT) return context.profile.filesystemRoot
		if (value.startsWith(`${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/`)) {
			return join(context.profile.filesystemRoot, value.slice(DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT.length + 1))
		}
		return value
	})
}

async function stageDefinition(context: HostContext, stage: DemoFridayDkgHostStage): Promise<{
	action: () => Promise<void>
	verify: () => Promise<string>
}> {
	const plan = demoFridayPerValidatorDkgPlan({
		participantId: context.participantId, runId: context.runId,
		committeeKeysetId: context.manifest.committeeKeysetId,
		committeeKeysetVersion: context.manifest.committeeKeysetVersion,
	})
	if (stage === 'enroll') return {
		action: async () => {
			const secret = await readSecretKey(context.paths.dkgIdentitySecret, 'DKG identity secret')
			try {
				await writeJsonCreateOnce(context.paths.enrollment, createDemoFridayDkgEnrollmentAttestationV2({
					manifest: context.manifest, expectedManifestDigest: context.expectedManifestDigest,
					participantId: context.participantId, dkgIdentityPrivateKey: secret,
				}), 'local enrollment')
			} finally { secret.fill(0) }
		}, verify: () => verifyEnrollment(context),
	}
	if (stage === 'confirm-transport') return {
		action: async () => {
			const local = await deriveLocal(context)
			const bundle: ConfirmationBundleV1 = {
				schema: DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA, manifestDigest: context.manifestDigest,
				participantId: context.participantId,
				entries: local.confirmationsToSend.map((confirmation) => structuredClone(confirmation)),
			}
			await writeJsonCreateOnce(context.paths.confirmations, bundle, 'local confirmations')
		}, verify: () => verifyConfirmations(context),
	}
	if (stage === 'persist-transport') return {
		action: async () => {
			const local = await deriveLocal(context)
			const peerConfirmations = exactConfirmationBundle(
				await readJson(context.paths.peerConfirmationsBundle, 'peer confirmation bundle'), context.manifest, context.participantId,
			)
			const transport = finalizeDemoFridayDkgTransportV2({
				manifest: context.manifest, expectedManifestDigest: context.expectedManifestDigest,
				provisional: local, peerConfirmations,
			})
			await writeJsonCreateOnce(context.paths.transportSecrets, transport, 'transport secrets')
		}, verify: () => verifyTransport(context),
	}
	if (stage === 'round1') return {
		action: async () => {
			const snapshot = await verifyParticipantRuntime(context)
			await runPinnedCommand(context, mapPlanCommand(context, plan.commands.round1), snapshot, 'participant binary')
		}, verify: () => verifyRound1(context),
	}
	if (stage === 'round1-agree') return {
		action: async () => {
			const snapshot = await verifyParticipantRuntime(context); await verifyRound1(context)
			await runPinnedCommand(context, mapPlanCommand(context, plan.commands['round1-agree']), snapshot, 'participant binary')
		}, verify: () => verifyAgreement(context),
	}
	if (stage === 'round2') return {
		action: async () => {
			const snapshot = await verifyParticipantRuntime(context); await verifiedTranscript(context)
			await runPinnedCommand(context, mapPlanCommand(context, plan.commands.round2), snapshot, 'participant binary')
		}, verify: () => verifyRound2(context),
	}
	if (stage === 'finalize') return {
		action: async () => {
			const snapshot = await verifyParticipantRuntime(context); await verifiedTranscript(context)
			await runPinnedCommand(context, mapPlanCommand(context, plan.commands.finalize), snapshot, 'participant binary')
		}, verify: () => verifyFinal(context),
	}
	if (stage === 'inspect') return {
		action: async () => {
			const snapshot = await exactBinarySnapshot(context.profile.inspectorBinary,
				context.manifest.participants[context.participantId - 1]!.inspectorBinarySha256, 'inspector binary', context.profile)
			await assertAbsent(context.paths.inspectionOutput, 'public inspection output')
			await runPinnedCommand(context,
				[context.profile.inspectorBinary, context.paths.finalPublicOutput, context.paths.inspectionOutput],
				snapshot, 'inspector binary')
			await chmod(context.paths.inspectionOutput, 0o600)
			const handle = await open(context.paths.inspectionOutput, 'r')
			try { await handle.sync() } finally { await handle.close() }
			await syncDirectory(context.paths.exchange)
		}, verify: () => verifyInspection(context),
	}
	return {
		action: async () => {
			await writeJsonCreateOnce(context.paths.attestationOutput, await expectedFinalAttestation(context), 'final attestation')
		}, verify: () => verifyAttestation(context),
	}
}

function sanitizedStageFailure(
	context: HostContext, stage: DemoFridayDkgHostStage, error: unknown,
): SanitizedChildFailure {
	if (error instanceof PinnedChildFailure) return error.sanitized
	if (contextChildCompleted.has(context)) return {
		failurePhase: 'post_spawn_verification', failureClass: 'post_spawn_rejected', childStarted: true,
		exitCode: 0, signalCode: null, timedOut: false, stdoutBytes: 0, stderrBytes: 0, diagnosticClass: 'none',
	}
	if (contextChildAttempted.has(context)) return {
		failurePhase: 'stage_action_unknown', failureClass: 'outcome_unavailable', childStarted: true,
		exitCode: null, signalCode: null, timedOut: false, stdoutBytes: null, stderrBytes: null,
		diagnosticClass: 'unavailable',
	}
	if (['round1', 'round1-agree', 'round2', 'finalize', 'inspect'].includes(stage)) return {
		failurePhase: 'pre_spawn_validation', failureClass: 'pre_spawn_rejected', childStarted: false,
		exitCode: null, signalCode: null, timedOut: false, stdoutBytes: null, stderrBytes: null,
		diagnosticClass: 'unavailable',
	}
	return {
		failurePhase: 'stage_action_unknown', failureClass: 'outcome_unavailable', childStarted: false,
		exitCode: null, signalCode: null, timedOut: false, stdoutBytes: null, stderrBytes: null,
		diagnosticClass: 'unavailable',
	}
}

async function persistSanitizedStageFailure(
	context: HostContext, stage: DemoFridayDkgHostStage, error: unknown,
): Promise<void> {
	await writeJsonCreateOnce(failurePath(context, stage), {
		schema: DEMO_FRIDAY_DKG_HOST_FAILURE_SCHEMA,
		manifestDigest: context.manifestDigest,
		participantId: context.participantId,
		stage,
		...sanitizedStageFailure(context, stage, error),
	}, 'sanitized host stage failure')
}

/**
 * Explicit recovery for a SIGKILL-stranded host lock. This never invokes a
 * participant/inspector binary and never reruns a stage. It proves the exact
 * recorded process is dead, reconciles only the known link-before-unlink
 * create-once inode, and authenticates already-durable output before release.
 */
export async function recoverDemoFridayPerValidatorDkgHostLock(
	options: DemoFridayDkgHostRecoveryOptions,
): Promise<DemoFridayDkgHostRecoveryResult> {
	const context = await loadContext({
		stage: 'enroll', participantId: options.participantId, runId: options.runId, profile: options.profile,
	})
	const ownerPath = join(context.paths.lock, 'owner.json')
	const { owner, encoded } = await readLockOwner(context)
	await assertLockOwnerDead(owner)
	await reconcileCreateOnceHardlink(ownerPath, owner.pid, 'host lock owner')
	const journal = await openExistingJournal(context)
	let journalClosed = false
	try {
		const last = journal.records[journal.records.length - 1]
		if (!last) fail('host lock recovery requires a durable stage journal')
		const prerequisite = PREVIOUS_STAGE[last.stage]
		if (prerequisite && !journal.records.some((record) => record.stage === prerequisite && record.status === 'completed')) {
			fail(`host lock recovery cannot authenticate prerequisite ${prerequisite}`)
		}
		const output = createOnceOutputForStage(context, last.stage)
		if (output) await reconcileCreateOnceHardlink(output, owner.pid, `${last.stage} output`)
		const definition = await stageDefinition(context, last.stage)
		let evidenceDigest: string
		try { evidenceDigest = await definition.verify() }
		catch (error) {
			throw new Error(`manual recovery required: durable ${last.stage} evidence did not verify; lock preserved`, { cause: error })
		}
		if (last.status === 'completed') {
			if (last.evidenceDigest !== evidenceDigest) fail(`completed ${last.stage} evidence changed during lock recovery`)
		} else {
			await appendJournal(journal.handle, {
				schema: DEMO_FRIDAY_DKG_HOST_JOURNAL_SCHEMA, manifestDigest: context.manifestDigest,
				participantId: context.participantId, stage: last.stage, status: 'completed', evidenceDigest,
			})
		}
		await journal.handle.close()
		journalClosed = true
		if (await readFile(ownerPath, 'utf8') !== encoded) fail('host lock owner changed during authenticated recovery')
		await unlink(ownerPath); await rmdir(context.paths.lock); await syncDirectory(context.paths.exchange)
		return { stage: last.stage, status: 'lock_recovered', evidenceDigest }
	} finally {
		if (!journalClosed) await journal.handle.close()
	}
}

export async function executeDemoFridayPerValidatorDkgHostStage(
	options: DemoFridayDkgHostStageOptions,
): Promise<DemoFridayDkgHostStageResult> {
	const stage = exactStage(options.stage)
	const context = await loadContext(options)
	if (options.runCommand) contextRunCommand.set(context, options.runCommand)
	if (options.beforeSpawnRecheck) contextBeforeSpawnRecheck.set(context, options.beforeSpawnRecheck)
	const release = await acquireHostLock(context)
	let journal: Awaited<ReturnType<typeof openJournal>> | undefined
	let preserveLock = false
	try {
		journal = await openJournal(context)
		const prior = new Map<DemoFridayDkgHostStage, HostJournalRecordV1>()
		for (const record of journal.records) prior.set(record.stage, record)
		const prerequisite = PREVIOUS_STAGE[stage]
		if (prerequisite && prior.get(prerequisite)?.status !== 'completed') fail(`stage ${stage} requires completed ${prerequisite}`)
		const definition = await stageDefinition(context, stage)
		const current = prior.get(stage)
		if (current?.status === 'completed') {
			const evidenceDigest = await definition.verify()
			if (evidenceDigest !== current.evidenceDigest) fail(`completed ${stage} evidence changed`)
			return { stage, status: 'already_completed', evidenceDigest }
		}
		if (current) fail(`stage ${stage} has non-terminal journal state; recover-lock is required and normal replay is forbidden`)
		await appendJournal(journal.handle, {
			schema: DEMO_FRIDAY_DKG_HOST_JOURNAL_SCHEMA, manifestDigest: context.manifestDigest,
			participantId: context.participantId, stage, status: 'started', evidenceDigest: null,
		})
		try {
			await definition.action()
			const evidenceDigest = await definition.verify()
			await appendJournal(journal.handle, {
				schema: DEMO_FRIDAY_DKG_HOST_JOURNAL_SCHEMA, manifestDigest: context.manifestDigest,
				participantId: context.participantId, stage, status: 'completed', evidenceDigest,
			})
			return { stage, status: 'completed', evidenceDigest }
		} catch (error) {
			// Once action execution starts, any error is an uncertain outcome. Keep
			// the exact PID/boot/start-identity lock even when writing the durable
			// indeterminate record also fails. Only the explicit dead-owner recovery
			// path may authenticate existing evidence and release it; a normal stage
			// invocation must never replay the Rust participant.
			preserveLock = true
			let failureRecordError: unknown
			try { await persistSanitizedStageFailure(context, stage, error) }
			catch (recordError) { failureRecordError = recordError }
			try {
				await appendJournal(journal.handle, {
					schema: DEMO_FRIDAY_DKG_HOST_JOURNAL_SCHEMA, manifestDigest: context.manifestDigest,
					participantId: context.participantId, stage, status: 'indeterminate', evidenceDigest: null,
				})
			} catch (journalError) {
				throw new AggregateError(
					failureRecordError ? [error, failureRecordError, journalError] : [error, journalError],
					`stage ${stage} and its durable failure records failed`,
				)
			}
			if (failureRecordError) throw new AggregateError([error, failureRecordError], `stage ${stage} failed and its sanitized failure record failed`)
			throw error
		}
	} finally {
		try { await journal?.handle.close() } finally {
			if (!preserveLock) await release()
		}
	}
}

export function demoFridayPerValidatorDkgHostArgs(argv = process.argv.slice(2)): {
	stage: DemoFridayDkgHostStage; participantId: DemoFridayParticipantId; runId: string
} {
	if (argv.length !== 5 || argv[1] !== '--participant' || argv[3] !== '--run-id') {
		fail('usage: plebeian-friday-per-validator-dkg-host STAGE --participant 1..4 --run-id ID')
	}
	return { stage: exactStage(argv[0]), participantId: exactParticipant(Number(argv[2])), runId: exactIdentifier(argv[4], 'runId') }
}

export function demoFridayPerValidatorDkgHostRecoveryArgs(argv = process.argv.slice(2)): DemoFridayDkgHostRecoveryOptions {
	if (argv.length !== 5 || argv[0] !== 'recover-lock' || argv[1] !== '--participant' || argv[3] !== '--run-id') {
		fail('usage: plebeian-friday-per-validator-dkg-host recover-lock --participant 1..4 --run-id ID')
	}
	return { participantId: exactParticipant(Number(argv[2])), runId: exactIdentifier(argv[4], 'runId') }
}

async function authenticatedCliReceipt(
	participantId: DemoFridayParticipantId,
	runId: string,
	result: DemoFridayDkgHostStageResult | DemoFridayDkgHostRecoveryResult,
): Promise<ReturnType<typeof createDemoFridayDkgAuthenticatedHostReceiptV2>> {
	const context = await loadContext({ stage: result.stage, participantId, runId })
	const secret = await readSecretKey(context.paths.dkgIdentitySecret, 'DKG identity secret')
	try {
		return createDemoFridayDkgAuthenticatedHostReceiptV2({
			manifestDigest: context.manifestDigest,
			participantId,
			stage: result.stage,
			status: result.status,
			evidenceDigest: result.evidenceDigest,
			dkgIdentityPrivateKey: secret,
		})
	} finally { secret.fill(0) }
}

if (import.meta.main) {
	try {
		const argv = process.argv.slice(2)
		const options = argv[0] === 'recover-lock'
			? demoFridayPerValidatorDkgHostRecoveryArgs(argv)
			: demoFridayPerValidatorDkgHostArgs(argv)
		const result = argv[0] === 'recover-lock'
			? await recoverDemoFridayPerValidatorDkgHostLock(options as DemoFridayDkgHostRecoveryOptions)
			: await executeDemoFridayPerValidatorDkgHostStage(options as ReturnType<typeof demoFridayPerValidatorDkgHostArgs>)
		process.stdout.write(`${JSON.stringify(await authenticatedCliReceipt(options.participantId, options.runId, result))}\n`)
	} catch {
		process.stderr.write('Friday per-validator DKG host command rejected\n')
		process.exitCode = 1
	}
}
