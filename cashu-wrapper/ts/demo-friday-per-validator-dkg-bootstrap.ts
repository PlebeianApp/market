/**
 * Pure, DEMO-ONLY per-validator DKG bootstrap.
 *
 * There is intentionally no key generation, persistence, process execution,
 * transport, or coordinator-side secret API here.  One host supplies its own
 * already-created DKG identity and X25519 secret, verifies the four-party
 * public manifest and attestations, derives only its three endpoint keys, and
 * confirms those keys with its peers before producing the Rust participant's
 * local transport-secrets object.
 */
import { isIP } from 'node:net'

import { x25519 } from '@noble/curves/ed25519.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
	type DemoFridayParticipantId,
} from './demo-friday-per-validator-dkg-plan'

const PARTICIPANTS = [1, 2, 3, 4] as const
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const NPUB = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const HOST_ID = /^linode-[1-9][0-9]{5,11}$/
const PAIRWISE_PURPOSE = 'COCO_DEMO_FROST_DKG_ROUND2_PAIRWISE_KEY_V1' as const

export const DEMO_FRIDAY_DKG_MANIFEST_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1' as const
export const DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_V1' as const
export const DEMO_FRIDAY_DKG_CONFIRMATION_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_V1' as const
export const DEMO_FRIDAY_DKG_FINAL_ATTESTATION_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V1' as const

export interface DemoFridayDkgManifestParticipantV1 {
	participantId: DemoFridayParticipantId
	hostId: string
	underlayIpv4: string
	fipsNpub: string
	fipsUla: string
	dkgIdentity: string
	signerIdentity: string
	kexPublicKey: string
	signerEndpoint: string
	participantBinarySha256: string
	inspectorBinarySha256: string
	configPath: string
	stateDirectory: string
}

export interface DemoFridayDkgPublicManifestV1 {
	schema: typeof DEMO_FRIDAY_DKG_MANIFEST_SCHEMA
	valueProfile: 'FAKE_MONEY_ONLY'
	deploymentId: string
	applicationRunId: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	roster: readonly [1, 2, 3, 4]
	rosterDigest: string
	coordinatorParticipantId: 1
	coordinatorIdentity: string
	participants: readonly [
		DemoFridayDkgManifestParticipantV1,
		DemoFridayDkgManifestParticipantV1,
		DemoFridayDkgManifestParticipantV1,
		DemoFridayDkgManifestParticipantV1,
	]
}

export interface DemoFridayDkgEnrollmentAttestationV1 {
	schema: typeof DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA
	manifestDigest: string
	rosterDigest: string
	participantId: DemoFridayParticipantId
	dkgIdentity: string
	signature: string
}

export interface DemoFridayDkgPairwiseConfirmationV1 {
	schema: typeof DEMO_FRIDAY_DKG_CONFIRMATION_SCHEMA
	manifestDigest: string
	rosterDigest: string
	purpose: typeof PAIRWISE_PURPOSE
	lowerParticipantId: DemoFridayParticipantId
	upperParticipantId: DemoFridayParticipantId
	senderParticipantId: DemoFridayParticipantId
	recipientParticipantId: DemoFridayParticipantId
	lowerKexPublicKey: string
	upperKexPublicKey: string
	confirmationMac: string
	dkgIdentity: string
	signature: string
}

export interface DemoFridayDkgTransportSecretsV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	participant_id: DemoFridayParticipantId
	identity_signing_key_hex: string
	identity_verifying_keys: Array<{ participant_id: DemoFridayParticipantId; verifying_key_hex: string }>
	round2_pairwise_keys: Array<{ peer_id: DemoFridayParticipantId; key_hex: string }>
}

interface DemoFridayDkgLocalPairwiseBootstrap {
	participantId: DemoFridayParticipantId
	manifestDigest: string
	transportSecrets: DemoFridayDkgTransportSecretsV1
	confirmationsToSend: DemoFridayDkgPairwiseConfirmationV1[]
}

/** Public handle contains confirmations only; usable transport keys remain module-private. */
export interface DemoFridayDkgTransportGateV2 {
	schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_TRANSPORT_GATE_V2'
	participantId: DemoFridayParticipantId
	manifestDigest: string
	confirmationsToSend: readonly DemoFridayDkgPairwiseConfirmationV1[]
}

export interface DemoFridayDkgFinalPublicPackageV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	participant_id: DemoFridayParticipantId
	public_key_package_hex: string
	public_key_package_sha256: string
}

export interface DemoFridayDkgRound1EnvelopeV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	sender: DemoFridayParticipantId
	payload_hex: string
	auth_signature_hex: string
}

export interface DemoFridayDkgRound1AgreementV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	participant_id: DemoFridayParticipantId
	round1_digest: string
	auth_signature_hex: string
}

export interface DemoFridayDkgRound1BundleV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	entries: DemoFridayDkgRound1EnvelopeV1[]
}

export interface DemoFridayDkgRound1AgreementBundleV1 {
	version: typeof DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
	entries: DemoFridayDkgRound1AgreementV1[]
}

export interface DemoFridayDkgPublicInspectionV1 {
	version: 'COCO_DEMO_FROST_PUBLIC_INSPECTION_V1'
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	source_participant_id: DemoFridayParticipantId
	public_key_package_sha256: string
	committee_public_key: string
	min_signers: 3
	max_signers: 4
	verifying_shares: Array<{ participant_id: DemoFridayParticipantId; verifying_share_hex: string }>
}

export interface DemoFridayDkgFinalAttestationV1 {
	schema: typeof DEMO_FRIDAY_DKG_FINAL_ATTESTATION_SCHEMA
	manifestDigest: string
	rosterDigest: string
	round1TranscriptDigest: string
	participantId: DemoFridayParticipantId
	dkgIdentity: string
	signerIdentity: string
	publicKeyPackageSha256: string
	publicSummaryDigest: string
	signature: string
}

export interface DemoFridayPublicDkgResultV1 {
	schema: 'PLEBEIAN_FRIDAY_FIPS_DKG_RESULT_V1'
	runId: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	publicKeyPackagePath: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	committeePublicKey: string
	coordinatorIdentity: string
	participants: Array<{
		participantId: DemoFridayParticipantId
		configPath: string
		stateDirectory: string
		verifyingShare: string
		signerIdentity: string
		signerEndpoint: string
	}>
}

function fail(message: string): never {
	throw new Error(`DEMO_FRIDAY_PER_VALIDATOR_BOOTSTRAP: ${message}`)
}

