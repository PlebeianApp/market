import { describe, expect, test } from 'bun:test'

import { x25519 } from '@noble/curves/ed25519.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgManifestDigest,
	demoFridayDkgRosterDigest,
	type DemoFridayDkgFinalPublicPackageV1,
	type DemoFridayDkgPublicInspectionV1,
	type DemoFridayDkgPublicManifestV1,
	type DemoFridayDkgRound1AgreementBundleV1,
	type DemoFridayDkgRound1BundleV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	assembleDemoFridayAuthenticatedDkgResultV2,
	createDemoFridayDkgEnrollmentAttestationV2,
	createDemoFridayDkgFinalAttestationV2,
	deriveDemoFridayDkgProvisionalV2,
	finalizeDemoFridayDkgTransportV2,
	verifyDemoFridayAuthenticatedDkgResultV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
} from './demo-friday-per-validator-dkg-plan'

const IDS = [1, 2, 3, 4] as const
const dkgPrivate = IDS.map((id) => new Uint8Array(32).fill(id))
const signerPrivate = IDS.map((id) => new Uint8Array(32).fill(id + 10))
const kexPrivate = IDS.map((id) => new Uint8Array(32).fill(id + 20))
const coordinatorPrivate = new Uint8Array(32).fill(31)

function hash(value: string | Uint8Array): string {
	return bytesToHex(sha256(typeof value === 'string' ? utf8ToBytes(value) : value))
}

function rustFrame(context: string, fields: readonly Uint8Array[]): Uint8Array {
	const contextBytes = utf8ToBytes(context)
	const output = new Uint8Array(contextBytes.length + fields.reduce((sum, field) => sum + 4 + field.length, 0))
	output.set(contextBytes)
	let offset = contextBytes.length
	for (const field of fields) {
		new DataView(output.buffer).setUint32(offset, field.length, false); offset += 4
		output.set(field, offset); offset += field.length
	}
	return output
}

function manifest(): DemoFridayDkgPublicManifestV1 {
	const ulas = [
		'fdc4:dc3c:6792:3f67:5b5d:453d:8712:b236', 'fd76:1a7b:b02d:6bd8:54e8:653f:110f:87be',
		'fd52:1a36:50a9:faa:3501:ce66:f3b8:7838', 'fd40:fda8:93de:8d8c:2bd1:b243:e607:7b7f',
	] as const
	const participants = IDS.map((participantId, index) => ({
		participantId, hostId: `linode-${108175009 + index}`, underlayIpv4: `172.105.${64 + index}.${142 - index}`,
		fipsNpub: `npub1${['q', 'p', 'z', 'r'][index]!.repeat(58)}`, fipsUla: ulas[index]!,
		dkgIdentity: bytesToHex(schnorr.getPublicKey(dkgPrivate[index]!)),
		signerIdentity: bytesToHex(schnorr.getPublicKey(signerPrivate[index]!)),
		kexPublicKey: bytesToHex(x25519.getPublicKey(kexPrivate[index]!)),
		signerEndpoint: `http://[${ulas[index]}]:39101/v1/frost`,
		participantBinarySha256: hash(`participant-binary-${participantId}`),
		inspectorBinarySha256: hash(`inspector-binary-${participantId}`),
		configPath: `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/participant.config.json`,
		stateDirectory: `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/state`,
	})) as unknown as DemoFridayDkgPublicManifestV1['participants']
	return {
		schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-v2-r12', applicationRunId: 'friday-auctions-r12', dkgRunId: 'friday-dkg-r12',
		committeeKeysetId: 'friday-committee-v1', committeeKeysetVersion: '1', roster: IDS,
		rosterDigest: demoFridayDkgRosterDigest(participants), coordinatorParticipantId: 1,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(coordinatorPrivate)), participants,
	}
}

function enrollments(value: DemoFridayDkgPublicManifestV1, expectedManifestDigest: string) {
	return IDS.map((participantId, index) => createDemoFridayDkgEnrollmentAttestationV2({
		manifest: value, expectedManifestDigest, participantId, dkgIdentityPrivateKey: dkgPrivate[index]!,
	}))
}

