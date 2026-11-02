/** Root-only permission seal for the stopped R18 keyset. No deletion is performed. */
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { demoFridayDkgManifestDigest, exactDemoFridayDkgManifest } from './demo-friday-per-validator-dkg-bootstrap'
import {
	demoFridayR18AbortDigest,
	exactDemoFridayR18AbortRecord,
} from './demo-friday-r20-fresh-profile'
import { verifyDemoFridayR18AbortSealBundle } from './demo-friday-r20-abort-seal'

const HEX_32 = /^[0-9a-f]{64}$/
const IDS = [1, 2, 3, 4] as const
const LINUX_O_PATH = 0o10000000
export const DEMO_FRIDAY_R18_PERMISSION_SEAL_SCHEMA = 'PLEBEIAN_FRIDAY_R18_PERMISSION_SEAL_V1' as const
export const DEMO_FRIDAY_R18_ABORT_BUNDLE_SCHEMA = 'PLEBEIAN_FRIDAY_R18_ABORT_BUNDLE_V1' as const
export const DEMO_FRIDAY_R18_PRODUCTION_ROOT = '/var/lib/plebeian-auctions-friday/frost/keyset-v1' as const
export const DEMO_FRIDAY_R18_PRODUCTION_PARENT = '/var/lib/plebeian-auctions-friday/frost' as const
export const DEMO_FRIDAY_R18_PRODUCTION_UID = 997 as const
export const DEMO_FRIDAY_R18_PRODUCTION_GID = 986 as const
export const DEMO_FRIDAY_R18_PRODUCTION_BUNDLE = '/var/lib/plebeian-auctions-friday-operator/dkg-r20/verified-abort-bundle.json' as const
export const DEMO_FRIDAY_R18_PUBLIC_SEAL = '/etc/plebeian-auctions-friday/r18-abort-seal.json' as const
export const DEMO_FRIDAY_R18_OPERATOR_SEAL_ROOT = '/var/lib/plebeian-auctions-friday-operator/dkg-r20/r18-permission-seal' as const
export const DEMO_FRIDAY_R18_HOST_BINARY = '/opt/plebeian-auctions-friday/bin/plebeian-friday-dkg-host' as const
export const DEMO_FRIDAY_R18_PARTICIPANT_BINARY = '/opt/plebeian-auctions-friday/bin/coco-demo-frost-participant' as const

export interface DemoFridayR18VerifiedAbortBundleV1 {
	schema: typeof DEMO_FRIDAY_R18_ABORT_BUNDLE_SCHEMA
	predecessorManifest: unknown
	abortRecord: unknown
	acknowledgements: unknown
}

export interface DemoFridayR18PermissionSealV1 {
	schema: typeof DEMO_FRIDAY_R18_PERMISSION_SEAL_SCHEMA
	participantId: 1 | 2 | 3 | 4
	abortDigest: string
	predecessorManifestDigest: string
	acknowledgementsDigest: string
	sealedRoot: string
	sealedParent: string
	priorOwnerUid: number
	priorOwnerGid: number
	sealedOwnerUid: number
	sealedOwnerGid: number
	sealedMode: '0700'
	sealedParentMode: '0711'
	status: 'R18_PRIVATE_ROOT_SEALED_NO_REPLAY'
}

export interface DemoFridayR18PermissionSealProfile {
	root: string
	rootParent: string
	bundlePath: string
	publicSealPath: string
	operatorSealRoot: string
	hostBinary: string
	participantBinary: string
	serviceUid: number
	serviceGid: number
	sealedUid: number
	sealedGid: number
}

export const DEMO_FRIDAY_R18_PRODUCTION_SEAL_PROFILE: DemoFridayR18PermissionSealProfile = Object.freeze({
	root: DEMO_FRIDAY_R18_PRODUCTION_ROOT, rootParent: DEMO_FRIDAY_R18_PRODUCTION_PARENT,
	bundlePath: DEMO_FRIDAY_R18_PRODUCTION_BUNDLE,
	publicSealPath: DEMO_FRIDAY_R18_PUBLIC_SEAL, operatorSealRoot: DEMO_FRIDAY_R18_OPERATOR_SEAL_ROOT,
	hostBinary: DEMO_FRIDAY_R18_HOST_BINARY, participantBinary: DEMO_FRIDAY_R18_PARTICIPANT_BINARY,
	serviceUid: DEMO_FRIDAY_R18_PRODUCTION_UID, serviceGid: DEMO_FRIDAY_R18_PRODUCTION_GID,
	sealedUid: 0, sealedGid: 0,
})