function exactObject(value: unknown, keys: string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function exactIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${label} is invalid`)
	return value
}

function exactParticipant(value: unknown, label: string): DemoFridayParticipantId {
	if (!Number.isInteger(value) || !PARTICIPANTS.includes(value as DemoFridayParticipantId)) fail(`${label} must be 1..4`)
	return value as DemoFridayParticipantId
}

function exactHex32(value: unknown, label: string): string {
	if (typeof value !== 'string' || !HEX_32.test(value)) fail(`${label} must be canonical 32-byte hex`)
	return value
}

export function exactDemoFridayDkgHostId(value: unknown): string {
	if (typeof value !== 'string' || !HOST_ID.test(value)) fail('hostId is invalid')
	return value
}

export function exactDemoFridayDkgFipsNpub(value: unknown): string {
	if (typeof value !== 'string' || !NPUB.test(value)) fail('fipsNpub is invalid')
	return value
}

function frame(domain: string, fields: unknown[]): Uint8Array {
	return utf8ToBytes(JSON.stringify([domain, ...fields]))
}

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(frame(domain, fields)))
}

function deterministicAux(domain: string, messageDigest: string): Uint8Array {
	return sha256(frame(domain, [messageDigest]))
}

function signDigest(domain: string, messageDigest: string, privateKey: Uint8Array): string {
	return bytesToHex(schnorr.sign(
		hexToBytes(messageDigest), privateKey, deterministicAux(`${domain}_AUX`, messageDigest),
	))
}

/** Go net.IP.String-compatible RFC 5952 spelling for non-IPv4 IPv6 values. */
export function canonicalDemoFridayIpv6(value: string): string | null {
	if (isIP(value) !== 6 || value.includes('%')) return null
	const halves = value.toLowerCase().split('::')
	if (halves.length > 2) return null
	const left = halves[0] === '' ? [] : halves[0]!.split(':')
	const right = halves.length === 1 || halves[1] === '' ? [] : halves[1]!.split(':')
	const missing = 8 - left.length - right.length
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
	const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((part) => Number.parseInt(part, 16))
	if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null
	let bestStart = -1; let bestLength = 0
	for (let start = 0; start < words.length;) {
		if (words[start] !== 0) { start += 1; continue }
		let end = start
		while (end < words.length && words[end] === 0) end += 1
		if (end - start >= 2 && end - start > bestLength) { bestStart = start; bestLength = end - start }
		start = end
	}
	const rendered = words.map((word) => word.toString(16))
	if (bestStart < 0) return rendered.join(':')
	const prefix = rendered.slice(0, bestStart).join(':')
	const suffix = rendered.slice(bestStart + bestLength).join(':')
	return `${prefix}::${suffix}`
}

function exactSecp256k1Point(value: unknown, label: string, evenOnly = false): string {
	if (typeof value !== 'string' || !COMPRESSED_KEY.test(value) || (evenOnly && !value.startsWith('02'))) fail(`${label} is invalid`)
	try { secp256k1.Point.fromHex(value).assertValidity() }
	catch { fail(`${label} is not an on-curve secp256k1 point`) }
	return value
}

const R20_DKG_ROOT = '/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2'
const SEPARATED_DKG_ROOT = '/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3'

function exactManifestParticipant(value: unknown, expectedId: DemoFridayParticipantId,
	expectedRoot: string): DemoFridayDkgManifestParticipantV1 {
	const raw = exactObject(value, [
		'participantId', 'hostId', 'underlayIpv4', 'fipsNpub', 'fipsUla', 'dkgIdentity', 'signerIdentity',
		'kexPublicKey', 'signerEndpoint', 'participantBinarySha256', 'inspectorBinarySha256', 'configPath',
		'stateDirectory',
	], `participant ${expectedId}`)
	const participantId = exactParticipant(raw.participantId, 'participantId')
	if (participantId !== expectedId
		|| typeof raw.underlayIpv4 !== 'string' || isIP(raw.underlayIpv4) !== 4
		|| typeof raw.fipsUla !== 'string' || !/^(?:fc|fd)/.test(raw.fipsUla)
		|| canonicalDemoFridayIpv6(raw.fipsUla) !== raw.fipsUla) fail(`participant ${expectedId} host/FIPS identity is invalid`)
	const hostId = exactDemoFridayDkgHostId(raw.hostId)
	const fipsNpub = exactDemoFridayDkgFipsNpub(raw.fipsNpub)
	const dkgIdentity = exactHex32(raw.dkgIdentity, 'dkgIdentity')
	const signerIdentity = exactHex32(raw.signerIdentity, 'signerIdentity')
	const kexPublicKey = exactHex32(raw.kexPublicKey, 'kexPublicKey')
	if (/^0+$/.test(kexPublicKey)) fail('KEX public key must not be zero')
	const signerEndpoint = `http://[${raw.fipsUla}]:39101/v1/frost`
	const configPath = `${expectedRoot}/participant.config.json`
	const stateDirectory = `${expectedRoot}/state`
	if (raw.signerEndpoint !== signerEndpoint || raw.configPath !== configPath || raw.stateDirectory !== stateDirectory) {
		fail(`participant ${expectedId} endpoint or local paths differ from the fixed deployment profile`)
	}
	return {
		participantId, hostId, underlayIpv4: raw.underlayIpv4, fipsNpub,
		fipsUla: raw.fipsUla, dkgIdentity, signerIdentity, kexPublicKey, signerEndpoint,
		participantBinarySha256: exactHex32(raw.participantBinarySha256, 'participantBinarySha256'),
		inspectorBinarySha256: exactHex32(raw.inspectorBinarySha256, 'inspectorBinarySha256'),
		configPath, stateDirectory,
	}
}

function manifestRootFromParticipants(participants: readonly unknown[]): string {
	const roots = new Set(participants.map((participant) => {
		if (participant === null || typeof participant !== 'object' || Array.isArray(participant)) {
			fail('participant is not an object')
		}
		const raw = participant as Record<string, unknown>
		if (raw.configPath === `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/participant.config.json`
			&& raw.stateDirectory === `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/state`) {
			return DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT
		}
		if (raw.configPath === `${R20_DKG_ROOT}/participant.config.json`
			&& raw.stateDirectory === `${R20_DKG_ROOT}/state`) return R20_DKG_ROOT
		if (raw.configPath === `${SEPARATED_DKG_ROOT}/participant.config.json`
			&& raw.stateDirectory === `${SEPARATED_DKG_ROOT}/state`) return SEPARATED_DKG_ROOT
		fail('participant local paths do not name an allowed fixed keyset root')
	}))
	if (roots.size !== 1) fail('participants mix DKG keyset roots')
	return [...roots][0]!
}

