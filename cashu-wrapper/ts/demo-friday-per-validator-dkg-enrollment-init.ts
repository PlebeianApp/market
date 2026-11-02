#!/usr/bin/env bun
/**
 * DEMO-ONLY, single-host DKG/KEX/RPC enrollment initializer.
 *
 * The executable has no all-host mode. It consumes one externally approved
 * host pin, creates one participant's private identities atomically on that
 * participant's final host, and prints only the public dual-signed enrollment.
 * It is never called implicitly by a signer or service startup path.
 */
import {
	constants,
} from 'node:fs'
import {
	lstat, mkdir, open, readFile, readdir, realpath, rmdir, unlink,
	type FileHandle,
} from 'node:fs/promises'
import { isIP } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'

import { dlopen, FFIType, read as ffiRead } from 'bun:ffi'

import { x25519 } from '@noble/curves/ed25519.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	canonicalDemoFridayIpv6,
	exactDemoFridayDkgFipsNpub,
	exactDemoFridayDkgHostId,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
	type DemoFridayParticipantId,
} from './demo-friday-per-validator-dkg-plan'

const PARTICIPANTS = [1, 2, 3, 4] as const
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const MAX_PIN_BYTES = 64 * 1024
const LINUX_O_CLOEXEC = 0o2000000

export const DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA =
	'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1' as const
export const DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA =
	'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_V1' as const
export const DEMO_FRIDAY_DKG_ENROLLMENT_LOCK_SCHEMA =
	'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_LOCK_V1' as const
export const DEMO_FRIDAY_DKG_ENROLLMENT_JOURNAL_SCHEMA =
	'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_JOURNAL_V1' as const
export const DEMO_FRIDAY_DKG_ENROLLMENT_PARENT =
	'/var/lib/plebeian-auctions-friday/frost' as const
export const DEMO_FRIDAY_DKG_HOST_PIN_PATH =
	'/var/lib/plebeian-auctions-friday/frost/owner-approved-host-enrollment-pin.json' as const

export interface DemoFridayDkgOwnerApprovedHostPinV1 {
	schema: typeof DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	deploymentId: string
	applicationRunId: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	participantId: DemoFridayParticipantId
	hostId: string
	underlayIpv4: string
	fipsNpub: string
	fipsUla: string
	signerEndpoint: string
	participantBinarySha256: string
	inspectorBinarySha256: string
	configPath: string
	stateDirectory: string
}

export interface DemoFridayDkgHostEnrollmentV1 {
	schema: typeof DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA
	hostPin: DemoFridayDkgOwnerApprovedHostPinV1
	hostPinDigest: string
	dkgIdentity: string
	kexPublicKey: string
	signerIdentity: string
	dkgIdentitySignature: string
	signerIdentitySignature: string
}

export interface DemoFridayDkgEnrollmentKeyGenerator {
	dkgIdentitySecret(): Uint8Array
	kexSecret(): Uint8Array
	signerIdentitySecret(): Uint8Array
}

export interface DemoFridayDkgEnrollmentFilesystemProfile {
	parentDirectory: string
	filesystemRoot: string
	hostPinPath: string
	/** Logical paths signed into the pin; omitted by legacy v1 mirrors. */
	logicalRoot?: string
}

export interface InitializeDemoFridayDkgHostEnrollmentOptions {
	participantId: DemoFridayParticipantId
	expectedHostPinDigest: string
	/** Fixed-fixture test seam. The CLI always uses the production generator. */
	keyGenerator?: DemoFridayDkgEnrollmentKeyGenerator
	/** Filesystem mirror test seam. The CLI always uses fixed production paths. */
	profile?: DemoFridayDkgEnrollmentFilesystemProfile
	/** Fixed-fixture crash seam. The CLI never supplies this hook. */
	faultInjection?: (phase: DemoFridayDkgEnrollmentFaultPhase) => Promise<void>
}

export const DEMO_FRIDAY_DKG_ENROLLMENT_FAULT_PHASES = [
	'after-lock-directory', 'after-lock-owner', 'after-journal-start', 'after-staging-directory',
	'after-private-files', 'after-public-enrollment', 'after-staging-sync', 'after-rename', 'after-parent-sync',
] as const
export type DemoFridayDkgEnrollmentFaultPhase = typeof DEMO_FRIDAY_DKG_ENROLLMENT_FAULT_PHASES[number]

export interface RecoverDemoFridayDkgHostEnrollmentOptions {
	participantId: DemoFridayParticipantId
	expectedHostPinDigest: string
	/** Filesystem mirror test seam. The CLI always uses fixed production paths. */
	profile?: DemoFridayDkgEnrollmentFilesystemProfile
	/** Fixed-fixture destination-race seam. The CLI never supplies this hook. */
	beforePromotion?: () => Promise<void>
}

interface EnrollmentLockOwnerV1 {
	schema: typeof DEMO_FRIDAY_DKG_ENROLLMENT_LOCK_SCHEMA
	pid: number
	bootId: string
	processStartTicks: string
	hostPinDigest: string
	participantId: DemoFridayParticipantId
}

type EnrollmentJournalPhase = 'started' | 'staging_complete' | 'promoted'

interface EnrollmentJournalRecordV1 {
	schema: typeof DEMO_FRIDAY_DKG_ENROLLMENT_JOURNAL_SCHEMA
	hostPinDigest: string
	participantId: DemoFridayParticipantId
	phase: EnrollmentJournalPhase
}

