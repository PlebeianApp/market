/**
 * Corrected authenticated per-validator DKG checkpoint.
 *
 * V2 never treats a manifest digest carried by the manifest as a trust root:
 * every entry point requires the independently provisioned expected digest.
 * It also keeps derived transport credentials module-private until all three
 * directional confirmations authenticate, and preserves the complete public
 * authentication chain in its output rather than returning a naked key.
 */
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFridayDkgEnrollmentAttestation,
	createDemoFridayDkgTransportGateV2,
	demoFridayDkgManifestDigest,
	exactDemoFridayDkgManifest,
	finalizeDemoFridayDkgTransportGateV2,
	verifyDemoFridayDkgEnrollments,
	verifyDemoFridayDkgRound1Transcript,
	type DemoFridayDkgEnrollmentAttestationV1,
	type DemoFridayDkgFinalPublicPackageV1,
	type DemoFridayDkgPairwiseConfirmationV1,
	type DemoFridayDkgPublicInspectionV1,
	type DemoFridayDkgPublicManifestV1,
	type DemoFridayDkgRound1AgreementBundleV1,
	type DemoFridayDkgRound1BundleV1,
	type DemoFridayDkgTransportSecretsV1,
	type DemoFridayDkgTransportGateV2,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
	type DemoFridayParticipantId,
} from './demo-friday-per-validator-dkg-plan'

const PARTICIPANTS = [1, 2, 3, 4] as const
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/

export const DEMO_FRIDAY_DKG_AUTHENTICATED_RESULT_SCHEMA = 'PLEBEIAN_FRIDAY_AUTHENTICATED_DKG_RESULT_V2' as const
export const DEMO_FRIDAY_DKG_FINAL_ATTESTATION_V2_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V2' as const
export const DEMO_FRIDAY_DKG_PROVISIONAL_SCHEMA = 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_PROVISIONAL_V2' as const

export interface DemoFridayDkgProvisionalV2 {
	schema: typeof DEMO_FRIDAY_DKG_PROVISIONAL_SCHEMA
	manifestDigest: string
	participantId: DemoFridayParticipantId
	confirmationsToSend: readonly DemoFridayDkgPairwiseConfirmationV1[]
}

export interface DemoFridayDkgFinalAttestationV2 {
	schema: typeof DEMO_FRIDAY_DKG_FINAL_ATTESTATION_V2_SCHEMA
	manifestDigest: string
	rosterDigest: string
	round1TranscriptDigest: string
	participantId: DemoFridayParticipantId
	dkgIdentity: string
	signerIdentity: string
	signerEndpoint: string
	participantBinarySha256: string
	inspectorBinarySha256: string
	packageBytesSha256: string
	inspectionPackageSha256: string
	committeePublicKey: string
	verifyingSharesDigest: string
	publicSummaryDigest: string
	signature: string
}

export interface DemoFridayAuthenticatedDkgParticipantV2 {
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
	verifyingShare: string
}

export interface DemoFridayAuthenticatedDkgResultV2 {
	schema: typeof DEMO_FRIDAY_DKG_AUTHENTICATED_RESULT_SCHEMA
	manifest: DemoFridayDkgPublicManifestV1
	manifestDigest: string
	rosterDigest: string
	round1TranscriptDigest: string
	publicSummaryDigest: string
	enrollments: DemoFridayDkgEnrollmentAttestationV1[]
	finalAttestations: DemoFridayDkgFinalAttestationV2[]
	runId: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	publicKeyPackagePath: string
	publicKeyPackageHex: string
	publicKeyPackageSha256: string
	inspectionPublicKeyPackageSha256: string
	signerRosterDigest: string
	committeePublicKey: string
	coordinatorIdentity: string
	participants: DemoFridayAuthenticatedDkgParticipantV2[]
}

