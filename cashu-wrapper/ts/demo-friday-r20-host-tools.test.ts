import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgOwnerApprovedHostPinDigestAtRoot,
	type DemoFridayDkgOwnerApprovedHostPinV1,
} from './demo-friday-per-validator-dkg-enrollment-init'
import { demoFridayR20ProfileDigest, DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA,
	type DemoFridayR20RuntimeDkgBindingV1 } from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	DEMO_FRIDAY_R20_DEPLOYMENT_ID, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH, DEMO_FRIDAY_R20_FRESH_PARENT,
	DEMO_FRIDAY_R20_INPUT_ROOT, DEMO_FRIDAY_R20_MANIFEST_DIGEST_PATH,
	DEMO_FRIDAY_R20_MANIFEST_PATH, DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH,
	DEMO_FRIDAY_R20_KEYSET_ID, DEMO_FRIDAY_R20_KEYSET_ROOT,
	DEMO_FRIDAY_R20_KEYSET_VERSION, DEMO_FRIDAY_R20_OPERATOR_ROOT,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'
import {
	demoFridayR20HostEnrollmentArgs, initializeDemoFridayR20HostEnrollment,
	recoverDemoFridayR20HostEnrollment,
} from './demo-friday-r20-host-enrollment'
import { executeDemoFridayR20HostStage } from './demo-friday-r20-host-stage'
import {
	DEMO_FRIDAY_R20_INSPECTOR_BINARY, DEMO_FRIDAY_R20_PARTICIPANT_BINARY,
} from './demo-friday-r20-path-contract'
import {
	DEMO_FRIDAY_R18_PRODUCTION_PARENT, DEMO_FRIDAY_R18_PRODUCTION_ROOT,
} from './demo-friday-r20-r18-permission-seal'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

function hex(label: string): string { return bytesToHex(sha256(utf8ToBytes(label))) }
const verifiedPredecessorSeal = async () => ({} as any)

function profile(predecessorManifestDigest = hex('predecessor')): DemoFridayR20FreshDkgProfileV2 {
	return {
		schema: 'PLEBEIAN_FRIDAY_FRESH_DKG_PROFILE_V2', valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
		dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
		committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, keysetRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
		configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
		transportSecretsPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`,
		stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		exchangeDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`,
		coordinatorRoot: DEMO_FRIDAY_R20_COORDINATOR_ROOT, operatorRoot: DEMO_FRIDAY_R20_OPERATOR_ROOT,
		predecessorManifestDigest, predecessorAbortDigest: hex('abort'), abortAcknowledgementsDigest: hex('acks'),
	}
}