function fail(message: string): never {
	throw new Error(`DEMO_FRIDAY_DKG_HOST_ENROLLMENT: ${message}`)
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function exactParticipant(value: unknown): DemoFridayParticipantId {
	if (!Number.isInteger(value) || !PARTICIPANTS.includes(value as DemoFridayParticipantId)) {
		fail('participant must be exactly one of 1..4')
	}
	return value as DemoFridayParticipantId
}

function exactIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${label} is invalid`)
	return value
}

function exactHex32(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HEX_32.test(value) || /^0+$/.test(value)) fail(`${label} is invalid`)
	return value
}

function canonicalAbsolute(value: string, label: string): string {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || resolve(value) !== value) {
		fail(`${label} must be a dedicated canonical absolute path`)
	}
	return value
}

function productionProfile(): DemoFridayDkgEnrollmentFilesystemProfile {
	return {
		parentDirectory: DEMO_FRIDAY_DKG_ENROLLMENT_PARENT,
		filesystemRoot: DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
		hostPinPath: DEMO_FRIDAY_DKG_HOST_PIN_PATH,
	}
}

function profileLogicalRoot(profile: DemoFridayDkgEnrollmentFilesystemProfile): string {
	return profile.logicalRoot ?? DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT
}

function frame(domain: string, fields: unknown[]): Uint8Array {
	return utf8ToBytes(JSON.stringify([domain, ...fields]))
}

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(frame(domain, fields)))
}

function signDigest(domain: string, messageDigest: string, secret: Uint8Array): string {
	return bytesToHex(schnorr.sign(
		hexToBytes(messageDigest), secret, sha256(frame(`${domain}_AUX`, [messageDigest])),
	))
}

export function exactDemoFridayDkgOwnerApprovedHostPin(
	value: unknown,
): DemoFridayDkgOwnerApprovedHostPinV1 {
	return exactDemoFridayDkgOwnerApprovedHostPinAtRoot(value, DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT)
}

export function exactDemoFridayDkgOwnerApprovedHostPinAtRoot(
	value: unknown,
	expectedRoot: string,
): DemoFridayDkgOwnerApprovedHostPinV1 {
	canonicalAbsolute(expectedRoot, 'expected enrollment root')
	const raw = exactObject(value, [
		'schema', 'valueProfile', 'deploymentId', 'applicationRunId', 'dkgRunId', 'committeeKeysetId',
		'committeeKeysetVersion', 'participantId', 'hostId', 'underlayIpv4', 'fipsNpub', 'fipsUla',
		'signerEndpoint', 'participantBinarySha256', 'inspectorBinarySha256', 'configPath', 'stateDirectory',
	], 'owner-approved host pin')
	const participantId = exactParticipant(raw.participantId)
	if (raw.schema !== DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| typeof raw.underlayIpv4 !== 'string' || isIP(raw.underlayIpv4) !== 4
		|| typeof raw.fipsUla !== 'string' || !/^(?:fc|fd)/.test(raw.fipsUla)
		|| canonicalDemoFridayIpv6(raw.fipsUla) !== raw.fipsUla) {
		fail('owner-approved host identity or FIPS binding is invalid')
	}
	let hostId: string; let fipsNpub: string
	try {
		hostId = exactDemoFridayDkgHostId(raw.hostId)
		fipsNpub = exactDemoFridayDkgFipsNpub(raw.fipsNpub)
	} catch { fail('owner-approved host identity or FIPS binding is invalid') }
	const signerEndpoint = `http://[${raw.fipsUla}]:39101/v1/frost`
	const configPath = `${expectedRoot}/participant.config.json`
	const stateDirectory = `${expectedRoot}/state`
	if (raw.signerEndpoint !== signerEndpoint || raw.configPath !== configPath || raw.stateDirectory !== stateDirectory) {
		fail('owner-approved endpoint or local paths differ from the fixed deployment profile')
	}
	return {
		schema: DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: exactIdentifier(raw.deploymentId, 'deploymentId'),
		applicationRunId: exactIdentifier(raw.applicationRunId, 'applicationRunId'),
		dkgRunId: exactIdentifier(raw.dkgRunId, 'dkgRunId'),
		committeeKeysetId: exactIdentifier(raw.committeeKeysetId, 'committeeKeysetId'),
		committeeKeysetVersion: exactIdentifier(raw.committeeKeysetVersion, 'committeeKeysetVersion'),
		participantId, hostId, underlayIpv4: raw.underlayIpv4,
		fipsNpub, fipsUla: raw.fipsUla, signerEndpoint,
		participantBinarySha256: exactHex32(raw.participantBinarySha256, 'participantBinarySha256'),
		inspectorBinarySha256: exactHex32(raw.inspectorBinarySha256, 'inspectorBinarySha256'),
		configPath, stateDirectory,
	}
}

export function demoFridayDkgOwnerApprovedHostPinDigest(
	value: DemoFridayDkgOwnerApprovedHostPinV1,
): string {
	return demoFridayDkgOwnerApprovedHostPinDigestAtRoot(value, DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT)
}

export function demoFridayDkgOwnerApprovedHostPinDigestAtRoot(
	value: DemoFridayDkgOwnerApprovedHostPinV1,
	expectedRoot: string,
): string {
	const pin = exactDemoFridayDkgOwnerApprovedHostPinAtRoot(value, expectedRoot)
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', [
		pin.schema, pin.valueProfile, pin.deploymentId, pin.applicationRunId, pin.dkgRunId,
		pin.committeeKeysetId, pin.committeeKeysetVersion, pin.participantId, pin.hostId,
		pin.underlayIpv4, pin.fipsNpub, pin.fipsUla, pin.signerEndpoint,
		pin.participantBinarySha256, pin.inspectorBinarySha256, pin.configPath, pin.stateDirectory,
	])
}