export interface DemoFridayAuthenticatedDkgCheckpointV2 {
	expectedManifestDigest: string
	manifest: DemoFridayDkgPublicManifestV1
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
	round1Bundle: DemoFridayDkgRound1BundleV1
	agreementBundle: DemoFridayDkgRound1AgreementBundleV1
	finalPublicPackages: readonly DemoFridayDkgFinalPublicPackageV1[]
	publicInspections: readonly DemoFridayDkgPublicInspectionV1[]
	finalAttestations: readonly DemoFridayDkgFinalAttestationV2[]
}

function fail(message: string): never {
	throw new Error(`DEMO_FRIDAY_PER_VALIDATOR_BOOTSTRAP_V2: ${message}`)
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		fail(`${label} has missing or unexpected fields`)
	}
	return value as Record<string, unknown>
}

function frame(domain: string, fields: unknown[]): Uint8Array {
	return utf8ToBytes(JSON.stringify([domain, ...fields]))
}

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(frame(domain, fields)))
}

function signDigest(domain: string, messageDigest: string, privateKey: Uint8Array): string {
	return bytesToHex(schnorr.sign(
		hexToBytes(messageDigest), privateKey, sha256(frame(`${domain}_AUX`, [messageDigest])),
	))
}

function exactExpectedDigest(value: unknown): string {
	if (typeof value !== 'string' || !HEX_32.test(value)) fail('expected manifest digest must be an external canonical digest')
	return value
}

function exactSecp256k1Point(value: unknown, label: string, evenOnly = false): string {
	if (typeof value !== 'string' || !COMPRESSED_KEY.test(value) || (evenOnly && !value.startsWith('02'))) fail(`${label} is invalid`)
	try { secp256k1.Point.fromHex(value).assertValidity() }
	catch { fail(`${label} is not an on-curve secp256k1 point`) }
	return value
}

export function exactDemoFridayDkgPinnedManifestV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
}): DemoFridayDkgPublicManifestV1 {
	const expected = exactExpectedDigest(options.expectedManifestDigest)
	const manifest = exactDemoFridayDkgManifest(options.manifest)
	if (demoFridayDkgManifestDigest(manifest) !== expected) fail('manifest differs from the independently provisioned ceremony pin')
	return manifest
}

export function createDemoFridayDkgEnrollmentAttestationV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	participantId: DemoFridayParticipantId
	dkgIdentityPrivateKey: Uint8Array
}): DemoFridayDkgEnrollmentAttestationV1 {
	const manifest = exactDemoFridayDkgPinnedManifestV2(options)
	return createDemoFridayDkgEnrollmentAttestation({
		manifest, participantId: options.participantId, dkgIdentityPrivateKey: options.dkgIdentityPrivateKey,
	})
}

export function verifyDemoFridayDkgEnrollmentsV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
}): DemoFridayDkgEnrollmentAttestationV1[] {
	const manifest = exactDemoFridayDkgPinnedManifestV2(options)
	return verifyDemoFridayDkgEnrollments(manifest, options.enrollments)
}

const provisionalGates = new WeakMap<DemoFridayDkgProvisionalV2, DemoFridayDkgTransportGateV2>()

function freezeConfirmation(value: DemoFridayDkgPairwiseConfirmationV1): DemoFridayDkgPairwiseConfirmationV1 {
	return Object.freeze(structuredClone(value))
}

/** Derive confirmations without exporting any usable transport credential. */
export function deriveDemoFridayDkgProvisionalV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
	participantId: DemoFridayParticipantId
	dkgIdentityPrivateKey: Uint8Array
	kexPrivateKey: Uint8Array
}): DemoFridayDkgProvisionalV2 {
	const manifest = exactDemoFridayDkgPinnedManifestV2(options)
	verifyDemoFridayDkgEnrollmentsV2({ ...options, manifest })
	const gate = createDemoFridayDkgTransportGateV2({
		manifest, enrollments: options.enrollments, participantId: options.participantId,
		expectedManifestDigest: options.expectedManifestDigest,
		dkgIdentityPrivateKey: options.dkgIdentityPrivateKey, kexPrivateKey: options.kexPrivateKey,
	})
	const provisional = Object.freeze({
		schema: DEMO_FRIDAY_DKG_PROVISIONAL_SCHEMA,
		manifestDigest: options.expectedManifestDigest,
		participantId: options.participantId,
		confirmationsToSend: Object.freeze(gate.confirmationsToSend.map(freezeConfirmation)),
	})
	provisionalGates.set(provisional, gate)
	return provisional
}