export function demoFridayDkgRosterDigest(participants: readonly DemoFridayDkgManifestParticipantV1[]): string {
	if (participants.length !== 4) fail('roster must contain exactly four participants')
	const root = manifestRootFromParticipants(participants)
	const exact = participants.map((participant, index) => exactManifestParticipant(participant, PARTICIPANTS[index]!, root))
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ROSTER_V1', exact.map((participant) => [
		participant.participantId, participant.hostId, participant.underlayIpv4, participant.fipsNpub,
		participant.fipsUla, participant.dkgIdentity, participant.signerIdentity, participant.kexPublicKey,
		participant.signerEndpoint, participant.participantBinarySha256, participant.inspectorBinarySha256,
		participant.configPath, participant.stateDirectory,
	]))
}

export function exactDemoFridayDkgManifest(value: unknown): DemoFridayDkgPublicManifestV1 {
	const raw = exactObject(value, [
		'schema', 'valueProfile', 'deploymentId', 'applicationRunId', 'dkgRunId', 'committeeKeysetId',
		'committeeKeysetVersion', 'roster', 'rosterDigest', 'coordinatorParticipantId', 'coordinatorIdentity',
		'participants',
	], 'manifest')
	if (raw.schema !== DEMO_FRIDAY_DKG_MANIFEST_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY'
		|| JSON.stringify(raw.roster) !== JSON.stringify(PARTICIPANTS) || raw.coordinatorParticipantId !== 1
		|| !Array.isArray(raw.participants) || raw.participants.length !== 4) fail('manifest schema or fixed roster is invalid')
	const root = manifestRootFromParticipants(raw.participants)
	if (root === R20_DKG_ROOT && (raw.deploymentId !== 'friday-demo-20261023-r20'
		|| raw.applicationRunId !== 'friday-demo-20261023-r20-run1'
		|| raw.dkgRunId !== 'friday-demo-20261023-r20-dkg2'
		|| raw.committeeKeysetId !== 'friday-demo-frost-keyset-v2'
		|| raw.committeeKeysetVersion !== '2')) {
		fail('keyset-v2 manifest differs from the fixed R20 run')
	}
	if (root === SEPARATED_DKG_ROOT && (raw.deploymentId !== 'friday-demo-20261030-separated-v1'
		|| raw.applicationRunId !== 'friday-demo-20261030-separated-v1-run1'
		|| raw.dkgRunId !== 'friday-demo-20261030-separated-v1-dkg1'
		|| raw.committeeKeysetId !== 'friday-demo-frost-keyset-separated-v1'
		|| raw.committeeKeysetVersion !== '3')) fail('keyset-v3 differs from exact separated deployment')
	const participants = raw.participants.map((participant, index) =>
		exactManifestParticipant(participant, PARTICIPANTS[index]!, root)) as unknown as DemoFridayDkgPublicManifestV1['participants']
	for (const field of ['hostId', 'underlayIpv4', 'fipsNpub', 'fipsUla', 'dkgIdentity', 'signerIdentity', 'kexPublicKey'] as const) {
		if (new Set(participants.map((participant) => participant[field])).size !== 4) fail(`manifest has duplicate ${field}`)
	}
	const coordinatorIdentity = exactHex32(raw.coordinatorIdentity, 'coordinatorIdentity')
	const schnorrIdentities = [coordinatorIdentity, ...participants.flatMap((participant) => [
		participant.dkgIdentity, participant.signerIdentity,
	])]
	if (new Set(schnorrIdentities).size !== schnorrIdentities.length) {
		fail('coordinator, DKG bootstrap, and signer RPC identities must all be distinct')
	}
	const rosterDigest = demoFridayDkgRosterDigest(participants)
	if (raw.rosterDigest !== rosterDigest) fail('manifest roster digest differs from its exact roster')
	return {
		schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: exactIdentifier(raw.deploymentId, 'deploymentId'),
		applicationRunId: exactIdentifier(raw.applicationRunId, 'applicationRunId'),
		dkgRunId: exactIdentifier(raw.dkgRunId, 'dkgRunId'),
		committeeKeysetId: exactIdentifier(raw.committeeKeysetId, 'committeeKeysetId'),
		committeeKeysetVersion: exactIdentifier(raw.committeeKeysetVersion, 'committeeKeysetVersion'),
		roster: PARTICIPANTS, rosterDigest,
		coordinatorParticipantId: 1, coordinatorIdentity,
		participants,
	}
}

export function demoFridayDkgManifestDigest(value: DemoFridayDkgPublicManifestV1): string {
	const manifest = exactDemoFridayDkgManifest(value)
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', [
		manifest.schema, manifest.valueProfile, manifest.deploymentId, manifest.applicationRunId, manifest.dkgRunId,
		manifest.committeeKeysetId, manifest.committeeKeysetVersion, manifest.roster, manifest.rosterDigest,
		manifest.coordinatorParticipantId, manifest.coordinatorIdentity,
		manifest.participants.map((participant) => [
			participant.participantId, participant.hostId, participant.underlayIpv4, participant.fipsNpub,
			participant.fipsUla, participant.dkgIdentity, participant.signerIdentity, participant.kexPublicKey,
			participant.signerEndpoint, participant.participantBinarySha256, participant.inspectorBinarySha256,
			participant.configPath, participant.stateDirectory,
		]),
	])
}

function enrollmentDigest(manifest: DemoFridayDkgPublicManifestV1, participantId: DemoFridayParticipantId): string {
	const participant = manifest.participants[participantId - 1]!
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_V1', [
		manifest.schema, manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion,
		manifest.rosterDigest, demoFridayDkgManifestDigest(manifest), participantId, participant.dkgIdentity,
		participant.kexPublicKey, PAIRWISE_PURPOSE,
	])
}

export function createDemoFridayDkgEnrollmentAttestation(options: {
	manifest: DemoFridayDkgPublicManifestV1
	participantId: DemoFridayParticipantId
	dkgIdentityPrivateKey: Uint8Array
}): DemoFridayDkgEnrollmentAttestationV1 {
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	const participantId = exactParticipant(options.participantId, 'participantId')
	const participant = manifest.participants[participantId - 1]!
	if (bytesToHex(schnorr.getPublicKey(options.dkgIdentityPrivateKey)) !== participant.dkgIdentity) {
		fail('local DKG identity secret differs from the enrolled public identity')
	}
	const messageDigest = enrollmentDigest(manifest, participantId)
	return {
		schema: DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA, manifestDigest: demoFridayDkgManifestDigest(manifest),
		rosterDigest: manifest.rosterDigest, participantId, dkgIdentity: participant.dkgIdentity,
		signature: signDigest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_V1', messageDigest, options.dkgIdentityPrivateKey),
	}
}