function signedRound1(value: DemoFridayDkgPublicManifestV1): {
	round1Bundle: DemoFridayDkgRound1BundleV1
	agreementBundle: DemoFridayDkgRound1AgreementBundleV1
} {
	const entries = IDS.map((sender, index) => {
		const payload_hex = sender.toString(16).padStart(2, '0').repeat(64)
		const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', [
			utf8ToBytes(DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION), utf8ToBytes(value.dkgRunId),
			utf8ToBytes(value.committeeKeysetId), utf8ToBytes(value.committeeKeysetVersion),
			Uint8Array.of(0, sender), utf8ToBytes(payload_hex),
		])
		return {
			version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: value.dkgRunId,
			committee_keyset_id: value.committeeKeysetId, committee_keyset_version: value.committeeKeysetVersion,
			sender, payload_hex, auth_signature_hex: bytesToHex(schnorr.sign(sha256(message), dkgPrivate[index]!, new Uint8Array(32))),
		}
	})
	const round1_digest = hash(JSON.stringify(entries))
	const agreements = IDS.map((participant_id, index) => {
		const message = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', [
			utf8ToBytes(DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION), utf8ToBytes(value.dkgRunId),
			utf8ToBytes(value.committeeKeysetId), utf8ToBytes(value.committeeKeysetVersion),
			Uint8Array.of(0, participant_id), utf8ToBytes(round1_digest),
		])
		return {
			version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: value.dkgRunId,
			committee_keyset_id: value.committeeKeysetId, committee_keyset_version: value.committeeKeysetVersion,
			participant_id, round1_digest,
			auth_signature_hex: bytesToHex(schnorr.sign(sha256(message), dkgPrivate[index]!, new Uint8Array(32))),
		}
	})
	return {
		round1Bundle: { version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, entries },
		agreementBundle: { version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, entries: agreements },
	}
}

function publicFixtures(value: DemoFridayDkgPublicManifestV1) {
	const bytes = new Uint8Array(240).fill(0xa1)
	const packageHash = hash(bytes)
	const shares = IDS.map((participant_id, index) => ({
		participant_id, verifying_share_hex: bytesToHex(secp256k1.Point.BASE.multiply(BigInt(index + 11)).toBytes(true)),
	}))
	const packages = IDS.map((participant_id): DemoFridayDkgFinalPublicPackageV1 => ({
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: value.dkgRunId,
		committee_keyset_id: value.committeeKeysetId, committee_keyset_version: value.committeeKeysetVersion,
		participant_id, public_key_package_hex: bytesToHex(bytes), public_key_package_sha256: packageHash,
	}))
	const inspections = IDS.map((source_participant_id): DemoFridayDkgPublicInspectionV1 => ({
		version: 'COCO_DEMO_FROST_PUBLIC_INSPECTION_V1', run_id: value.dkgRunId,
		committee_keyset_id: value.committeeKeysetId, committee_keyset_version: value.committeeKeysetVersion,
		source_participant_id, public_key_package_sha256: packageHash,
		committee_public_key: bytesToHex(secp256k1.Point.BASE.multiply(2n).toBytes(true)), min_signers: 3, max_signers: 4,
		verifying_shares: structuredClone(shares),
	}))
	return { packages, inspections }
}

function completeCheckpoint() {
	const value = manifest()
	const expectedManifestDigest = demoFridayDkgManifestDigest(value)
	const signed = enrollments(value, expectedManifestDigest)
	const round1 = signedRound1(value)
	const fixtures = publicFixtures(value)
	const attestations = IDS.map((participantId, index) => createDemoFridayDkgFinalAttestationV2({
		manifest: value, expectedManifestDigest, enrollments: signed, participantId,
		dkgIdentityPrivateKey: dkgPrivate[index]!, ...round1,
		finalPublicPackage: fixtures.packages[index]!, publicInspection: fixtures.inspections[index]!,
	}))
	return { value, expectedManifestDigest, signed, round1, fixtures, attestations }
}

