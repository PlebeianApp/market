import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { demoFridayDkgManifestDigest, demoFridayDkgRosterDigest, type DemoFridayDkgPublicManifestV1 } from './demo-friday-per-validator-dkg-bootstrap'
import { DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION } from './demo-friday-per-validator-dkg-plan'
import { DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, demoFridayR18AbortDigest, exactDemoFridayR18AbortRecord } from './demo-friday-r20-fresh-profile'
import { createDemoFridayR18AbortAcknowledgement } from './demo-friday-r20-abort-seal'
import {
	composeDemoFridayVerifiedAbortBundle, composeDemoFridayVerifiedAbortBundleFromProfile,
	type DemoFridayVerifiedAbortComposerProfile,
} from './demo-friday-r20-verified-abort-composer'

const IDS = [1, 2, 3, 4] as const
const keys = IDS.map((id) => hexToBytes(id.toString(16).padStart(64, '0')))
const npubs = [
	'npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj',
	'npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty',
	'npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r',
	'npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc',
] as const
const hash = (value: string) => bytesToHex(sha256(utf8ToBytes(value)))

function fixture() {
	const participants = IDS.map((participantId, index) => ({
		participantId, hostId: `linode-${108175008 + participantId}`, underlayIpv4: `172.105.64.${140 + participantId}`,
		fipsNpub: npubs[index]!, fipsUla: `fd00::${participantId}`, dkgIdentity: bytesToHex(schnorr.getPublicKey(keys[index]!)),
		signerIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes((index + 11).toString(16).padStart(64, '0')))),
		kexPublicKey: hash(`kex-${participantId}`), signerEndpoint: `http://[fd00::${participantId}]:39101/v1/frost`,
		participantBinarySha256: hash('participant'), inspectorBinarySha256: hash('inspector'),
		configPath: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json',
		stateDirectory: '/var/lib/plebeian-auctions-friday/frost/keyset-v1/state',
	})) as unknown as DemoFridayDkgPublicManifestV1['participants']
	const manifest: DemoFridayDkgPublicManifestV1 = {
		schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-demo-20261023-r14', applicationRunId: 'friday-demo-20261023-r14-run1',
		dkgRunId: 'friday-demo-20261023-r14-dkg1', committeeKeysetId: 'friday-demo-frost-keyset-v1', committeeKeysetVersion: '1',
		roster: IDS, rosterDigest: demoFridayDkgRosterDigest(participants), coordinatorParticipantId: 1,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(hexToBytes('50'.padStart(64, '0')))), participants,
	}
	const manifestDigest = demoFridayDkgManifestDigest(manifest)
	const receipts = IDS.map((id) => hash(`persist-${id}`)) as [string, string, string, string]
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest: manifest, record: {
		schema: DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY', predecessorManifestDigest: manifestDigest,
		predecessorDeploymentId: manifest.deploymentId, predecessorApplicationRunId: manifest.applicationRunId,
		predecessorDkgRunId: manifest.dkgRunId, predecessorCommitteeKeysetId: manifest.committeeKeysetId,
		predecessorCommitteeKeysetVersion: manifest.committeeKeysetVersion, persistTransportReceiptDigests: receipts,
		slot1DeadProcessIdentityDigest: hash('dead'), slot1LockMetadataDigest: hash('lock'), slot1JournalMetadataDigest: hash('journal'),
		slot1StateObservationDigest: hash('state'), serviceSealDigest: hash('seal'), abortReason: 'ROUND1_OUTCOME_INDETERMINATE',
	} })
	const abortDigest = demoFridayR18AbortDigest(record)
	const acknowledgements = IDS.map((participantId) => createDemoFridayR18AbortAcknowledgement({
		predecessorManifest: manifest, abortRecord: record, expectedAbortDigest: abortDigest, participantId,
		localTransportSecrets: { version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
			run_id: manifest.dkgRunId, committee_keyset_id: manifest.committeeKeysetId,
			committee_keyset_version: manifest.committeeKeysetVersion, participant_id: participantId,
			identity_signing_key_hex: bytesToHex(keys[participantId - 1]!),
			identity_verifying_keys: IDS.map((id) => ({ participant_id: id, verifying_key_hex: participants[id - 1]!.dkgIdentity })),
			round2_pairwise_keys: IDS.filter((id) => id !== participantId).map((id) => ({ peer_id: id,
				key_hex: hash(`pair-${Math.min(id, participantId)}-${Math.max(id, participantId)}`) })),
		},
	}).acknowledgement)
	return { manifest, manifestDigest, record, abortDigest, acknowledgements }
}

