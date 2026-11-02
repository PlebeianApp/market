import { describe, expect, test } from 'bun:test'

import { x25519 } from '@noble/curves/ed25519.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	assembleDemoFridayPublicDkgResult,
	createDemoFridayDkgEnrollmentAttestation,
	createDemoFridayDkgFinalAttestation,
	createDemoFridayDkgTransportGateV2,
	demoFridayDkgManifestDigest,
	demoFridayDkgRosterDigest,
	exactDemoFridayDkgManifest,
	finalizeDemoFridayDkgTransportGateV2,
	verifyDemoFridayDkgRound1Transcript,
	verifyDemoFridayDkgEnrollments,
	type DemoFridayDkgFinalPublicPackageV1,
	type DemoFridayDkgPublicInspectionV1,
	type DemoFridayDkgPublicManifestV1,
	type DemoFridayDkgRound1AgreementBundleV1,
	type DemoFridayDkgRound1BundleV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
} from './demo-friday-per-validator-dkg-plan'

const IDS = [1, 2, 3, 4] as const
const dkgPrivate = IDS.map((id) => new Uint8Array(32).fill(id))
const signerPrivate = IDS.map((id) => new Uint8Array(32).fill(id + 10))
const kexPrivate = IDS.map((id) => new Uint8Array(32).fill(id + 20))
const coordinatorPrivate = new Uint8Array(32).fill(31)

function hash(value: string): string { return bytesToHex(sha256(utf8ToBytes(value))) }

function rustFrame(context: string, fields: readonly Uint8Array[]): Uint8Array {
	const contextBytes = utf8ToBytes(context)
	const output = new Uint8Array(contextBytes.length + fields.reduce((sum, field) => sum + 4 + field.length, 0))
	output.set(contextBytes)
	let offset = contextBytes.length
	for (const field of fields) {
		new DataView(output.buffer).setUint32(offset, field.length, false)
		offset += 4
		output.set(field, offset)
		offset += field.length
	}
	return output
}

function signRustFrame(
	context: string, fields: readonly Uint8Array[], privateKey: Uint8Array, hashRounds = 1,
): string {
	let message = rustFrame(context, fields)
	for (let index = 0; index < hashRounds; index += 1) message = sha256(message)
	return bytesToHex(schnorr.sign(message, privateKey, new Uint8Array(32)))
}

function signedRound1(value: DemoFridayDkgPublicManifestV1): {
	round1Bundle: DemoFridayDkgRound1BundleV1
	agreementBundle: DemoFridayDkgRound1AgreementBundleV1
} {
	const entries = IDS.map((sender, index) => {
		const payload_hex = sender.toString(16).padStart(2, '0').repeat(64)
		const fields = [
			utf8ToBytes(DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION), utf8ToBytes(value.dkgRunId),
			utf8ToBytes(value.committeeKeysetId), utf8ToBytes(value.committeeKeysetVersion),
			Uint8Array.of(0, sender), utf8ToBytes(payload_hex),
		]
		return {
			version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: value.dkgRunId,
			committee_keyset_id: value.committeeKeysetId, committee_keyset_version: value.committeeKeysetVersion,
			sender, payload_hex, auth_signature_hex: signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', fields, dkgPrivate[index]!,
			),
		}
	})
	const round1_digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify(entries))))
	const agreements = IDS.map((participant_id, index) => {
		const fields = [
			utf8ToBytes(DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION), utf8ToBytes(value.dkgRunId),
			utf8ToBytes(value.committeeKeysetId), utf8ToBytes(value.committeeKeysetVersion),
			Uint8Array.of(0, participant_id), utf8ToBytes(round1_digest),
		]
		return {
			version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: value.dkgRunId,
			committee_keyset_id: value.committeeKeysetId, committee_keyset_version: value.committeeKeysetVersion,
			participant_id, round1_digest,
			auth_signature_hex: signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', fields, dkgPrivate[index]!,
			),
		}
	})
	return {
		round1Bundle: { version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, entries },
		agreementBundle: { version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, entries: agreements },
	}
}