/** Export the exact Rust transport object only after all three peers confirm. */
export function finalizeDemoFridayDkgTransportV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	provisional: DemoFridayDkgProvisionalV2
	peerConfirmations: readonly DemoFridayDkgPairwiseConfirmationV1[]
}): DemoFridayDkgTransportSecretsV1 {
	const manifest = exactDemoFridayDkgPinnedManifestV2(options)
	const gate = provisionalGates.get(options.provisional)
	if (!gate || options.provisional.schema !== DEMO_FRIDAY_DKG_PROVISIONAL_SCHEMA
		|| options.provisional.manifestDigest !== options.expectedManifestDigest
		|| options.provisional.participantId !== gate.participantId) fail('provisional handle is foreign, serialized, or differently bound')
	const transport = finalizeDemoFridayDkgTransportGateV2({
		manifest, expectedManifestDigest: options.expectedManifestDigest,
		gate, peerConfirmations: options.peerConfirmations,
	})
	provisionalGates.delete(options.provisional)
	return transport
}

function exactFinalPackage(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
	participantId: DemoFridayParticipantId,
): DemoFridayDkgFinalPublicPackageV1 {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'participant_id',
		'public_key_package_hex', 'public_key_package_sha256',
	], 'final public package')
	if (raw.version !== DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId || raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| raw.participant_id !== participantId || typeof raw.public_key_package_hex !== 'string'
		|| !/^[0-9a-f]+$/.test(raw.public_key_package_hex) || raw.public_key_package_hex.length % 2 !== 0
		|| raw.public_key_package_hex.length > 131_072 || typeof raw.public_key_package_sha256 !== 'string'
		|| raw.public_key_package_sha256 !== bytesToHex(sha256(hexToBytes(raw.public_key_package_hex)))) {
		fail(`participant ${participantId} final package is invalid`)
	}
	return structuredClone(raw) as unknown as DemoFridayDkgFinalPublicPackageV1
}

function exactInspection(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
	participantId: DemoFridayParticipantId,
): DemoFridayDkgPublicInspectionV1 {
	const raw = exactObject(value, [
		'version', 'run_id', 'committee_keyset_id', 'committee_keyset_version', 'source_participant_id',
		'public_key_package_sha256', 'committee_public_key', 'min_signers', 'max_signers', 'verifying_shares',
	], 'public inspection')
	if (raw.version !== 'COCO_DEMO_FROST_PUBLIC_INSPECTION_V1' || raw.run_id !== manifest.dkgRunId
		|| raw.committee_keyset_id !== manifest.committeeKeysetId || raw.committee_keyset_version !== manifest.committeeKeysetVersion
		|| raw.source_participant_id !== participantId || typeof raw.public_key_package_sha256 !== 'string'
		|| !HEX_32.test(raw.public_key_package_sha256)
		|| raw.min_signers !== 3 || raw.max_signers !== 4 || !Array.isArray(raw.verifying_shares)
		|| raw.verifying_shares.length !== 4) fail(`participant ${participantId} public inspection is invalid`)
	const committeePublicKey = exactSecp256k1Point(raw.committee_public_key, 'committee public key', true)
	const shares = raw.verifying_shares.map((value, index) => {
		const share = exactObject(value, ['participant_id', 'verifying_share_hex'], 'verifying share')
		if (share.participant_id !== PARTICIPANTS[index]) fail('verifying-share roster is invalid')
		return { participant_id: PARTICIPANTS[index]!, verifying_share_hex: exactSecp256k1Point(share.verifying_share_hex, 'verifying share') }
	})
	if (new Set(shares.map((share) => share.verifying_share_hex)).size !== 4) fail('verifying shares are not distinct')
	return { ...structuredClone(raw), committee_public_key: committeePublicKey, verifying_shares: shares } as unknown as DemoFridayDkgPublicInspectionV1
}

