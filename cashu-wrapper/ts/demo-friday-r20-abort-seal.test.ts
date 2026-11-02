import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgManifestDigest, demoFridayDkgRosterDigest,
	type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import { DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION } from './demo-friday-per-validator-dkg-plan'
import {
	DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, demoFridayR18AbortDigest,
	exactDemoFridayR18AbortRecord,
} from './demo-friday-r20-fresh-profile'
import {
	composeDemoFridayR18AbortRecord, createDemoFridayR18AbortAcknowledgement,
	DEMO_FRIDAY_R18_ABORT_EVIDENCE_SCHEMA, verifyDemoFridayR18AbortSealBundle,
	writeDemoFridayAbortBundleCreateOnce,
} from './demo-friday-r20-abort-seal'

const IDS = [1, 2, 3, 4] as const
const privateKeys = IDS.map((value) => hexToBytes(value.toString(16).padStart(64, '0')))
const npubs = [
	'npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj',
	'npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty',
	'npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r',
	'npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc',
] as const

function hash(value: string): string { return bytesToHex(sha256(utf8ToBytes(value))) }

function manifest(): DemoFridayDkgPublicManifestV1 {
	const participants = IDS.map((participantId, index) => {
		const fipsUla = `fd00::${participantId}`
		return {
			participantId, hostId: `linode-${108175008 + participantId}`,
			underlayIpv4: `172.105.64.${140 + participantId}`, fipsNpub: npubs[index]!, fipsUla,
			dkgIdentity: bytesToHex(schnorr.getPublicKey(privateKeys[index]!)),
			signerIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes((index + 11).toString(16).padStart(64, '0')))),
			kexPublicKey: hash(`kex-${participantId}`), signerEndpoint: `http://[${fipsUla}]:39101/v1/frost`,
			participantBinarySha256: hash('participant'), inspectorBinarySha256: hash('inspector'),
			configPath: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json',
			stateDirectory: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/state',
		}
	}) as unknown as DemoFridayDkgPublicManifestV1['participants']
	return {
		schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-demo-20261023-r14', applicationRunId: 'friday-demo-20261023-r14-run1',
		dkgRunId: 'friday-demo-20261023-r14-dkg1', committeeKeysetId: 'friday-demo-frost-keyset-v1',
		committeeKeysetVersion: '1', roster: IDS, rosterDigest: demoFridayDkgRosterDigest(participants),
		coordinatorParticipantId: 1,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes('50'.padStart(64, '0')))), participants,
	}
}

function fixture() {
	const predecessorManifest = manifest()
	const predecessorManifestDigest = demoFridayDkgManifestDigest(predecessorManifest)
	const values = IDS.map((id) => hash(`persist-${id}`)) as [string, string, string, string]
	const evidence = {
		schema: DEMO_FRIDAY_R18_ABORT_EVIDENCE_SCHEMA, predecessorManifestDigest,
		persistTransportReceiptDigests: values, slot1DeadProcessIdentityDigest: hash('dead'),
		slot1LockMetadataDigest: hash('lock'), slot1JournalMetadataDigest: hash('journal'),
		slot1StateObservationDigest: hash('state'), serviceSealDigest: hash('seal'),
	}
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest, record: {
		schema: DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		predecessorManifestDigest, predecessorDeploymentId: predecessorManifest.deploymentId,
		predecessorApplicationRunId: predecessorManifest.applicationRunId,
		predecessorDkgRunId: predecessorManifest.dkgRunId,
		predecessorCommitteeKeysetId: predecessorManifest.committeeKeysetId,
		predecessorCommitteeKeysetVersion: predecessorManifest.committeeKeysetVersion,
		persistTransportReceiptDigests: values, slot1DeadProcessIdentityDigest: evidence.slot1DeadProcessIdentityDigest,
		slot1LockMetadataDigest: evidence.slot1LockMetadataDigest,
		slot1JournalMetadataDigest: evidence.slot1JournalMetadataDigest,
		slot1StateObservationDigest: evidence.slot1StateObservationDigest,
		serviceSealDigest: evidence.serviceSealDigest, abortReason: 'ROUND1_OUTCOME_INDETERMINATE',
	} })
	return { predecessorManifest, predecessorManifestDigest, evidence,
		expectedAbortDigest: demoFridayR18AbortDigest(record) }
}