export function verifyDemoFridayDkgEnrollments(
	manifestValue: DemoFridayDkgPublicManifestV1,
	values: readonly DemoFridayDkgEnrollmentAttestationV1[],
): DemoFridayDkgEnrollmentAttestationV1[] {
	const manifest = exactDemoFridayDkgManifest(manifestValue)
	const manifestDigest = demoFridayDkgManifestDigest(manifest)
	if (values.length !== 4) fail('exactly four enrollment attestations are required')
	return values.map((value, index) => {
		const raw = exactObject(value, ['schema', 'manifestDigest', 'rosterDigest', 'participantId', 'dkgIdentity', 'signature'], 'enrollment')
		const participantId = exactParticipant(raw.participantId, 'enrollment participantId')
		const expectedId = PARTICIPANTS[index]!
		const participant = manifest.participants[participantId - 1]!
		if (participantId !== expectedId || raw.schema !== DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA
			|| raw.manifestDigest !== manifestDigest || raw.rosterDigest !== manifest.rosterDigest
			|| raw.dkgIdentity !== participant.dkgIdentity || typeof raw.signature !== 'string' || !HEX_64.test(raw.signature)
			|| !schnorr.verify(hexToBytes(raw.signature), hexToBytes(enrollmentDigest(manifest, participantId)), hexToBytes(participant.dkgIdentity))) {
			fail(`enrollment ${participantId} is not an exact valid manifest attestation`)
		}
		return structuredClone(value)
	})
}

function pairBinding(manifest: DemoFridayDkgPublicManifestV1, left: DemoFridayParticipantId, right: DemoFridayParticipantId) {
	if (left === right) fail('pairwise derivation requires distinct participants')
	const lowerParticipantId = Math.min(left, right) as DemoFridayParticipantId
	const upperParticipantId = Math.max(left, right) as DemoFridayParticipantId
	return {
		lowerParticipantId, upperParticipantId,
		lowerKexPublicKey: manifest.participants[lowerParticipantId - 1]!.kexPublicKey,
		upperKexPublicKey: manifest.participants[upperParticipantId - 1]!.kexPublicKey,
	}
}

function derivePairwiseKey(options: {
	manifest: DemoFridayDkgPublicManifestV1
	localParticipantId: DemoFridayParticipantId
	peerParticipantId: DemoFridayParticipantId
	localKexPrivateKey: Uint8Array
}): Uint8Array {
	const { manifest, localParticipantId, peerParticipantId } = options
	const pair = pairBinding(manifest, localParticipantId, peerParticipantId)
	const local = manifest.participants[localParticipantId - 1]!
	if (bytesToHex(x25519.getPublicKey(options.localKexPrivateKey)) !== local.kexPublicKey) {
		fail('local KEX secret differs from the enrolled public key')
	}
	const shared = x25519.getSharedSecret(options.localKexPrivateKey, hexToBytes(manifest.participants[peerParticipantId - 1]!.kexPublicKey))
	if (shared.every((value) => value === 0)) fail('X25519 produced an all-zero shared secret')
	const manifestDigest = demoFridayDkgManifestDigest(manifest)
	const salt = sha256(frame('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HKDF_SALT_V1', [manifestDigest, manifest.rosterDigest]))
	const info = frame('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HKDF_INFO_V1', [
		manifest.schema, manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion,
		manifest.rosterDigest, manifestDigest, PAIRWISE_PURPOSE, pair.lowerParticipantId, pair.upperParticipantId,
		pair.lowerKexPublicKey, pair.upperKexPublicKey,
	])
	const key = hkdf(sha256, shared, salt, info, 32)
	shared.fill(0)
	if (key.every((value) => value === 0)) fail('HKDF produced an invalid all-zero pairwise key')
	return key
}

function confirmationDigest(value: Omit<DemoFridayDkgPairwiseConfirmationV1, 'signature'>): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_SIGNATURE_V1', [
		value.schema, value.manifestDigest, value.rosterDigest, value.purpose, value.lowerParticipantId,
		value.upperParticipantId, value.senderParticipantId, value.recipientParticipantId,
		value.lowerKexPublicKey, value.upperKexPublicKey, value.confirmationMac, value.dkgIdentity,
	])
}

function confirmationMac(options: {
	manifest: DemoFridayDkgPublicManifestV1
	key: Uint8Array
	senderParticipantId: DemoFridayParticipantId
	recipientParticipantId: DemoFridayParticipantId
}): string {
	const pair = pairBinding(options.manifest, options.senderParticipantId, options.recipientParticipantId)
	return bytesToHex(hmac(sha256, options.key, frame('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_MAC_V1', [
		DEMO_FRIDAY_DKG_CONFIRMATION_SCHEMA, options.manifest.dkgRunId, options.manifest.committeeKeysetId,
		options.manifest.committeeKeysetVersion, options.manifest.rosterDigest,
		demoFridayDkgManifestDigest(options.manifest), PAIRWISE_PURPOSE, pair.lowerParticipantId,
		pair.upperParticipantId, options.senderParticipantId, options.recipientParticipantId,
		pair.lowerKexPublicKey, pair.upperKexPublicKey,
	])))
}