function hostEnrollmentDigest(value: Omit<DemoFridayDkgHostEnrollmentV1,
	'dkgIdentitySignature' | 'signerIdentitySignature'>): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_V1', [
		value.schema, value.hostPinDigest, value.hostPin, value.dkgIdentity, value.kexPublicKey,
		value.signerIdentity,
	])
}

function publicEnrollment(
	pin: DemoFridayDkgOwnerApprovedHostPinV1,
	hostPinDigest: string,
	dkgSecret: Uint8Array,
	kexSecret: Uint8Array,
	signerSecret: Uint8Array,
): DemoFridayDkgHostEnrollmentV1 {
	if (dkgSecret.length !== 32 || kexSecret.length !== 32 || signerSecret.length !== 32) {
		fail('generated private identity has an invalid length')
	}
	let dkgIdentity: string
	let kexPublicKey: string
	let signerIdentity: string
	try {
		dkgIdentity = bytesToHex(schnorr.getPublicKey(dkgSecret))
		kexPublicKey = bytesToHex(x25519.getPublicKey(kexSecret))
		signerIdentity = bytesToHex(schnorr.getPublicKey(signerSecret))
	} catch {
		fail('generated private identity is invalid')
	}
	if ([dkgIdentity, kexPublicKey, signerIdentity].some((value) => !HEX_32.test(value) || /^0+$/.test(value))
		|| new Set([dkgIdentity, kexPublicKey, signerIdentity]).size !== 3) {
		fail('generated DKG, KEX, and RPC identities must be valid and pairwise distinct')
	}
	const unsigned: Omit<DemoFridayDkgHostEnrollmentV1,
		'dkgIdentitySignature' | 'signerIdentitySignature'> = {
		schema: DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA, hostPin: structuredClone(pin), hostPinDigest,
		dkgIdentity, kexPublicKey, signerIdentity,
	}
	const messageDigest = hostEnrollmentDigest(unsigned)
	return {
		...unsigned,
		dkgIdentitySignature: signDigest(
			'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_DKG_V1', messageDigest, dkgSecret,
		),
		signerIdentitySignature: signDigest(
			'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_RPC_V1', messageDigest, signerSecret,
		),
	}
}

export function verifyDemoFridayDkgHostEnrollment(
	value: unknown,
	expectedHostPinDigest: string,
): DemoFridayDkgHostEnrollmentV1 {
	return verifyDemoFridayDkgHostEnrollmentAtRoot(value, expectedHostPinDigest,
		DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT)
}

export function verifyDemoFridayDkgHostEnrollmentAtRoot(
	value: unknown,
	expectedHostPinDigest: string,
	expectedRoot: string,
): DemoFridayDkgHostEnrollmentV1 {
	if (!HEX_32.test(expectedHostPinDigest)) fail('expected host pin digest is invalid')
	const raw = exactObject(value, [
		'schema', 'hostPin', 'hostPinDigest', 'dkgIdentity', 'kexPublicKey', 'signerIdentity',
		'dkgIdentitySignature', 'signerIdentitySignature',
	], 'host enrollment')
	const hostPin = exactDemoFridayDkgOwnerApprovedHostPinAtRoot(raw.hostPin, expectedRoot)
	const dkgIdentity = exactHex32(raw.dkgIdentity, 'dkgIdentity')
	const kexPublicKey = exactHex32(raw.kexPublicKey, 'kexPublicKey')
	const signerIdentity = exactHex32(raw.signerIdentity, 'signerIdentity')
	if (raw.schema !== DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA || raw.hostPinDigest !== expectedHostPinDigest
		|| demoFridayDkgOwnerApprovedHostPinDigestAtRoot(hostPin, expectedRoot) !== expectedHostPinDigest
		|| new Set([dkgIdentity, kexPublicKey, signerIdentity]).size !== 3
		|| typeof raw.dkgIdentitySignature !== 'string' || !HEX_64.test(raw.dkgIdentitySignature)
		|| typeof raw.signerIdentitySignature !== 'string' || !HEX_64.test(raw.signerIdentitySignature)) {
		fail('host enrollment binding is invalid')
	}
	const unsigned = {
		schema: DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA, hostPin, hostPinDigest: expectedHostPinDigest,
		dkgIdentity, kexPublicKey, signerIdentity,
	} satisfies Omit<DemoFridayDkgHostEnrollmentV1, 'dkgIdentitySignature' | 'signerIdentitySignature'>
	const messageDigest = hostEnrollmentDigest(unsigned)
	if (!schnorr.verify(hexToBytes(raw.dkgIdentitySignature), hexToBytes(messageDigest), hexToBytes(dkgIdentity))
		|| !schnorr.verify(hexToBytes(raw.signerIdentitySignature), hexToBytes(messageDigest), hexToBytes(signerIdentity))) {
		fail('host enrollment possession signatures are invalid')
	}
	return {
		...unsigned, dkgIdentitySignature: raw.dkgIdentitySignature,
		signerIdentitySignature: raw.signerIdentitySignature,
	}
}

function productionKeyGenerator(): DemoFridayDkgEnrollmentKeyGenerator {
	return {
		dkgIdentitySecret: () => schnorr.utils.randomSecretKey(),
		kexSecret: () => x25519.utils.randomSecretKey(),
		signerIdentitySecret: () => schnorr.utils.randomSecretKey(),
	}
}

