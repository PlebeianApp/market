/**
 * Pure/public R20 manifest composer plus durable public/ciphertext courier.
 *
 * This module never accepts a private key, transport secret, arbitrary path,
 * URL, or command. Round-two values remain opaque recipient ciphertext and
 * are authenticated only by their final recipient's endpoint-held AEAD key.
 */
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_DKG_MANIFEST_SCHEMA,
	canonicalDemoFridayIpv6, exactDemoFridayDkgFipsNpub, exactDemoFridayDkgHostId,
	type DemoFridayDkgManifestParticipantV1, type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA, DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA,
} from './demo-friday-per-validator-dkg-enrollment-init'
import {
	DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA, executeDemoFridayDkgRelayRequestV1,
} from './demo-friday-per-validator-dkg-relay'
import {
	DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, demoFridayR20ProfileDigest,
	exactDemoFridayR20BoundManifest, type DemoFridayR20BoundManifestV1,
} from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_DEPLOYMENT_ID,
	DEMO_FRIDAY_R20_DKG_RUN_ID, DEMO_FRIDAY_R20_KEYSET_ID,
	DEMO_FRIDAY_R20_KEYSET_VERSION, type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'

const IDS = [1, 2, 3, 4] as const
type ParticipantId = typeof IDS[number]
const HEX32 = /^[0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{128}$/
const MAX_OUTPUT = 4 * 1024 * 1024
const O_CLOEXEC = 0o2000000

export const DEMO_FRIDAY_R20_COORDINATOR_PUBLIC_SCHEMA = 'PLEBEIAN_FRIDAY_R20_COORDINATOR_PUBLIC_V1' as const
export const DEMO_FRIDAY_R20_COURIER_RECEIPT_SCHEMA = 'PLEBEIAN_FRIDAY_R20_COURIER_RECEIPT_V1' as const

export interface DemoFridayR20CoordinatorPublicV1 {
	schema: typeof DEMO_FRIDAY_R20_COORDINATOR_PUBLIC_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	deploymentId: typeof DEMO_FRIDAY_R20_DEPLOYMENT_ID
	applicationRunId: typeof DEMO_FRIDAY_R20_APPLICATION_RUN_ID
	dkgRunId: typeof DEMO_FRIDAY_R20_DKG_RUN_ID
	committeeKeysetId: typeof DEMO_FRIDAY_R20_KEYSET_ID
	committeeKeysetVersion: typeof DEMO_FRIDAY_R20_KEYSET_VERSION
	predecessorAbortDigest: string
	abortAcknowledgementsDigest: string
	coordinatorIdentity: string
}

interface R20HostPin {
	schema: typeof DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	deploymentId: typeof DEMO_FRIDAY_R20_DEPLOYMENT_ID
	applicationRunId: typeof DEMO_FRIDAY_R20_APPLICATION_RUN_ID
	dkgRunId: typeof DEMO_FRIDAY_R20_DKG_RUN_ID
	committeeKeysetId: typeof DEMO_FRIDAY_R20_KEYSET_ID
	committeeKeysetVersion: typeof DEMO_FRIDAY_R20_KEYSET_VERSION
	participantId: ParticipantId
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

interface R20HostEnrollment {
	schema: typeof DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA
	hostPin: R20HostPin
	hostPinDigest: string
	dkgIdentity: string
	kexPublicKey: string
	signerIdentity: string
	dkgIdentitySignature: string
	signerIdentitySignature: string
}

export type DemoFridayR20CourierPhase =
	| 'enrollment' | 'confirmations' | 'round1' | 'agreement'
	| 'round2-1' | 'round2-2' | 'round2-3' | 'round2-4' | 'final'

export interface DemoFridayR20CourierProfile {
	root: string
	expectedUid: number
	expectedGid: number
}

export interface DemoFridayR20CourierReceiptV1 {
	schema: typeof DEMO_FRIDAY_R20_COURIER_RECEIPT_SCHEMA
	phase: DemoFridayR20CourierPhase
	manifestDigest: string
	manifestBindingDigest: string
	predecessorAbortDigest: string
	outputSha256: string
	outputSize: number
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R20_COURIER: ${message}`) }
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}
function hex32(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HEX32.test(value) || /^0+$/.test(value)) fail(`${label} is invalid`)
	return value
}
function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([domain, ...fields]))))
}
function exactParticipant(value: unknown): ParticipantId {
	if (!IDS.includes(value as ParticipantId)) fail('participant must be 1..4')
	return value as ParticipantId
}
function participantFields(value: DemoFridayDkgManifestParticipantV1): unknown[] {
	return [value.participantId, value.hostId, value.underlayIpv4, value.fipsNpub, value.fipsUla,
		value.dkgIdentity, value.signerIdentity, value.kexPublicKey, value.signerEndpoint,
		value.participantBinarySha256, value.inspectorBinarySha256, value.configPath, value.stateDirectory]
}

function exactCoordinator(value: unknown, profile: DemoFridayR20FreshDkgProfileV2,
	predecessor: DemoFridayDkgPublicManifestV1): DemoFridayR20CoordinatorPublicV1 {
	const raw = object(value, ['schema', 'valueProfile', 'deploymentId', 'applicationRunId', 'dkgRunId',
		'committeeKeysetId', 'committeeKeysetVersion', 'predecessorAbortDigest',
		'abortAcknowledgementsDigest', 'coordinatorIdentity'], 'coordinator public record')
	const identity = hex32(raw.coordinatorIdentity, 'coordinator identity')
	if (raw.schema !== DEMO_FRIDAY_R20_COORDINATOR_PUBLIC_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| raw.deploymentId !== profile.deploymentId || raw.applicationRunId !== profile.applicationRunId
		|| raw.dkgRunId !== profile.dkgRunId || raw.committeeKeysetId !== profile.committeeKeysetId
		|| raw.committeeKeysetVersion !== profile.committeeKeysetVersion
		|| raw.predecessorAbortDigest !== profile.predecessorAbortDigest
		|| raw.abortAcknowledgementsDigest !== profile.abortAcknowledgementsDigest
		|| identity === predecessor.coordinatorIdentity) fail('coordinator differs from the fixed fresh-run authority')
	try { schnorr.utils.lift_x(BigInt(`0x${identity}`)) } catch { fail('coordinator identity is not on curve') }
	return structuredClone(raw) as unknown as DemoFridayR20CoordinatorPublicV1
}

function exactPin(value: unknown, participantId: ParticipantId,
	profile: DemoFridayR20FreshDkgProfileV2): R20HostPin {
	const raw = object(value, ['schema', 'valueProfile', 'deploymentId', 'applicationRunId', 'dkgRunId',
		'committeeKeysetId', 'committeeKeysetVersion', 'participantId', 'hostId', 'underlayIpv4',
		'fipsNpub', 'fipsUla', 'signerEndpoint', 'participantBinarySha256', 'inspectorBinarySha256',
		'configPath', 'stateDirectory'], `host pin ${participantId}`)
	let hostId: string, fipsNpub: string
	try { hostId = exactDemoFridayDkgHostId(raw.hostId); fipsNpub = exactDemoFridayDkgFipsNpub(raw.fipsNpub) }
	catch { return fail(`host pin ${participantId} identity is invalid`) }
	if (raw.schema !== DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| raw.deploymentId !== profile.deploymentId || raw.applicationRunId !== profile.applicationRunId
		|| raw.dkgRunId !== profile.dkgRunId || raw.committeeKeysetId !== profile.committeeKeysetId
		|| raw.committeeKeysetVersion !== profile.committeeKeysetVersion
		|| exactParticipant(raw.participantId) !== participantId || typeof raw.underlayIpv4 !== 'string'
		|| isIP(raw.underlayIpv4) !== 4 || typeof raw.fipsUla !== 'string'
		|| canonicalDemoFridayIpv6(raw.fipsUla) !== raw.fipsUla
		|| raw.signerEndpoint !== `http://[${raw.fipsUla}]:39101/v1/frost`
		|| raw.configPath !== profile.configPath || raw.stateDirectory !== profile.stateDirectory) {
		fail(`host pin ${participantId} differs from the fixed fresh-run profile`)
	}
	return { schema: DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: profile.deploymentId, applicationRunId: profile.applicationRunId,
		dkgRunId: profile.dkgRunId, committeeKeysetId: profile.committeeKeysetId,
		committeeKeysetVersion: profile.committeeKeysetVersion, participantId, hostId,
		underlayIpv4: raw.underlayIpv4, fipsNpub, fipsUla: raw.fipsUla,
		signerEndpoint: raw.signerEndpoint, participantBinarySha256: hex32(raw.participantBinarySha256, 'participant binary'),
		inspectorBinarySha256: hex32(raw.inspectorBinarySha256, 'inspector binary'),
		configPath: profile.configPath, stateDirectory: profile.stateDirectory }
}

function pinDigest(pin: R20HostPin): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', [pin.schema, pin.valueProfile,
		pin.deploymentId, pin.applicationRunId, pin.dkgRunId, pin.committeeKeysetId,
		pin.committeeKeysetVersion, pin.participantId, pin.hostId, pin.underlayIpv4, pin.fipsNpub,
		pin.fipsUla, pin.signerEndpoint, pin.participantBinarySha256, pin.inspectorBinarySha256,
		pin.configPath, pin.stateDirectory])
}

