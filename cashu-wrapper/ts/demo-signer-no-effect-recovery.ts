/**
 * Offline, fail-closed recovery for the one reviewed signer incident where an
 * admission RPC was durably claimed but the invocation scratch parent was
 * absent before the Rust participant could run.
 *
 * This is deliberately not imported by the signer service and exposes no
 * network endpoint.  It requires the service lease, exact stopped-state
 * aggregates, a zero Rust revision, no Rust admission files, and the exact
 * persistent quarantine marker.  The pending row is retained as an anchored
 * cached rejection; it is never deleted or made retryable.
 */
import { Database } from 'bun:sqlite'
import { dlopen, FFIType } from 'bun:ffi'
import {
	closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, readdirSync,
} from 'node:fs'
import {
	chmod, lstat, mkdir, readFile, rename, writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { openDemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { DemoSignerRpcJournalV2 } from './demo-signer-rpc-journal-v2'

const MARKER = Buffer.from('SIGNER_LOCAL_UNCERTAINTY_V2\n')
const HEX_32 = /^[0-9a-f]{64}$/
const libc = dlopen('libc.so.6', { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } })

export interface DemoSignerNoEffectRecoveryActionV1 {
	schema: 'PLEBEIAN_SIGNER_NO_EFFECT_RECOVERY_ACTION_V1'
	participantId: 1 | 2 | 3
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	runtimeUid: number
	runtimeGid: number
	backupDirectory: string
	paths: {
		stateDirectory: string
		signerMetadataPath: string
		proofUsePath: string
		coordinatorAnchorPath: string
		admissionSafetyPath: string
		enrollmentPermitPath: string
		leasePath: string
		quarantinePath: string
		scratchParent: string
	}
}

interface RecoveryState {
	admission: { complete: number; pending: number; rejected_no_effect: number }
	fundingAbortRows: number
	proofClaims: number
	admissionRevision: number
	admissionAnchorRevision: number
	rustAnchorRevision: number
	rustAdmissionEntries: string[]
}

function fail(message: string): never { throw new Error(`DEMO_SIGNER_NO_EFFECT_RECOVERY: ${message}`) }
function canonical(path: string, label: string): string {
	if (!path.startsWith('/') || resolve(path) !== path || path === '/' || path.endsWith('/') || path.includes('//')) fail(`${label} is not a dedicated canonical absolute path`)
	return path
}
function privateRegular(path: string, uid: number, gid: number, label: string): void {
	const stat = lstatSync(path)
	if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o777) !== 0o600) {
		fail(`${label} is not the exact runtime-owned 0600 regular file`)
	}
}
function fsyncPath(path: string, directory = false): void {
	const fd = openSync(path, constants.O_RDONLY | (directory ? constants.O_DIRECTORY : 0))
	try { fsyncSync(fd) } finally { closeSync(fd) }
}
function acquireLease(path: string, uid: number, gid: number): () => void {
	privateRegular(path, uid, gid, 'signer lease')
	const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW)
	if (libc.symbols.flock(fd, 2 | 4) !== 0) { closeSync(fd); fail('signer lease is held; service is not offline') }
	return () => { libc.symbols.flock(fd, 8); closeSync(fd) }
}
function oneNumber(database: Database, sql: string): number {
	const row = database.query<{ value: number }, []>(sql).get()
	if (row === null || !Number.isSafeInteger(row.value) || row.value < 0) fail('database aggregate is invalid')
	return row.value
}
function exactCounts(database: Database, table: string): Record<string, number> {
	return Object.fromEntries(database.query<{ status: string; count: number }, []>(
		`SELECT status,COUNT(*) AS count FROM ${table} GROUP BY status ORDER BY status`,
	).all().map(({ status, count }) => [status, count]))
}
function readState(action: DemoSignerNoEffectRecoveryActionV1): RecoveryState {
	const admission = new Database(action.paths.admissionSafetyPath, { readonly: true, strict: true })
	const anchor = new Database(action.paths.coordinatorAnchorPath, { readonly: true, strict: true })
	try {
		if ((admission.query('PRAGMA quick_check').get() as { quick_check: string }).quick_check !== 'ok'
			|| (anchor.query('PRAGMA quick_check').get() as { quick_check: string }).quick_check !== 'ok') fail('SQLite quick_check failed')
		const statuses = exactCounts(admission, 'demo_fips_admission_rpc_journal')
		const abort = oneNumber(admission, 'SELECT COUNT(*) AS value FROM demo_fips_funding_abort_rpc_journal')
		const proofClaims = oneNumber(admission, 'SELECT COUNT(*) AS value FROM fips_admission_proof_claims')
		const admissionRevision = oneNumber(admission, 'SELECT revision AS value FROM admission_safety_metadata WHERE id=1')
		const admissionAnchorRevision = oneNumber(anchor, `SELECT revision AS value FROM disposition_admission_safety_anchor WHERE participant_id=${action.participantId}`)
		const rustAnchorRevision = oneNumber(anchor, `SELECT rust_state_revision AS value FROM disposition_signer_safety_anchor WHERE participant_id=${action.participantId}`)
		return {
			admission: {
				complete: statuses.complete ?? 0, pending: statuses.pending ?? 0,
				rejected_no_effect: statuses.rejected_no_effect ?? 0,
			},
			fundingAbortRows: abort, proofClaims, admissionRevision, admissionAnchorRevision, rustAnchorRevision,
			rustAdmissionEntries: readdirSyncExact(action.paths.stateDirectory).filter((name) => name.startsWith('admission-')).sort(),
		}
	} finally { admission.close(false); anchor.close(false) }
}
function readdirSyncExact(path: string): string[] {
	const stat = lstatSync(path)
	if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Rust state is not a regular directory')
	return readdirSync(path)
}
function expectState(actual: RecoveryState, phase: 'before' | 'after'): void {
	const expected = phase === 'before'
		? { complete: 1, pending: 1, rejected_no_effect: 0, revision: 4 }
		: { complete: 1, pending: 0, rejected_no_effect: 1, revision: 5 }
	if (actual.admission.complete !== expected.complete || actual.admission.pending !== expected.pending
		|| actual.admission.rejected_no_effect !== expected.rejected_no_effect
		|| actual.admissionRevision !== expected.revision || actual.admissionAnchorRevision !== expected.revision
		|| actual.fundingAbortRows !== 0 || actual.proofClaims !== 3 || actual.rustAnchorRevision !== 0
		|| actual.rustAdmissionEntries.length !== 0) fail(`${phase} evidence differs from the reviewed incident`)
}
function actionExact(input: unknown): DemoSignerNoEffectRecoveryActionV1 {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('action is not an object')
	const value = input as DemoSignerNoEffectRecoveryActionV1
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
		'backupDirectory','dkgRunId','participantId','paths','publicKeyPackageSha256','runtimeGid','runtimeUid','schema','signerRosterDigest',
	].sort()) || value.schema !== 'PLEBEIAN_SIGNER_NO_EFFECT_RECOVERY_ACTION_V1'
		|| ![1, 2, 3].includes(value.participantId) || value.dkgRunId.length === 0
		|| !HEX_32.test(value.publicKeyPackageSha256) || !HEX_32.test(value.signerRosterDigest)
		|| !Number.isSafeInteger(value.runtimeUid) || value.runtimeUid < 1
		|| !Number.isSafeInteger(value.runtimeGid) || value.runtimeGid < 1
		|| value.paths === null || typeof value.paths !== 'object' || Array.isArray(value.paths)
		|| JSON.stringify(Object.keys(value.paths).sort()) !== JSON.stringify([
			'admissionSafetyPath','coordinatorAnchorPath','enrollmentPermitPath','leasePath','proofUsePath','quarantinePath','scratchParent','signerMetadataPath','stateDirectory',
		].sort())) fail('action identity or fields differ')
	if (process.geteuid?.() !== value.runtimeUid || process.getegid?.() !== value.runtimeGid) {
		fail('tool must run as the exact signer runtime identity')
	}
	for (const [label, path] of Object.entries({ backupDirectory: value.backupDirectory, ...value.paths })) canonical(path, label)
	const unique = new Set([value.backupDirectory, ...Object.values(value.paths)])
	if (unique.size !== 10 || !value.paths.signerMetadataPath.startsWith(`${value.paths.stateDirectory}/`)
		|| [value.paths.proofUsePath, value.paths.coordinatorAnchorPath, value.paths.admissionSafetyPath, value.backupDirectory]
			.some((path) => path.startsWith(`${value.paths.stateDirectory}/`))) fail('action paths overlap a protected boundary')
	return structuredClone(value)
}
async function backupDatabase(databasePath: string, outputPath: string): Promise<number> {
	const database = new Database(databasePath, { readonly: true, strict: true })
	try {
		const bytes = database.serialize()
		await writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 }); await chmod(outputPath, 0o600); fsyncPath(outputPath)
		const verification = new Database(outputPath, { readonly: true, strict: true })
		try { if ((verification.query('PRAGMA quick_check').get() as { quick_check: string }).quick_check !== 'ok') fail('serialized backup quick_check failed') }
		finally { verification.close(false) }
		return bytes.byteLength
	} finally { database.close(false) }
}
async function assertIncidentFiles(action: DemoSignerNoEffectRecoveryActionV1): Promise<void> {
	const { paths } = action
	privateRegular(paths.leasePath, action.runtimeUid, action.runtimeGid, 'signer lease')
	privateRegular(paths.quarantinePath, action.runtimeUid, action.runtimeGid, 'quarantine marker')
	if (!readFileSync(paths.quarantinePath).equals(MARKER)) fail('quarantine marker bytes differ')
	try { await lstat(paths.scratchParent); fail('scratch parent already exists') }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
	for (const [label, path] of Object.entries({
		admissionSafety: paths.admissionSafetyPath, coordinatorAnchor: paths.coordinatorAnchorPath,
		signerMetadata: paths.signerMetadataPath, proofUse: paths.proofUsePath,
	})) privateRegular(path, action.runtimeUid, action.runtimeGid, label)
	const parent = await lstat(dirname(action.backupDirectory))
	if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== action.runtimeUid
		|| parent.gid !== action.runtimeGid || (parent.mode & 0o777) !== 0o700) fail('backup parent must be runtime-owned mode 0700')
}

