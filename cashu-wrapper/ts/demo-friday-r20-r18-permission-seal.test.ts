import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
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
	applyDemoFridayR18PermissionSeal, DEMO_FRIDAY_R18_ABORT_BUNDLE_SCHEMA,
	DEMO_FRIDAY_R18_PERMISSION_SEAL_SCHEMA, exactDemoFridayR18VerifiedAbortBundle,
	requireDemoFridayR20PredecessorPermissionSeal, type DemoFridayR18PermissionSealProfile,
	verifyDemoFridayR18SealedDirectoryMetadata,
} from './demo-friday-r20-r18-permission-seal'

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
	const values = IDS.map((id) => hash(`persist-${id}`)) as [string, string, string, string]
	const record = exactDemoFridayR18AbortRecord({ predecessorManifest: manifest, record: {
		schema: DEMO_FRIDAY_R18_ABORT_RECORD_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY', predecessorManifestDigest: manifestDigest,
		predecessorDeploymentId: manifest.deploymentId, predecessorApplicationRunId: manifest.applicationRunId,
		predecessorDkgRunId: manifest.dkgRunId, predecessorCommitteeKeysetId: manifest.committeeKeysetId,
		predecessorCommitteeKeysetVersion: manifest.committeeKeysetVersion, persistTransportReceiptDigests: values,
		slot1DeadProcessIdentityDigest: hash('dead'), slot1LockMetadataDigest: hash('lock'), slot1JournalMetadataDigest: hash('journal'),
		slot1StateObservationDigest: hash('state'), serviceSealDigest: hash('seal'), abortReason: 'ROUND1_OUTCOME_INDETERMINATE',
	} })
	const abortDigest = demoFridayR18AbortDigest(record)
	const acknowledgements = IDS.map((participantId) => createDemoFridayR18AbortAcknowledgement({
		predecessorManifest: manifest, abortRecord: record, expectedAbortDigest: abortDigest, participantId,
		localTransportSecrets: {
			version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: manifest.dkgRunId,
			committee_keyset_id: manifest.committeeKeysetId, committee_keyset_version: manifest.committeeKeysetVersion,
			participant_id: participantId, identity_signing_key_hex: bytesToHex(keys[participantId - 1]!),
			identity_verifying_keys: IDS.map((id) => ({ participant_id: id, verifying_key_hex: participants[id - 1]!.dkgIdentity })),
			round2_pairwise_keys: IDS.filter((id) => id !== participantId).map((id) => ({ peer_id: id,
				key_hex: hash(`pair-${Math.min(id, participantId)}-${Math.max(id, participantId)}`) })),
		},
	}).acknowledgement)
	return { manifest, manifestDigest, record, abortDigest, acknowledgements,
		bundle: { schema: DEMO_FRIDAY_R18_ABORT_BUNDLE_SCHEMA, predecessorManifest: manifest, abortRecord: record, acknowledgements } }
}

