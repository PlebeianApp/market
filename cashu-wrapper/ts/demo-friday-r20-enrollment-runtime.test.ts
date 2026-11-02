import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA, DEMO_FRIDAY_DKG_MANIFEST_SCHEMA,
	demoFridayDkgManifestDigest, demoFridayDkgRosterDigest, exactDemoFridayDkgManifest,
	type DemoFridayDkgManifestParticipantV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, DEMO_FRIDAY_R20_RUNTIME_BINDING_SCHEMA,
	demoFridayR20ProfileDigest, demoFridayR20RuntimeBindingDigest,
	exactDemoFridayR20BoundManifest, verifyDemoFridayR20ManifestAndEnrollments,
	verifyDemoFridayR20RuntimeBinding,
	type DemoFridayR20RuntimeDkgBindingV1,
} from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	DEMO_FRIDAY_R20_DEPLOYMENT_ID, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_KEYSET_ID, DEMO_FRIDAY_R20_KEYSET_ROOT,
	DEMO_FRIDAY_R20_KEYSET_VERSION, DEMO_FRIDAY_R20_OPERATOR_ROOT,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'

const oldKeys = [1, 2, 3, 4].map((value) => hexToBytes(value.toString(16).padStart(64, '0')))
const freshKeys = [21, 22, 23, 24].map((value) => hexToBytes(value.toString(16).padStart(64, '0')))
const npubs = [
	'npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj',
	'npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty',
	'npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r',
	'npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc',
] as const
const goGolden = await Bun.file(new URL(
	'../../internal/poc/testdata/friday-r20-runtime-binding-go-golden.json', import.meta.url,
)).json() as { predecessorManifest: unknown; binding: DemoFridayR20RuntimeDkgBindingV1 }
const goRuntimeBinding = goGolden.binding

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([domain, ...fields]))))
}

function hex(label: string): string { return bytesToHex(sha256(utf8ToBytes(label))) }

function participantFields(value: DemoFridayDkgManifestParticipantV1): unknown[] {
	return [value.participantId, value.hostId, value.underlayIpv4, value.fipsNpub, value.fipsUla,
		value.dkgIdentity, value.signerIdentity, value.kexPublicKey, value.signerEndpoint,
		value.participantBinarySha256, value.inspectorBinarySha256, value.configPath, value.stateDirectory]
}