export async function recoverDemoSignerPendingBeforeEffect(input: unknown): Promise<{
	schema: 'PLEBEIAN_SIGNER_NO_EFFECT_RECOVERY_RESULT_V1'; status: 'COMPLETE'; participantId: 1 | 2 | 3
	before: RecoveryState; after: RecoveryState; backupDirectory: string
}> {
	const action = actionExact(input), { paths } = action
	await assertIncidentFiles(action)
	const release = acquireLease(paths.leasePath, action.runtimeUid, action.runtimeGid)
	let anchor: ReturnType<typeof openDemoDispositionSignerAnchor> | undefined
	let journalDatabase: Database | undefined
	try {
		await assertIncidentFiles(action)
		const before = readState(action); expectState(before, 'before')
		await mkdir(action.backupDirectory, { mode: 0o700 }); await chmod(action.backupDirectory, 0o700)
		const admissionBackup = join(action.backupDirectory, 'admission-safety.sqlite3.backup')
		const anchorBackup = join(action.backupDirectory, 'signer-safety-anchor.sqlite3.backup')
		const signerMetadataBackup = join(action.backupDirectory, 'disposition-metadata.sqlite3.backup')
		const markerBackup = join(action.backupDirectory, 'signer-service-v2.quarantine.backup')
		const admissionBytes = await backupDatabase(paths.admissionSafetyPath, admissionBackup)
		const anchorBytes = await backupDatabase(paths.coordinatorAnchorPath, anchorBackup)
		const signerMetadataBytes = await backupDatabase(paths.signerMetadataPath, signerMetadataBackup)
		await writeFile(markerBackup, MARKER, { flag: 'wx', mode: 0o600 }); await chmod(markerBackup, 0o600); fsyncPath(markerBackup)
		await writeFile(join(action.backupDirectory, 'PRE-RECOVERY.json'), `${JSON.stringify({
			schema: 'PLEBEIAN_SIGNER_NO_EFFECT_PRE_RECOVERY_V1', participantId: action.participantId,
			before, backups: { admissionBytes, anchorBytes, signerMetadataBytes, markerBytes: MARKER.byteLength },
		})}\n`, { flag: 'wx', mode: 0o600 }); fsyncPath(join(action.backupDirectory, 'PRE-RECOVERY.json')); fsyncPath(action.backupDirectory, true)

		anchor = openDemoDispositionSignerAnchor({
			participantId: action.participantId, dkgRunId: action.dkgRunId,
			publicKeyPackageSha256: action.publicKeyPackageSha256, signerRosterDigest: action.signerRosterDigest,
			stateDirectory: paths.stateDirectory, signerMetadataPath: paths.signerMetadataPath,
			proofUsePath: paths.proofUsePath, coordinatorAnchorPath: paths.coordinatorAnchorPath,
			initialEnrollmentPermitPath: paths.enrollmentPermitPath, admissionSafetyPath: paths.admissionSafetyPath,
		})
		journalDatabase = new Database(paths.admissionSafetyPath, { create: false, strict: true })
		const journal = new DemoSignerRpcJournalV2<unknown>(journalDatabase, 'demo_fips_admission_rpc_journal', anchor)
		const witness = anchor.captureNoEffectWitness()
		await journal.operatorRejectOnlyPendingPreEffect(witness)
		anchor.assertHealthCurrent()
		journalDatabase.close(false); journalDatabase = undefined; anchor.close(); anchor = undefined
		const after = readState(action); expectState(after, 'after')
		if (!readFileSync(paths.quarantinePath).equals(MARKER)) fail('quarantine marker changed before release')
		const pendingReceipt = join(action.backupDirectory, 'RECOVERY.pending.json')
		const completeReceipt = join(action.backupDirectory, 'RECOVERY.json')
		const result = { schema: 'PLEBEIAN_SIGNER_NO_EFFECT_RECOVERY_RESULT_V1' as const,
			status: 'COMPLETE' as const, participantId: action.participantId, before, after,
			backupDirectory: action.backupDirectory }
		await writeFile(pendingReceipt, `${JSON.stringify(result)}\n`, { flag: 'wx', mode: 0o600 }); fsyncPath(pendingReceipt)
		await rename(paths.quarantinePath, join(action.backupDirectory, 'signer-service-v2.quarantine.released'))
		fsyncPath(dirname(paths.quarantinePath), true); fsyncPath(action.backupDirectory, true)
		await rename(pendingReceipt, completeReceipt); fsyncPath(action.backupDirectory, true)
		return result
	} finally {
		try { journalDatabase?.close(false) } catch {}
		try { anchor?.close() } catch {}
		release()
	}
}

export async function demoSignerNoEffectRecoveryMain(argv: string[]): Promise<void> {
	if (argv.length !== 2 || argv[0] !== '--action') fail('usage: --action /absolute/action.json')
	const actionPath = canonical(argv[1]!, 'action path')
	const parsed = JSON.parse(await readFile(actionPath, 'utf8')) as unknown
	const action = actionExact(parsed), metadata = lstatSync(actionPath)
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== action.runtimeGid
		|| (metadata.mode & 0o777) !== 0o640) fail('action file must be root-owned, runtime-group-readable mode 0640')
	const result = await recoverDemoSignerPendingBeforeEffect(action)
	process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.main) {
	try { await demoSignerNoEffectRecoveryMain(process.argv.slice(2)) }
	catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : 'DEMO_SIGNER_NO_EFFECT_RECOVERY: unknown error'}\n`)
		process.exitCode = 1
	}
}