function verifyingSharesDigest(inspection: DemoFridayDkgPublicInspectionV1): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_VERIFYING_SHARES_V2', inspection.verifying_shares.map((share) => [
		share.participant_id, share.verifying_share_hex,
	]))
}

function publicSummaryDigest(options: {
	manifest: DemoFridayDkgPublicManifestV1
	manifestDigest?: string
	round1TranscriptDigest: string
	packageValue: DemoFridayDkgFinalPublicPackageV1
	inspection: DemoFridayDkgPublicInspectionV1
}): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_SUMMARY_V2', [
		options.manifestDigest ?? demoFridayDkgManifestDigest(options.manifest), options.manifest.rosterDigest,
		options.manifest.dkgRunId, options.manifest.committeeKeysetId, options.manifest.committeeKeysetVersion,
		options.round1TranscriptDigest, options.packageValue.public_key_package_hex,
		options.packageValue.public_key_package_sha256, options.inspection.public_key_package_sha256,
		options.inspection.committee_public_key, options.inspection.min_signers, options.inspection.max_signers,
		options.inspection.verifying_shares.map((share) => [share.participant_id, share.verifying_share_hex]),
		options.manifest.participants.map((participant) => [
			participant.participantId, participant.hostId, participant.underlayIpv4, participant.fipsNpub,
			participant.fipsUla, participant.dkgIdentity, participant.signerIdentity, participant.kexPublicKey,
			participant.signerEndpoint, participant.participantBinarySha256, participant.inspectorBinarySha256,
			participant.configPath, participant.stateDirectory,
		]),
	])
}

function finalAttestationDigest(value: Omit<DemoFridayDkgFinalAttestationV2, 'signature'>): string {
	return digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V2', [
		value.schema, value.manifestDigest, value.rosterDigest, value.round1TranscriptDigest,
		value.participantId, value.dkgIdentity, value.signerIdentity, value.signerEndpoint,
		value.participantBinarySha256, value.inspectorBinarySha256, value.packageBytesSha256,
		value.inspectionPackageSha256, value.committeePublicKey, value.verifyingSharesDigest,
		value.publicSummaryDigest,
	])
}

export function createDemoFridayDkgFinalAttestationV2(options: {
	manifest: DemoFridayDkgPublicManifestV1
	expectedManifestDigest: string
	enrollments: readonly DemoFridayDkgEnrollmentAttestationV1[]
	participantId: DemoFridayParticipantId
	dkgIdentityPrivateKey: Uint8Array
	round1Bundle: DemoFridayDkgRound1BundleV1
	agreementBundle: DemoFridayDkgRound1AgreementBundleV1
	finalPublicPackage: DemoFridayDkgFinalPublicPackageV1
	publicInspection: DemoFridayDkgPublicInspectionV1
}): DemoFridayDkgFinalAttestationV2 {
	const manifest = exactDemoFridayDkgPinnedManifestV2(options)
	verifyDemoFridayDkgEnrollmentsV2({ ...options, manifest })
	const participant = manifest.participants[options.participantId - 1]
	if (!participant || bytesToHex(schnorr.getPublicKey(options.dkgIdentityPrivateKey)) !== participant.dkgIdentity) {
		fail('final signer is not the externally pinned participant')
	}
	const round1TranscriptDigest = verifyDemoFridayDkgRound1Transcript({
		manifest, round1Bundle: options.round1Bundle, agreementBundle: options.agreementBundle,
	})
	const packageValue = exactFinalPackage(options.finalPublicPackage, manifest, options.participantId)
	const inspection = exactInspection(options.publicInspection, manifest, options.participantId)
	// Independent comparison is mandatory even though each side was validated.
	if (packageValue.public_key_package_sha256 !== inspection.public_key_package_sha256) {
		fail('package bytes hash differs from the independently inspected package hash')
	}
	const unsigned: Omit<DemoFridayDkgFinalAttestationV2, 'signature'> = {
		schema: DEMO_FRIDAY_DKG_FINAL_ATTESTATION_V2_SCHEMA, manifestDigest: options.expectedManifestDigest,
		rosterDigest: manifest.rosterDigest, round1TranscriptDigest, participantId: options.participantId,
		dkgIdentity: participant.dkgIdentity, signerIdentity: participant.signerIdentity,
		signerEndpoint: participant.signerEndpoint, participantBinarySha256: participant.participantBinarySha256,
		inspectorBinarySha256: participant.inspectorBinarySha256,
		packageBytesSha256: packageValue.public_key_package_sha256,
		inspectionPackageSha256: inspection.public_key_package_sha256,
		committeePublicKey: inspection.committee_public_key,
		verifyingSharesDigest: verifyingSharesDigest(inspection),
		publicSummaryDigest: publicSummaryDigest({ manifest, round1TranscriptDigest, packageValue, inspection }),
	}
	return {
		...unsigned,
		signature: signDigest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_FINAL_ATTESTATION_V2',
			finalAttestationDigest(unsigned), options.dkgIdentityPrivateKey),
	}
}