export function exactDemoFridayLocalTransportSecrets(
	manifestValue: DemoFridayDkgPublicManifestV1,
	value: unknown,
): DemoFridayDkgTransportSecretsV1 {
	const manifest = exactDemoFridayDkgManifest(manifestValue)
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id',
		'identity_signing_key_hex', 'identity_verifying_keys', 'round2_pairwise_keys',
	], 'local transport secrets')
	const participantId = exactParticipant(raw.participant_id, 'transport participant')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId || raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| typeof raw.identity_signing_key_hex !== 'string' || !HEX_32.test(raw.identity_signing_key_hex)
		|| bytesToHex(schnorr.getPublicKey(hexToBytes(raw.identity_signing_key_hex))) !== manifest.participants[participantId - 1]!.dkgIdentity
		|| !Array.isArray(raw.identity_verifying_keys) || raw.identity_verifying_keys.length !== 4
		|| !Array.isArray(raw.round2_pairwise_keys) || raw.round2_pairwise_keys.length !== 3) {
		fail('local transport secrets do not match the enrolled participant')
	}
	const identities = raw.identity_verifying_keys.map((value, index) => {
		const entry = exactObject(value, ['participant_id', 'verifying_key_hex'], 'transport identity entry')
		if (entry.participant_id !== PARTICIPANTS[index]
			|| entry.verifying_key_hex !== manifest.participants[index]!.dkgIdentity) fail('transport identity roster differs from manifest')
		return { participant_id: PARTICIPANTS[index]!, verifying_key_hex: entry.verifying_key_hex as string }
	})
	const expectedPeers = PARTICIPANTS.filter((entry) => entry !== participantId)
	const pairwise = raw.round2_pairwise_keys.map((value, index) => {
		const entry = exactObject(value, ['peer_id', 'key_hex'], 'transport pairwise entry')
		if (entry.peer_id !== expectedPeers[index] || typeof entry.key_hex !== 'string' || !HEX_32.test(entry.key_hex)
			|| /^0+$/.test(entry.key_hex)) fail('transport pairwise roster or key is invalid')
		return { peer_id: expectedPeers[index]!, key_hex: entry.key_hex }
	})
	if (new Set(pairwise.map((entry) => entry.key_hex)).size !== 3) fail('transport pairwise keys must be distinct')
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: manifest.dkgRunId,
		committee_keyset_id: manifest.committeeKeysetId, committee_keyset_version: manifest.committeeKeysetVersion,
		participant_id: participantId, identity_signing_key_hex: raw.identity_signing_key_hex,
		identity_verifying_keys: identities, round2_pairwise_keys: pairwise,
	}
}

function deriveDemoFridayLocalPairwiseBootstrap(options: {
	manifest: DemoFridayDkgPublicManifestV1
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
	participantId: DemoFridayParticipantId
	dkgIdentityPrivateKey: Uint8Array
	kexPrivateKey: Uint8Array
}): DemoFridayDkgLocalPairwiseBootstrap {
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	verifyDemoFridayDkgEnrollments(manifest, options.enrollments)
	const participantId = exactParticipant(options.participantId, 'participantId')
	const participant = manifest.participants[participantId - 1]!
	if (bytesToHex(schnorr.getPublicKey(options.dkgIdentityPrivateKey)) !== participant.dkgIdentity) {
		fail('local DKG identity secret differs from enrollment')
	}
	const pairs = PARTICIPANTS.filter((peerId) => peerId !== participantId).map((peerId) => {
		const key = derivePairwiseKey({ manifest, localParticipantId: participantId, peerParticipantId: peerId, localKexPrivateKey: options.kexPrivateKey })
		const pair = pairBinding(manifest, participantId, peerId)
		const unsigned: Omit<DemoFridayDkgPairwiseConfirmationV1, 'signature'> = {
			schema: DEMO_FRIDAY_DKG_CONFIRMATION_SCHEMA, manifestDigest: demoFridayDkgManifestDigest(manifest),
			rosterDigest: manifest.rosterDigest, purpose: PAIRWISE_PURPOSE, ...pair,
			senderParticipantId: participantId, recipientParticipantId: peerId,
			confirmationMac: confirmationMac({ manifest, key, senderParticipantId: participantId, recipientParticipantId: peerId }),
			dkgIdentity: participant.dkgIdentity,
		}
		return {
			peerId, keyHex: bytesToHex(key), confirmation: {
				...unsigned,
				signature: signDigest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_KEY_CONFIRMATION_SIGNATURE_V1', confirmationDigest(unsigned), options.dkgIdentityPrivateKey),
			},
		}
	})
	if (new Set(pairs.map((pair) => pair.keyHex)).size !== 3) fail('local pairwise keys must be distinct')
	return {
		participantId, manifestDigest: demoFridayDkgManifestDigest(manifest),
		transportSecrets: {
			version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: manifest.dkgRunId,
			committee_keyset_id: manifest.committeeKeysetId, committee_keyset_version: manifest.committeeKeysetVersion,
			participant_id: participantId, identity_signing_key_hex: bytesToHex(options.dkgIdentityPrivateKey),
			identity_verifying_keys: manifest.participants.map((entry) => ({
				participant_id: entry.participantId, verifying_key_hex: entry.dkgIdentity,
			})),
			round2_pairwise_keys: pairs.map((pair) => ({ peer_id: pair.peerId, key_hex: pair.keyHex })),
		},
		confirmationsToSend: pairs.map((pair) => pair.confirmation),
	}
}

function verifyPeerConfirmation(options: {
	manifest: DemoFridayDkgPublicManifestV1
	local: DemoFridayDkgLocalPairwiseBootstrap
	value: DemoFridayDkgPairwiseConfirmationV1
}): void {
	const raw = exactObject(options.value, [
		'schema', 'manifestDigest', 'rosterDigest', 'purpose', 'lowerParticipantId', 'upperParticipantId',
		'senderParticipantId', 'recipientParticipantId', 'lowerKexPublicKey', 'upperKexPublicKey',
		'confirmationMac', 'dkgIdentity', 'signature',
	], 'pairwise confirmation')
	const sender = exactParticipant(raw.senderParticipantId, 'confirmation sender')
	const recipient = exactParticipant(raw.recipientParticipantId, 'confirmation recipient')
	const pair = pairBinding(options.manifest, sender, recipient)
	const localKey = options.local.transportSecrets.round2_pairwise_keys.find((entry) => entry.peer_id === sender)
	if (recipient !== options.local.participantId || !localKey || raw.schema !== DEMO_FRIDAY_DKG_CONFIRMATION_SCHEMA
		|| raw.manifestDigest !== options.local.manifestDigest || raw.rosterDigest !== options.manifest.rosterDigest
		|| raw.purpose !== PAIRWISE_PURPOSE || raw.lowerParticipantId !== pair.lowerParticipantId
		|| raw.upperParticipantId !== pair.upperParticipantId || raw.lowerKexPublicKey !== pair.lowerKexPublicKey
		|| raw.upperKexPublicKey !== pair.upperKexPublicKey || raw.dkgIdentity !== options.manifest.participants[sender - 1]!.dkgIdentity
		|| typeof raw.confirmationMac !== 'string' || !HEX_32.test(raw.confirmationMac)
		|| raw.confirmationMac !== confirmationMac({
			manifest: options.manifest, key: hexToBytes(localKey.key_hex), senderParticipantId: sender, recipientParticipantId: recipient,
		}) || typeof raw.signature !== 'string' || !HEX_64.test(raw.signature)
		|| !schnorr.verify(hexToBytes(raw.signature), hexToBytes(confirmationDigest(options.value)), hexToBytes(raw.dkgIdentity as string))) {
		fail(`pairwise confirmation from participant ${sender} is invalid`)
	}
}