describe('per-validator DKG authenticated checkpoint V2', () => {
	test('requires a separately pinned manifest digest before enrollment or derivation', () => {
		const value = manifest()
		const actual = demoFridayDkgManifestDigest(value)
		expect(() => createDemoFridayDkgEnrollmentAttestationV2({
			manifest: value, expectedManifestDigest: '00'.repeat(32), participantId: 1,
			dkgIdentityPrivateKey: dkgPrivate[0]!,
		})).toThrow('independently provisioned ceremony pin')
		const signed = enrollments(value, actual)
		expect(() => deriveDemoFridayDkgProvisionalV2({
			manifest: value, expectedManifestDigest: '11'.repeat(32), enrollments: signed,
			participantId: 1, dkgIdentityPrivateKey: dkgPrivate[0]!, kexPrivateKey: kexPrivate[0]!,
		})).toThrow('independently provisioned ceremony pin')
	})

	test('requires Go-canonical ULA spelling and actual on-curve committee/share points', () => {
		const aliased = structuredClone(manifest())
		aliased.participants[2]!.fipsUla = 'fd52:1a36:50a9:0faa:3501:ce66:f3b8:7838'
		aliased.participants[2]!.signerEndpoint = 'http://[fd52:1a36:50a9:0faa:3501:ce66:f3b8:7838]:39101/v1/frost'
		expect(() => demoFridayDkgManifestDigest(aliased)).toThrow('host/FIPS identity is invalid')

		const fixture = completeCheckpoint()
		const invalidCommittee = structuredClone(fixture.fixtures.inspections[0]!)
		invalidCommittee.committee_public_key = `02${'ff'.repeat(32)}`
		expect(() => createDemoFridayDkgFinalAttestationV2({
			manifest: fixture.value, expectedManifestDigest: fixture.expectedManifestDigest,
			enrollments: fixture.signed, participantId: 1, dkgIdentityPrivateKey: dkgPrivate[0]!,
			...fixture.round1, finalPublicPackage: fixture.fixtures.packages[0]!, publicInspection: invalidCommittee,
		})).toThrow('on-curve')
		const invalidShare = structuredClone(fixture.fixtures.inspections[0]!)
		invalidShare.verifying_shares[0]!.verifying_share_hex = `03${'ff'.repeat(32)}`
		expect(() => createDemoFridayDkgFinalAttestationV2({
			manifest: fixture.value, expectedManifestDigest: fixture.expectedManifestDigest,
			enrollments: fixture.signed, participantId: 1, dkgIdentityPrivateKey: dkgPrivate[0]!,
			...fixture.round1, finalPublicPackage: fixture.fixtures.packages[0]!, publicInspection: invalidShare,
		})).toThrow('on-curve')
	})

	test('keeps pairwise transport credentials opaque until all three directional confirmations verify', () => {
		const value = manifest(); const expectedManifestDigest = demoFridayDkgManifestDigest(value)
		const signed = enrollments(value, expectedManifestDigest)
		const provisionals = IDS.map((participantId, index) => deriveDemoFridayDkgProvisionalV2({
			manifest: value, expectedManifestDigest, enrollments: signed, participantId,
			dkgIdentityPrivateKey: dkgPrivate[index]!, kexPrivateKey: kexPrivate[index]!,
		}))
		expect(JSON.stringify(provisionals[0])).not.toMatch(/transportSecrets|identity_signing_key_hex|round2_pairwise_keys|key_hex/)
		const peerConfirmations = provisionals.slice(1).map((peer) =>
			peer.confirmationsToSend.find((confirmation) => confirmation.recipientParticipantId === 1)!)
		expect(() => finalizeDemoFridayDkgTransportV2({
			manifest: value, expectedManifestDigest, provisional: provisionals[0]!,
			peerConfirmations: peerConfirmations.slice(0, 2),
		})).toThrow('incomplete')
		expect(() => finalizeDemoFridayDkgTransportV2({
			manifest: value, expectedManifestDigest,
			provisional: structuredClone(provisionals[0]!), peerConfirmations,
		})).toThrow('foreign, serialized')
		const transport = finalizeDemoFridayDkgTransportV2({
			manifest: value, expectedManifestDigest, provisional: provisionals[0]!, peerConfirmations,
		})
		expect(transport.participant_id).toBe(1)
		expect(transport.round2_pairwise_keys.map((entry) => entry.peer_id)).toEqual([2, 3, 4])
		expect(() => finalizeDemoFridayDkgTransportV2({
			manifest: value, expectedManifestDigest, provisional: provisionals[0]!, peerConfirmations,
		})).toThrow('foreign, serialized')
	})

	test('emits a downstream-verifiable authenticated result rather than a naked committee key', () => {
		const fixture = completeCheckpoint()
		const result = assembleDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, manifest: fixture.value,
			enrollments: fixture.signed, ...fixture.round1, finalPublicPackages: fixture.fixtures.packages,
			publicInspections: fixture.fixtures.inspections, finalAttestations: fixture.attestations,
		})
		expect({
			manifestDigest: result.manifestDigest, rosterDigest: result.rosterDigest,
			round1TranscriptDigest: result.round1TranscriptDigest, publicSummaryDigest: result.publicSummaryDigest,
			signerRosterDigest: result.signerRosterDigest, publicKeyPackageSha256: result.publicKeyPackageSha256,
			committeePublicKey: result.committeePublicKey,
		}).toEqual({
			manifestDigest: 'ea9db8bcc122956c52c93294ef4700b3ad4a5af722f1b1374966e76440626b5d',
			rosterDigest: 'f71ec5df9dc4ef1aaf78dedd71179f57bedf0e2b6a0faf01063fdc2061563b47',
			round1TranscriptDigest: '19a05d9f039979046d6d524d16aa42eb738cd0752317228943fda81e1e02eb39',
			publicSummaryDigest: '66858070b56ae63aa0d8511ac989cd2086d9875cc29b73baa9d789900256a644',
			signerRosterDigest: '99d8bdbf2f62e1ea2a7958243fe1c86ca45834f392c2f602ae3fde299557877e',
			publicKeyPackageSha256: 'd2faf97d31180224c0d9842599168b7cd2df292f89741fbd7aad398a6c57afe4',
			committeePublicKey: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
		})
		expect(result.participants.map((participant) => participant.verifyingShare)).toEqual([
			'03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb',
			'03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a',
			'03f28773c2d975288bc7d1d205c3748651b075fbc6610e58cddeeddf8f19405aa8',
			'03499fdf9e895e719cfd64e67f07d38e3226aa7b63678949e6e49b241a60e823e4',
		])
		expect(result.schema).toBe('PLEBEIAN_FRIDAY_AUTHENTICATED_DKG_RESULT_V2')
		expect(result.enrollments).toHaveLength(4)
		expect(result.finalAttestations).toHaveLength(4)
		expect(result.manifestDigest).toBe(fixture.expectedManifestDigest)
		expect(result.publicKeyPackageHex).toBe(fixture.fixtures.packages[0]!.public_key_package_hex)
		expect(result.participants.map((participant) => participant.participantBinarySha256))
			.toEqual(fixture.value.participants.map((participant) => participant.participantBinarySha256))
		expect(() => verifyDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, result,
		})).not.toThrow()
		expect(() => verifyDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: '00'.repeat(32), result,
		})).toThrow('external manifest binding differs')
	})

	test('independently rejects package bytes/hash versus inspector hash before attestations are considered', () => {
		const fixture = completeCheckpoint()
		const packages = structuredClone(fixture.fixtures.packages)
		const changedBytes = new Uint8Array(240).fill(0xa2)
		packages[2]!.public_key_package_hex = bytesToHex(changedBytes)
		packages[2]!.public_key_package_sha256 = hash(changedBytes)
		expect(() => assembleDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, manifest: fixture.value,
			enrollments: fixture.signed, ...fixture.round1, finalPublicPackages: packages,
			publicInspections: fixture.fixtures.inspections, finalAttestations: fixture.attestations,
		})).toThrow('package bytes hash differs from its inspection hash')
	})

	test('rejects altered endpoint, binary pins, transcript, and all-four attestation omissions', () => {
		const fixture = completeCheckpoint()
		const result = assembleDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, manifest: fixture.value,
			enrollments: fixture.signed, ...fixture.round1, finalPublicPackages: fixture.fixtures.packages,
			publicInspections: fixture.fixtures.inspections, finalAttestations: fixture.attestations,
		})
		const endpoint = structuredClone(result)
		endpoint.participants[0]!.signerEndpoint = 'http://[fd00::1]:39101/v1/frost'
		expect(() => verifyDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, result: endpoint,
		})).toThrow('differs from manifest')
		const binary = structuredClone(result)
		binary.participants[1]!.participantBinarySha256 = '00'.repeat(32)
		expect(() => verifyDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, result: binary,
		})).toThrow('differs from manifest')
		const transcript = structuredClone(result)
		transcript.round1TranscriptDigest = '11'.repeat(32)
		expect(() => verifyDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, result: transcript,
		})).toThrow('summary')
		expect(() => assembleDemoFridayAuthenticatedDkgResultV2({
			expectedManifestDigest: fixture.expectedManifestDigest, manifest: fixture.value,
			enrollments: fixture.signed, ...fixture.round1, finalPublicPackages: fixture.fixtures.packages,
			publicInspections: fixture.fixtures.inspections, finalAttestations: fixture.attestations.slice(0, 3),
		})).toThrow('exactly four')
	})
})