describe('R18 permission/service seal', () => {
	test('requires the exact four signed acknowledgements and independently pinned abort', () => {
		const value = fixture()
		expect(exactDemoFridayR18VerifiedAbortBundle({ value: value.bundle, expectedAbortDigest: value.abortDigest }).manifestDigest)
			.toBe(value.manifestDigest)
		expect(() => exactDemoFridayR18VerifiedAbortBundle({ value: { ...value.bundle, acknowledgements: value.acknowledgements.slice(0, 3) },
			expectedAbortDigest: value.abortDigest })).toThrow()
		expect(() => exactDemoFridayR18VerifiedAbortBundle({ value: value.bundle, expectedAbortDigest: hash('wrong') })).toThrow()
	})

	test('seals a stopped disposable root create-once without changing private file contents', async () => {
		const value = fixture(); const base = await mkdtemp(join(tmpdir(), 'r18-permission-seal-')); await chmod(base, 0o700)
		const root = join(base, 'keyset-v1'); const operatorParent = join(base, 'operator'); const config = join(base, 'config')
		await Promise.all([mkdir(root, { mode: 0o700 }), mkdir(operatorParent, { mode: 0o700 }), mkdir(config, { mode: 0o700 })])
		const privateFile = join(root, 'private-state'); await writeFile(privateFile, 'opaque-private-state', { mode: 0o600 })
		const bundlePath = join(operatorParent, 'bundle.json'); await writeFile(bundlePath, `${JSON.stringify(value.bundle)}\n`, { mode: 0o600 })
		const hostBinary = join(base, 'host'); const participantBinary = join(base, 'participant')
		await copyFile('/bin/true', hostBinary); await copyFile('/bin/true', participantBinary)
		await chmod(hostBinary, 0o755); await chmod(participantBinary, 0o755)
		const uid = process.getuid!(); const gid = process.getgid!()
		const profile: DemoFridayR18PermissionSealProfile = { root, rootParent: base, bundlePath, publicSealPath: join(config, 'seal.json'),
			operatorSealRoot: join(operatorParent, 'operation'), hostBinary, participantBinary,
			serviceUid: uid, serviceGid: gid, sealedUid: uid, sealedGid: gid }
		const before = await readFile(privateFile)
		await expect(applyDemoFridayR18PermissionSeal({ profile, participantId: 1, expectedAbortDigest: value.abortDigest,
			expectedServiceSealDigest: hash('wrong-contract') })).rejects.toThrow('service-seal contract digest differs')
		const seal = await applyDemoFridayR18PermissionSeal({ profile, participantId: 1, expectedAbortDigest: value.abortDigest,
			expectedServiceSealDigest: hash('seal') })
		expect(seal.status).toBe('R18_PRIVATE_ROOT_SEALED_NO_REPLAY')
		expect(await readFile(privateFile)).toEqual(before)
		expect((await stat(join(operatorParent, 'operation', 'complete.json'))).mode & 0o777).toBe(0o600)
		expect((await stat(join(config, 'seal.json'))).mode & 0o777).toBe(0o444)
		await expect(applyDemoFridayR18PermissionSeal({ profile, participantId: 1, expectedAbortDigest: value.abortDigest,
			expectedServiceSealDigest: hash('seal') })).rejects.toThrow()
	})

	test('new driver rejects absent, wrong-root, and incomplete predecessor seals', () => {
		const value = fixture()
		expect(() => requireDemoFridayR20PredecessorPermissionSeal({ value: undefined,
			expectedAbortDigest: value.abortDigest, expectedManifestDigest: value.manifestDigest,
			expectedParticipantId: 1 })).toThrow()
		const seal = { schema: DEMO_FRIDAY_R18_PERMISSION_SEAL_SCHEMA, participantId: 1, abortDigest: value.abortDigest,
			predecessorManifestDigest: value.manifestDigest, acknowledgementsDigest: hash('acks'),
			sealedRoot: '/tmp/not-r18', sealedParent: '/tmp', priorOwnerUid: 997, priorOwnerGid: 986, sealedOwnerUid: 0,
			sealedOwnerGid: 0, sealedMode: '0700', sealedParentMode: '0711', status: 'R18_PRIVATE_ROOT_SEALED_NO_REPLAY' }
		expect(() => requireDemoFridayR20PredecessorPermissionSeal({ value: seal,
			expectedAbortDigest: value.abortDigest, expectedManifestDigest: value.manifestDigest,
			expectedParticipantId: 1 })).toThrow()
		expect(() => requireDemoFridayR20PredecessorPermissionSeal({ value: { ...seal,
			sealedRoot: '/var/lib/plebeian-auctions-friday/frost/keyset-v1', acknowledgementsDigest: '' },
			expectedAbortDigest: value.abortDigest, expectedManifestDigest: value.manifestDigest,
			expectedParticipantId: 1 })).toThrow()
		const valid = { ...seal, sealedRoot: '/var/lib/plebeian-auctions-friday/frost/keyset-v1',
			sealedParent: '/var/lib/plebeian-auctions-friday/frost' }
		expect(() => requireDemoFridayR20PredecessorPermissionSeal({ value: valid,
			expectedAbortDigest: value.abortDigest, expectedManifestDigest: value.manifestDigest,
			expectedParticipantId: 2 })).toThrow()
		expect(requireDemoFridayR20PredecessorPermissionSeal({ value: valid,
			expectedAbortDigest: value.abortDigest, expectedManifestDigest: value.manifestDigest,
			expectedParticipantId: 1 }).participantId).toBe(1)
	})

	test('metadata-only predecessor verifier pins search-only directories and rejects symlinks', async () => {
		const base = await mkdtemp(join(tmpdir(), 'r18-predecessor-metadata-'))
		const parent = join(base, 'frost'); const root = join(parent, 'keyset-v1')
		await mkdir(parent, { mode: 0o700 }); await mkdir(root, { mode: 0o700 }); await chmod(parent, 0o711)
		const uid = process.getuid!(); const gid = process.getgid!()
		await expect(verifyDemoFridayR18SealedDirectoryMetadata({
			path: parent, uid, gid, mode: 0o711, label: 'parent',
		})).resolves.toBeUndefined()
		await expect(verifyDemoFridayR18SealedDirectoryMetadata({
			path: root, uid, gid, mode: 0o700, label: 'private root',
		})).resolves.toBeUndefined()
		const linked = join(base, 'linked-root'); await symlink(root, linked)
		await expect(verifyDemoFridayR18SealedDirectoryMetadata({
			path: linked, uid, gid, mode: 0o700, label: 'private root',
		})).rejects.toThrow()
	})

	test.skipIf(process.geteuid?.() !== 0)('root-only: service uid traverses 0711 parent and O_PATH-verifies root-owned 0700 keyset', async () => {
		const base = await mkdtemp(join(tmpdir(), 'r18-predecessor-root-integration-'))
		await chmod(base, 0o755)
		const parent = join(base, 'frost'); const root = join(parent, 'keyset-v1')
		await mkdir(parent, { mode: 0o711 }); await mkdir(root, { mode: 0o700 })
		const source = [
			'import { verifyDemoFridayR18SealedDirectoryMetadata as verify } from "./demo-friday-r20-r18-permission-seal.ts";',
			`await verify({path:${JSON.stringify(parent)},uid:0,gid:0,mode:0o711,label:"parent"});`,
			`await verify({path:${JSON.stringify(root)},uid:0,gid:0,mode:0o700,label:"private root"});`,
		].join('')
		const child = spawnSync(process.execPath, ['-e', source], {
			cwd: import.meta.dir, encoding: 'utf8', timeout: 10_000, uid: 65_534, gid: 65_534,
			env: { PATH: '/nonexistent', LANG: 'C', LC_ALL: 'C' },
		})
		expect({ status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr })
			.toEqual({ status: 0, signal: null, stdout: '', stderr: '' })
	})
})