async function exactOwnedFile(path: string, mode: number, label: string): Promise<void> {
	const handle = await openExactOwnedFile(path, mode, label)
	await handle.close()
}

async function openExactOwnedFile(path: string, mode: number, label: string): Promise<FileHandle> {
	const pathMetadata = await lstat(path)
	const uid = process.geteuid?.()
	if (uid === undefined || !pathMetadata.isFile() || pathMetadata.isSymbolicLink() || pathMetadata.nlink !== 1
		|| pathMetadata.uid !== uid || (pathMetadata.mode & 0o777) !== mode || await realpath(path) !== path) {
		fail(`${label} must be an owned regular ${mode.toString(8)} file without links`)
	}
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | LINUX_O_CLOEXEC)
	try {
		const metadata = await handle.stat()
		if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== uid
			|| (metadata.mode & 0o777) !== mode || metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) {
			fail(`${label} changed while it was opened`)
		}
		return handle
	} catch (error) {
		await handle.close()
		throw error
	}
}

async function readExactOwnedFile(path: string, mode: number, label: string): Promise<Buffer> {
	const handle = await openExactOwnedFile(path, mode, label)
	try { return await handle.readFile() }
	finally { await handle.close() }
}

async function exactOwnedDirectory(path: string, label: string): Promise<void> {
	const metadata = await lstat(path)
	const uid = process.geteuid?.()
	if (uid === undefined || !metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid
		|| (metadata.mode & 0o777) !== 0o700 || await realpath(path) !== path) {
		fail(`${label} must be an owned real 0700 directory`)
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY)
	try { await handle.sync() } finally { await handle.close() }
}

async function writeNewFile(path: string, text: string): Promise<void> {
	let handle: FileHandle | undefined
	try {
		handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
			| constants.O_NOFOLLOW | LINUX_O_CLOEXEC, 0o600)
		await handle.writeFile(text, 'utf8')
		await handle.sync()
		await handle.chmod(0o600)
	} finally { await handle?.close() }
}

async function readJson(path: string, label: string, secret = false): Promise<unknown> {
	let bytes: Buffer
	if (secret) bytes = await readExactOwnedFile(path, 0o600, label)
	else {
		const metadata = await lstat(path)
		if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path) {
			fail(`${label} must be a real regular file without links`)
		}
		const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | LINUX_O_CLOEXEC)
		try {
			const opened = await handle.stat()
			if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
				fail(`${label} changed while it was opened`)
			}
			bytes = await handle.readFile()
		} finally { await handle.close() }
	}
	if (bytes.length === 0 || bytes.length > MAX_PIN_BYTES) fail(`${label} has an invalid size`)
	try { return JSON.parse(bytes.toString('utf8')) as unknown }
	catch { fail(`${label} is not valid JSON`) }
}

async function readSecret(path: string, label: string): Promise<Uint8Array> {
	const text = (await readExactOwnedFile(path, 0o600, label)).toString('utf8')
	if (!/^[0-9a-f]{64}\n$/.test(text)) fail(`${label} is invalid`)
	return hexToBytes(text.trim())
}

function hostPaths(root: string, pin: DemoFridayDkgOwnerApprovedHostPinV1) {
	const exchange = join(root, 'exchange', pin.dkgRunId)
	return {
		dkgSecret: join(root, 'identity-signing-key.hex'),
		kexSecret: join(root, 'kex-private-key.hex'),
		signerSecret: join(root, 'signer-rpc-identity.key'),
		config: join(root, 'participant.config.json'), state: join(root, 'state'), exchange,
		enrollment: join(exchange, `participant-${pin.participantId}.host-enrollment.json`),
	}
}

function exactParticipantConfig(pin: DemoFridayDkgOwnerApprovedHostPinV1): Record<string, unknown> {
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
		run_id: pin.dkgRunId, committee_keyset_id: pin.committeeKeysetId,
		committee_keyset_version: pin.committeeKeysetVersion, participant_id: pin.participantId,
		max_signers: 4, min_signers: 3, roster: PARTICIPANTS,
	}
}

async function verifyEnrollmentRoot(
	profile: DemoFridayDkgEnrollmentFilesystemProfile,
	root: string,
	pin: DemoFridayDkgOwnerApprovedHostPinV1,
	expectedHostPinDigest: string,
): Promise<DemoFridayDkgHostEnrollmentV1> {
	canonicalAbsolute(root, 'host enrollment root')
	if (dirname(root) !== profile.parentDirectory) fail('host enrollment root is outside its fixed parent')
	await exactOwnedDirectory(root, 'host enrollment root')
	const paths = hostPaths(root, pin)
	await exactOwnedDirectory(paths.state, 'participant state directory')
	await exactOwnedDirectory(dirname(paths.exchange), 'exchange root')
	await exactOwnedDirectory(paths.exchange, 'run exchange directory')
	const [dkgSecret, kexSecret, signerSecret] = await Promise.all([
		readSecret(paths.dkgSecret, 'DKG identity secret'), readSecret(paths.kexSecret, 'KEX secret'),
		readSecret(paths.signerSecret, 'signer RPC identity secret'),
	])
	try {
			const enrollment = verifyDemoFridayDkgHostEnrollmentAtRoot(
			await readJson(paths.enrollment, 'public host enrollment', true), expectedHostPinDigest,
				profileLogicalRoot(profile),
		)
		const expected = publicEnrollment(pin, expectedHostPinDigest, dkgSecret, kexSecret, signerSecret)
		if (JSON.stringify(enrollment) !== JSON.stringify(expected)) fail('stored enrollment differs from fixed private identities')
		const config = await readJson(paths.config, 'participant config', true)
		if (JSON.stringify(config) !== JSON.stringify(exactParticipantConfig(pin))) fail('participant config differs from owner pin')
		return enrollment
	} finally { dkgSecret.fill(0); kexSecret.fill(0); signerSecret.fill(0) }
}