function exactFinalAttestation(
	value: unknown,
	manifest: DemoFridayDkgPublicManifestV1,
	participantId: DemoFridayParticipantId,
	expected: Omit<DemoFridayDkgFinalAttestationV2, 'signature'>,
): DemoFridayDkgFinalAttestationV2 {
	const raw = exactObject(value, [
		'schema', 'manifestDigest', 'rosterDigest', 'round1TranscriptDigest', 'participantId', 'dkgIdentity',
		'signerIdentity', 'signerEndpoint', 'participantBinarySha256', 'inspectorBinarySha256',
		'packageBytesSha256', 'inspectionPackageSha256', 'committeePublicKey', 'verifyingSharesDigest',
		'publicSummaryDigest', 'signature',
	], 'final attestation')
	for (const [field, expectedValue] of Object.entries(expected)) {
		if (raw[field] !== expectedValue) fail(`final attestation ${participantId} differs at ${field}`)
	}
	if (typeof raw.signature !== 'string' || !HEX_64.test(raw.signature)
		|| !schnorr.verify(hexToBytes(raw.signature), hexToBytes(finalAttestationDigest(expected)),
			hexToBytes(manifest.participants[participantId - 1]!.dkgIdentity))) {
		fail(`final attestation ${participantId} has an invalid identity signature`)
	}
	return structuredClone(raw) as unknown as DemoFridayDkgFinalAttestationV2
}

function signerRosterDigest(manifest: DemoFridayDkgPublicManifestV1, inspection: DemoFridayDkgPublicInspectionV1): string {
	return digest('COCO_DEMO_FROST_SIGNER_ROSTER_V1', [
		manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion,
		inspection.public_key_package_sha256, inspection.committee_public_key, 3, 4,
		inspection.verifying_shares.map((share) => ({
			participant_id: share.participant_id, verifying_share_hex: share.verifying_share_hex,
		})),
	])
}