function transport(value: ReturnType<typeof fixture>, participantId: 1 | 2 | 3 | 4) {
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: value.predecessorManifest.dkgRunId,
		committee_keyset_id: value.predecessorManifest.committeeKeysetId,
		committee_keyset_version: value.predecessorManifest.committeeKeysetVersion, participant_id: participantId,
		identity_signing_key_hex: bytesToHex(privateKeys[participantId - 1]!),
		identity_verifying_keys: IDS.map((id) => ({ participant_id: id,
			verifying_key_hex: value.predecessorManifest.participants[id - 1]!.dkgIdentity })),
		round2_pairwise_keys: IDS.filter((id) => id !== participantId).map((id) => ({
			peer_id: id, key_hex: hash(`pair-${Math.min(id, participantId)}-${Math.max(id, participantId)}`),
		})),
	}
}

describe('Friday R18 create-once abort seal', () => {
	test('binds metadata evidence and four host-local acknowledgements to the exact predecessor', () => {
		const value = fixture()
		const composed = composeDemoFridayR18AbortRecord({
			predecessorManifest: value.predecessorManifest, evidence: value.evidence,
			expectedManifestDigest: value.predecessorManifestDigest,
			expectedAbortDigest: value.expectedAbortDigest,
		})
		const acknowledgements = IDS.map((participantId) => createDemoFridayR18AbortAcknowledgement({
			predecessorManifest: value.predecessorManifest, abortRecord: composed.record,
			expectedAbortDigest: composed.abortDigest, participantId,
			localTransportSecrets: transport(value, participantId),
		}).acknowledgement)
		expect(() => verifyDemoFridayR18AbortSealBundle({ predecessorManifest: value.predecessorManifest,
			abortRecord: composed.record, acknowledgements,
			expectedAbortDigest: composed.abortDigest })).not.toThrow()
		const changed = structuredClone(acknowledgements); changed[2]!.participantId = 2
		expect(() => verifyDemoFridayR18AbortSealBundle({ predecessorManifest: value.predecessorManifest,
			abortRecord: composed.record, acknowledgements: changed,
			expectedAbortDigest: composed.abortDigest })).toThrow()
	})

	test('durably creates a completion-last bundle and refuses all replay or partial-state recovery', async () => {
		const parent = await mkdtemp(join(tmpdir(), 'friday-r20-abort-')); await chmod(parent, 0o700)
		await writeDemoFridayAbortBundleCreateOnce({ parent, name: 'bundle', files: {
			'abort-record.json': { safe: true }, 'abort-digest.json': { digest: hash('abort') },
		} })
		expect(JSON.parse(await readFile(join(parent, 'bundle', 'complete.json'), 'utf8')).files)
			.toEqual(['abort-digest.json', 'abort-record.json'])
		expect((await stat(join(parent, 'bundle', 'abort-record.json'))).mode & 0o777).toBe(0o600)
		await expect(writeDemoFridayAbortBundleCreateOnce({ parent, name: 'bundle', files: {
			'abort-record.json': { safe: true },
		} })).rejects.toThrow()
		await expect(writeDemoFridayAbortBundleCreateOnce({ parent, name: 'partial', files: {
			'INVALID': { safe: false },
		} })).rejects.toThrow('file name')
		await expect(writeDemoFridayAbortBundleCreateOnce({ parent, name: 'partial', files: {
			'abort-record.json': { safe: true },
		} })).rejects.toThrow()
	})

	test('rejects altered evidence pins, foreign slots and legacy predecessor drift', () => {
		const value = fixture()
		expect(() => composeDemoFridayR18AbortRecord({ predecessorManifest: value.predecessorManifest,
			evidence: { ...value.evidence, serviceSealDigest: hash('other') },
			expectedManifestDigest: value.predecessorManifestDigest,
			expectedAbortDigest: value.expectedAbortDigest })).toThrow('owner pin')
		const composed = composeDemoFridayR18AbortRecord({ predecessorManifest: value.predecessorManifest,
			evidence: value.evidence, expectedManifestDigest: value.predecessorManifestDigest,
			expectedAbortDigest: value.expectedAbortDigest })
		expect(() => createDemoFridayR18AbortAcknowledgement({ predecessorManifest: value.predecessorManifest,
			abortRecord: composed.record, expectedAbortDigest: composed.abortDigest, participantId: 1,
			localTransportSecrets: transport(value, 2) })).toThrow('another slot')
		expect(() => composeDemoFridayR18AbortRecord({
			predecessorManifest: { ...value.predecessorManifest, dkgRunId: 'friday-demo-r17' },
			evidence: value.evidence, expectedManifestDigest: value.predecessorManifestDigest,
			expectedAbortDigest: value.expectedAbortDigest,
		})).toThrow('exact stopped R18')
	})
})