async function hostPin(
	profile: DemoFridayDkgEnrollmentFilesystemProfile,
	expectedHostPinDigest: string,
	participantId: DemoFridayParticipantId,
): Promise<DemoFridayDkgOwnerApprovedHostPinV1> {
	const bytes = await readExactOwnedFile(profile.hostPinPath, 0o600, 'owner-approved host pin')
	if (bytes.length === 0 || bytes.length > MAX_PIN_BYTES) fail('owner-approved host pin has an invalid size')
	let value: unknown
	try { value = JSON.parse(bytes.toString('utf8')) as unknown }
	catch { fail('owner-approved host pin is not valid JSON') }
	const pin = exactDemoFridayDkgOwnerApprovedHostPinAtRoot(value, profileLogicalRoot(profile))
	if (pin.participantId !== participantId) fail('requested participant differs from the owner-approved host pin')
	if (demoFridayDkgOwnerApprovedHostPinDigestAtRoot(pin, profileLogicalRoot(profile)) !== expectedHostPinDigest) {
		fail('owner-approved host pin differs from the externally supplied digest')
	}
	return pin
}

function exactProfile(profile: DemoFridayDkgEnrollmentFilesystemProfile): void {
	canonicalAbsolute(profile.parentDirectory, 'enrollment parent')
	canonicalAbsolute(profile.filesystemRoot, 'enrollment root')
	canonicalAbsolute(profile.hostPinPath, 'host pin path')
	canonicalAbsolute(profileLogicalRoot(profile), 'logical enrollment root')
	if (dirname(profile.filesystemRoot) !== profile.parentDirectory) fail('enrollment root must be a direct child of its fixed parent')
}

function enrollmentControlPaths(profile: DemoFridayDkgEnrollmentFilesystemProfile) {
	const stem = basename(profile.filesystemRoot)
	const lock = join(profile.parentDirectory, `.${stem}.enrollment-init.lock`)
	return {
		lock, owner: join(lock, 'owner.json'), journal: join(lock, 'journal.jsonl'),
		staging: join(profile.parentDirectory, `.${stem}.initializing`),
	}
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

function exactEnrollmentLockOwner(
	value: unknown,
	participantId: DemoFridayParticipantId,
	expectedHostPinDigest: string,
): EnrollmentLockOwnerV1 {
	const raw = exactObject(value, [
		'schema', 'pid', 'bootId', 'processStartTicks', 'hostPinDigest', 'participantId',
	], 'enrollment lock owner')
	if (raw.schema !== DEMO_FRIDAY_DKG_ENROLLMENT_LOCK_SCHEMA || !Number.isSafeInteger(raw.pid) || Number(raw.pid) < 1
		|| typeof raw.bootId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(raw.bootId)
		|| typeof raw.processStartTicks !== 'string' || !/^[0-9]+$/.test(raw.processStartTicks)
		|| raw.hostPinDigest !== expectedHostPinDigest || raw.participantId !== participantId) {
		fail('enrollment lock owner is malformed or belongs to another host pin')
	}
	return structuredClone(raw) as unknown as EnrollmentLockOwnerV1
}

async function readEnrollmentLockOwner(
	path: string,
	participantId: DemoFridayParticipantId,
	expectedHostPinDigest: string,
): Promise<{ owner: EnrollmentLockOwnerV1; encoded: string }> {
	let value: unknown
	try { value = await readJson(path, 'enrollment lock owner', true) }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			fail('manual recovery required: enrollment lock exists without an authenticated owner record')
		}
		throw error
	}
	const owner = exactEnrollmentLockOwner(value, participantId, expectedHostPinDigest)
	return { owner, encoded: `${JSON.stringify(owner)}\n` }
}

async function assertEnrollmentOwnerDead(owner: EnrollmentLockOwnerV1): Promise<void> {
	if (await currentBootId() !== owner.bootId) return
	const currentStart = await processStartTicks(owner.pid)
	if (currentStart === null || currentStart !== owner.processStartTicks) return
	fail('enrollment lock owner is still live; recovery is forbidden')
}

function exactEnrollmentJournalRecord(
	value: unknown,
	participantId: DemoFridayParticipantId,
	expectedHostPinDigest: string,
): EnrollmentJournalRecordV1 {
	const raw = exactObject(value, ['schema', 'hostPinDigest', 'participantId', 'phase'], 'enrollment journal record')
	if (raw.schema !== DEMO_FRIDAY_DKG_ENROLLMENT_JOURNAL_SCHEMA || raw.hostPinDigest !== expectedHostPinDigest
		|| raw.participantId !== participantId || !['started', 'staging_complete', 'promoted'].includes(String(raw.phase))) {
		fail('enrollment journal record is malformed or belongs to another host pin')
	}
	return structuredClone(raw) as unknown as EnrollmentJournalRecordV1
}