/** Only after all three peers confirm the same derived keys may round one use this object. */
function finalizeDemoFridayLocalTransportSecrets(options: {
	manifest: DemoFridayDkgPublicManifestV1
	localBootstrap: DemoFridayDkgLocalPairwiseBootstrap
	peerConfirmations: readonly DemoFridayDkgPairwiseConfirmationV1[]
}): DemoFridayDkgTransportSecretsV1 {
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	const transportSecrets = exactDemoFridayLocalTransportSecrets(manifest, options.localBootstrap.transportSecrets)
	if (options.localBootstrap.manifestDigest !== demoFridayDkgManifestDigest(manifest)
		|| options.localBootstrap.participantId !== transportSecrets.participant_id
		|| options.peerConfirmations.length !== 3) fail('local bootstrap or peer confirmation set is incomplete')
	const expectedPeers = PARTICIPANTS.filter((value) => value !== options.localBootstrap.participantId)
	const actualPeers = options.peerConfirmations.map((value) => value.senderParticipantId)
	if (JSON.stringify(actualPeers) !== JSON.stringify(expectedPeers)) fail('peer confirmations must contain each other participant in roster order')
	for (const confirmation of options.peerConfirmations) verifyPeerConfirmation({ manifest, local: options.localBootstrap, value: confirmation })
	return transportSecrets
}

const gatedTransportSecrets = new WeakMap<DemoFridayDkgTransportGateV2, DemoFridayDkgLocalPairwiseBootstrap>()

/**
 * The only exported derivation entry point. It requires the external manifest
 * pin and returns no usable DKG or pairwise secret before confirmation.
 */
export function createDemoFridayDkgTransportGateV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
	participantId: DemoFridayParticipantId
	dkgIdentityPrivateKey: Uint8Array
	kexPrivateKey: Uint8Array
}): DemoFridayDkgTransportGateV2 {
	if (typeof options.expectedManifestDigest !== 'string' || !HEX_32.test(options.expectedManifestDigest)) {
		fail('transport gate requires an external manifest digest')
	}
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	if (demoFridayDkgManifestDigest(manifest) !== options.expectedManifestDigest) {
		fail('transport gate manifest differs from its external pin')
	}
	const internal = deriveDemoFridayLocalPairwiseBootstrap({ ...options, manifest })
	const gate = Object.freeze({
		schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_TRANSPORT_GATE_V2' as const,
		participantId: internal.participantId, manifestDigest: internal.manifestDigest,
		confirmationsToSend: Object.freeze(internal.confirmationsToSend.map((value) => Object.freeze(structuredClone(value)))),
	})
	gatedTransportSecrets.set(gate, internal)
	return gate
}

/** Release the exact Rust transport object once, only after all three confirmations verify. */
export function finalizeDemoFridayDkgTransportGateV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	gate: DemoFridayDkgTransportGateV2
	peerConfirmations: readonly DemoFridayDkgPairwiseConfirmationV1[]
}): DemoFridayDkgTransportSecretsV1 {
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	const internal = gatedTransportSecrets.get(options.gate)
	if (!internal || options.gate.schema !== 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_TRANSPORT_GATE_V2'
		|| options.gate.manifestDigest !== options.expectedManifestDigest
		|| demoFridayDkgManifestDigest(manifest) !== options.expectedManifestDigest
		|| options.gate.participantId !== internal.participantId) {
		fail('transport gate is foreign, serialized, replayed, or differently pinned')
	}
	const transport = finalizeDemoFridayLocalTransportSecrets({
		manifest, localBootstrap: internal, peerConfirmations: options.peerConfirmations,
	})
	gatedTransportSecrets.delete(options.gate)
	return transport
}

function exactFinalPackage(value: unknown, manifest: DemoFridayDkgPublicManifestV1, participantId: DemoFridayParticipantId): DemoFridayDkgFinalPublicPackageV1 {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id',
		'public_key_package_hex', 'public_key_package_sha256',
	], 'final public package')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId || raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| raw.participant_id !== participantId || typeof raw.public_key_package_hex !== 'string'
		|| !/^[0-9a-f]+$/.test(raw.public_key_package_hex) || raw.public_key_package_hex.length % 2 !== 0
		|| raw.public_key_package_hex.length > 131_072
		|| raw.public_key_package_sha256 !== bytesToHex(sha256(hexToBytes(raw.public_key_package_hex)))) {
		fail(`participant ${participantId} final public package is invalid`)
	}
	return structuredClone(value as DemoFridayDkgFinalPublicPackageV1)
}

function exactInspection(value: unknown, manifest: DemoFridayDkgPublicManifestV1, participantId: DemoFridayParticipantId): DemoFridayDkgPublicInspectionV1 {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'source_participant_id',
		'public_key_package_sha256', 'committee_public_key', 'min_signers', 'max_signers', 'verifying_shares',
	], 'public inspection')
	if (raw.version !== 'COCO_DEMO_FROST_PUBLIC_INSPECTION_V1' || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId || raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| raw.source_participant_id !== participantId || raw.min_signers !== 3 || raw.max_signers !== 4
		|| !Array.isArray(raw.verifying_shares) || raw.verifying_shares.length !== 4) fail('public inspection is invalid')
	const committeePublicKey = exactSecp256k1Point(raw.committee_public_key, 'committee public key', true)
	const shares = raw.verifying_shares.map((value, index) => {
		const share = exactObject(value, ['participant_id', 'verifying_share_hex'], 'verifying share')
		if (share.participant_id !== PARTICIPANTS[index]) fail('verifying-share roster is invalid')
		return { participant_id: PARTICIPANTS[index]!, verifying_share_hex: exactSecp256k1Point(share.verifying_share_hex, 'verifying share') }
	})
	if (new Set(shares.map((share) => share.verifying_share_hex)).size !== 4
		|| typeof raw.public_key_package_sha256 !== 'string' || !HEX_32.test(raw.public_key_package_sha256)) {
		fail('public inspection contains duplicate shares or an invalid package hash')
	}
	return { ...structuredClone(value as DemoFridayDkgPublicInspectionV1), committee_public_key: committeePublicKey, verifying_shares: shares }
}

function u16be(value: DemoFridayParticipantId): Uint8Array {
	return Uint8Array.of(0, value)
}

