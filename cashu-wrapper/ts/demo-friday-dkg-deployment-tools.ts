import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rmdir, unlink, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { dlopen, FFIType, read as ffiRead } from 'bun:ffi'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, demoFridayDkgManifestDigest, demoFridayDkgRosterDigest,
	exactDemoFridayDkgManifest, type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	verifyDemoFridayDkgHostEnrollment, type DemoFridayDkgHostEnrollmentV1,
} from './demo-friday-per-validator-dkg-enrollment-init'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
import { SEPARATED_DEPLOYMENT_ID, SEPARATED_APPLICATION_RUN_ID, SEPARATED_DKG_RUN_ID, SEPARATED_COORDINATOR_ROOT } from './demo-friday-separated-constants'
const HEX32 = /^[0-9a-f]{64}$/
const LINUX_O_CLOEXEC = 0o2000000
const MAX_PUBLIC_INPUT_BYTES = 1024 * 1024

export const DEMO_FRIDAY_COORDINATOR_IDENTITY_SCHEMA = 'PLEBEIAN_FRIDAY_COORDINATOR_RPC_IDENTITY_V1' as const
export const DEMO_FRIDAY_COORDINATOR_LOCK_SCHEMA = 'PLEBEIAN_FRIDAY_COORDINATOR_RPC_IDENTITY_LOCK_V1' as const
export const DEMO_FRIDAY_COMPOSED_MANIFEST_SCHEMA = 'PLEBEIAN_FRIDAY_COMPOSED_DKG_MANIFEST_V2' as const
export const DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA = 'PLEBEIAN_FRIDAY_COMPOSED_DKG_MANIFEST_RECEIPT_V1' as const
export const DEMO_FRIDAY_MANIFEST_COMPOSITION_LOCK_SCHEMA = 'PLEBEIAN_FRIDAY_DKG_MANIFEST_COMPOSITION_LOCK_V1' as const
export const DEMO_FRIDAY_COORDINATOR_ROOT = '/var/lib/plebeian-auctions-friday/coordinator' as const
export const DEMO_FRIDAY_COORDINATOR_SECRET_PATH = `${DEMO_FRIDAY_COORDINATOR_ROOT}/coordinator-rpc-identity.key` as const
export const DEMO_FRIDAY_COORDINATOR_PUBLIC_PATH = `${DEMO_FRIDAY_COORDINATOR_ROOT}/coordinator-rpc-identity.public.json` as const
export const DEMO_FRIDAY_COORDINATOR_HOST_ID = 'linode-108236985' as const