function fixture() {
	const predecessorParticipants = oldKeys.map((key, index) => {
		const participantId = (index + 1) as 1 | 2 | 3 | 4
		const fipsUla = `fd00::${participantId}`
		return {
			participantId, hostId: `linode-${100000 + participantId}`, underlayIpv4: `198.18.1.${participantId}`,
			fipsNpub: npubs[index]!, fipsUla, dkgIdentity: bytesToHex(schnorr.getPublicKey(key)),
			signerIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes((index + 11).toString(16).padStart(64, '0')))),
			kexPublicKey: hex(`old-kex-${participantId}`), signerEndpoint: `http://[${fipsUla}]:39101/v1/frost`,
			participantBinarySha256: hex('participant'), inspectorBinarySha256: hex('inspector'),
			configPath: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json',
			stateDirectory: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/state',
		} satisfies DemoFridayDkgManifestParticipantV1
	}) as [DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1,
		DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1]
	const predecessor = exactDemoFridayDkgManifest({
		schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-demo-r18', applicationRunId: 'friday-demo-r18-run1', dkgRunId: 'friday-demo-r18-dkg1',
		committeeKeysetId: 'friday-demo-frost-keyset-v1', committeeKeysetVersion: '1', roster: [1, 2, 3, 4],
		rosterDigest: demoFridayDkgRosterDigest(predecessorParticipants), coordinatorParticipantId: 1,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes('50'.padStart(64, '0')))),
		participants: predecessorParticipants,
	})
	const participants = freshKeys.map((key, index) => {
		const participantId = (index + 1) as 1 | 2 | 3 | 4
		const previous = predecessor.participants[index]!
		return { ...previous, dkgIdentity: bytesToHex(schnorr.getPublicKey(key)),
			signerIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes((index + 31).toString(16).padStart(64, '0')))),
			kexPublicKey: hex(`fresh-kex-${participantId}`),
			configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
			stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		} satisfies DemoFridayDkgManifestParticipantV1
	}) as [DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1,
		DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1]
	const rosterDigest = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ROSTER_V1', participants.map(participantFields))
	const manifest = {
		schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY' as const,
		deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
		dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
		committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, roster: [1, 2, 3, 4] as const,
		rosterDigest, coordinatorParticipantId: 1 as const,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes('60'.padStart(64, '0')))), participants,
	}
	const manifestDigest = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', [
		manifest.schema, manifest.valueProfile, manifest.deploymentId, manifest.applicationRunId,
		manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion, manifest.roster,
		manifest.rosterDigest, manifest.coordinatorParticipantId, manifest.coordinatorIdentity,
		manifest.participants.map(participantFields),
	])
	const profile: DemoFridayR20FreshDkgProfileV2 = {
		schema: 'PLEBEIAN_FRIDAY_FRESH_DKG_PROFILE_V2', valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
		dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
		committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, keysetRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
		configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
		transportSecretsPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`,
		stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		exchangeDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`,
		coordinatorRoot: DEMO_FRIDAY_R20_COORDINATOR_ROOT, operatorRoot: DEMO_FRIDAY_R20_OPERATOR_ROOT,
		predecessorManifestDigest: demoFridayDkgManifestDigest(predecessor), predecessorAbortDigest: hex('abort'),
		abortAcknowledgementsDigest: hex('acks'),
	}
	const profileDigest = demoFridayR20ProfileDigest(profile)
	const bindingDigest = digest(DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA,
		[profileDigest, profile.predecessorAbortDigest, manifestDigest])
	const bound = { schema: DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest,
		predecessorAbortDigest: profile.predecessorAbortDigest, manifest, manifestDigest, bindingDigest }
	const enrollments = participants.map((participant, index) => {
		const participantId = index + 1
		const enrollmentDigest = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_ENROLLMENT_V1', [
			manifest.schema, manifest.dkgRunId, manifest.committeeKeysetId, manifest.committeeKeysetVersion,
			manifest.rosterDigest, manifestDigest, participantId, participant.dkgIdentity,
			participant.kexPublicKey, 'COCO_DEMO_FROST_DKG_ROUND2_PAIRWISE_KEY_V1',
		])
		return { schema: DEMO_FRIDAY_DKG_ENROLLMENT_SCHEMA, manifestDigest, rosterDigest,
			participantId, dkgIdentity: participant.dkgIdentity,
			signature: bytesToHex(schnorr.sign(hexToBytes(enrollmentDigest), freshKeys[index]!)) }
	})
	return { predecessor, profile, manifest, bound, bindingDigest, enrollments }
}