function exactEnrollment(value: unknown, participantId: ParticipantId, expectedPin: string,
	profile: DemoFridayR20FreshDkgProfileV2): R20HostEnrollment {
	const raw = object(value, ['schema', 'hostPin', 'hostPinDigest', 'dkgIdentity', 'kexPublicKey',
		'signerIdentity', 'dkgIdentitySignature', 'signerIdentitySignature'], `host enrollment ${participantId}`)
	const hostPin = exactPin(raw.hostPin, participantId, profile)
	const dkgIdentity = hex32(raw.dkgIdentity, 'DKG identity'), kexPublicKey = hex32(raw.kexPublicKey, 'KEX key')
	const signerIdentity = hex32(raw.signerIdentity, 'signer identity')
	if (raw.schema !== DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA || raw.hostPinDigest !== expectedPin
		|| pinDigest(hostPin) !== expectedPin || new Set([dkgIdentity, kexPublicKey, signerIdentity]).size !== 3
		|| typeof raw.dkgIdentitySignature !== 'string' || !HEX64.test(raw.dkgIdentitySignature)
		|| typeof raw.signerIdentitySignature !== 'string' || !HEX64.test(raw.signerIdentitySignature)) {
		fail(`host enrollment ${participantId} binding is invalid`)
	}
	const unsigned = { schema: DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA, hostPin,
		hostPinDigest: expectedPin, dkgIdentity, kexPublicKey, signerIdentity }
	const messageDigest = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_V1', [
		unsigned.schema, unsigned.hostPinDigest, unsigned.hostPin, dkgIdentity, kexPublicKey, signerIdentity])
	if (!schnorr.verify(hexToBytes(raw.dkgIdentitySignature), hexToBytes(messageDigest), hexToBytes(dkgIdentity))
		|| !schnorr.verify(hexToBytes(raw.signerIdentitySignature), hexToBytes(messageDigest), hexToBytes(signerIdentity))) {
		fail(`host enrollment ${participantId} possession signature is invalid`)
	}
	return { ...unsigned, dkgIdentitySignature: raw.dkgIdentitySignature,
		signerIdentitySignature: raw.signerIdentitySignature }
}