async function appendEnrollmentJournal(
	path: string,
	record: EnrollmentJournalRecordV1,
	create = false,
): Promise<void> {
	let handle: FileHandle
	if (create) {
		handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
			| constants.O_NOFOLLOW | LINUX_O_CLOEXEC, 0o600)
	}
	else {
		const readHandle = await openExactOwnedFile(path, 0o600, 'enrollment journal')
		const expected = await readHandle.stat()
		await readHandle.close()
		handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | LINUX_O_CLOEXEC)
		const opened = await handle.stat()
		if (opened.dev !== expected.dev || opened.ino !== expected.ino || opened.nlink !== 1
			|| opened.uid !== process.geteuid?.() || (opened.mode & 0o777) !== 0o600) {
			await handle.close()
			fail('enrollment journal changed while it was opened for append')
		}
	}
	try {
		await handle.appendFile(`${JSON.stringify(record)}\n`, 'utf8')
		await handle.sync(); await handle.chmod(0o600)
	} finally { await handle.close() }
}

async function readEnrollmentJournal(
	path: string,
	participantId: DemoFridayParticipantId,
	expectedHostPinDigest: string,
): Promise<EnrollmentJournalRecordV1[]> {
	try { await exactOwnedFile(path, 0o600, 'enrollment journal') }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
		throw error
	}
	const text = (await readExactOwnedFile(path, 0o600, 'enrollment journal')).toString('utf8')
	if (text === '' || !text.endsWith('\n')) fail('enrollment journal is empty or torn')
	const records = text.trim().split('\n').map((line) => {
		let value: unknown
		try { value = JSON.parse(line) as unknown } catch { fail('enrollment journal contains invalid JSON') }
		return exactEnrollmentJournalRecord(value, participantId, expectedHostPinDigest)
	})
	const order: EnrollmentJournalPhase[] = ['started', 'staging_complete', 'promoted']
	if (records[0]?.phase !== 'started'
		|| records.some((record, index) => order.indexOf(record.phase) !== index)) {
		fail('enrollment journal has an impossible phase sequence')
	}
	return records
}

async function pathExists(path: string): Promise<boolean> {
	try { await lstat(path); return true }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
		throw error
	}
}

const AT_FDCWD = -100
const RENAME_NOREPLACE = 1
const EEXIST = 17

/** Linux x86-64 is the only reviewed Friday deployment target. */
async function renameNoReplace(source: string, destination: string): Promise<void> {
	canonicalAbsolute(source, 'staging promotion source')
	canonicalAbsolute(destination, 'staging promotion destination')
	if (process.platform !== 'linux' || process.arch !== 'x64') {
		fail('atomic no-replace promotion is unavailable on this deployment platform')
	}
	const libc = dlopen('/lib/x86_64-linux-gnu/libc.so.6', {
		renameat2: {
			args: [FFIType.i32, FFIType.cstring, FFIType.i32, FFIType.cstring, FFIType.u32],
			returns: FFIType.i32,
		},
		__errno_location: { args: [], returns: FFIType.ptr },
	})
	try {
		const sourceBytes = Buffer.from(`${source}\0`, 'utf8')
		const destinationBytes = Buffer.from(`${destination}\0`, 'utf8')
		if (libc.symbols.renameat2(AT_FDCWD, sourceBytes, AT_FDCWD, destinationBytes, RENAME_NOREPLACE) === 0) return
		const errnoPointer = libc.symbols.__errno_location()
		if (errnoPointer === null) fail('atomic no-replace promotion could not read the kernel error state')
		const errno = ffiRead.i32(errnoPointer)
		if (errno === EEXIST) fail('final enrollment root appeared before atomic promotion; existing state and staging were preserved')
		fail(`atomic no-replace enrollment promotion failed with errno ${errno}; existing state and staging were preserved`)
	} finally { libc.close() }
}

async function releaseEnrollmentLock(
	profile: DemoFridayDkgEnrollmentFilesystemProfile,
	paths: ReturnType<typeof enrollmentControlPaths>,
	expectedOwner: string,
): Promise<void> {
	await exactOwnedDirectory(paths.lock, 'enrollment lock')
	if ((await readExactOwnedFile(paths.owner, 0o600, 'enrollment lock owner')).toString('utf8') !== expectedOwner) {
		fail('enrollment lock owner changed; refusing release')
	}
	const entries = (await readdir(paths.lock)).sort()
	if (JSON.stringify(entries) !== JSON.stringify(['journal.jsonl', 'owner.json'])
		&& JSON.stringify(entries) !== JSON.stringify(['owner.json'])) {
		fail('enrollment lock contains unexpected recovery state')
	}
	if (entries.includes('journal.jsonl')) await unlink(paths.journal)
	await unlink(paths.owner); await rmdir(paths.lock); await syncDirectory(profile.parentDirectory)
}

async function fault(
	options: InitializeDemoFridayDkgHostEnrollmentOptions,
	phase: DemoFridayDkgEnrollmentFaultPhase,
): Promise<void> {
	await options.faultInjection?.(phase)
}

