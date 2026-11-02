import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { x25519 } from '@noble/curves/ed25519.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, demoFridayDkgManifestDigest, demoFridayDkgRosterDigest,
	exactDemoFridayDkgManifest, type DemoFridayDkgManifestParticipantV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import { createDemoFridayDkgEnrollmentAttestationV2 } from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
	DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA, DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA,
} from './demo-friday-per-validator-dkg-enrollment-init'
import { DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA } from './demo-friday-per-validator-dkg-relay'
import {
	composeDemoFridayR20BoundManifest, DEMO_FRIDAY_R20_COORDINATOR_PUBLIC_SCHEMA,
	executeDemoFridayR20CourierPhase, initializeDemoFridayR20Courier,
} from './demo-friday-r20-coordinator-courier'
import { runDemoFridayR20CourierCli } from './demo-friday-r20-courier-cli'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	DEMO_FRIDAY_R20_DEPLOYMENT_ID, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_KEYSET_ID, DEMO_FRIDAY_R20_KEYSET_ROOT,
	DEMO_FRIDAY_R20_KEYSET_VERSION, DEMO_FRIDAY_R20_OPERATOR_ROOT,
	DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA, DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA,
	demoFridayR18AbortAcknowledgementDigest, demoFridayR18AbortDigest,
	type DemoFridayR18AbortAcknowledgementV1, type DemoFridayR18AbortRecordV1,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'

const IDS = [1, 2, 3, 4] as const
const oldDkg = IDS.map((id) => new Uint8Array(32).fill(id))
const freshDkg = IDS.map((id) => new Uint8Array(32).fill(id + 20))
const freshSigner = IDS.map((id) => new Uint8Array(32).fill(id + 30))
const freshKex = IDS.map((id) => new Uint8Array(32).fill(id + 40))
const npubs = [
	'npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj',
	'npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty',
	'npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r',
	'npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc',
] as const

function digest(domain: string, fields: unknown[]): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([domain, ...fields]))))
}
function sign(domain: string, messageDigest: string, secret: Uint8Array): string {
	return bytesToHex(schnorr.sign(hexToBytes(messageDigest), secret,
		sha256(utf8ToBytes(JSON.stringify([`${domain}_AUX`, messageDigest])))))
}