export function assembleDemoFridayAuthenticatedDkgResultV2(
	checkpoint: DemoFridayAuthenticatedDkgCheckpointV2,
): DemoFridayAuthenticatedDkgResultV2 {
	const manifest = exactDemoFridayDkgPinnedManifestV2(checkpoint)
	const enrollments = verifyDemoFridayDkgEnrollmentsV2({ ...checkpoint, manifest })
	const round1TranscriptDigest = verifyDemoFridayDkgRound1Transcript({
		manifest, round1Bundle: checkpoint.round1Bundle, agreementBundle: checkpoint.agreementBundle,
	})
	if (checkpoint.finalPublicPackages.length !== 4 || checkpoint.publicInspections.length !== 4
		|| checkpoint.finalAttestations.length !== 4) fail('exactly four packages, inspections, and final attestations are required')
	const packages = checkpoint.finalPublicPackages.map((value, index) => exactFinalPackage(value, manifest, PARTICIPANTS[index]!))
	const inspections = checkpoint.publicInspections.map((value, index) => exactInspection(value, manifest, PARTICIPANTS[index]!))
	for (let index = 0; index < 4; index += 1) {
		if (packages[index]!.public_key_package_sha256 !== inspections[index]!.public_key_package_sha256) {
			fail(`participant ${index + 1} package bytes hash differs from its inspection hash`)
		}
	}
	if (new Set(packages.map((value) => value.public_key_package_hex)).size !== 1
		|| new Set(packages.map((value) => value.public_key_package_sha256)).size !== 1) {
		fail('four final public packages are not byte-identical')
	}
	const summaries = packages.map((packageValue, index) => publicSummaryDigest({
		manifest, round1TranscriptDigest, packageValue, inspection: inspections[index]!,
	}))
	if (new Set(summaries).size !== 1) fail('four public inspections do not describe one identical authenticated committee')
	const finalAttestations = checkpoint.finalAttestations.map((value, index) => {
		const participantId = PARTICIPANTS[index]!
		const participant = manifest.participants[index]!
		const expected: Omit<DemoFridayDkgFinalAttestationV2, 'signature'> = {
			schema: DEMO_FRIDAY_DKG_FINAL_ATTESTATION_V2_SCHEMA,
			manifestDigest: checkpoint.expectedManifestDigest, rosterDigest: manifest.rosterDigest,
			round1TranscriptDigest, participantId, dkgIdentity: participant.dkgIdentity,
			signerIdentity: participant.signerIdentity, signerEndpoint: participant.signerEndpoint,
			participantBinarySha256: participant.participantBinarySha256,
			inspectorBinarySha256: participant.inspectorBinarySha256,
			packageBytesSha256: packages[index]!.public_key_package_sha256,
			inspectionPackageSha256: inspections[index]!.public_key_package_sha256,
			committeePublicKey: inspections[index]!.committee_public_key,
			verifyingSharesDigest: verifyingSharesDigest(inspections[index]!), publicSummaryDigest: summaries[index]!,
		}
		return exactFinalAttestation(value, manifest, participantId, expected)
	})
	const inspection = inspections[0]!
	return {
		schema: DEMO_FRIDAY_DKG_AUTHENTICATED_RESULT_SCHEMA, manifest, manifestDigest: checkpoint.expectedManifestDigest,
		rosterDigest: manifest.rosterDigest, round1TranscriptDigest, publicSummaryDigest: summaries[0]!,
		enrollments, finalAttestations, runId: manifest.applicationRunId, dkgRunId: manifest.dkgRunId,
		committeeKeysetId: manifest.committeeKeysetId, committeeKeysetVersion: manifest.committeeKeysetVersion,
		// exactDemoFridayDkgManifest has already confined every participant to
		// one accepted ceremony root. Preserve that root in the public result.
		publicKeyPackagePath: `${manifest.participants[0].configPath.slice(0, -'/participant.config.json'.length)}/exchange/${manifest.dkgRunId}/participant-1.public.json`,
		publicKeyPackageHex: packages[0]!.public_key_package_hex,
		publicKeyPackageSha256: packages[0]!.public_key_package_sha256,
		inspectionPublicKeyPackageSha256: inspection.public_key_package_sha256,
		signerRosterDigest: signerRosterDigest(manifest, inspection), committeePublicKey: inspection.committee_public_key,
		coordinatorIdentity: manifest.coordinatorIdentity,
		participants: manifest.participants.map((participant, index) => ({
			...participant, verifyingShare: inspection.verifying_shares[index]!.verifying_share_hex,
		})),
	}
}