describe('R20 fixed per-host tools', () => {
	test('production constants separate sealed predecessor, fresh inputs and fresh keyset', () => {
		expect(DEMO_FRIDAY_R18_PRODUCTION_PARENT).toBe('/var/lib/plebeian-auctions-friday/frost')
		expect(DEMO_FRIDAY_R18_PRODUCTION_ROOT).toBe(`${DEMO_FRIDAY_R18_PRODUCTION_PARENT}/keyset-v1`)
		expect(DEMO_FRIDAY_R20_FRESH_PARENT).toBe('/var/lib/plebeian-auctions-friday/frost-v2')
		expect(DEMO_FRIDAY_R20_INPUT_ROOT).toBe(`${DEMO_FRIDAY_R20_FRESH_PARENT}/r20-inputs`)
		expect(DEMO_FRIDAY_R20_KEYSET_ROOT).toBe(`${DEMO_FRIDAY_R20_FRESH_PARENT}/keyset-v2`)
		expect(DEMO_FRIDAY_R20_MANIFEST_PATH).toBe(`${DEMO_FRIDAY_R20_KEYSET_ROOT}/manifest.json`)
		expect(DEMO_FRIDAY_R20_MANIFEST_DIGEST_PATH)
			.toBe(`${DEMO_FRIDAY_R20_KEYSET_ROOT}/owner-approved-manifest-digest.txt`)
		expect(DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH)
			.toBe(`${DEMO_FRIDAY_R20_INPUT_ROOT}/predecessor-manifest.json`)
		expect(DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH)
			.toBe(`${DEMO_FRIDAY_R20_INPUT_ROOT}/bound-manifest.json`)
		for (const fresh of [DEMO_FRIDAY_R20_FRESH_PARENT, DEMO_FRIDAY_R20_INPUT_ROOT,
			DEMO_FRIDAY_R20_KEYSET_ROOT]) {
			expect(fresh).not.toBe(DEMO_FRIDAY_R18_PRODUCTION_PARENT)
			expect(fresh.startsWith(`${DEMO_FRIDAY_R18_PRODUCTION_PARENT}/`)).toBe(false)
			expect(DEMO_FRIDAY_R18_PRODUCTION_PARENT.startsWith(`${fresh}/`)).toBe(false)
		}
	})

	test('creates keyset-v2 once and replays only the verified final enrollment', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-r20-enrollment-')); roots.push(root)
		const parent = join(root, 'frost-v2'); const filesystemRoot = join(parent, 'keyset-v2')
		const hostPinPath = join(parent, 'owner-approved-host-enrollment-pin-v2.json')
		await mkdir(parent, { mode: 0o700 })
		const pin: DemoFridayDkgOwnerApprovedHostPinV1 = {
			schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', valueProfile: 'FAKE_MONEY_ONLY',
			deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
			dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
			committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, participantId: 1,
			hostId: 'linode-108175009', underlayIpv4: '172.105.64.142',
			fipsNpub: `npub1${'q'.repeat(58)}`, fipsUla: 'fd42::1', signerEndpoint: 'http://[fd42::1]:39101/v1/frost',
			participantBinarySha256: hex('participant'), inspectorBinarySha256: hex('inspector'),
			configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
			stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		}
		await writeFile(hostPinPath, `${JSON.stringify(pin)}\n`, { mode: 0o600 })
		const expectedHostPinDigest = demoFridayDkgOwnerApprovedHostPinDigestAtRoot(pin, DEMO_FRIDAY_R20_KEYSET_ROOT)
		const value = profile(); const expectedProfileDigest = demoFridayR20ProfileDigest(value)
		let generations = 0
		const keyGenerator = {
			dkgIdentitySecret: () => { generations += 1; return new Uint8Array(32).fill(1) },
			kexSecret: () => new Uint8Array(32).fill(2), signerIdentitySecret: () => new Uint8Array(32).fill(3),
		}
		const options = { profile: value, expectedProfileDigest, participantId: 1 as const,
			expectedHostPinDigest, filesystem: { parentDirectory: parent, filesystemRoot, hostPinPath,
				logicalRoot: DEMO_FRIDAY_R20_KEYSET_ROOT }, keyGenerator,
			verifyPredecessorSeal: verifiedPredecessorSeal }
		const first = await initializeDemoFridayR20HostEnrollment(options)
		const second = await initializeDemoFridayR20HostEnrollment(options)
		expect(first).toEqual(second); expect(generations).toBe(1)
		expect(first.hostPin.configPath).toBe(`${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`)
		await expect(initializeDemoFridayR20HostEnrollment({ ...options,
			profile: { ...value, dkgRunId: 'friday-demo-r18-dkg1' } as any })).rejects.toThrow()
		expect(demoFridayR20HostEnrollmentArgs(['recover', '--participant', '1',
			'--expected-profile-digest', expectedProfileDigest,
			'--expected-host-pin-digest', expectedHostPinDigest])).toEqual({
			action: 'recover', participantId: 1, expectedProfileDigest, expectedHostPinDigest,
		})
	})

	test('recovers one complete keyset-v2 staging tree after a dead owner without regenerating', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-r20-recovery-')); roots.push(root)
		const parent = join(root, 'frost-v2'); const filesystemRoot = join(parent, 'keyset-v2')
		const hostPinPath = join(parent, 'owner-approved-host-enrollment-pin-v2.json')
		await mkdir(parent, { mode: 0o700 })
		const pin: DemoFridayDkgOwnerApprovedHostPinV1 = {
			schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', valueProfile: 'FAKE_MONEY_ONLY',
			deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
			dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
			committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, participantId: 1,
			hostId: 'linode-108175009', underlayIpv4: '172.105.64.142',
			fipsNpub: `npub1${'q'.repeat(58)}`, fipsUla: 'fd42::1', signerEndpoint: 'http://[fd42::1]:39101/v1/frost',
			participantBinarySha256: hex('participant'), inspectorBinarySha256: hex('inspector'),
			configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
			stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		}
		await writeFile(hostPinPath, `${JSON.stringify(pin)}\n`, { mode: 0o600 })
		const value = profile()
		const expectedProfileDigest = demoFridayR20ProfileDigest(value)
		const expectedHostPinDigest = demoFridayDkgOwnerApprovedHostPinDigestAtRoot(pin, DEMO_FRIDAY_R20_KEYSET_ROOT)
		const filesystem = { parentDirectory: parent, filesystemRoot, hostPinPath,
			logicalRoot: DEMO_FRIDAY_R20_KEYSET_ROOT }
		const moduleUrl = new URL('./demo-friday-r20-host-enrollment.ts', import.meta.url).href
		const childScript = join(root, 'crash-fixture.ts')
		await writeFile(childScript, `
			const m = await import(${JSON.stringify(moduleUrl)});
			const options = ${JSON.stringify({ profile: value, expectedProfileDigest, participantId: 1,
				expectedHostPinDigest, filesystem })};
			await m.initializeDemoFridayR20HostEnrollment({ ...options,
				verifyPredecessorSeal: async () => ({}),
				keyGenerator: { dkgIdentitySecret: () => new Uint8Array(32).fill(11),
					kexSecret: () => new Uint8Array(32).fill(12),
					signerIdentitySecret: () => new Uint8Array(32).fill(13) },
				faultInjection: async (phase) => { if (phase === 'after-staging-sync') process.exit(77) },
			});
		`, { mode: 0o600 })
		const child = Bun.spawn([process.execPath, childScript], { stdout: 'pipe', stderr: 'pipe' })
		expect(await child.exited).toBe(77)
		const recovered = await recoverDemoFridayR20HostEnrollment({ profile: value,
			expectedProfileDigest, participantId: 1, expectedHostPinDigest, filesystem,
			verifyPredecessorSeal: verifiedPredecessorSeal })
		const replayed = await initializeDemoFridayR20HostEnrollment({ profile: value,
			expectedProfileDigest, participantId: 1, expectedHostPinDigest, filesystem,
			verifyPredecessorSeal: verifiedPredecessorSeal,
			keyGenerator: { dkgIdentitySecret: () => { throw new Error('must not regenerate') },
				kexSecret: () => { throw new Error('must not regenerate') },
				signerIdentitySecret: () => { throw new Error('must not regenerate') } } })
		expect(replayed).toEqual(recovered)
	})

	test('dispatches only the independently bound v2 manifest and fixed host profile', async () => {
		const golden = await Bun.file(new URL('../../internal/poc/testdata/friday-r20-runtime-binding-go-golden.json', import.meta.url))
			.json() as { predecessorManifest: unknown; binding: DemoFridayR20RuntimeDkgBindingV1 }
		const value = profile(golden.binding.predecessorManifestDigest)
		value.predecessorAbortDigest = golden.binding.predecessorAbortDigest
		value.abortAcknowledgementsDigest = golden.binding.abortAcknowledgementsDigest
		const profileDigest = demoFridayR20ProfileDigest(value)
		const bindingDigest = hex(JSON.stringify([
			DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest, value.predecessorAbortDigest,
			golden.binding.manifestDigest,
		]))
		const boundManifest = { schema: DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest,
			predecessorAbortDigest: value.predecessorAbortDigest, manifest: golden.binding.result.manifest,
			manifestDigest: golden.binding.manifestDigest, bindingDigest }
		let received: any
		await expect(executeDemoFridayR20HostStage({ stage: 'enroll', participantId: 2, profile: value,
			predecessorManifest: golden.predecessorManifest, boundManifest,
			expectedProfileDigest: profileDigest, expectedManifestBindingDigest: bindingDigest,
		}, async () => { throw new Error('must not dispatch') }, async () => {
			throw new Error('predecessor permission seal missing')
		})).rejects.toThrow('permission seal missing')
		await executeDemoFridayR20HostStage({ stage: 'enroll', participantId: 2, profile: value,
			predecessorManifest: golden.predecessorManifest, boundManifest,
			expectedProfileDigest: profileDigest, expectedManifestBindingDigest: bindingDigest,
			filesystemRoot: '/tmp/friday-r20-host-mirror' }, async (options) => {
			received = options
			return { stage: options.stage, status: 'completed', evidenceDigest: hex('evidence') }
		}, verifiedPredecessorSeal)
		expect(received.runId).toBe(DEMO_FRIDAY_R20_DKG_RUN_ID)
		expect(received.externalManifestDigest).toBe(golden.binding.manifestDigest)
		expect(received.profile.filesystemRoot).toBe('/tmp/friday-r20-host-mirror')
		expect(received.profile.participantBinary).toBe(DEMO_FRIDAY_R20_PARTICIPANT_BINARY)
		expect(received.profile.inspectorBinary).toBe(DEMO_FRIDAY_R20_INSPECTOR_BINARY)
		expect(received.profile.trustedBinaryParentRoot).toBe('/')
		await expect(executeDemoFridayR20HostStage({ stage: 'enroll', participantId: 2,
			profile: value, predecessorManifest: golden.predecessorManifest,
			boundManifest: { ...boundManifest, predecessorAbortDigest: hex('wrong') },
			expectedProfileDigest: profileDigest, expectedManifestBindingDigest: bindingDigest,
		}, async () => { throw new Error('must not dispatch') }, verifiedPredecessorSeal)).rejects.toThrow()
	})

	test('creates fresh enrollment only below frost-v2 and preserves the sealed predecessor tree', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-r20-parent-separation-')); roots.push(root)
		const sealedParent = join(root, 'frost')
		const sealedRoot = join(sealedParent, 'keyset-v1')
		const freshParent = join(root, 'frost-v2')
		const filesystemRoot = join(freshParent, 'keyset-v2')
		const hostPinPath = join(freshParent, 'owner-approved-host-enrollment-pin-v2.json')
		await mkdir(sealedParent, { mode: 0o700 })
		await mkdir(sealedRoot, { mode: 0o700 })
		await writeFile(join(sealedRoot, 'preserved-marker'), 'r18-preserved\n', { mode: 0o600 })
		await chmod(sealedParent, 0o711)
		await mkdir(freshParent, { mode: 0o700 })
		const sealedParentBefore = await lstat(sealedParent)
		const sealedRootBefore = await lstat(sealedRoot)
		const pin: DemoFridayDkgOwnerApprovedHostPinV1 = {
			schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', valueProfile: 'FAKE_MONEY_ONLY',
			deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
			dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
			committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, participantId: 1,
			hostId: 'linode-108175009', underlayIpv4: '172.105.64.142',
			fipsNpub: `npub1${'q'.repeat(58)}`, fipsUla: 'fd42::1', signerEndpoint: 'http://[fd42::1]:39101/v1/frost',
			participantBinarySha256: hex('participant'), inspectorBinarySha256: hex('inspector'),
			configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
			stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		}
		await writeFile(hostPinPath, `${JSON.stringify(pin)}\n`, { mode: 0o600 })
		const expectedHostPinDigest = demoFridayDkgOwnerApprovedHostPinDigestAtRoot(pin, DEMO_FRIDAY_R20_KEYSET_ROOT)
		const value = profile(); const expectedProfileDigest = demoFridayR20ProfileDigest(value)
		await initializeDemoFridayR20HostEnrollment({ profile: value, expectedProfileDigest,
			participantId: 1, expectedHostPinDigest,
			filesystem: { parentDirectory: freshParent, filesystemRoot, hostPinPath,
				logicalRoot: DEMO_FRIDAY_R20_KEYSET_ROOT },
			keyGenerator: { dkgIdentitySecret: () => new Uint8Array(32).fill(21),
				kexSecret: () => new Uint8Array(32).fill(22),
				signerIdentitySecret: () => new Uint8Array(32).fill(23) },
			verifyPredecessorSeal: verifiedPredecessorSeal })
		const sealedParentAfter = await lstat(sealedParent)
		const sealedRootAfter = await lstat(sealedRoot)
		expect([sealedParentAfter.dev, sealedParentAfter.ino, sealedParentAfter.mode & 0o777])
			.toEqual([sealedParentBefore.dev, sealedParentBefore.ino, 0o711])
		expect([sealedRootAfter.dev, sealedRootAfter.ino, sealedRootAfter.mode & 0o777])
			.toEqual([sealedRootBefore.dev, sealedRootBefore.ino, 0o700])
		expect(await readdir(sealedParent)).toEqual(['keyset-v1'])
		expect(await readFile(join(sealedRoot, 'preserved-marker'), 'utf8')).toBe('r18-preserved\n')
		expect((await lstat(freshParent)).mode & 0o777).toBe(0o700)
		expect((await lstat(filesystemRoot)).mode & 0o777).toBe(0o700)
		expect(await readdir(freshParent)).toContain('owner-approved-host-enrollment-pin-v2.json')
	})

	test('rejects an old logical root or symlinked fresh parent before identity generation', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-r20-parent-reject-')); roots.push(root)
		const actualParent = join(root, 'actual-frost-v2')
		const linkedParent = join(root, 'frost-v2')
		await mkdir(actualParent, { mode: 0o700 })
		await symlink(actualParent, linkedParent)
		const filesystemRoot = join(linkedParent, 'keyset-v2')
		const hostPinPath = join(linkedParent, 'owner-approved-host-enrollment-pin-v2.json')
		const pin: DemoFridayDkgOwnerApprovedHostPinV1 = {
			schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', valueProfile: 'FAKE_MONEY_ONLY',
			deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
			dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
			committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, participantId: 1,
			hostId: 'linode-108175009', underlayIpv4: '172.105.64.142',
			fipsNpub: `npub1${'q'.repeat(58)}`, fipsUla: 'fd42::1', signerEndpoint: 'http://[fd42::1]:39101/v1/frost',
			participantBinarySha256: hex('participant'), inspectorBinarySha256: hex('inspector'),
			configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
			stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		}
		await writeFile(join(actualParent, 'owner-approved-host-enrollment-pin-v2.json'),
			`${JSON.stringify(pin)}\n`, { mode: 0o600 })
		const expectedHostPinDigest = demoFridayDkgOwnerApprovedHostPinDigestAtRoot(pin, DEMO_FRIDAY_R20_KEYSET_ROOT)
		const value = profile(); const expectedProfileDigest = demoFridayR20ProfileDigest(value)
		let generations = 0
		const keyGenerator = { dkgIdentitySecret: () => { generations += 1; return new Uint8Array(32).fill(31) },
			kexSecret: () => new Uint8Array(32).fill(32), signerIdentitySecret: () => new Uint8Array(32).fill(33) }
		await expect(initializeDemoFridayR20HostEnrollment({ profile: value, expectedProfileDigest,
			participantId: 1, expectedHostPinDigest,
			filesystem: { parentDirectory: linkedParent, filesystemRoot, hostPinPath,
				logicalRoot: DEMO_FRIDAY_R20_KEYSET_ROOT }, keyGenerator,
			verifyPredecessorSeal: verifiedPredecessorSeal })).rejects.toThrow('owned real 0700 directory')
		expect(generations).toBe(0)
		await expect(initializeDemoFridayR20HostEnrollment({ profile: value, expectedProfileDigest,
			participantId: 1, expectedHostPinDigest,
			filesystem: { parentDirectory: linkedParent,
				filesystemRoot: join(linkedParent, 'keyset-v1'), hostPinPath,
				logicalRoot: '/var/lib/plebeian-auctions-friday/frost/keyset-v1' }, keyGenerator,
			verifyPredecessorSeal: verifiedPredecessorSeal })).rejects.toThrow('production filesystem root differs')
		expect(generations).toBe(0)
	})

	test('rejects a mode-0711 fresh enrollment parent before identity generation', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-r20-parent-mode-')); roots.push(root)
		const parent = join(root, 'frost-v2'); const filesystemRoot = join(parent, 'keyset-v2')
		const hostPinPath = join(parent, 'owner-approved-host-enrollment-pin-v2.json')
		await mkdir(parent, { mode: 0o700 })
		const pin: DemoFridayDkgOwnerApprovedHostPinV1 = {
			schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_PIN_V1', valueProfile: 'FAKE_MONEY_ONLY',
			deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
			dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
			committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, participantId: 1,
			hostId: 'linode-108175009', underlayIpv4: '172.105.64.142',
			fipsNpub: `npub1${'q'.repeat(58)}`, fipsUla: 'fd42::1', signerEndpoint: 'http://[fd42::1]:39101/v1/frost',
			participantBinarySha256: hex('participant'), inspectorBinarySha256: hex('inspector'),
			configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
			stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
		}
		await writeFile(hostPinPath, `${JSON.stringify(pin)}\n`, { mode: 0o600 })
		await chmod(parent, 0o711)
		const value = profile(); let generations = 0
		await expect(initializeDemoFridayR20HostEnrollment({ profile: value,
			expectedProfileDigest: demoFridayR20ProfileDigest(value), participantId: 1,
			expectedHostPinDigest: demoFridayDkgOwnerApprovedHostPinDigestAtRoot(pin, DEMO_FRIDAY_R20_KEYSET_ROOT),
			filesystem: { parentDirectory: parent, filesystemRoot, hostPinPath,
				logicalRoot: DEMO_FRIDAY_R20_KEYSET_ROOT },
			keyGenerator: { dkgIdentitySecret: () => { generations += 1; return new Uint8Array(32).fill(41) },
				kexSecret: () => new Uint8Array(32).fill(42),
				signerIdentitySecret: () => new Uint8Array(32).fill(43) },
			verifyPredecessorSeal: verifiedPredecessorSeal,
		})).rejects.toThrow('owned real 0700 directory')
		expect(generations).toBe(0)
	})
})