function fixture() {
	const ulas = ['fd42::1', 'fd42::2', 'fd42::3', 'fd42::4'] as const
	const oldParticipants = IDS.map((id, index) => ({ participantId: id,
		hostId: `linode-${100000 + id}`, underlayIpv4: `10.0.0.${id}`, fipsNpub: npubs[index]!, fipsUla: ulas[index]!,
		dkgIdentity: bytesToHex(schnorr.getPublicKey(oldDkg[index]!)),
		signerIdentity: bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(id + 10))),
		kexPublicKey: bytesToHex(x25519.getPublicKey(new Uint8Array(32).fill(id + 50))),
		signerEndpoint: `http://[${ulas[index]}]:39101/v1/frost`,
		participantBinarySha256: digest('bin', [id]), inspectorBinarySha256: digest('inspect', [id]),
		configPath: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json',
		stateDirectory: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/state',
	})) as unknown as [DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1,
		DemoFridayDkgManifestParticipantV1, DemoFridayDkgManifestParticipantV1]
	const predecessor = exactDemoFridayDkgManifest({ schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA,
		valueProfile: 'FAKE_MONEY_ONLY', deploymentId: 'friday-r18', applicationRunId: 'friday-r18-run1',
		dkgRunId: 'friday-r18-dkg1', committeeKeysetId: 'friday-keyset-v1', committeeKeysetVersion: '1',
		roster: IDS, rosterDigest: demoFridayDkgRosterDigest(oldParticipants), coordinatorParticipantId: 1,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(60))), participants: oldParticipants })
	const abortRecord: DemoFridayR18AbortRecordV1 = {
		schema: DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		predecessorManifestDigest: demoFridayDkgManifestDigest(predecessor),
		predecessorDeploymentId: predecessor.deploymentId,
		predecessorApplicationRunId: predecessor.applicationRunId,
		predecessorDkgRunId: predecessor.dkgRunId,
		predecessorCommitteeKeysetId: predecessor.committeeKeysetId,
		predecessorCommitteeKeysetVersion: predecessor.committeeKeysetVersion,
		persistTransportReceiptDigests: IDS.map((id) => digest('persist', [id])) as [string, string, string, string],
		slot1DeadProcessIdentityDigest: digest('dead-process', []),
		slot1LockMetadataDigest: digest('lock', []), slot1JournalMetadataDigest: digest('journal', []),
		slot1StateObservationDigest: digest('state', []), serviceSealDigest: digest('seal', []),
		abortReason: 'ROUND1_OUTCOME_INDETERMINATE',
	}
	const abortDigest = demoFridayR18AbortDigest(abortRecord)
	const acknowledgements = IDS.map((participantId, index) => {
		const dkgIdentity = oldParticipants[index]!.dkgIdentity
		const acknowledgementDigest = demoFridayR18AbortAcknowledgementDigest({
			abortDigest, participantId, dkgIdentity,
		})
		return { schema: DEMO_FRIDAY_R18_ABORT_ACK_SCHEMA, abortDigest, participantId, dkgIdentity,
			signature: bytesToHex(schnorr.sign(hexToBytes(acknowledgementDigest), oldDkg[index]!)),
		} satisfies DemoFridayR18AbortAcknowledgementV1
	}) as [DemoFridayR18AbortAcknowledgementV1, DemoFridayR18AbortAcknowledgementV1,
		DemoFridayR18AbortAcknowledgementV1, DemoFridayR18AbortAcknowledgementV1]
	const abortAcknowledgementsDigest = digest('PLEBEIAN_FRIDAY_DKG_ABORT_ACKNOWLEDGEMENT_SET_V1',
		acknowledgements.map((value) => [value.participantId, value.dkgIdentity, value.signature]))
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
		predecessorManifestDigest: demoFridayDkgManifestDigest(predecessor), predecessorAbortDigest: abortDigest,
		abortAcknowledgementsDigest,
	}
	const coordinator = { schema: DEMO_FRIDAY_R20_COORDINATOR_PUBLIC_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: profile.deploymentId, applicationRunId: profile.applicationRunId, dkgRunId: profile.dkgRunId,
		committeeKeysetId: profile.committeeKeysetId, committeeKeysetVersion: profile.committeeKeysetVersion,
		predecessorAbortDigest: profile.predecessorAbortDigest,
		abortAcknowledgementsDigest: profile.abortAcknowledgementsDigest,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(61))) }
	const pins = IDS.map((id, index) => ({ schema: DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA,
		valueProfile: 'FAKE_MONEY_ONLY', deploymentId: profile.deploymentId,
		applicationRunId: profile.applicationRunId, dkgRunId: profile.dkgRunId,
		committeeKeysetId: profile.committeeKeysetId, committeeKeysetVersion: profile.committeeKeysetVersion,
		participantId: id, hostId: oldParticipants[index]!.hostId, underlayIpv4: oldParticipants[index]!.underlayIpv4,
		fipsNpub: oldParticipants[index]!.fipsNpub, fipsUla: oldParticipants[index]!.fipsUla,
		signerEndpoint: oldParticipants[index]!.signerEndpoint,
		participantBinarySha256: oldParticipants[index]!.participantBinarySha256,
		inspectorBinarySha256: oldParticipants[index]!.inspectorBinarySha256,
		configPath: profile.configPath, stateDirectory: profile.stateDirectory }))
	const pinDigests = pins.map((pin) => digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', [
		pin.schema, pin.valueProfile, pin.deploymentId, pin.applicationRunId, pin.dkgRunId,
		pin.committeeKeysetId, pin.committeeKeysetVersion, pin.participantId, pin.hostId, pin.underlayIpv4,
		pin.fipsNpub, pin.fipsUla, pin.signerEndpoint, pin.participantBinarySha256,
		pin.inspectorBinarySha256, pin.configPath, pin.stateDirectory]))
	const enrollments = pins.map((pin, index) => {
		const unsigned = { schema: DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA, hostPin: pin,
			hostPinDigest: pinDigests[index]!, dkgIdentity: bytesToHex(schnorr.getPublicKey(freshDkg[index]!)),
			kexPublicKey: bytesToHex(x25519.getPublicKey(freshKex[index]!)),
			signerIdentity: bytesToHex(schnorr.getPublicKey(freshSigner[index]!)) }
		const message = digest('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_V1', [
			unsigned.schema, unsigned.hostPinDigest, unsigned.hostPin, unsigned.dkgIdentity,
			unsigned.kexPublicKey, unsigned.signerIdentity])
		return { ...unsigned,
			dkgIdentitySignature: sign('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_DKG_V1', message, freshDkg[index]!),
			signerIdentitySignature: sign('PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_ENROLLMENT_RPC_V1', message, freshSigner[index]!) }
	})
	const permissionSeals = IDS.map((participantId) => ({
		schema: 'PLEBEIAN_FRIDAY_R18_PERMISSION_SEAL_V1', participantId,
		abortDigest: profile.predecessorAbortDigest,
		predecessorManifestDigest: profile.predecessorManifestDigest,
		acknowledgementsDigest: profile.abortAcknowledgementsDigest,
		sealedRoot: '/var/lib/plebeian-auctions-friday/frost/keyset-v1',
		sealedParent: '/var/lib/plebeian-auctions-friday/frost',
		priorOwnerUid: 997, priorOwnerGid: 986, sealedOwnerUid: 0, sealedOwnerGid: 0,
		sealedMode: '0700', sealedParentMode: '0711', status: 'R18_PRIVATE_ROOT_SEALED_NO_REPLAY',
	}))
	return { predecessor, abortRecord, acknowledgements, permissionSeals, profile, coordinator, enrollments, pinDigests }
}