export async function recoverDemoFridayDkgHostEnrollment(
	options: RecoverDemoFridayDkgHostEnrollmentOptions,
): Promise<DemoFridayDkgHostEnrollmentV1> {
	const participantId = exactParticipant(options.participantId)
	if (!HEX_32.test(options.expectedHostPinDigest)) fail('expected host pin digest is invalid')
	const profile = options.profile ?? productionProfile(); exactProfile(profile)
	await exactOwnedDirectory(profile.parentDirectory, 'enrollment parent')
	const pin = await hostPin(profile, options.expectedHostPinDigest, participantId)
	const paths = enrollmentControlPaths(profile)
	await exactOwnedDirectory(paths.lock, 'enrollment lock')
	const { owner, encoded } = await readEnrollmentLockOwner(paths.owner, participantId, options.expectedHostPinDigest)
	await assertEnrollmentOwnerDead(owner)
	await readEnrollmentJournal(paths.journal, participantId, options.expectedHostPinDigest)
	const rootExists = await pathExists(profile.filesystemRoot)
	const stagingExists = await pathExists(paths.staging)
	if (rootExists && stagingExists) fail('manual recovery required: both final and staging enrollment roots exist')
	let enrollment: DemoFridayDkgHostEnrollmentV1
	if (rootExists) {
		try { enrollment = await verifyEnrollmentRoot(profile, profile.filesystemRoot, pin, options.expectedHostPinDigest) }
		catch (error) { throw new Error('manual recovery required: final enrollment root failed verification', { cause: error }) }
	} else if (stagingExists) {
		try { enrollment = await verifyEnrollmentRoot(profile, paths.staging, pin, options.expectedHostPinDigest) }
		catch (error) {
			throw new Error('manual recovery required: incomplete enrollment staging was preserved without regenerating identities', { cause: error })
		}
		const currentPin = await hostPin(profile, options.expectedHostPinDigest, participantId)
		if (JSON.stringify(currentPin) !== JSON.stringify(pin)) fail('owner-approved host pin changed during recovery')
		await options.beforePromotion?.()
		await renameNoReplace(paths.staging, profile.filesystemRoot); await syncDirectory(profile.parentDirectory)
		enrollment = await verifyEnrollmentRoot(profile, profile.filesystemRoot, pin, options.expectedHostPinDigest)
	} else {
		fail('manual recovery required: enrollment stopped before durable identity output; lock preserved')
	}
	const currentPin = await hostPin(profile, options.expectedHostPinDigest, participantId)
	if (JSON.stringify(currentPin) !== JSON.stringify(pin)) fail('owner-approved host pin changed before recovery completion')
	await releaseEnrollmentLock(profile, paths, encoded)
	return enrollment
}

export async function initializeDemoFridayDkgHostEnrollment(
	options: InitializeDemoFridayDkgHostEnrollmentOptions,
): Promise<DemoFridayDkgHostEnrollmentV1> {
	const participantId = exactParticipant(options.participantId)
	if (!HEX_32.test(options.expectedHostPinDigest)) fail('expected host pin digest is invalid')
	const profile = options.profile ?? productionProfile(); exactProfile(profile)
	await exactOwnedDirectory(profile.parentDirectory, 'enrollment parent')
	const pin = await hostPin(profile, options.expectedHostPinDigest, participantId)
	const paths = enrollmentControlPaths(profile)
	const startTicks = await processStartTicks(process.pid)
	if (startTicks === null) fail('current process identity disappeared before enrollment lock creation')
	const owner: EnrollmentLockOwnerV1 = {
		schema: DEMO_FRIDAY_DKG_ENROLLMENT_LOCK_SCHEMA, pid: process.pid, bootId: await currentBootId(),
		processStartTicks: startTicks, hostPinDigest: options.expectedHostPinDigest, participantId,
	}
	const ownerEncoded = `${JSON.stringify(owner)}\n`
	try { await mkdir(paths.lock, { mode: 0o700 }) }
	catch { fail('single-host enrollment lock exists or is stranded') }
	await syncDirectory(profile.parentDirectory); await fault(options, 'after-lock-directory')
	await writeNewFile(paths.owner, ownerEncoded); await syncDirectory(paths.lock); await fault(options, 'after-lock-owner')
	await appendEnrollmentJournal(paths.journal, {
		schema: DEMO_FRIDAY_DKG_ENROLLMENT_JOURNAL_SCHEMA, hostPinDigest: options.expectedHostPinDigest,
		participantId, phase: 'started',
	}, true)
	await syncDirectory(paths.lock); await fault(options, 'after-journal-start')
	let completed = false
	try {
		const rootExists = await pathExists(profile.filesystemRoot)
		if (rootExists) {
			let enrollment: DemoFridayDkgHostEnrollmentV1
			try { enrollment = await verifyEnrollmentRoot(profile, profile.filesystemRoot, pin, options.expectedHostPinDigest) }
			catch (error) {
				throw new Error('existing final enrollment root failed verification; state was preserved', { cause: error })
			}
			const currentPin = await hostPin(profile, options.expectedHostPinDigest, participantId)
			if (JSON.stringify(currentPin) !== JSON.stringify(pin)) {
				fail('owner-approved host pin changed while replaying initialization')
			}
			completed = true
			return enrollment
		}
		try { await lstat(paths.staging); fail('single-host enrollment staging directory is stranded') }
		catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
		}
		const generator = options.keyGenerator ?? productionKeyGenerator()
		const dkgSecret = generator.dkgIdentitySecret()
		const kexSecret = generator.kexSecret()
		const signerSecret = generator.signerIdentitySecret()
		try {
			const enrollment = publicEnrollment(pin, options.expectedHostPinDigest, dkgSecret, kexSecret, signerSecret)
			await mkdir(paths.staging, { mode: 0o700 }); await fault(options, 'after-staging-directory')
			const host = hostPaths(paths.staging, pin)
			await mkdir(join(paths.staging, 'state'), { mode: 0o700 })
			await mkdir(join(paths.staging, 'exchange'), { mode: 0o700 })
			await mkdir(host.exchange, { mode: 0o700 })
			await writeNewFile(host.dkgSecret, `${bytesToHex(dkgSecret)}\n`)
			await writeNewFile(host.kexSecret, `${bytesToHex(kexSecret)}\n`)
			await writeNewFile(host.signerSecret, `${bytesToHex(signerSecret)}\n`)
			await writeNewFile(host.config, `${JSON.stringify(exactParticipantConfig(pin))}\n`)
			await fault(options, 'after-private-files')
			await writeNewFile(host.enrollment, `${JSON.stringify(enrollment)}\n`)
			await fault(options, 'after-public-enrollment')
			await syncDirectory(host.exchange); await syncDirectory(join(paths.staging, 'exchange'))
			await syncDirectory(host.state); await syncDirectory(paths.staging)
			await appendEnrollmentJournal(paths.journal, {
				schema: DEMO_FRIDAY_DKG_ENROLLMENT_JOURNAL_SCHEMA, hostPinDigest: options.expectedHostPinDigest,
				participantId, phase: 'staging_complete',
			})
			await fault(options, 'after-staging-sync')
			const currentPin = await hostPin(profile, options.expectedHostPinDigest, participantId)
			if (JSON.stringify(currentPin) !== JSON.stringify(pin)) fail('owner-approved host pin changed during initialization')
			await renameNoReplace(paths.staging, profile.filesystemRoot); await fault(options, 'after-rename')
			await syncDirectory(profile.parentDirectory)
			await appendEnrollmentJournal(paths.journal, {
				schema: DEMO_FRIDAY_DKG_ENROLLMENT_JOURNAL_SCHEMA, hostPinDigest: options.expectedHostPinDigest,
				participantId, phase: 'promoted',
			})
			await fault(options, 'after-parent-sync')
			await verifyEnrollmentRoot(profile, profile.filesystemRoot, pin, options.expectedHostPinDigest)
			completed = true
			return enrollment
		} finally { dkgSecret.fill(0); kexSecret.fill(0); signerSecret.fill(0) }
	} finally {
		if (completed) await releaseEnrollmentLock(profile, paths, ownerEncoded)
	}
}