function isProductionProfile(profile: DemoFridayR18PermissionSealProfile): boolean {
	return Object.entries(DEMO_FRIDAY_R18_PRODUCTION_SEAL_PROFILE)
		.every(([key, value]) => profile[key as keyof DemoFridayR18PermissionSealProfile] === value)
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R18_PERMISSION_SEAL: ${message}`) }
function digest(value: string): string { return bytesToHex(sha256(utf8ToBytes(value))) }

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function canonical(path: string, label: string): string {
	if (!path.startsWith('/') || resolve(path) !== path || path === '/' || path.endsWith('/') || path.includes('//')) {
		fail(`${label} is not a canonical absolute path`)
	}
	return path
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try { await handle.sync() } finally { await handle.close() }
}

async function readProtectedJson(path: string, expectedUid: number, expectedMode: number, label: string): Promise<unknown> {
	canonical(path, label)
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const before = await handle.stat()
		if (!before.isFile() || before.nlink !== 1 || before.uid !== expectedUid
			|| (before.mode & 0o777) !== expectedMode || before.size < 2 || before.size > 512 * 1024
			|| await realpath(path) !== path) fail(`${label} metadata differs`)
		const bytes = await handle.readFile()
		const after = await handle.stat()
		if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
			|| before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			fail(`${label} changed while read`)
		}
		try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
		catch { fail(`${label} is not UTF-8 JSON`) }
	} finally { await handle.close() }
}

export function exactDemoFridayR18VerifiedAbortBundle(options: {
	value: unknown
	expectedAbortDigest: string
}): { manifestDigest: string; abortDigest: string; acknowledgementsDigest: string; serviceSealDigest: string } {
	if (!HEX_32.test(options.expectedAbortDigest)) fail('expected abort digest is malformed')
	const raw = exactObject(options.value, ['schema', 'predecessorManifest', 'abortRecord', 'acknowledgements'], 'abort bundle')
	if (raw.schema !== DEMO_FRIDAY_R18_ABORT_BUNDLE_SCHEMA || !Array.isArray(raw.acknowledgements)
		|| raw.acknowledgements.length !== 4) fail('abort bundle profile differs')
	verifyDemoFridayR18AbortSealBundle({ predecessorManifest: raw.predecessorManifest,
		abortRecord: raw.abortRecord, acknowledgements: raw.acknowledgements,
		expectedAbortDigest: options.expectedAbortDigest })
	const manifest = exactDemoFridayDkgManifest(raw.predecessorManifest)
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest: manifest, record: raw.abortRecord })
	const abortDigest = demoFridayR18AbortDigest(record)
	if (abortDigest !== options.expectedAbortDigest) fail('abort digest differs from external pin')
	for (let index = 0; index < 4; index += 1) {
		const acknowledgement = raw.acknowledgements[index] as Record<string, unknown>
		if (acknowledgement.participantId !== IDS[index]) fail('abort acknowledgements are not in exact roster order')
	}
	return { manifestDigest: demoFridayDkgManifestDigest(manifest), abortDigest,
		acknowledgementsDigest: digest(`${JSON.stringify(raw.acknowledgements)}\n`),
		serviceSealDigest: record.serviceSealDigest }
}

async function executableIdentity(path: string): Promise<{ dev: number; ino: number }> {
	canonical(path, 'executable')
	const metadata = await stat(path)
	if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o111) === 0
		|| (metadata.mode & 0o022) !== 0 || await realpath(path) !== path) fail('pinned executable metadata differs')
	return { dev: metadata.dev, ino: metadata.ino }
}

export async function assertDemoFridayR18ProcessesAbsent(profile: DemoFridayR18PermissionSealProfile): Promise<void> {
	const identities = await Promise.all([executableIdentity(profile.hostBinary), executableIdentity(profile.participantBinary)])
	for (const name of await readdir('/proc')) {
		if (!/^[1-9][0-9]*$/.test(name)) continue
		const exe = `/proc/${name}/exe`
		try {
			const target = await readlink(exe)
			const metadata = await stat(exe)
			if (identities.some((identity) => identity.dev === metadata.dev && identity.ino === metadata.ino)
				|| [profile.hostBinary, profile.participantBinary].includes(target)) {
				fail('an R18 DKG executable is still running')
			}
		} catch (error) {
			if (error instanceof Error && 'code' in error && ['ENOENT', 'ESRCH'].includes(String(error.code))) continue
			if (error instanceof Error && error.message.includes('still running')) throw error
			fail('process executable inventory could not be completed')
		}
	}
}

async function writeExclusive(path: string, bytes: Uint8Array, mode: number): Promise<void> {
	const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
	try { await handle.writeFile(bytes); await handle.sync(); await handle.chmod(mode) } finally { await handle.close() }
}

/**
 * Apply the metadata-only seal. The caller must be root in production.
 * A crash leaves an exclusive operator directory or sealed root and therefore
 * requires inspection; this function never resumes or rolls back implicitly.
 */
export async function applyDemoFridayR18PermissionSeal(options: {
	profile: DemoFridayR18PermissionSealProfile
	participantId: 1 | 2 | 3 | 4
	expectedAbortDigest: string
	expectedServiceSealDigest: string
}): Promise<DemoFridayR18PermissionSealV1> {
	const profile = options.profile
	for (const [label, path] of Object.entries({ root: profile.root, bundle: profile.bundlePath,
		rootParent: profile.rootParent, publicSeal: profile.publicSealPath,
		operatorSeal: profile.operatorSealRoot })) canonical(path, label)
	if (dirname(profile.root) !== profile.rootParent) fail('R18 root is not directly beneath its fixed parent')
	if (isProductionProfile(profile) && process.geteuid?.() !== 0) fail('production seal requires root')
	const bundle = exactDemoFridayR18VerifiedAbortBundle({
		value: await readProtectedJson(profile.bundlePath, profile.sealedUid, 0o600, 'verified abort bundle'),
		expectedAbortDigest: options.expectedAbortDigest,
	})
	if (!HEX_32.test(options.expectedServiceSealDigest)
		|| bundle.serviceSealDigest !== options.expectedServiceSealDigest) {
		fail('service-seal contract digest differs from the authoritative abort record')
	}
	await assertDemoFridayR18ProcessesAbsent(profile)
	const parentHandle = await open(profile.rootParent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	const rootHandle = await open(profile.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try {
		const parentBefore = await parentHandle.stat()
		if (!parentBefore.isDirectory() || parentBefore.uid !== profile.serviceUid || parentBefore.gid !== profile.serviceGid
			|| (parentBefore.mode & 0o777) !== 0o700 || parentBefore.nlink < 2
			|| await realpath(profile.rootParent) !== profile.rootParent) fail('R18 parent metadata differs')
		const before = await rootHandle.stat()
		if (!before.isDirectory() || before.uid !== profile.serviceUid || before.gid !== profile.serviceGid
			|| (before.mode & 0o777) !== 0o700 || before.nlink < 2 || await realpath(profile.root) !== profile.root) {
			fail('R18 private root metadata differs from the stopped run')
		}
		try {
			await lstat(profile.operatorSealRoot)
			fail('permission-seal operation already exists')
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
		}
		await mkdir(profile.operatorSealRoot, { mode: 0o700 })
		await syncDirectory(dirname(profile.operatorSealRoot))
		const seal: DemoFridayR18PermissionSealV1 = {
			schema: DEMO_FRIDAY_R18_PERMISSION_SEAL_SCHEMA, participantId: options.participantId,
			abortDigest: bundle.abortDigest, predecessorManifestDigest: bundle.manifestDigest,
			acknowledgementsDigest: bundle.acknowledgementsDigest, sealedRoot: profile.root,
			sealedParent: profile.rootParent,
			priorOwnerUid: profile.serviceUid, priorOwnerGid: profile.serviceGid,
			sealedOwnerUid: profile.sealedUid, sealedOwnerGid: profile.sealedGid, sealedMode: '0700',
			sealedParentMode: '0711',
			status: 'R18_PRIVATE_ROOT_SEALED_NO_REPLAY',
		}
		await writeExclusive(join(profile.operatorSealRoot, 'pending.json'),
			utf8ToBytes(`${JSON.stringify(seal)}\n`), 0o600)
		await syncDirectory(profile.operatorSealRoot)
		await rootHandle.chown(profile.sealedUid, profile.sealedGid)
		await rootHandle.chmod(0o700)
		await rootHandle.sync()
		const after = await rootHandle.stat()
		if (after.dev !== before.dev || after.ino !== before.ino || after.uid !== profile.sealedUid
			|| after.gid !== profile.sealedGid || (after.mode & 0o777) !== 0o700) fail('R18 root seal did not persist')
		await parentHandle.chown(profile.sealedUid, profile.sealedGid)
		await parentHandle.chmod(0o711)
		await parentHandle.sync()
		const parentAfter = await parentHandle.stat()
		if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino
			|| parentAfter.uid !== profile.sealedUid || parentAfter.gid !== profile.sealedGid
			|| (parentAfter.mode & 0o777) !== 0o711) fail('R18 parent seal did not persist')
		await syncDirectory(dirname(profile.rootParent))
		await writeExclusive(profile.publicSealPath, utf8ToBytes(`${JSON.stringify(seal)}\n`), 0o444)
		await syncDirectory(dirname(profile.publicSealPath))
		await writeExclusive(join(profile.operatorSealRoot, 'complete.json'),
			utf8ToBytes(`${JSON.stringify(seal)}\n`), 0o600)
		await syncDirectory(profile.operatorSealRoot)
		return seal
	} finally { await rootHandle.close(); await parentHandle.close() }
}

/** Every R20 driver must call this before touching fresh-run private state. */
export function requireDemoFridayR20PredecessorPermissionSeal(options: {
	value: unknown
	expectedAbortDigest: string
	expectedManifestDigest: string
	expectedParticipantId: 1 | 2 | 3 | 4
}): DemoFridayR18PermissionSealV1 {
	const raw = exactObject(options.value, [
		'schema', 'participantId', 'abortDigest', 'predecessorManifestDigest', 'acknowledgementsDigest',
		'sealedRoot', 'sealedParent', 'priorOwnerUid', 'priorOwnerGid', 'sealedOwnerUid', 'sealedOwnerGid',
		'sealedMode', 'sealedParentMode', 'status',
	], 'permission seal')
	if (raw.schema !== DEMO_FRIDAY_R18_PERMISSION_SEAL_SCHEMA || raw.participantId !== options.expectedParticipantId
		|| raw.abortDigest !== options.expectedAbortDigest || raw.predecessorManifestDigest !== options.expectedManifestDigest
		|| typeof raw.acknowledgementsDigest !== 'string' || !HEX_32.test(raw.acknowledgementsDigest)
		|| raw.sealedRoot !== DEMO_FRIDAY_R18_PRODUCTION_ROOT
		|| raw.sealedParent !== DEMO_FRIDAY_R18_PRODUCTION_PARENT
		|| raw.priorOwnerUid !== DEMO_FRIDAY_R18_PRODUCTION_UID || raw.priorOwnerGid !== DEMO_FRIDAY_R18_PRODUCTION_GID
		|| raw.sealedOwnerUid !== 0 || raw.sealedOwnerGid !== 0 || raw.sealedMode !== '0700'
		|| raw.sealedParentMode !== '0711'
		|| raw.status !== 'R18_PRIVATE_ROOT_SEALED_NO_REPLAY') fail('permission seal differs from fixed R20 predecessor')
	return structuredClone(raw) as unknown as DemoFridayR18PermissionSealV1
}

/** Metadata-only verifier; O_PATH deliberately requires no directory read permission. */
export async function verifyDemoFridayR18SealedDirectoryMetadata(options: {
	path: string
	uid: number
	gid: number
	mode: 0o700 | 0o711
	label: 'parent' | 'private root'
}): Promise<void> {
	canonical(options.path, `sealed R18 ${options.label}`)
	const pathBefore = await lstat(options.path)
	const handle = await open(options.path, LINUX_O_PATH | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try {
		const metadata = await handle.stat()
		const [resolved, pathAfter] = await Promise.all([realpath(options.path), lstat(options.path)])
		if (!metadata.isDirectory() || metadata.uid !== options.uid || metadata.gid !== options.gid
			|| (metadata.mode & 0o777) !== options.mode || metadata.nlink < 2
			|| resolved !== options.path || !pathBefore.isDirectory() || !pathAfter.isDirectory()
			|| pathBefore.dev !== metadata.dev || pathBefore.ino !== metadata.ino
			|| pathAfter.dev !== metadata.dev || pathAfter.ino !== metadata.ino
			|| pathBefore.nlink !== metadata.nlink || pathAfter.nlink !== metadata.nlink
			|| (pathBefore.mode & 0o777) !== (metadata.mode & 0o777)
			|| (pathAfter.mode & 0o777) !== (metadata.mode & 0o777)) {
			fail(`sealed R18 ${options.label} metadata differs`)
		}
	} finally { await handle.close() }
}

/**
 * Fixed-production-path verifier for every R20 host/service entry point.
 * It verifies both the public seal and the effective filesystem revocation;
 * callers must still independently pin the abort and predecessor manifest.
 */
export async function verifyDemoFridayR20PredecessorPermissionSealFromFixedPath(options: {
	expectedAbortDigest: string
	expectedManifestDigest: string
	expectedParticipantId: 1 | 2 | 3 | 4
}): Promise<DemoFridayR18PermissionSealV1> {
	const value = await readProtectedJson(DEMO_FRIDAY_R18_PUBLIC_SEAL, 0, 0o444, 'public permission seal')
	const seal = requireDemoFridayR20PredecessorPermissionSeal({ ...options, value })
	await verifyDemoFridayR18SealedDirectoryMetadata({
		path: DEMO_FRIDAY_R18_PRODUCTION_PARENT, uid: 0, gid: 0, mode: 0o711, label: 'parent',
	})
	await verifyDemoFridayR18SealedDirectoryMetadata({
		path: DEMO_FRIDAY_R18_PRODUCTION_ROOT, uid: 0, gid: 0, mode: 0o700, label: 'private root',
	})
	return seal
}