export function verifyDemoFridayAuthenticatedDkgResultV2AtRoot(options: {
	expectedManifestDigest: string
	result: DemoFridayAuthenticatedDkgResultV2
	expectedDkgRoot: string
	verifyManifestAndEnrollments: (options: {
		manifest: unknown
		expectedManifestDigest: string
		enrollments: unknown
	}) => DemoFridayDkgPublicManifestV1
}): DemoFridayAuthenticatedDkgResultV2 {
	const expectedManifestDigest = exactExpectedDigest(options.expectedManifestDigest)
	const raw = exactObject(options.result, [
		'schema', 'manifest', 'manifestDigest', 'rosterDigest', 'round1TranscriptDigest', 'publicSummaryDigest',
		'enrollments', 'finalAttestations', 'runId', 'dkgRunId', 'committeeKeysetId', 'committeeKeysetVersion',
		'publicKeyPackagePath', 'publicKeyPackageHex', 'publicKeyPackageSha256', 'inspectionPublicKeyPackageSha256',
		'signerRosterDigest', 'committeePublicKey', 'coordinatorIdentity', 'participants',
	], 'authenticated result')
	if (raw.schema !== DEMO_FRIDAY_DKG_AUTHENTICATED_RESULT_SCHEMA || raw.manifestDigest !== expectedManifestDigest) {
		fail('authenticated result schema or external manifest binding differs')
	}
	if (!Array.isArray(raw.enrollments) || raw.enrollments.length !== 4) fail('authenticated result requires four enrollments')
	const manifest = options.verifyManifestAndEnrollments({
		manifest: raw.manifest, expectedManifestDigest, enrollments: raw.enrollments,
	})
	if (raw.rosterDigest !== manifest.rosterDigest || typeof raw.round1TranscriptDigest !== 'string'
		|| !HEX_32.test(raw.round1TranscriptDigest) || typeof raw.publicSummaryDigest !== 'string'
		|| !HEX_32.test(raw.publicSummaryDigest) || raw.runId !== manifest.applicationRunId || raw.dkgRunId !== manifest.dkgRunId
		|| raw.committeeKeysetId !== manifest.committeeKeysetId || raw.committeeKeysetVersion !== manifest.committeeKeysetVersion
		|| typeof raw.publicKeyPackageHex !== 'string' || !/^[0-9a-f]+$/.test(raw.publicKeyPackageHex)
		|| raw.publicKeyPackageHex.length % 2 !== 0 || raw.publicKeyPackageHex.length > 131_072
		|| raw.publicKeyPackageSha256 !== bytesToHex(sha256(hexToBytes(raw.publicKeyPackageHex)))
		|| raw.inspectionPublicKeyPackageSha256 !== raw.publicKeyPackageSha256 || !Array.isArray(raw.participants) || raw.participants.length !== 4
		|| !Array.isArray(raw.finalAttestations) || raw.finalAttestations.length !== 4) fail('authenticated result public binding is invalid')
	const committeePublicKey = exactSecp256k1Point(raw.committeePublicKey, 'result committee public key', true)
	const participants = raw.participants as DemoFridayAuthenticatedDkgParticipantV2[]
	const shares = participants.map((participant, index) => {
		exactObject(participant, [
			'participantId', 'hostId', 'underlayIpv4', 'fipsNpub', 'fipsUla', 'dkgIdentity', 'signerIdentity',
			'kexPublicKey', 'signerEndpoint', 'participantBinarySha256', 'inspectorBinarySha256',
			'configPath', 'stateDirectory', 'verifyingShare',
		], `authenticated result participant ${index + 1}`)
		const manifestParticipant = manifest.participants[index]!
		for (const [key, value] of Object.entries(manifestParticipant)) {
			if ((participant as unknown as Record<string, unknown>)[key] !== value) fail(`result participant ${index + 1} differs from manifest`)
		}
		return { participant_id: PARTICIPANTS[index]!, verifying_share_hex: exactSecp256k1Point(participant.verifyingShare, 'result verifying share') }
	})
	if (new Set(shares.map((share) => share.verifying_share_hex)).size !== 4) fail('result verifying shares are not distinct')
	const inspection: DemoFridayDkgPublicInspectionV1 = {
		version: 'COCO_DEMO_FROST_PUBLIC_INSPECTION_V1', run_id: manifest.dkgRunId,
		committee_keyset_id: manifest.committeeKeysetId, committee_keyset_version: manifest.committeeKeysetVersion,
		source_participant_id: 1, public_key_package_sha256: raw.publicKeyPackageSha256 as string,
		committee_public_key: committeePublicKey, min_signers: 3, max_signers: 4,
		verifying_shares: shares,
	}
	const packageValue: DemoFridayDkgFinalPublicPackageV1 = {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: manifest.dkgRunId,
		committee_keyset_id: manifest.committeeKeysetId, committee_keyset_version: manifest.committeeKeysetVersion,
		participant_id: 1, public_key_package_hex: raw.publicKeyPackageHex as string,
		public_key_package_sha256: raw.publicKeyPackageSha256 as string,
	}
	const summary = publicSummaryDigest({
		manifest, manifestDigest: expectedManifestDigest,
		round1TranscriptDigest: raw.round1TranscriptDigest as string, packageValue, inspection,
	})
	if (summary !== raw.publicSummaryDigest || raw.signerRosterDigest !== signerRosterDigest(manifest, inspection)
		|| raw.coordinatorIdentity !== manifest.coordinatorIdentity
		|| raw.publicKeyPackagePath !== `${options.expectedDkgRoot}/exchange/${manifest.dkgRunId}/participant-1.public.json`) {
		fail('authenticated result summary or established public binding differs')
	}
	for (let index = 0; index < 4; index += 1) {
		const participantId = PARTICIPANTS[index]!
		const participant = manifest.participants[index]!
		const expected: Omit<DemoFridayDkgFinalAttestationV2, 'signature'> = {
			schema: DEMO_FRIDAY_DKG_FINAL_ATTESTATION_V2_SCHEMA, manifestDigest: expectedManifestDigest,
			rosterDigest: manifest.rosterDigest, round1TranscriptDigest: raw.round1TranscriptDigest as string,
			participantId, dkgIdentity: participant.dkgIdentity, signerIdentity: participant.signerIdentity,
			signerEndpoint: participant.signerEndpoint, participantBinarySha256: participant.participantBinarySha256,
			inspectorBinarySha256: participant.inspectorBinarySha256,
			packageBytesSha256: raw.publicKeyPackageSha256 as string,
			inspectionPackageSha256: raw.inspectionPublicKeyPackageSha256 as string,
			committeePublicKey: raw.committeePublicKey as string, verifyingSharesDigest: verifyingSharesDigest(inspection),
			publicSummaryDigest: summary,
		}
		exactFinalAttestation(raw.finalAttestations[index], manifest, participantId, expected)
	}
	return structuredClone(options.result)
}

/** Downstream V1 consumers retain the exact established keyset-v1 contract. */
export function verifyDemoFridayAuthenticatedDkgResultV2(options: {
	expectedManifestDigest: string
	result: DemoFridayAuthenticatedDkgResultV2
}): DemoFridayAuthenticatedDkgResultV2 {
	return verifyDemoFridayAuthenticatedDkgResultV2AtRoot({
		...options,
		expectedDkgRoot: DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
		verifyManifestAndEnrollments: ({ manifest, expectedManifestDigest, enrollments }) => {
			const verified = exactDemoFridayDkgPinnedManifestV2({
				manifest: manifest as DemoFridayDkgPublicManifestV1, expectedManifestDigest,
			})
			verifyDemoFridayDkgEnrollmentsV2({
				manifest: verified, expectedManifestDigest,
				enrollments: enrollments as DemoFridayDkgEnrollmentAttestationV1[],
			})
			return verified
		},
	})
}