function rustFrame(context: string, fields: readonly Uint8Array[]): Uint8Array {
	const contextBytes = utf8ToBytes(context)
	const size = contextBytes.length + fields.reduce((total, field) => total + 4 + field.length, 0)
	const output = new Uint8Array(size)
	output.set(contextBytes, 0)
	let offset = contextBytes.length
	for (const field of fields) {
		new DataView(output.buffer).setUint32(offset, field.length, false)
		offset += 4
		output.set(field, offset)
		offset += field.length
	}
	return output
}

function exactRound1Envelope(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
): DemoFridayDkgRound1EnvelopeV1 {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'sender', 'payload_hex',
		'auth_signature_hex',
	], 'round-one envelope')
	const sender = exactParticipant(raw.sender, 'round-one sender')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId || raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| typeof raw.payload_hex !== 'string' || !/^[0-9a-f]+$/.test(raw.payload_hex) || raw.payload_hex.length % 2 !== 0
		|| raw.payload_hex.length > 131_072 || typeof raw.auth_signature_hex !== 'string' || !HEX_64.test(raw.auth_signature_hex)) {
		fail(`round-one envelope ${sender} is malformed`)
	}
	const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', [
		utf8ToBytes(raw.version), utf8ToBytes(raw.run_id), utf8ToBytes(raw.committee_keyset_id),
		utf8ToBytes(raw.committee_keyset_version), u16be(sender), utf8ToBytes(raw.payload_hex),
	])
	// Rust k256 `Signer` signs SHA-256(frame), not the unhashed frame accepted by noble's low-level API.
	if (!schnorr.verify(hexToBytes(raw.auth_signature_hex), sha256(message), hexToBytes(manifest.participants[sender - 1]!.dkgIdentity))) {
		fail(`round-one envelope ${sender} has an invalid identity signature`)
	}
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
		run_id: manifest.dkgRunId,
		committee_keyset_id: manifest.committeeKeysetId,
		committee_keyset_version: manifest.committeeKeysetVersion,
		sender,
		payload_hex: raw.payload_hex,
		auth_signature_hex: raw.auth_signature_hex,
	}
}

/** Verify the existing Rust participant's exact all-four round-one transcript and agreements. */
export function verifyDemoFridayDkgRound1Transcript(options: {
	manifest: DemoFridayDkgPublicManifestV1
	round1Bundle: DemoFridayDkgRound1BundleV1
	agreementBundle: DemoFridayDkgRound1AgreementBundleV1
}): string {
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	const round1Raw = exactObject(options.round1Bundle, ['version', 'entries'], 'round-one bundle')
	if (round1Raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
		|| !Array.isArray(round1Raw.entries) || round1Raw.entries.length !== 4) fail('round-one bundle requires all four participants')
	const envelopes = round1Raw.entries.map((entry) => exactRound1Envelope(entry, manifest))
		.sort((left, right) => left.sender - right.sender)
	if (JSON.stringify(envelopes.map((entry) => entry.sender)) !== JSON.stringify(PARTICIPANTS)) {
		fail('round-one bundle has duplicate or missing participants')
	}
	const round1Digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify(envelopes))))
	const agreementRaw = exactObject(options.agreementBundle, ['version', 'entries'], 'round-one agreement bundle')
	if (agreementRaw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION
		|| !Array.isArray(agreementRaw.entries) || agreementRaw.entries.length !== 4) fail('round-one agreement bundle requires all four participants')
	const participantIds: DemoFridayParticipantId[] = []
	for (const entry of agreementRaw.entries) {
		const raw = exactObject(entry, [
			'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id',
			'round1_digest', 'auth_signature_hex',
		], 'round-one agreement')
		const participantId = exactParticipant(raw.participant_id, 'agreement participant')
		participantIds.push(participantId)
		if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
			|| raw.committee_keyset_id !== manifest.committeeKeysetId || raw.committee_keyset_version !== manifest.committeeKeysetVersion
			|| raw.round1_digest !== round1Digest || typeof raw.auth_signature_hex !== 'string' || !HEX_64.test(raw.auth_signature_hex)) {
			fail(`round-one agreement ${participantId} differs from the canonical transcript`)
		}
		const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', [
			utf8ToBytes(raw.version), utf8ToBytes(raw.run_id), utf8ToBytes(raw.committee_keyset_id),
			utf8ToBytes(raw.committee_keyset_version), u16be(participantId), utf8ToBytes(raw.round1_digest),
		])
		if (!schnorr.verify(hexToBytes(raw.auth_signature_hex), sha256(message), hexToBytes(manifest.participants[participantId - 1]!.dkgIdentity))) {
			fail(`round-one agreement ${participantId} has an invalid identity signature`)
		}
	}
	if (JSON.stringify([...participantIds].sort()) !== JSON.stringify(PARTICIPANTS)) {
		fail('round-one agreements have duplicate or missing participants')
	}
	return round1Digest
}

function publicSummaryDigest(options: {
	manifest: DemoFridayDkgPublicManifestV1
	packageValue: DemoFridayDkgFinalPublicPackageV1
	inspection: DemoFridayDkgPublicInspectionV1
	round1TranscriptDigest: string
}): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_SUMMARY_V1', [
		demoFridayDkgManifestDigest(options.manifest), options.manifest.rosterDigest,
		options.manifest.dkgRunId, options.manifest.committeeKeysetId, options.manifest.committeeKeysetVersion,
		PAIRWISE_PURPOSE, options.round1TranscriptDigest, options.packageValue.public_key_package_hex,
		options.packageValue.public_key_package_sha256, options.inspection.committee_public_key,
		options.inspection.min_signers, options.inspection.max_signers,
		options.inspection.verifying_shares.map((share) => [share.participant_id, share.verifying_share_hex]),
	])
}

function finalAttestationDigest(value: Omit<DemoFridayDkgFinalAttestationV1, 'signature'>): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V1', [
		value.schema, value.manifestDigest, value.rosterDigest, value.round1TranscriptDigest,
		value.participantId, value.dkgIdentity, value.signerIdentity, value.publicKeyPackageSha256,
		value.publicSummaryDigest,
	])
}