describe('Friday R20 enrollment/runtime boundary', () => {
	test('matches the Go runtime binding digest frame byte-for-byte', () => {
		expect(goRuntimeBinding.schema).toBe(DEMO_FRIDAY_R20_RUNTIME_BINDING_SCHEMA)
		expect(demoFridayR20RuntimeBindingDigest(goRuntimeBinding)).toBe(goRuntimeBinding.bindingDigest)
		const changed = structuredClone(goRuntimeBinding)
		changed.predecessorAbortDigest = '44'.repeat(32)
		expect(demoFridayR20RuntimeBindingDigest(changed)).not.toBe(goRuntimeBinding.bindingDigest)
	})

	test('accepts the complete Go-produced fresh-run result under independent outer pins', () => {
		const profile: DemoFridayR20FreshDkgProfileV2 = {
			schema: 'PLEBEIAN_FRIDAY_FRESH_DKG_PROFILE_V2', valueProfile: 'FAKE_MONEY_ONLY',
			deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
			dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
			committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, keysetRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
			configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
			transportSecretsPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`,
			stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
			exchangeDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`,
			coordinatorRoot: DEMO_FRIDAY_R20_COORDINATOR_ROOT, operatorRoot: DEMO_FRIDAY_R20_OPERATOR_ROOT,
			predecessorManifestDigest: goRuntimeBinding.predecessorManifestDigest,
			predecessorAbortDigest: goRuntimeBinding.predecessorAbortDigest,
			abortAcknowledgementsDigest: goRuntimeBinding.abortAcknowledgementsDigest,
		}
		const profileDigest = demoFridayR20ProfileDigest(profile)
		const manifestBindingDigest = digest(DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA,
			[profileDigest, profile.predecessorAbortDigest, goRuntimeBinding.manifestDigest])
		const bound = { schema: DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest,
			predecessorAbortDigest: profile.predecessorAbortDigest,
			manifest: goRuntimeBinding.result.manifest, manifestDigest: goRuntimeBinding.manifestDigest,
			bindingDigest: manifestBindingDigest }
		const verified = verifyDemoFridayR20RuntimeBinding({
			profile, predecessorManifest: goGolden.predecessorManifest, boundManifest: bound,
			expectedManifestBindingDigest: manifestBindingDigest,
			expectedRuntimeBindingDigest: goRuntimeBinding.bindingDigest, value: goRuntimeBinding,
		})
		expect(verified.bindingDigest).toBe(goRuntimeBinding.bindingDigest)
		expect(() => verifyDemoFridayR20RuntimeBinding({
			profile, predecessorManifest: fixture().predecessor, boundManifest: bound,
			expectedManifestBindingDigest: manifestBindingDigest,
			expectedRuntimeBindingDigest: goRuntimeBinding.bindingDigest, value: goRuntimeBinding,
		})).toThrow('independently pinned abort profile')
		for (const mutate of [
			(value: any) => { value.dkgRoot = '/var/lib/plebeian-auctions-friday/frost/keyset-v1' },
			(value: any) => { value.predecessorAbortDigest = '55'.repeat(32) },
			(value: any) => { value.result.dkgRunId = 'friday-demo-r18-dkg1' },
		]) {
			const changed = structuredClone(goRuntimeBinding); mutate(changed)
			expect(() => verifyDemoFridayR20RuntimeBinding({
				profile, predecessorManifest: goGolden.predecessorManifest, boundManifest: bound,
				expectedManifestBindingDigest: manifestBindingDigest,
				expectedRuntimeBindingDigest: goRuntimeBinding.bindingDigest, value: changed,
			})).toThrow()
		}
	})

	test('accepts fixed keyset-v2 manifest and four freshly signed enrollments', () => {
		const value = fixture()
		expect(exactDemoFridayR20BoundManifest({ profile: value.profile, predecessorManifest: value.predecessor,
			value: value.bound, expectedBindingDigest: value.bindingDigest }).manifestDigest).toBe(value.bound.manifestDigest)
		expect(verifyDemoFridayR20ManifestAndEnrollments({ profile: value.profile,
			predecessorManifest: value.predecessor, boundManifest: value.bound,
			expectedBindingDigest: value.bindingDigest, enrollments: value.enrollments }).dkgRunId)
			.toBe(DEMO_FRIDAY_R20_DKG_RUN_ID)
	})

	test('rejects v1 roots, old runs, changed abort binding, reused identities and bad enrollment signatures', () => {
		const value = fixture()
		for (const mutate of [
			(bound: any) => { bound.manifest.participants[0].configPath = '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json' },
			(bound: any) => { bound.manifest.dkgRunId = 'friday-demo-20261023-r14-dkg1' },
			(bound: any) => { bound.predecessorAbortDigest = hex('different-abort') },
			(bound: any) => { bound.manifest.participants[0].dkgIdentity = value.predecessor.participants[0]!.dkgIdentity },
		]) {
			const changed = structuredClone(value.bound); mutate(changed)
			expect(() => exactDemoFridayR20BoundManifest({ profile: value.profile,
				predecessorManifest: value.predecessor, value: changed,
				expectedBindingDigest: value.bindingDigest })).toThrow()
		}
		const badEnrollments = structuredClone(value.enrollments)
		badEnrollments[0]!.signature = '00'.repeat(64)
		expect(() => verifyDemoFridayR20ManifestAndEnrollments({ profile: value.profile,
			predecessorManifest: value.predecessor, boundManifest: value.bound,
			expectedBindingDigest: value.bindingDigest, enrollments: badEnrollments })).toThrow()
	})
})