export interface DemoFridayCoordinatorIdentityV1 {
	schema: typeof DEMO_FRIDAY_COORDINATOR_IDENTITY_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	deploymentId: string
	applicationRunId: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	hostId: typeof DEMO_FRIDAY_COORDINATOR_HOST_ID | 'linode-109290386'
	coordinatorParticipantId: 1
	coordinatorIdentity: string
}
export interface DemoFridayCoordinatorIdentityProfile {
	root: string
	secretPath: string
	publicPath: string
	parentDirectory?: string
}
export interface DemoFridayCoordinatorIdentityInput {
	deploymentId: string
	applicationRunId: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	profile?: DemoFridayCoordinatorIdentityProfile
	secretGenerator?: () => Uint8Array
	faultInjection?: (phase: DemoFridayCoordinatorFaultPhase) => Promise<void>
}
export const DEMO_FRIDAY_COORDINATOR_FAULT_PHASES = [
	'after-lock', 'after-staging', 'after-private', 'after-public', 'after-staging-sync',
	'after-promotion', 'after-parent-sync',
] as const
export type DemoFridayCoordinatorFaultPhase = typeof DEMO_FRIDAY_COORDINATOR_FAULT_PHASES[number]
interface DemoFridayCoordinatorLockOwnerV1 {
	schema: typeof DEMO_FRIDAY_COORDINATOR_LOCK_SCHEMA
	pid: number
	bootId: string
	processStartTicks: string
	bindingDigest: string
}
interface DemoFridayManifestCompositionLockOwnerV1 {
	schema: typeof DEMO_FRIDAY_MANIFEST_COMPOSITION_LOCK_SCHEMA
	pid: number
	bootId: string
	processStartTicks: string
	bindingDigest: string
}
export interface DemoFridayComposedManifestV2 {
	schema: typeof DEMO_FRIDAY_COMPOSED_MANIFEST_SCHEMA
	expectedHostPinDigests: readonly [string, string, string, string]
	manifest: DemoFridayDkgPublicManifestV1
	manifestDigest: string
}
export interface DemoFridayComposedManifestReceiptV1 {
	schema: typeof DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA
	outputPath: string
	outputSha256: string
	manifestDigest: string
	expectedHostPinDigests: readonly [string, string, string, string]
}
export const DEMO_FRIDAY_MANIFEST_FAULT_PHASES = [
	'after-lock', 'after-staging', 'after-manifest-stage', 'after-receipt-stage',
	'after-staging-sync', 'after-receipt-promotion', 'after-manifest-promotion', 'after-parent-sync',
] as const
export type DemoFridayManifestFaultPhase = typeof DEMO_FRIDAY_MANIFEST_FAULT_PHASES[number]
export interface DemoFridayManifestWriteOptions {
	coordinator: unknown
	enrollments: readonly unknown[]
	expectedHostPinDigests: readonly string[]
	outputPath: string
	receiptPath: string
	faultInjection?: (phase: DemoFridayManifestFaultPhase) => Promise<void>
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_DKG_DEPLOYMENT: ${message}`) }
function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }
function exactIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${label} is invalid`)
	return value
}
function exactHex32(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HEX32.test(value) || /^0+$/.test(value)) fail(`${label} is invalid`)
	return value
}
function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} has missing or unexpected fields`)
	return value as Record<string, unknown>
}
function exactAbsolutePath(value: string, label: string): string {
	if (!value.startsWith('/') || value.includes('\0')) fail(`${label} is not an absolute path`)
	return value
}
function exactProfile(profile?: DemoFridayCoordinatorIdentityProfile): Required<DemoFridayCoordinatorIdentityProfile> {
	const raw = profile ?? { root: DEMO_FRIDAY_COORDINATOR_ROOT, secretPath: DEMO_FRIDAY_COORDINATOR_SECRET_PATH,
		publicPath: DEMO_FRIDAY_COORDINATOR_PUBLIC_PATH }
	const value = { ...raw, parentDirectory: raw.parentDirectory ?? dirname(raw.root) }
	for (const [label, path] of Object.entries(value)) exactAbsolutePath(path, label)
	if (dirname(value.root) !== value.parentDirectory || dirname(value.secretPath) !== value.root
		|| dirname(value.publicPath) !== value.root || value.secretPath === value.publicPath) fail('coordinator identity profile is outside its fixed root')
	return value
}
async function pathExists(path: string): Promise<boolean> {
	try { await lstat(path); return true } catch (error) { if (isMissing(error)) return false; throw error }
}
async function exactOwnedDirectory(path: string, label: string): Promise<void> {
	const stat = await lstat(path); const uid = process.geteuid?.()
	if (uid === undefined || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid
		|| (stat.mode & 0o777) !== 0o700 || await realpath(path) !== path) fail(`${label} is not an owned real 0700 directory`)
}
async function openExactOwnedFile(path: string, mode: number, label: string): Promise<FileHandle> {
	const pathStat = await lstat(path); const uid = process.geteuid?.()
	if (uid === undefined || !pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1
		|| pathStat.uid !== uid || (pathStat.mode & 0o777) !== mode || await realpath(path) !== path) {
		fail(`${label} is not an owned real ${mode.toString(8)} single-link file`)
	}
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | LINUX_O_CLOEXEC)
	try {
		const opened = await handle.stat()
		if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== uid || (opened.mode & 0o777) !== mode
			|| opened.dev !== pathStat.dev || opened.ino !== pathStat.ino) fail(`${label} changed while opened`)
		return handle
	} catch (error) { await handle.close(); throw error }
}
async function readExactOwnedFile(path: string, mode: number, label: string): Promise<Buffer> {
	const handle = await openExactOwnedFile(path, mode, label)
	try { return await handle.readFile() } finally { await handle.close() }
}
async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | LINUX_O_CLOEXEC)
	try { await handle.sync() } finally { await handle.close() }
}
async function writeNew(path: string, value: string, mode = 0o600): Promise<void> {
	const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
		| constants.O_NOFOLLOW | LINUX_O_CLOEXEC, mode)
	try { await handle.writeFile(value, 'utf8'); await handle.sync(); await handle.chmod(mode) } finally { await handle.close() }
}
async function currentBootId(): Promise<string> {
	const value = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
	if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)) fail('boot identity is unavailable')
	return value
}
async function processStartTicks(pid: number): Promise<string | null> {
	let text: string
	try { text = await readFile(`/proc/${pid}/stat`, 'utf8') } catch (error) { if (isMissing(error)) return null; throw error }
	const close = text.lastIndexOf(')'), fields = close < 0 ? [] : text.slice(close + 1).trim().split(/\s+/), ticks = fields[19]
	if (!ticks || !/^[0-9]+$/.test(ticks)) fail('process start identity is unavailable')
	return ticks
}

const AT_FDCWD = -100, RENAME_NOREPLACE = 1, EEXIST = 17
async function renameNoReplace(source: string, destination: string): Promise<void> {
	if (process.platform !== 'linux' || process.arch !== 'x64') fail('atomic no-replace promotion is unavailable')
	const libc = dlopen('/lib/x86_64-linux-gnu/libc.so.6', {
		renameat2: { args: [FFIType.i32, FFIType.cstring, FFIType.i32, FFIType.cstring, FFIType.u32], returns: FFIType.i32 },
		__errno_location: { args: [], returns: FFIType.ptr },
	})
	try {
		if (libc.symbols.renameat2(AT_FDCWD, Buffer.from(`${source}\0`), AT_FDCWD,
			Buffer.from(`${destination}\0`), RENAME_NOREPLACE) === 0) return
		const pointer = libc.symbols.__errno_location(); if (pointer === null) fail('could not read rename error')
		const errno = ffiRead.i32(pointer)
		if (errno === EEXIST) fail('atomic promotion destination appeared; state was preserved')
		fail(`atomic no-replace promotion failed with errno ${errno}; state was preserved`)
	} finally { libc.close() }
}

export function exactDemoFridayCoordinatorIdentity(value: unknown): DemoFridayCoordinatorIdentityV1 {
	const raw = exactObject(value, ['schema', 'valueProfile', 'deploymentId', 'applicationRunId', 'dkgRunId',
		'committeeKeysetId', 'committeeKeysetVersion', 'hostId', 'coordinatorParticipantId', 'coordinatorIdentity'], 'coordinator public identity')
	if (raw.schema !== DEMO_FRIDAY_COORDINATOR_IDENTITY_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| raw.hostId !== (raw.deploymentId===SEPARATED_DEPLOYMENT_ID?'linode-109290386':DEMO_FRIDAY_COORDINATOR_HOST_ID) || raw.coordinatorParticipantId !== 1) fail('coordinator public identity is not the fixed V2 authority')
	if(raw.deploymentId===SEPARATED_DEPLOYMENT_ID && (raw.applicationRunId!==SEPARATED_APPLICATION_RUN_ID || raw.dkgRunId!==SEPARATED_DKG_RUN_ID || raw.committeeKeysetId!=='friday-demo-frost-keyset-separated-v1' || raw.committeeKeysetVersion!=='3'))fail('separated coordinator namespace differs')
	return { schema: DEMO_FRIDAY_COORDINATOR_IDENTITY_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: exactIdentifier(raw.deploymentId, 'deploymentId'), applicationRunId: exactIdentifier(raw.applicationRunId, 'applicationRunId'),
		dkgRunId: exactIdentifier(raw.dkgRunId, 'dkgRunId'), committeeKeysetId: exactIdentifier(raw.committeeKeysetId, 'committeeKeysetId'),
		committeeKeysetVersion: exactIdentifier(raw.committeeKeysetVersion, 'committeeKeysetVersion'),
		hostId: raw.hostId as DemoFridayCoordinatorIdentityV1['hostId'], coordinatorParticipantId: 1,
		coordinatorIdentity: exactHex32(raw.coordinatorIdentity, 'coordinatorIdentity') }
}
function publicIdentity(input: DemoFridayCoordinatorIdentityInput, secret: Uint8Array): DemoFridayCoordinatorIdentityV1 {
	return exactDemoFridayCoordinatorIdentity({ schema: DEMO_FRIDAY_COORDINATOR_IDENTITY_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: input.deploymentId, applicationRunId: input.applicationRunId, dkgRunId: input.dkgRunId,
		committeeKeysetId: input.committeeKeysetId, committeeKeysetVersion: input.committeeKeysetVersion,
		hostId: input.deploymentId===SEPARATED_DEPLOYMENT_ID?'linode-109290386':DEMO_FRIDAY_COORDINATOR_HOST_ID, coordinatorParticipantId: 1,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(secret)) })
}
function coordinatorBindingDigest(input: DemoFridayCoordinatorIdentityInput): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify({ deploymentId: exactIdentifier(input.deploymentId, 'deploymentId'),
		applicationRunId: exactIdentifier(input.applicationRunId, 'applicationRunId'), dkgRunId: exactIdentifier(input.dkgRunId, 'dkgRunId'),
		committeeKeysetId: exactIdentifier(input.committeeKeysetId, 'committeeKeysetId'),
		committeeKeysetVersion: exactIdentifier(input.committeeKeysetVersion, 'committeeKeysetVersion') }))))
}
function controlPaths(profile: Required<DemoFridayCoordinatorIdentityProfile>) {
	const name = basename(profile.root), lock = join(profile.parentDirectory, `.${name}.identity.lock`)
	return { lock, owner: join(lock, 'owner.json'), staging: join(profile.parentDirectory, `.${name}.initializing`) }
}
async function verifyCoordinatorRoot(profile: Required<DemoFridayCoordinatorIdentityProfile>, input: DemoFridayCoordinatorIdentityInput,
	root = profile.root): Promise<DemoFridayCoordinatorIdentityV1> {
	await exactOwnedDirectory(root, 'coordinator root')
	if (JSON.stringify((await readdir(root)).sort()) !== JSON.stringify([basename(profile.secretPath), basename(profile.publicPath)].sort())) {
		fail('coordinator root contains unexpected entries')
	}
	const secretText = (await readExactOwnedFile(join(root, basename(profile.secretPath)), 0o600, 'coordinator private identity')).toString('utf8')
	if (!/^[0-9a-f]{64}\n$/.test(secretText)) fail('coordinator private identity is malformed')
	const secret = hexToBytes(secretText.trim())
	try {
		const publicBytes = await readExactOwnedFile(join(root, basename(profile.publicPath)), 0o600, 'coordinator public identity')
		if (publicBytes.length < 2 || publicBytes.length > MAX_PUBLIC_INPUT_BYTES) fail('coordinator public identity size is invalid')
		let stored: DemoFridayCoordinatorIdentityV1
		try { stored = exactDemoFridayCoordinatorIdentity(JSON.parse(publicBytes.toString('utf8')) as unknown) }
		catch { return fail('coordinator public identity is malformed') }
		if (JSON.stringify(stored) !== JSON.stringify(publicIdentity(input, secret))) fail('stored coordinator public identity differs')
		return stored
	} finally { secret.fill(0) }
}
async function lockOwner(input: DemoFridayCoordinatorIdentityInput): Promise<{ value: DemoFridayCoordinatorLockOwnerV1; encoded: string }> {
	const ticks = await processStartTicks(process.pid); if (ticks === null) fail('current process identity disappeared')
	const value: DemoFridayCoordinatorLockOwnerV1 = { schema: DEMO_FRIDAY_COORDINATOR_LOCK_SCHEMA, pid: process.pid,
		bootId: await currentBootId(), processStartTicks: ticks, bindingDigest: coordinatorBindingDigest(input) }
	return { value, encoded: `${JSON.stringify(value)}\n` }
}
async function readLockOwner(path: string, input: DemoFridayCoordinatorIdentityInput) {
	let value: unknown
	try { value = JSON.parse((await readExactOwnedFile(path, 0o600, 'coordinator lock owner')).toString('utf8')) as unknown }
	catch { return fail('coordinator lock owner is malformed') }
	const raw = exactObject(value, ['schema', 'pid', 'bootId', 'processStartTicks', 'bindingDigest'], 'coordinator lock owner')
	if (raw.schema !== DEMO_FRIDAY_COORDINATOR_LOCK_SCHEMA || !Number.isSafeInteger(raw.pid) || Number(raw.pid) < 1
		|| typeof raw.bootId !== 'string' || typeof raw.processStartTicks !== 'string' || !/^[0-9]+$/.test(raw.processStartTicks)
		|| raw.bindingDigest !== coordinatorBindingDigest(input)) fail('coordinator lock owner differs from the requested identity')
	const owner = raw as unknown as DemoFridayCoordinatorLockOwnerV1
	return { owner, encoded: `${JSON.stringify(owner)}\n` }
}
async function assertOwnerDead(owner: { bootId: string; pid: number; processStartTicks: string }): Promise<void> {
	if (owner.bootId !== await currentBootId()) return
	const ticks = await processStartTicks(owner.pid)
	if (ticks === null || ticks !== owner.processStartTicks) return
	fail('coordinator lock owner is still live')
}
async function releaseLock(profile: Required<DemoFridayCoordinatorIdentityProfile>, paths: ReturnType<typeof controlPaths>, encoded: string) {
	await exactOwnedDirectory(paths.lock, 'coordinator lock')
	if ((await readExactOwnedFile(paths.owner, 0o600, 'coordinator lock owner')).toString('utf8') !== encoded) fail('coordinator lock owner changed')
	if (JSON.stringify((await readdir(paths.lock)).sort()) !== JSON.stringify(['owner.json'])) fail('coordinator lock has unexpected entries')
	await unlink(paths.owner); await rmdir(paths.lock); await syncDirectory(profile.parentDirectory)
}

export async function initializeDemoFridayCoordinatorIdentity(input: DemoFridayCoordinatorIdentityInput): Promise<DemoFridayCoordinatorIdentityV1> {
	const profile = exactProfile(input.profile ?? (input.deploymentId===SEPARATED_DEPLOYMENT_ID ? {root:SEPARATED_COORDINATOR_ROOT,secretPath:`${SEPARATED_COORDINATOR_ROOT}/coordinator-rpc-identity.key`,publicPath:`${SEPARATED_COORDINATOR_ROOT}/coordinator-rpc-identity.public.json`}:undefined)), paths = controlPaths(profile)
	await exactOwnedDirectory(profile.parentDirectory, 'coordinator parent')
	if (await pathExists(paths.lock)) fail('coordinator identity lock exists; use reviewed recovery')
	if (await pathExists(paths.staging)) fail('coordinator identity staging exists; use reviewed recovery')
	if (await pathExists(profile.root)) return verifyCoordinatorRoot(profile, input)
	const owner = await lockOwner(input)
	try { await mkdir(paths.lock, { mode: 0o700 }) } catch { fail('coordinator identity lock exists or raced') }
	await syncDirectory(profile.parentDirectory); await writeNew(paths.owner, owner.encoded); await syncDirectory(paths.lock)
	await input.faultInjection?.('after-lock')
	const secret = input.secretGenerator?.() ?? randomBytes(32)
	if (!(secret instanceof Uint8Array) || secret.length !== 32 || /^0+$/.test(bytesToHex(secret))) fail('coordinator secret generator failed')
	let completed = false
	try {
		await mkdir(paths.staging, { mode: 0o700 }); await input.faultInjection?.('after-staging')
		await writeNew(join(paths.staging, basename(profile.secretPath)), `${bytesToHex(secret)}\n`); await input.faultInjection?.('after-private')
		await writeNew(join(paths.staging, basename(profile.publicPath)), `${JSON.stringify(publicIdentity(input, secret))}\n`)
		await input.faultInjection?.('after-public'); await syncDirectory(paths.staging); await input.faultInjection?.('after-staging-sync')
		await renameNoReplace(paths.staging, profile.root); await input.faultInjection?.('after-promotion')
		await syncDirectory(profile.parentDirectory); await input.faultInjection?.('after-parent-sync')
		const result = await verifyCoordinatorRoot(profile, input); completed = true; return result
	} finally { secret.fill(0); if (completed) await releaseLock(profile, paths, owner.encoded) }
}
export async function recoverDemoFridayCoordinatorIdentity(input: DemoFridayCoordinatorIdentityInput): Promise<DemoFridayCoordinatorIdentityV1> {
	const profile = exactProfile(input.profile ?? (input.deploymentId===SEPARATED_DEPLOYMENT_ID ? {root:SEPARATED_COORDINATOR_ROOT,secretPath:`${SEPARATED_COORDINATOR_ROOT}/coordinator-rpc-identity.key`,publicPath:`${SEPARATED_COORDINATOR_ROOT}/coordinator-rpc-identity.public.json`}:undefined)), paths = controlPaths(profile)
	await exactOwnedDirectory(profile.parentDirectory, 'coordinator parent'); await exactOwnedDirectory(paths.lock, 'coordinator lock')
	const { owner, encoded } = await readLockOwner(paths.owner, input); await assertOwnerDead(owner)
	const rootExists = await pathExists(profile.root), stagingExists = await pathExists(paths.staging)
	if (rootExists && stagingExists) fail('both coordinator final and staging roots exist; manual inspection required')
	let result: DemoFridayCoordinatorIdentityV1
	if (rootExists) result = await verifyCoordinatorRoot(profile, input)
	else if (stagingExists) {
		result = await verifyCoordinatorRoot(profile, input, paths.staging)
		await renameNoReplace(paths.staging, profile.root); await syncDirectory(profile.parentDirectory)
		result = await verifyCoordinatorRoot(profile, input)
	} else fail('coordinator recovery has no complete identity root; state was preserved')
	await releaseLock(profile, paths, encoded); return result
}

function exactExpectedDigests(values: readonly string[]): readonly [string, string, string, string] {
	if (values.length !== 4 || values.some((value) => !HEX32.test(value) || /^0+$/.test(value))) fail('four externally pinned host digests are required')
	return Object.freeze([...values]) as unknown as readonly [string, string, string, string]
}
export function composeDemoFridayInitialDkgManifest(options: {
	coordinator: unknown
	enrollments: readonly unknown[]
	expectedHostPinDigests: readonly string[]
}): DemoFridayComposedManifestV2 {
	const coordinator = exactDemoFridayCoordinatorIdentity(options.coordinator), expected = exactExpectedDigests(options.expectedHostPinDigests)
	if (!Array.isArray(options.enrollments) || options.enrollments.length !== 4) fail('exactly four host enrollments are required')
	const enrollments = options.enrollments.map((value, index) => {
		const raw = exactObject(value, ['schema', 'hostPin', 'hostPinDigest', 'dkgIdentity', 'kexPublicKey', 'signerIdentity',
			'dkgIdentitySignature', 'signerIdentitySignature'], 'host enrollment') as unknown as DemoFridayDkgHostEnrollmentV1
		if (raw.hostPinDigest !== expected[index]) fail(`host enrollment ${index + 1} differs from its external pin`)
		const enrollment = verifyDemoFridayDkgHostEnrollment(raw, expected[index]!)
		if (enrollment.hostPin.participantId !== index + 1) fail('host enrollments are not in exact slot order')
		return enrollment
	})
	const first = enrollments[0]!.hostPin
	for (const enrollment of enrollments) {
		const pin = enrollment.hostPin
		if (pin.deploymentId !== coordinator.deploymentId || pin.applicationRunId !== coordinator.applicationRunId
			|| pin.dkgRunId !== coordinator.dkgRunId || pin.committeeKeysetId !== coordinator.committeeKeysetId
			|| pin.committeeKeysetVersion !== coordinator.committeeKeysetVersion
			|| pin.deploymentId !== first.deploymentId || pin.applicationRunId !== first.applicationRunId) {
			fail('coordinator and enrollments do not share one ceremony identity')
		}
	}
	const participants = enrollments.map((enrollment) => ({ participantId: enrollment.hostPin.participantId,
		hostId: enrollment.hostPin.hostId, underlayIpv4: enrollment.hostPin.underlayIpv4, fipsNpub: enrollment.hostPin.fipsNpub,
		fipsUla: enrollment.hostPin.fipsUla, dkgIdentity: enrollment.dkgIdentity, signerIdentity: enrollment.signerIdentity,
		kexPublicKey: enrollment.kexPublicKey, signerEndpoint: enrollment.hostPin.signerEndpoint,
		participantBinarySha256: enrollment.hostPin.participantBinarySha256,
		inspectorBinarySha256: enrollment.hostPin.inspectorBinarySha256,
		configPath: enrollment.hostPin.configPath, stateDirectory: enrollment.hostPin.stateDirectory })) as unknown as DemoFridayDkgPublicManifestV1['participants']
	const manifest = exactDemoFridayDkgManifest({ schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: coordinator.deploymentId, applicationRunId: coordinator.applicationRunId, dkgRunId: coordinator.dkgRunId,
		committeeKeysetId: coordinator.committeeKeysetId, committeeKeysetVersion: coordinator.committeeKeysetVersion,
		roster: [1, 2, 3, 4], rosterDigest: demoFridayDkgRosterDigest(participants), coordinatorParticipantId: 1,
		coordinatorIdentity: coordinator.coordinatorIdentity, participants })
	return Object.freeze({ schema: DEMO_FRIDAY_COMPOSED_MANIFEST_SCHEMA, expectedHostPinDigests: expected,
		manifest, manifestDigest: demoFridayDkgManifestDigest(manifest) })
}
function manifestControlPaths(outputPath: string, receiptPath: string) {
	const parent = dirname(outputPath)
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([outputPath, receiptPath])))).slice(0, 24)
	return { parent, lock: join(parent, `.friday-dkg-manifest-${id}.lock`),
		owner: join(parent, `.friday-dkg-manifest-${id}.lock`, 'owner.json'),
		staging: join(parent, `.friday-dkg-manifest-${id}.staging`) }
}
function manifestPayload(options: DemoFridayManifestWriteOptions) {
	const result = composeDemoFridayInitialDkgManifest(options), manifestEncoded = `${JSON.stringify(result)}\n`
	const receipt: DemoFridayComposedManifestReceiptV1 = { schema: DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA,
		outputPath: options.outputPath, outputSha256: bytesToHex(sha256(utf8ToBytes(manifestEncoded))),
		manifestDigest: result.manifestDigest, expectedHostPinDigests: result.expectedHostPinDigests }
	const receiptEncoded = `${JSON.stringify(receipt)}\n`
	const bindingDigest = bytesToHex(sha256(utf8ToBytes(JSON.stringify({
		outputPath: options.outputPath, receiptPath: options.receiptPath,
		manifestSha256: receipt.outputSha256, receiptSha256: bytesToHex(sha256(utf8ToBytes(receiptEncoded))),
		manifestDigest: receipt.manifestDigest, expectedHostPinDigests: receipt.expectedHostPinDigests,
	}))))
	return { result, manifestEncoded, receipt: Object.freeze(receipt), receiptEncoded, bindingDigest }
}
async function manifestLockOwner(bindingDigest: string): Promise<{
	value: DemoFridayManifestCompositionLockOwnerV1
	encoded: string
}> {
	const ticks = await processStartTicks(process.pid); if (ticks === null) fail('current process identity disappeared')
	const value: DemoFridayManifestCompositionLockOwnerV1 = { schema: DEMO_FRIDAY_MANIFEST_COMPOSITION_LOCK_SCHEMA,
		pid: process.pid, bootId: await currentBootId(), processStartTicks: ticks, bindingDigest }
	return { value, encoded: `${JSON.stringify(value)}\n` }
}
async function readManifestLockOwner(path: string, bindingDigest: string) {
	let value: unknown
	try { value = JSON.parse((await readExactOwnedFile(path, 0o600, 'manifest composition lock owner')).toString('utf8')) as unknown }
	catch { return fail('manifest composition lock owner is malformed') }
	const raw = exactObject(value, ['schema', 'pid', 'bootId', 'processStartTicks', 'bindingDigest'], 'manifest composition lock owner')
	if (raw.schema !== DEMO_FRIDAY_MANIFEST_COMPOSITION_LOCK_SCHEMA || !Number.isSafeInteger(raw.pid) || Number(raw.pid) < 1
		|| typeof raw.bootId !== 'string' || typeof raw.processStartTicks !== 'string' || !/^[0-9]+$/.test(raw.processStartTicks)
		|| raw.bindingDigest !== bindingDigest) fail('manifest composition lock differs from the requested pair')
	const owner = raw as unknown as DemoFridayManifestCompositionLockOwnerV1
	return { owner, encoded: `${JSON.stringify(owner)}\n` }
}
async function acquireManifestLock(paths: ReturnType<typeof manifestControlPaths>, encoded: string): Promise<void> {
	const preparing = `${paths.lock}.preparing-${process.pid}-${randomBytes(8).toString('hex')}`
	await mkdir(preparing, { mode: 0o700 })
	try {
		await writeNew(join(preparing, 'owner.json'), encoded); await syncDirectory(preparing)
		await renameNoReplace(preparing, paths.lock); await syncDirectory(paths.parent)
	} catch (error) {
		if (await pathExists(preparing)) {
			try { await unlink(join(preparing, 'owner.json')); await rmdir(preparing); await syncDirectory(paths.parent) } catch { /* preserve primary failure */ }
		}
		throw error
	}
}
async function releaseManifestLock(paths: ReturnType<typeof manifestControlPaths>, encoded: string): Promise<void> {
	await exactOwnedDirectory(paths.lock, 'manifest composition lock')
	if ((await readExactOwnedFile(paths.owner, 0o600, 'manifest composition lock owner')).toString('utf8') !== encoded) {
		fail('manifest composition lock owner changed')
	}
	if (JSON.stringify((await readdir(paths.lock)).sort()) !== JSON.stringify(['owner.json'])) {
		fail('manifest composition lock has unexpected entries')
	}
	await unlink(paths.owner); await rmdir(paths.lock); await syncDirectory(paths.parent)
}
async function assertExactBytes(path: string, encoded: string, label: string): Promise<void> {
	if ((await readExactOwnedFile(path, 0o600, label)).toString('utf8') !== encoded) fail(`${label} differs from the locked pair`)
}
async function completeManifestPair(options: DemoFridayManifestWriteOptions,
	paths: ReturnType<typeof manifestControlPaths>, payload: ReturnType<typeof manifestPayload>, lockEncoded: string): Promise<void> {
	const outputName = basename(options.outputPath), receiptName = basename(options.receiptPath)
	const outputExists = await pathExists(options.outputPath), receiptExists = await pathExists(options.receiptPath)
	if (!await pathExists(paths.staging)) {
		if (outputExists && receiptExists) {
			await assertExactBytes(options.outputPath, payload.manifestEncoded, 'final manifest')
			await assertExactBytes(options.receiptPath, payload.receiptEncoded, 'final manifest receipt')
			await syncDirectory(paths.parent); await releaseManifestLock(paths, lockEncoded); return
		}
		if (outputExists || receiptExists) fail('manifest pair is partial without its staging directory; state was preserved')
		await mkdir(paths.staging, { mode: 0o700 }); await syncDirectory(paths.parent)
		await options.faultInjection?.('after-staging')
	}
	await exactOwnedDirectory(paths.staging, 'manifest composition staging')
	const stagedOutput = join(paths.staging, outputName), stagedReceipt = join(paths.staging, receiptName)
	if (outputExists) await assertExactBytes(options.outputPath, payload.manifestEncoded, 'final manifest')
	else if (await pathExists(stagedOutput)) await assertExactBytes(stagedOutput, payload.manifestEncoded, 'staged manifest')
	else { await writeNew(stagedOutput, payload.manifestEncoded); await options.faultInjection?.('after-manifest-stage') }
	if (receiptExists) await assertExactBytes(options.receiptPath, payload.receiptEncoded, 'final manifest receipt')
	else if (await pathExists(stagedReceipt)) await assertExactBytes(stagedReceipt, payload.receiptEncoded, 'staged manifest receipt')
	else { await writeNew(stagedReceipt, payload.receiptEncoded); await options.faultInjection?.('after-receipt-stage') }
	const expectedStaged = [!outputExists ? outputName : null, !receiptExists ? receiptName : null]
		.filter((value): value is string => value !== null).sort()
	if (JSON.stringify((await readdir(paths.staging)).sort()) !== JSON.stringify(expectedStaged)) {
		fail('manifest composition staging has missing or unexpected entries')
	}
	await syncDirectory(paths.staging); await options.faultInjection?.('after-staging-sync')
	if (!receiptExists) {
		await renameNoReplace(stagedReceipt, options.receiptPath)
		// Establish a durable receipt-before-manifest barrier.  A successful
		// recovery can rely on the receipt directory entry and the staged
		// manifest existing together after a crash at the following hook.
		await syncDirectory(paths.staging); await syncDirectory(paths.parent)
		await options.faultInjection?.('after-receipt-promotion')
	}
	if (!outputExists) {
		await renameNoReplace(stagedOutput, options.outputPath)
		await syncDirectory(paths.staging); await syncDirectory(paths.parent)
		await options.faultInjection?.('after-manifest-promotion')
	}
	await assertExactBytes(options.outputPath, payload.manifestEncoded, 'final manifest')
	await assertExactBytes(options.receiptPath, payload.receiptEncoded, 'final manifest receipt')
	if ((await readdir(paths.staging)).length !== 0) fail('manifest composition staging is not empty after promotion')
	await rmdir(paths.staging); await syncDirectory(paths.parent); await options.faultInjection?.('after-parent-sync')
	await releaseManifestLock(paths, lockEncoded)
}

export async function writeDemoFridayInitialDkgManifest(options: DemoFridayManifestWriteOptions): Promise<DemoFridayComposedManifestReceiptV1> {
	exactAbsolutePath(options.outputPath, 'manifest output'); exactAbsolutePath(options.receiptPath, 'manifest receipt')
	if (options.outputPath === options.receiptPath || dirname(options.outputPath) !== dirname(options.receiptPath)) {
		fail('manifest output and receipt must be distinct files in one directory')
	}
	const paths = manifestControlPaths(options.outputPath, options.receiptPath)
	await exactOwnedDirectory(paths.parent, 'manifest output directory')
	if (await pathExists(paths.lock)) fail('manifest composition lock exists; use reviewed recovery')
	if (await pathExists(paths.staging) || await pathExists(options.outputPath) || await pathExists(options.receiptPath)) {
		fail('manifest composition destination or staging already exists')
	}
	const payload = manifestPayload(options), owner = await manifestLockOwner(payload.bindingDigest)
	await acquireManifestLock(paths, owner.encoded); await options.faultInjection?.('after-lock')
	await completeManifestPair(options, paths, payload, owner.encoded)
	return payload.receipt
}
export async function recoverDemoFridayInitialDkgManifest(options: DemoFridayManifestWriteOptions): Promise<DemoFridayComposedManifestReceiptV1> {
	exactAbsolutePath(options.outputPath, 'manifest output'); exactAbsolutePath(options.receiptPath, 'manifest receipt')
	if (options.outputPath === options.receiptPath || dirname(options.outputPath) !== dirname(options.receiptPath)) {
		fail('manifest output and receipt must be distinct files in one directory')
	}
	const paths = manifestControlPaths(options.outputPath, options.receiptPath)
	await exactOwnedDirectory(paths.parent, 'manifest output directory'); await exactOwnedDirectory(paths.lock, 'manifest composition lock')
	const payload = manifestPayload(options), { owner, encoded } = await readManifestLockOwner(paths.owner, payload.bindingDigest)
	await assertOwnerDead(owner)
	await completeManifestPair({ ...options, faultInjection: undefined }, paths, payload, encoded)
	return payload.receipt
}
export function demoFridayCoordinatorIdentityDigest(value: DemoFridayCoordinatorIdentityV1): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(exactDemoFridayCoordinatorIdentity(value)))))
}