function manifest(overrides: Partial<DemoFridayDkgPublicManifestV1> = {}): DemoFridayDkgPublicManifestV1 {
	const ulas = [
		'fdc4:dc3c:6792:3f67:5b5d:453d:8712:b236',
		'fd76:1a7b:b02d:6bd8:54e8:653f:110f:87be',
		'fd52:1a36:50a9:faa:3501:ce66:f3b8:7838',
		'fd40:fda8:93de:8d8c:2bd1:b243:e607:7b7f',
	] as const
	const participants = IDS.map((participantId, index) => ({
		participantId,
		hostId: `linode-${108175009 + index}`,
		underlayIpv4: `172.105.${64 + index}.${142 - index}`,
		fipsNpub: `npub1${['q', 'p', 'z', 'r'][index]!.repeat(58)}`,
		fipsUla: ulas[index]!,
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
		...overrides,
	}
}

function enrollments(value: DemoFridayDkgPublicManifestV1) {
	return IDS.map((participantId, index) => createDemoFridayDkgEnrollmentAttestation({
		manifest: value, participantId, dkgIdentityPrivateKey: dkgPrivate[index]!,
	}))
}

function localBootstraps(value: DemoFridayDkgPublicManifestV1) {
	const signed = enrollments(value)
	return IDS.map((participantId, index) => createDemoFridayDkgTransportGateV2({
		manifest: value, expectedManifestDigest: demoFridayDkgManifestDigest(value), enrollments: signed, participantId,
		dkgIdentityPrivateKey: dkgPrivate[index]!, kexPrivateKey: kexPrivate[index]!,
	}))
}

function finalizedTransports(value: DemoFridayDkgPublicManifestV1) {
	const gates = localBootstraps(value)
	return gates.map((gate) => finalizeDemoFridayDkgTransportGateV2({
		manifest: value, expectedManifestDigest: demoFridayDkgManifestDigest(value), gate,
		peerConfirmations: gates.filter((peer) => peer.participantId !== gate.participantId).map((peer) =>
			peer.confirmationsToSend.find((confirmation) => confirmation.recipientParticipantId === gate.participantId)!),
	}))
}

function finalFixtures(value: DemoFridayDkgPublicManifestV1) {
	const publicPackageHex = 'a1'.repeat(240)
	const packageHash = bytesToHex(sha256(new Uint8Array(240).fill(0xa1)))
	const shares = IDS.map((participant_id, index) => ({
		participant_id,
		verifying_share_hex: bytesToHex(secp256k1.Point.BASE.multiply(BigInt(index + 11)).toBytes(true)),
	}))
	const packages = IDS.map((participant_id): DemoFridayDkgFinalPublicPackageV1 => ({
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: value.dkgRunId,
		committee_keyset_id: value.committeeKeysetId, committee_keyset_version: value.committeeKeysetVersion,
		participant_id, public_key_package_hex: publicPackageHex, public_key_package_sha256: packageHash,
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

describe('genuinely per-validator DKG bootstrap', () => {
	test('requires four DKG-signed attestations over one exact public host/FIPS/KEX roster', () => {
		const publicManifest = manifest()
		const signed = enrollments(publicManifest)
		expect(verifyDemoFridayDkgEnrollments(publicManifest, signed)).toHaveLength(4)
		expect(new Set(signed.map((value) => value.dkgIdentity)).size).toBe(4)
		expect(JSON.stringify(publicManifest)).not.toMatch(/private|secret|pairwise_keys/)

		const substituted = structuredClone(publicManifest)
		substituted.participants[2].fipsUla = 'fd00::3'
		substituted.participants[2].signerEndpoint = 'http://[fd00::3]:39101/v1/frost'
		expect(() => exactDemoFridayDkgManifest(substituted)).toThrow('roster digest differs')
		const wrongSignature = structuredClone(signed)
		wrongSignature[0]!.signature = signed[1]!.signature
		expect(() => verifyDemoFridayDkgEnrollments(publicManifest, wrongSignature)).toThrow('not an exact valid manifest attestation')
		expect(() => createDemoFridayDkgEnrollmentAttestation({
			manifest: publicManifest, participantId: 1, dkgIdentityPrivateKey: dkgPrivate[1]!,
		})).toThrow('differs from the enrolled public identity')
	})

	test('rejects duplicate, zero, and cross-role reused identities before any derivation', () => {
		const duplicate = manifest()
		duplicate.participants[3].kexPublicKey = duplicate.participants[0].kexPublicKey
		duplicate.rosterDigest = demoFridayDkgRosterDigest(duplicate.participants)
		expect(() => exactDemoFridayDkgManifest(duplicate)).toThrow('duplicate kexPublicKey')

		const zero = manifest()
		zero.participants[1].kexPublicKey = '00'.repeat(32)
		expect(() => demoFridayDkgRosterDigest(zero.participants)).toThrow('must not be zero')

		const reusedRpcIdentity = manifest()
		reusedRpcIdentity.participants[1].signerIdentity = reusedRpcIdentity.participants[0].dkgIdentity
		reusedRpcIdentity.rosterDigest = demoFridayDkgRosterDigest(reusedRpcIdentity.participants)
		expect(() => exactDemoFridayDkgManifest(reusedRpcIdentity))
			.toThrow('coordinator, DKG bootstrap, and signer RPC identities must all be distinct')
	})

	test('derives matching endpoint-only keys with ordered pairs and separates another run', () => {
		const publicManifest = manifest()
		const gates = localBootstraps(publicManifest)
		for (const gate of gates) expect('transportSecrets' in gate).toBe(false)
		const locals = gates.map((gate) => finalizeDemoFridayDkgTransportGateV2({
			manifest: publicManifest, expectedManifestDigest: demoFridayDkgManifestDigest(publicManifest), gate,
			peerConfirmations: gates.filter((peer) => peer.participantId !== gate.participantId).map((peer) =>
				peer.confirmationsToSend.find((confirmation) => confirmation.recipientParticipantId === gate.participantId)!),
		}))
		for (let left = 0; left < 4; left += 1) {
			for (let right = left + 1; right < 4; right += 1) {
				const leftKey = locals[left]!.round2_pairwise_keys.find((value) => value.peer_id === right + 1)!.key_hex
				const rightKey = locals[right]!.round2_pairwise_keys.find((value) => value.peer_id === left + 1)!.key_hex
				expect(leftKey).toBe(rightKey)
			}
		}

		const anotherRun = manifest({ dkgRunId: 'friday-dkg-r13' })
		const anotherLocals = finalizedTransports(anotherRun)
		expect(locals[0]!.round2_pairwise_keys[0]!.key_hex)
			.not.toBe(anotherLocals[0]!.round2_pairwise_keys[0]!.key_hex)
	})

	test('withholds local Rust transport credentials until all three signed MAC confirmations arrive', () => {
		const publicManifest = manifest()
		const locals = localBootstraps(publicManifest)
		const local = locals[1]!
		const peerConfirmations = locals.filter((value) => value.participantId !== local.participantId).map((peer) =>
			peer.confirmationsToSend.find((confirmation) => confirmation.recipientParticipantId === local.participantId)!)
		expect(() => finalizeDemoFridayDkgTransportGateV2({
			manifest: publicManifest, expectedManifestDigest: demoFridayDkgManifestDigest(publicManifest),
			gate: local, peerConfirmations: peerConfirmations.slice(0, 2),
		})).toThrow('incomplete')
		const tampered = structuredClone(peerConfirmations)
		tampered[0]!.confirmationMac = '00'.repeat(32)
		expect(() => finalizeDemoFridayDkgTransportGateV2({
			manifest: publicManifest, expectedManifestDigest: demoFridayDkgManifestDigest(publicManifest),
			gate: local, peerConfirmations: tampered,
		})).toThrow('confirmation from participant')
		const transport = finalizeDemoFridayDkgTransportGateV2({
			manifest: publicManifest, expectedManifestDigest: demoFridayDkgManifestDigest(publicManifest),
			gate: local, peerConfirmations,
		})
		expect(transport.participant_id).toBe(2)
		expect(transport.round2_pairwise_keys.map((value) => value.peer_id)).toEqual([1, 3, 4])
	})

	test('rejects old, double-hashed, wrong-domain and field-mutated round-one and agreement contracts', () => {
		const publicManifest = manifest()
		const valid = signedRound1(publicManifest)
		expect(typeof verifyDemoFridayDkgRound1Transcript({ manifest: publicManifest, ...valid })).toBe('string')
		for (const mutation of ['old', 'double', 'domain', 'run', 'keyset', 'participant', 'payload'] as const) {
			const candidate = structuredClone(valid)
			const entry = candidate.round1Bundle.entries[0]!
			const fields = [
				utf8ToBytes(entry.version), utf8ToBytes(entry.run_id), utf8ToBytes(entry.committee_keyset_id),
				utf8ToBytes(entry.committee_keyset_version), Uint8Array.of(0, 1), utf8ToBytes(entry.payload_hex),
			]
			if (mutation === 'old') entry.auth_signature_hex = signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', fields, dkgPrivate[0]!, 0,
			)
			if (mutation === 'double') entry.auth_signature_hex = signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', fields, dkgPrivate[0]!, 2,
			)
			if (mutation === 'domain') entry.auth_signature_hex = signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1_MUTATED', fields, dkgPrivate[0]!,
			)
			if (mutation === 'run') entry.run_id = 'mutated-run'
			if (mutation === 'keyset') entry.committee_keyset_id = 'mutated-keyset'
			if (mutation === 'participant') entry.sender = 2
			if (mutation === 'payload') entry.payload_hex = `f${entry.payload_hex.slice(1)}`
			expect(() => verifyDemoFridayDkgRound1Transcript({
				manifest: publicManifest, ...candidate,
			})).toThrow()
		}
		for (const mutation of ['old', 'double', 'domain', 'run', 'keyset', 'participant', 'transcript'] as const) {
			const candidate = structuredClone(valid)
			const entry = candidate.agreementBundle.entries[0]!
			const fields = [
				utf8ToBytes(entry.version), utf8ToBytes(entry.run_id), utf8ToBytes(entry.committee_keyset_id),
				utf8ToBytes(entry.committee_keyset_version), Uint8Array.of(0, 1), utf8ToBytes(entry.round1_digest),
			]
			if (mutation === 'old') entry.auth_signature_hex = signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', fields, dkgPrivate[0]!, 0,
			)
			if (mutation === 'double') entry.auth_signature_hex = signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', fields, dkgPrivate[0]!, 2,
			)
			if (mutation === 'domain') entry.auth_signature_hex = signRustFrame(
				'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1_MUTATED', fields, dkgPrivate[0]!,
			)
			if (mutation === 'run') entry.run_id = 'mutated-run'
			if (mutation === 'keyset') entry.committee_keyset_id = 'mutated-keyset'
			if (mutation === 'participant') entry.participant_id = 2
			if (mutation === 'transcript') entry.round1_digest = 'f'.repeat(64)
			expect(() => verifyDemoFridayDkgRound1Transcript({
				manifest: publicManifest, ...candidate,
			})).toThrow()
		}
	})

	test('requires four enrolled identity attestations over one transcript, package, committee, and share roster', () => {
		const publicManifest = manifest()
		const signed = enrollments(publicManifest)
		const round1 = signedRound1(publicManifest)
		const fixtures = finalFixtures(publicManifest)
		const attestations = IDS.map((participantId, index) => createDemoFridayDkgFinalAttestation({
			manifest: publicManifest, enrollments: signed, participantId,
			dkgIdentityPrivateKey: dkgPrivate[index]!, ...round1,
			finalPublicPackage: fixtures.packages[index]!, publicInspection: fixtures.inspections[index]!,
		}))
		const result = assembleDemoFridayPublicDkgResult({
			manifest: publicManifest, enrollments: signed, ...round1,
			finalPublicPackages: fixtures.packages, publicInspections: fixtures.inspections,
			finalAttestations: attestations,
		})
		expect(Object.keys(result).sort()).toEqual([
			'committeeKeysetId', 'committeeKeysetVersion', 'committeePublicKey', 'coordinatorIdentity',
			'dkgRunId', 'participants', 'publicKeyPackagePath', 'publicKeyPackageSha256', 'runId', 'schema',
			'signerRosterDigest',
		].sort())
		expect(result.participants).toHaveLength(4)
		expect(result.participants.map((value) => value.signerIdentity)).toEqual(publicManifest.participants.map((value) => value.signerIdentity))
		expect(result.publicKeyPackagePath).toBe(`${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/exchange/${publicManifest.dkgRunId}/participant-1.public.json`)
		expect(result.signerRosterDigest).toBe(bytesToHex(sha256(utf8ToBytes(JSON.stringify([
			'COCO_DEMO_FROST_SIGNER_ROSTER_V1', publicManifest.dkgRunId, publicManifest.committeeKeysetId,
			publicManifest.committeeKeysetVersion, result.publicKeyPackageSha256, result.committeePublicKey, 3, 4,
			fixtures.inspections[0]!.verifying_shares,
		])))))
		expect(JSON.stringify(result)).not.toMatch(/private|secret|key_hex|package_hex/)

		expect(() => assembleDemoFridayPublicDkgResult({
			manifest: publicManifest, enrollments: signed, ...round1,
			finalPublicPackages: fixtures.packages, publicInspections: fixtures.inspections,
			finalAttestations: attestations.slice(0, 3),
		})).toThrow('exactly four')
		const wrongTranscript = structuredClone(round1)
		wrongTranscript.agreementBundle.entries[0]!.round1_digest = hash('substituted-round-one-transcript')
		expect(() => assembleDemoFridayPublicDkgResult({
			manifest: publicManifest, enrollments: signed, ...wrongTranscript,
			finalPublicPackages: fixtures.packages, publicInspections: fixtures.inspections,
			finalAttestations: attestations,
		})).toThrow('differs from the canonical transcript')
	})

	test('rejects changed package bytes, committee shares, wrong final signer, and secret-bearing input', () => {
		const publicManifest = manifest()
		const signed = enrollments(publicManifest)
		const round1 = signedRound1(publicManifest)
		const fixtures = finalFixtures(publicManifest)
		const attestations = IDS.map((participantId, index) => createDemoFridayDkgFinalAttestation({
			manifest: publicManifest, enrollments: signed, participantId,
			dkgIdentityPrivateKey: dkgPrivate[index]!, ...round1,
			finalPublicPackage: fixtures.packages[index]!, publicInspection: fixtures.inspections[index]!,
		}))
		const changedPackage = structuredClone(fixtures.packages)
		changedPackage[3]!.public_key_package_hex = 'a2'.repeat(240)
		expect(() => assembleDemoFridayPublicDkgResult({
			manifest: publicManifest, enrollments: signed, ...round1,
			finalPublicPackages: changedPackage, publicInspections: fixtures.inspections, finalAttestations: attestations,
		})).toThrow('final public package is invalid')
		const changedShares = structuredClone(fixtures.inspections)
		changedShares[2]!.verifying_shares[0]!.verifying_share_hex = bytesToHex(secp256k1.Point.BASE.multiply(99n).toBytes(true))
		expect(() => assembleDemoFridayPublicDkgResult({
			manifest: publicManifest, enrollments: signed, ...round1,
			finalPublicPackages: fixtures.packages, publicInspections: changedShares, finalAttestations: attestations,
		})).toThrow('do not describe one identical committee')
		const wrongSigner = structuredClone(attestations)
		wrongSigner[0]!.signature = attestations[1]!.signature
		expect(() => assembleDemoFridayPublicDkgResult({
			manifest: publicManifest, enrollments: signed, ...round1,
			finalPublicPackages: fixtures.packages, publicInspections: fixtures.inspections, finalAttestations: wrongSigner,
		})).toThrow('final attestation 1 is invalid')
		const secretBearing = structuredClone(fixtures.packages) as Array<DemoFridayDkgFinalPublicPackageV1 & { identity_signing_key_hex?: string }>
		secretBearing[0]!.identity_signing_key_hex = '01'.repeat(32)
		expect(() => assembleDemoFridayPublicDkgResult({
			manifest: publicManifest, enrollments: signed, ...round1,
			finalPublicPackages: secretBearing, publicInspections: fixtures.inspections, finalAttestations: attestations,
		})).toThrow('missing or unexpected fields')
	})

	test('manifest digest changes across every deployment identity plane', () => {
		const original = manifest()
		const changed = manifest({ applicationRunId: 'friday-auctions-r13' })
		expect(demoFridayDkgManifestDigest(original)).not.toBe(demoFridayDkgManifestDigest(changed))
	})
})