export function composeDemoFridayR20BoundManifest(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: DemoFridayDkgPublicManifestV1
	coordinator: unknown
	enrollments: readonly unknown[]
	expectedHostPinDigests: readonly string[]
}): DemoFridayR20BoundManifestV1 {
	if (options.enrollments.length !== 4 || options.expectedHostPinDigests.length !== 4) {
		fail('exactly four enrollments and four external host-pin digests are required')
	}
	const coordinator = exactCoordinator(options.coordinator, options.profile, options.predecessorManifest)
	const enrollments = IDS.map((id, index) => exactEnrollment(options.enrollments[index], id,
		hex32(options.expectedHostPinDigests[index], `host pin ${id}`), options.profile))
	const participants = enrollments.map((value) => ({ participantId: value.hostPin.participantId,
		hostId: value.hostPin.hostId, underlayIpv4: value.hostPin.underlayIpv4, fipsNpub: value.hostPin.fipsNpub,
		fipsUla: value.hostPin.fipsUla, dkgIdentity: value.dkgIdentity, signerIdentity: value.signerIdentity,
		kexPublicKey: value.kexPublicKey, signerEndpoint: value.hostPin.signerEndpoint,
		participantBinarySha256: value.hostPin.participantBinarySha256,
		inspectorBinarySha256: value.hostPin.inspectorBinarySha256,
		configPath: options.profile.configPath, stateDirectory: options.profile.stateDirectory,
	})) as unknown as DemoFridayDkgPublicManifestV1['participants']
	const rosterDigest = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ROSTER_V1', participants.map(participantFields))
	const manifest: DemoFridayDkgPublicManifestV1 = {
		schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: options.profile.deploymentId, applicationRunId: options.profile.applicationRunId,
		dkgRunId: options.profile.dkgRunId, committeeKeysetId: options.profile.committeeKeysetId,
		committeeKeysetVersion: options.profile.committeeKeysetVersion, roster: IDS, rosterDigest,
		coordinatorParticipantId: 1, coordinatorIdentity: coordinator.coordinatorIdentity, participants,
	}
	const manifestDigest = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', [manifest.schema,
		manifest.valueProfile, manifest.deploymentId, manifest.applicationRunId, manifest.dkgRunId,
		manifest.committeeKeysetId, manifest.committeeKeysetVersion, manifest.roster, rosterDigest,
		manifest.coordinatorParticipantId, manifest.coordinatorIdentity, participants.map(participantFields)])
	const profileDigest = demoFridayR20ProfileDigest(options.profile)
	const bindingDigest = digest(DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA,
		[profileDigest, options.profile.predecessorAbortDigest, manifestDigest])
	return exactDemoFridayR20BoundManifest({ profile: options.profile,
		predecessorManifest: options.predecessorManifest,
		value: { schema: DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest,
			predecessorAbortDigest: options.profile.predecessorAbortDigest, manifest,
			manifestDigest, bindingDigest }, expectedBindingDigest: bindingDigest })
}