describe('verified abort bundle composer', () => {
	test('normalizes exact R18 public inputs and all four enrolled-host signatures', () => {
		const value = fixture()
		const bundle = composeDemoFridayVerifiedAbortBundle({ predecessorManifest: value.manifest,
			abortRecord: value.record, acknowledgements: value.acknowledgements,
			expectedManifestDigest: value.manifestDigest, expectedAbortDigest: value.abortDigest })
		expect(bundle.acknowledgements.map((ack) => ack.participantId)).toEqual([...IDS])
		expect(JSON.stringify(bundle)).toBe(JSON.stringify(composeDemoFridayVerifiedAbortBundle({
			predecessorManifest: value.manifest, abortRecord: value.record, acknowledgements: value.acknowledgements,
			expectedManifestDigest: value.manifestDigest, expectedAbortDigest: value.abortDigest,
		})))
	})

	test('rejects duplicate slots, tampered signatures, and cross-run predecessors', () => {
		const value = fixture(); const duplicate = structuredClone(value.acknowledgements); duplicate[3] = duplicate[2]!
		expect(() => composeDemoFridayVerifiedAbortBundle({ predecessorManifest: value.manifest,
			abortRecord: value.record, acknowledgements: duplicate, expectedManifestDigest: value.manifestDigest,
			expectedAbortDigest: value.abortDigest })).toThrow()
		const tampered = structuredClone(value.acknowledgements); tampered[0]!.signature = '00'.repeat(64)
		expect(() => composeDemoFridayVerifiedAbortBundle({ predecessorManifest: value.manifest,
			abortRecord: value.record, acknowledgements: tampered, expectedManifestDigest: value.manifestDigest,
			expectedAbortDigest: value.abortDigest })).toThrow()
		expect(() => composeDemoFridayVerifiedAbortBundle({ predecessorManifest: { ...value.manifest,
			dkgRunId: 'friday-demo-20261023-foreign' }, abortRecord: value.record,
			acknowledgements: value.acknowledgements, expectedManifestDigest: value.manifestDigest,
			expectedAbortDigest: value.abortDigest })).toThrow('R18 predecessor')
	})

	test('reads only protected public files and creates a durable output exactly once', async () => {
		const value = fixture(); const base = await mkdtemp(join(tmpdir(), 'verified-abort-composer-')); await chmod(base, 0o700)
		const input = join(base, 'input'); const output = join(base, 'output')
		await mkdir(input, { mode: 0o700 }); await mkdir(output, { mode: 0o700 })
		const values = [value.manifest, value.record, ...value.acknowledgements]
		const paths = values.map((_, index) => join(input, `${index}.json`))
		for (let index = 0; index < values.length; index += 1) await writeFile(paths[index]!, `${JSON.stringify(values[index])}\n`, { mode: 0o600 })
		const profile: DemoFridayVerifiedAbortComposerProfile = { manifestPath: paths[0]!, abortRecordPath: paths[1]!,
			acknowledgementPaths: paths.slice(2) as [string, string, string, string], outputPath: join(output, 'bundle.json'),
			ownerUid: process.getuid!(), ownerGid: process.getgid!() }
		await composeDemoFridayVerifiedAbortBundleFromProfile({ profile, expectedManifestDigest: value.manifestDigest,
			expectedAbortDigest: value.abortDigest })
		const stored = JSON.parse(await readFile(profile.outputPath, 'utf8'))
		expect(stored.acknowledgements).toHaveLength(4)
		await expect(composeDemoFridayVerifiedAbortBundleFromProfile({ profile,
			expectedManifestDigest: value.manifestDigest, expectedAbortDigest: value.abortDigest })).rejects.toThrow()
	})
})