async function writeInput(path: string, value: unknown): Promise<void> {
	await writeFile(path, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

describe('R20 coordinator and public/ciphertext courier', () => {
	test('composes one abort-bound keyset-v2 manifest and rejects cross-run enrollments', () => {
		const value = fixture()
		const bound = composeDemoFridayR20BoundManifest({ profile: value.profile,
			predecessorManifest: value.predecessor, coordinator: value.coordinator,
			enrollments: value.enrollments, expectedHostPinDigests: value.pinDigests })
		expect(bound.manifest.dkgRunId).toBe(DEMO_FRIDAY_R20_DKG_RUN_ID)
		expect(bound.manifest.participants[0]!.configPath).toContain('/keyset-v2/')
		const changed = structuredClone(value.enrollments)
		;(changed[0]!.hostPin as { dkgRunId: string }).dkgRunId = 'friday-r18-dkg1'
		expect(() => composeDemoFridayR20BoundManifest({ profile: value.profile,
			predecessorManifest: value.predecessor, coordinator: value.coordinator,
			enrollments: changed, expectedHostPinDigests: value.pinDigests })).toThrow('fresh-run profile')
	})

	test('durably emits one public enrollment phase and refuses replay or barrier skips', async () => {
		const value = fixture()
		const bound = composeDemoFridayR20BoundManifest({ profile: value.profile,
			predecessorManifest: value.predecessor, coordinator: value.coordinator,
			enrollments: value.enrollments, expectedHostPinDigests: value.pinDigests })
		const root = await mkdtemp(join(tmpdir(), 'friday-r20-courier-'))
		await rm(root, { recursive: true })
		const profile = { root, expectedUid: process.geteuid!(), expectedGid: process.getegid!() }
		try {
			await initializeDemoFridayR20Courier(profile, bound)
			const entries = IDS.map((participantId, index) => createDemoFridayDkgEnrollmentAttestationV2({
				manifest: bound.manifest, expectedManifestDigest: bound.manifestDigest,
				participantId, dkgIdentityPrivateKey: freshDkg[index]!,
			}))
			const request = { schema: 'PLEBEIAN_FRIDAY_R20_COURIER_PHASE_REQUEST_V1', action: 'enrollment_bundle',
				payload: { relayRequest: { schema: DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA, action: 'enrollment_bundle',
					manifest: bound.manifest, expectedManifestDigest: bound.manifestDigest, entries } } }
			const receipt = await executeDemoFridayR20CourierPhase({ profile, profileBinding: value.profile,
				predecessorManifest: value.predecessor, expectedManifestBindingDigest: bound.bindingDigest,
				phase: 'enrollment', request })
			expect(receipt.predecessorAbortDigest).toBe(value.profile.predecessorAbortDigest)
			await expect(executeDemoFridayR20CourierPhase({ profile, profileBinding: value.profile,
				predecessorManifest: value.predecessor, expectedManifestBindingDigest: bound.bindingDigest,
				phase: 'enrollment', request })).rejects.toThrow()
			await expect(executeDemoFridayR20CourierPhase({ profile, profileBinding: value.profile,
				predecessorManifest: value.predecessor, expectedManifestBindingDigest: bound.bindingDigest,
				phase: 'round1', request: { ...request, action: 'round1_bundle' } })).rejects.toThrow()
			await writeFile(join(root, 'receipts', 'enrollment.json'), `${JSON.stringify({
				...receipt, manifestBindingDigest: '55'.repeat(32),
			})}\n`, { mode: 0o600 })
			await expect(executeDemoFridayR20CourierPhase({ profile, profileBinding: value.profile,
				predecessorManifest: value.predecessor, expectedManifestBindingDigest: bound.bindingDigest,
				phase: 'confirmations', request: { ...request, action: 'route_confirmations' } })).rejects
				.toThrow('durable bound output')
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('fixed-path CLI initializes and relays without caller-selected roots', async () => {
		const value = fixture()
		const parent = await mkdtemp(join(tmpdir(), 'friday-r20-cli-'))
		const inputRoot = join(parent, 'fixed-inputs'), courierRoot = join(parent, 'fixed-courier')
		await mkdir(inputRoot, { mode: 0o700 })
		const identity = { expectedUid: process.geteuid!(), expectedGid: process.getegid!() }
		const cliProfile = { inputRoot, courier: { root: courierRoot, ...identity } }
		try {
			await writeInput(join(inputRoot, 'r18-predecessor-manifest.json'), value.predecessor)
			await writeInput(join(inputRoot, 'r18-abort-record.json'), value.abortRecord)
			for (const participantId of IDS) {
				await writeInput(join(inputRoot, `participant-${participantId}.abort-acknowledgement.json`),
					value.acknowledgements[participantId - 1])
				await writeInput(join(inputRoot, `participant-${participantId}.host-enrollment.json`),
					value.enrollments[participantId - 1])
				await writeInput(join(inputRoot, `participant-${participantId}.r18-permission-seal.json`),
					value.permissionSeals[participantId - 1])
			}
			await writeInput(join(inputRoot, 'owner-approved-predecessor-abort-digest.txt'),
				`${value.profile.predecessorAbortDigest}\n`)
			await writeInput(join(inputRoot, 'coordinator-public.json'), value.coordinator)
			await writeInput(join(inputRoot, 'owner-approved-host-pin-digests.json'), {
				schema: 'PLEBEIAN_FRIDAY_R20_HOST_PIN_DIGESTS_V1', digests: value.pinDigests,
			})
			await writeInput(join(inputRoot, 'participant-4.r18-permission-seal.json'), {
				...value.permissionSeals[3], participantId: 3,
			})
			await expect(runDemoFridayR20CourierCli(['init'], cliProfile)).rejects.toThrow('permission seal')
			await writeInput(join(inputRoot, 'participant-4.r18-permission-seal.json'), value.permissionSeals[3])
			await runDemoFridayR20CourierCli(['init'], cliProfile)
			const bound = composeDemoFridayR20BoundManifest({ profile: value.profile,
				predecessorManifest: value.predecessor, coordinator: value.coordinator,
				enrollments: value.enrollments, expectedHostPinDigests: value.pinDigests })
			await writeInput(join(inputRoot, 'owner-approved-manifest-binding-digest.txt'),
				`${bound.bindingDigest}\n`)
			const entries = IDS.map((participantId, index) => createDemoFridayDkgEnrollmentAttestationV2({
				manifest: bound.manifest, expectedManifestDigest: bound.manifestDigest,
				participantId, dkgIdentityPrivateKey: freshDkg[index]!,
			}))
			const request = { schema: 'PLEBEIAN_FRIDAY_R20_COURIER_PHASE_REQUEST_V1', action: 'enrollment_bundle',
				payload: { relayRequest: { schema: DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA,
					action: 'enrollment_bundle', manifest: bound.manifest,
					expectedManifestDigest: bound.manifestDigest, entries } } }
			await runDemoFridayR20CourierCli(['relay', 'enrollment'], cliProfile,
				utf8ToBytes(JSON.stringify(request)))
			await expect(runDemoFridayR20CourierCli(['init'], cliProfile)).rejects.toThrow()
			await expect(runDemoFridayR20CourierCli(['relay', 'enrollment', '/tmp/escape'], cliProfile,
				utf8ToBytes('{}'))).rejects.toThrow('usage:')
			expect(await Bun.file(join(courierRoot, 'receipts', 'enrollment.json')).exists()).toBe(true)
		} finally { await rm(parent, { recursive: true, force: true }) }
	})
})