function phaseFile(phase: DemoFridayR20CourierPhase): string { return `${phase}.json` }
function previousPhase(phase: DemoFridayR20CourierPhase): DemoFridayR20CourierPhase | null {
	const phases: DemoFridayR20CourierPhase[] = [
		'enrollment', 'confirmations', 'round1', 'agreement',
		'round2-1', 'round2-2', 'round2-3', 'round2-4', 'final',
	]
	const index = phases.indexOf(phase)
	if (index < 0) fail('courier phase is unsupported')
	return index === 0 ? null : phases[index - 1]!
}
function absoluteRoot(value: string): string {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || resolve(value) !== value) {
		fail('courier root is not a dedicated canonical absolute path')
	}
	return value
}
async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC)
	try { await handle.sync() } finally { await handle.close() }
}
async function exactDirectory(path: string, profile: DemoFridayR20CourierProfile): Promise<void> {
	const meta = await lstat(path)
	if (!meta.isDirectory() || meta.isSymbolicLink() || meta.uid !== profile.expectedUid
		|| meta.gid !== profile.expectedGid || (meta.mode & 0o777) !== 0o700 || await realpath(path) !== path) {
		fail('courier directory identity is invalid')
	}
}
async function writeNew(path: string, value: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
		| constants.O_NOFOLLOW | O_CLOEXEC, 0o600)
	try { await handle.writeFile(value); await handle.sync(); await handle.chmod(0o600) } finally { await handle.close() }
}
async function exactFile(path: string, profile: DemoFridayR20CourierProfile): Promise<Uint8Array> {
	const before = await lstat(path)
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== profile.expectedUid
		|| before.gid !== profile.expectedGid || (before.mode & 0o777) !== 0o600 || before.size > MAX_OUTPUT
		|| await realpath(path) !== path) fail('courier file identity is invalid')
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC)
	try {
		const opened = await handle.stat()
		if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail('courier file changed while opened')
		return new Uint8Array(await handle.readFile())
	} finally { await handle.close() }
}