export function createDemoFridayDkgFinalAttestation(options: {
	manifest: DemoFridayDkgPublicManifestV1
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
	participantId: DemoFridayParticipantId
	dkgIdentityPrivateKey: Uint8Array
	round1Bundle: DemoFridayDkgRound1BundleV1
	agreementBundle: DemoFridayDkgRound1AgreementBundleV1
	finalPublicPackage: DemoFridayDkgFinalPublicPackageV1
	publicInspection: DemoFridayDkgPublicInspectionV1
}): DemoFridayDkgFinalAttestationV1 {
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	verifyDemoFridayDkgEnrollments(manifest, options.enrollments)
	const participantId = exactParticipant(options.participantId, 'participantId')
	const participant = manifest.participants[participantId - 1]!
	if (bytesToHex(schnorr.getPublicKey(options.dkgIdentityPrivateKey)) !== participant.dkgIdentity) fail('final attestation signer is not enrolled')
	const round1TranscriptDigest = verifyDemoFridayDkgRound1Transcript({
		manifest, round1Bundle: options.round1Bundle, agreementBundle: options.agreementBundle,
	})
	const packageValue = exactFinalPackage(options.finalPublicPackage, manifest, participantId)
	const inspection = exactInspection(options.publicInspection, manifest, participantId)
	if (packageValue.public_key_package_sha256 !== inspection.public_key_package_sha256) fail('final package and inspection hashes differ')
	const unsigned: Omit<DemoFridayDkgFinalAttestationV1, 'signature'> = {
		schema: DEMO_FRIDAY_DKG_FINAL_ATTESTATION_SCHEMA, manifestDigest: demoFridayDkgManifestDigest(manifest),
		rosterDigest: manifest.rosterDigest, round1TranscriptDigest, participantId,
		dkgIdentity: participant.dkgIdentity, signerIdentity: participant.signerIdentity,
		publicKeyPackageSha256: packageValue.public_key_package_sha256,
		publicSummaryDigest: publicSummaryDigest({ manifest, packageValue, inspection, round1TranscriptDigest }),
	}
	return { ...unsigned, signature: signDigest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V1', finalAttestationDigest(unsigned), options.dkgIdentityPrivateKey) }
}

function signerRosterDigest(manifest: DemoFridayDkgPublicManifestV1, inspection: DemoFridayDkgPublicInspectionV1): string {
	return digest('COCO_DEMO_FROST_SIGNER_ROSTER_V1', [
		manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion,
		inspection.public_key_package_sha256, inspection.committee_public_key, 3, 4,
		inspection.verifying_shares.map((share) => ({ participant_id: share.participant_id, verifying_share_hex: share.verifying_share_hex })),
	])
}

/** Assemble only the established public result shape; no private input is accepted. */
export function assembleDemoFridayPublicDkgResult(options: {
	manifest: DemoFridayDkgPublicManifestV1
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
	round1Bundle: DemoFridayDkgRound1BundleV1
	agreementBundle: DemoFridayDkgRound1AgreementBundleV1
	finalPublicPackages: readonly DemoFridayDkgFinalPublicPackageV1[]
	publicInspections: readonly DemoFridayDkgPublicInspectionV1[]
	finalAttestations: readonly DemoFridayDkgFinalAttestationV1[]
}): DemoFridayPublicDkgResultV1 {
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	verifyDemoFridayDkgEnrollments(manifest, options.enrollments)
	const round1TranscriptDigest = verifyDemoFridayDkgRound1Transcript({
		manifest, round1Bundle: options.round1Bundle, agreementBundle: options.agreementBundle,
	})
	if (options.finalPublicPackages.length !== 4 || options.publicInspections.length !== 4 || options.finalAttestations.length !== 4) {
		fail('exactly four final packages, inspections, and attestations are required')
	}
	const packages = options.finalPublicPackages.map((value, index) => exactFinalPackage(value, manifest, PARTICIPANTS[index]!))
	const inspections = options.publicInspections.map((value, index) => exactInspection(value, manifest, PARTICIPANTS[index]!))
	if (new Set(packages.map((value) => value.public_key_package_hex)).size !== 1
		|| new Set(packages.map((value) => value.public_key_package_sha256)).size !== 1) fail('four final public packages are not byte-identical')
	const summaries = packages.map((packageValue, index) => publicSummaryDigest({
		manifest, packageValue, inspection: inspections[index]!, round1TranscriptDigest,
	}))
	if (new Set(summaries).size !== 1) fail('four public inspections do not describe one identical committee')
	for (let index = 0; index < 4; index += 1) {
		const raw = exactObject(options.finalAttestations[index], [
			'schema', 'manifestDigest', 'rosterDigest', 'round1TranscriptDigest', 'participantId', 'dkgIdentity',
			'signerIdentity', 'publicKeyPackageSha256', 'publicSummaryDigest', 'signature',
		], 'final attestation')
		const participant = manifest.participants[index]!
		if (raw.schema !== DEMO_FRIDAY_DKG_FINAL_ATTESTATION_SCHEMA || raw.manifestDigest !== demoFridayDkgManifestDigest(manifest)
			|| raw.rosterDigest !== manifest.rosterDigest || raw.round1TranscriptDigest !== round1TranscriptDigest
			|| raw.participantId !== participant.participantId || raw.dkgIdentity !== participant.dkgIdentity
			|| raw.signerIdentity !== participant.signerIdentity || raw.publicKeyPackageSha256 !== packages[index]!.public_key_package_sha256
			|| raw.publicSummaryDigest !== summaries[index] || typeof raw.signature !== 'string' || !HEX_64.test(raw.signature)
			|| !schnorr.verify(hexToBytes(raw.signature), hexToBytes(finalAttestationDigest(options.finalAttestations[index] as DemoFridayDkgFinalAttestationV1)), hexToBytes(participant.dkgIdentity))) {
			fail(`final attestation ${index + 1} is invalid`)
		}
	}
	const inspection = inspections[0]!
	return {
		schema: 'PLEBEIAN_FRIDAY_FIPS_DKG_RESULT_V1', runId: manifest.applicationRunId,
		dkgRunId: manifest.dkgRunId, committeeKeysetId: manifest.committeeKeysetId,
		committeeKeysetVersion: manifest.committeeKeysetVersion,
		publicKeyPackagePath: `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/exchange/${manifest.dkgRunId}/participant-1.public.json`,
		publicKeyPackageSha256: packages[0]!.public_key_package_sha256,
		signerRosterDigest: signerRosterDigest(manifest, inspection), committeePublicKey: inspection.committee_public_key,
		coordinatorIdentity: manifest.coordinatorIdentity,
		participants: manifest.participants.map((participant, index) => ({
			participantId: participant.participantId, configPath: participant.configPath,
			stateDirectory: participant.stateDirectory, verifyingShare: inspection.verifying_shares[index]!.verifying_share_hex,
			signerIdentity: participant.signerIdentity, signerEndpoint: participant.signerEndpoint,
		})),
	}
}