export function demoFridayDkgEnrollmentInitArgs(argv = process.argv.slice(2)): {
	participantId: DemoFridayParticipantId
	expectedHostPinDigest: string
} {
	if (argv.length !== 5 || argv[0] !== 'init' || argv[1] !== '--participant'
		|| argv[3] !== '--expected-host-pin-digest') {
		fail('usage: plebeian-friday-dkg-enrollment-init init --participant 1..4 --expected-host-pin-digest HEX')
	}
	return { participantId: exactParticipant(Number(argv[2])), expectedHostPinDigest: argv[4]! }
}

export function demoFridayDkgEnrollmentRecoveryArgs(argv = process.argv.slice(2)): RecoverDemoFridayDkgHostEnrollmentOptions {
	if (argv.length !== 5 || argv[0] !== 'recover' || argv[1] !== '--participant'
		|| argv[3] !== '--expected-host-pin-digest') {
		fail('usage: plebeian-friday-dkg-enrollment-init recover --participant 1..4 --expected-host-pin-digest HEX')
	}
	return { participantId: exactParticipant(Number(argv[2])), expectedHostPinDigest: argv[4]! }
}

/**
 * Deployment canary for the compiled Bun/libc boundary. It operates only in a
 * fresh, explicitly named /tmp directory and creates no identities.
 */
export async function runDemoFridayEnrollmentNoReplaceSelfTest(root: string): Promise<{
	schema: 'PLEBEIAN_FRIDAY_ENROLLMENT_NOREPLACE_SELF_TEST_V1'
	supported: true
}> {
	if (!root.startsWith('/tmp/plebeian-friday-enrollment-noreplace-') || resolve(root) !== root) {
		fail('no-replace self-test root must be a dedicated canonical /tmp path')
	}
	await mkdir(root, { mode: 0o700 })
	const source = join(root, 'source'), destination = join(root, 'destination'), collision = join(root, 'collision')
	try {
		await mkdir(source, { mode: 0o700 }); await writeNewFile(join(source, 'marker'), 'first\n')
		await renameNoReplace(source, destination)
		if (await readFile(join(destination, 'marker'), 'utf8') !== 'first\n') fail('no-replace self-test promotion changed bytes')
		await mkdir(collision, { mode: 0o700 }); await writeNewFile(join(collision, 'marker'), 'second\n')
		let rejected = false
		try { await renameNoReplace(collision, destination) } catch { rejected = true }
		if (!rejected || await readFile(join(destination, 'marker'), 'utf8') !== 'first\n'
			|| await readFile(join(collision, 'marker'), 'utf8') !== 'second\n') {
			fail('no-replace self-test did not preserve both collision paths')
		}
		await unlink(join(destination, 'marker')); await rmdir(destination)
		await unlink(join(collision, 'marker')); await rmdir(collision); await rmdir(root)
		return { schema: 'PLEBEIAN_FRIDAY_ENROLLMENT_NOREPLACE_SELF_TEST_V1', supported: true }
	} catch (error) {
		throw new Error('compiled no-replace self-test failed; inspect the dedicated temporary root', { cause: error })
	}
}

if (import.meta.main) {
	const argv = process.argv.slice(2)
	if (argv.length === 3 && argv[0] === 'self-test-no-replace' && argv[1] === '--root') {
		process.stdout.write(`${JSON.stringify(await runDemoFridayEnrollmentNoReplaceSelfTest(argv[2]!))}\n`)
		process.exit(0)
	}
	const enrollment = argv[0] === 'recover'
		? await recoverDemoFridayDkgHostEnrollment(demoFridayDkgEnrollmentRecoveryArgs(argv))
		: await initializeDemoFridayDkgHostEnrollment(demoFridayDkgEnrollmentInitArgs(argv))
	process.stdout.write(`${JSON.stringify(enrollment)}\n`)
}