async function requirePhaseReceipt(profile: DemoFridayR20CourierProfile,
	bound: DemoFridayR20BoundManifestV1, profileBinding: DemoFridayR20FreshDkgProfileV2,
	phase: DemoFridayR20CourierPhase): Promise<void> {
	let value: unknown
	try {
		value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
			await exactFile(join(profile.root, 'receipts', phaseFile(phase)), profile)))
	} catch { return fail(`courier ${phase} receipt is absent or malformed`) }
	const raw = object(value, ['schema', 'phase', 'manifestDigest', 'manifestBindingDigest',
		'predecessorAbortDigest', 'outputSha256', 'outputSize'], `${phase} receipt`)
	const output = await exactFile(join(profile.root, 'outputs', phaseFile(phase)), profile)
	if (raw.schema !== DEMO_FRIDAY_R20_COURIER_RECEIPT_SCHEMA || raw.phase !== phase
		|| raw.manifestDigest !== bound.manifestDigest || raw.manifestBindingDigest !== bound.bindingDigest
		|| raw.predecessorAbortDigest !== profileBinding.predecessorAbortDigest
		|| raw.outputSha256 !== bytesToHex(sha256(output)) || raw.outputSize !== output.length) {
		fail(`courier ${phase} receipt differs from its durable bound output`)
	}
}

export async function initializeDemoFridayR20Courier(profile: DemoFridayR20CourierProfile,
	bound: DemoFridayR20BoundManifestV1): Promise<void> {
	absoluteRoot(profile.root)
	await mkdir(profile.root, { mode: 0o700 }); await chmod(profile.root, 0o700)
	await exactDirectory(profile.root, profile)
	for (const name of ['outputs', 'receipts']) {
		await mkdir(join(profile.root, name), { mode: 0o700 }); await chmod(join(profile.root, name), 0o700)
		await exactDirectory(join(profile.root, name), profile)
	}
	const encoded = utf8ToBytes(`${JSON.stringify(bound)}\n`)
	await writeNew(join(profile.root, 'bound-manifest.json'), encoded)
	await syncDirectory(profile.root); await syncDirectory(dirname(profile.root))
}

export async function executeDemoFridayR20CourierPhase(options: {
	profile: DemoFridayR20CourierProfile
	profileBinding: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: DemoFridayDkgPublicManifestV1
	expectedManifestBindingDigest: string
	phase: DemoFridayR20CourierPhase
	request: unknown
}): Promise<DemoFridayR20CourierReceiptV1> {
	absoluteRoot(options.profile.root); await exactDirectory(options.profile.root, options.profile)
	await exactDirectory(join(options.profile.root, 'outputs'), options.profile)
	await exactDirectory(join(options.profile.root, 'receipts'), options.profile)
	const boundBytes = await exactFile(join(options.profile.root, 'bound-manifest.json'), options.profile)
	let boundValue: unknown
	try { boundValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(boundBytes)) }
	catch { return fail('stored bound manifest is malformed') }
	const bound = exactDemoFridayR20BoundManifest({ profile: options.profileBinding,
		predecessorManifest: options.predecessorManifest, value: boundValue,
		expectedBindingDigest: options.expectedManifestBindingDigest })
	const previous = previousPhase(options.phase)
	if (previous !== null) await requirePhaseReceipt(options.profile, bound, options.profileBinding, previous)
	const request = object(options.request, ['schema', 'action', 'payload'], 'courier phase request')
	if (request.schema !== 'PLEBEIAN_FRIDAY_R20_COURIER_PHASE_REQUEST_V1') fail('courier phase request schema is invalid')
	const payload = object(request.payload, ['relayRequest'], 'courier payload')
	const relayRequest = object(payload.relayRequest, ['schema', 'action', ...(
		request.action === 'compose_authenticated_result' ? ['checkpoint'] :
		request.action === 'round2_bundle' ? ['manifest', 'expectedManifestDigest', 'recipientParticipantId', 'round1TranscriptDigest', 'envelopes'] :
		request.action === 'route_confirmations' ? ['manifest', 'expectedManifestDigest', 'sourceBundles'] :
		['manifest', 'expectedManifestDigest', 'entries'])], 'relay request')
	if (relayRequest.schema !== DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA) fail('nested relay schema differs')
	if (request.action !== relayRequest.action) fail('courier and relay action differ')
	const expectedAction = options.phase === 'enrollment' ? 'enrollment_bundle'
		: options.phase === 'confirmations' ? 'route_confirmations'
			: options.phase === 'round1' ? 'round1_bundle'
				: options.phase === 'agreement' ? 'agreement_bundle'
					: options.phase.startsWith('round2-') ? 'round2_bundle' : 'compose_authenticated_result'
	if (request.action !== expectedAction) fail('courier action is invalid for this fixed phase')
	if (options.phase.startsWith('round2-')
		&& relayRequest.recipientParticipantId !== Number(options.phase.slice('round2-'.length))) {
		fail('round-two phase and recipient differ')
	}
	if (request.action !== 'compose_authenticated_result') {
		if (JSON.stringify(relayRequest.manifest) !== JSON.stringify(bound.manifest)
			|| relayRequest.expectedManifestDigest !== bound.manifestDigest) fail('relay request differs from bound manifest')
	} else {
		const checkpoint = object(relayRequest.checkpoint, [
			'expectedManifestDigest', 'manifest', 'enrollments', 'round1Bundle', 'agreementBundle',
			'finalPublicPackages', 'publicInspections', 'finalAttestations',
		], 'authenticated-result checkpoint')
		if (checkpoint.expectedManifestDigest !== bound.manifestDigest
			|| JSON.stringify(checkpoint.manifest) !== JSON.stringify(bound.manifest)) {
			fail('authenticated-result checkpoint differs from the bound R20 manifest')
		}
	}
	const result = executeDemoFridayDkgRelayRequestV1(payload.relayRequest)
	const encoded = utf8ToBytes(`${JSON.stringify(result)}\n`)
	if (encoded.length > MAX_OUTPUT) fail('courier result exceeds the public/ciphertext output bound')
	const outputSha256 = bytesToHex(sha256(encoded))
	const receipt: DemoFridayR20CourierReceiptV1 = {
		schema: DEMO_FRIDAY_R20_COURIER_RECEIPT_SCHEMA, phase: options.phase,
		manifestDigest: bound.manifestDigest, manifestBindingDigest: bound.bindingDigest,
		predecessorAbortDigest: options.profileBinding.predecessorAbortDigest,
		outputSha256, outputSize: encoded.length,
	}
	const output = join(options.profile.root, 'outputs', phaseFile(options.phase))
	const receiptPath = join(options.profile.root, 'receipts', phaseFile(options.phase))
	await writeNew(output, encoded); await syncDirectory(join(options.profile.root, 'outputs'))
	await writeNew(receiptPath, utf8ToBytes(`${JSON.stringify(receipt)}\n`))
	await syncDirectory(join(options.profile.root, 'receipts')); await syncDirectory(options.profile.root)
	const installed = await exactFile(output, options.profile)
	if (bytesToHex(sha256(installed)) !== outputSha256) fail('durable courier output differs')
	return Object.freeze(receipt)
}
