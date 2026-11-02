import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	composeDemoFridayInitialDkgManifest,
	DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA,
	DEMO_FRIDAY_COMPOSED_MANIFEST_SCHEMA,
	DEMO_FRIDAY_COORDINATOR_IDENTITY_SCHEMA,
	initializeDemoFridayCoordinatorIdentity,
	recoverDemoFridayCoordinatorIdentity,
	recoverDemoFridayInitialDkgManifest,
	writeDemoFridayInitialDkgManifest,
} from './demo-friday-dkg-deployment-tools'
import {
	demoFridayDkgOwnerApprovedHostPinDigest,
	initializeDemoFridayDkgHostEnrollment,
	type DemoFridayDkgHostEnrollmentV1,
	type DemoFridayDkgOwnerApprovedHostPinV1,
} from './demo-friday-per-validator-dkg-enrollment-init'
import { runDemoFridayDkgDeploymentCli } from './demo-friday-dkg-deployment-cli'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function temp(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `friday-${label}-`)); roots.push(root); await chmod(root, 0o700); return root
}
function secret(byte: number): () => Uint8Array { return () => new Uint8Array(32).fill(byte) }
async function coordinator() {
	const parent = await temp('coordinator'), root = join(parent, 'coordinator')
	return { parent, root, profile: { parentDirectory: parent, root,
		secretPath: join(root, 'coordinator.key'), publicPath: join(root, 'coordinator.public.json') },
	input: { deploymentId: 'friday-demo-20261023-r14', applicationRunId: 'friday-demo-20261023-r14-run1',
		dkgRunId: 'friday-demo-20261023-r14-dkg1', committeeKeysetId: 'friday-demo-frost-keyset-v1',
		committeeKeysetVersion: '1' } }
}
async function enrollments(): Promise<DemoFridayDkgHostEnrollmentV1[]> {
	const values: DemoFridayDkgHostEnrollmentV1[] = []
	for (let participant = 1; participant <= 4; participant++) {
		const pin = JSON.parse(await readFile(join(import.meta.dir,
			`../../deploy/friday/dkg-enrollment-r14/v${participant}-host-pin.json`), 'utf8')) as DemoFridayDkgOwnerApprovedHostPinV1
		const parent = await temp(`participant-${participant}`)
		const profile = { parentDirectory: parent, filesystemRoot: join(parent, 'keyset-v1'), hostPinPath: join(parent, 'host-pin.json') }
		await writeFile(profile.hostPinPath, `${JSON.stringify(pin)}\n`, { mode: 0o600 })
		values.push(await initializeDemoFridayDkgHostEnrollment({ participantId: participant as 1 | 2 | 3 | 4,
			expectedHostPinDigest: demoFridayDkgOwnerApprovedHostPinDigest(pin), profile,
			keyGenerator: { dkgIdentitySecret: secret(10 + participant), kexSecret: secret(20 + participant),
				signerIdentitySecret: secret(30 + participant) } }))
	}
	return values
}
async function manifestInputs() {
	const held = await coordinator(), identity = await initializeDemoFridayCoordinatorIdentity({ ...held.input,
		profile: held.profile, secretGenerator: secret(5) })
	const enrolled = await enrollments(), root = await temp('manifest-output')
	return { root, enrolled, options: { outputPath: join(root, 'manifest.json'), receiptPath: join(root, 'receipt.json'),
		expectedHostPinDigests: enrolled.map((value) => value.hostPinDigest), coordinator: identity, enrollments: enrolled } }
}
async function markManifestOwnerDead(root: string) {
	const lock = (await readdir(root)).find((name) => name.endsWith('.lock'))
	if (!lock) throw new Error('test manifest lock missing')
	const ownerPath = join(root, lock, 'owner.json'), owner = JSON.parse(await readFile(ownerPath, 'utf8')) as {
		pid: number; processStartTicks: string
	}
	owner.pid = 2_000_000_000; owner.processStartTicks = '1'
	await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 })
}

describe('Friday final-host deployment tools', () => {
	test('atomically creates one V2 coordinator identity and replays only the exact binding', async () => {
		const held = await coordinator()
		const first = await initializeDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile, secretGenerator: secret(9) })
		expect(first.schema).toBe(DEMO_FRIDAY_COORDINATOR_IDENTITY_SCHEMA)
		expect(await initializeDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile })).toEqual(first)
		await expect(initializeDemoFridayCoordinatorIdentity({ ...held.input, applicationRunId: 'changed-run', profile: held.profile }))
			.rejects.toThrow(/stored coordinator public identity differs/)
		expect(await lstat(held.root)).toMatchObject({ mode: expect.any(Number) })
	})

	test('preserves crash state and recovers a complete staged coordinator identity only after owner death', async () => {
		const held = await coordinator()
		await expect(initializeDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile, secretGenerator: secret(8),
			faultInjection: async (phase) => { if (phase === 'after-staging-sync') throw new Error('injected stop') } }))
			.rejects.toThrow(/injected stop/)
		await expect(initializeDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile }))
			.rejects.toThrow(/lock exists/)
		const ownerPath = join(held.parent, '.coordinator.identity.lock', 'owner.json')
		const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { pid: number; processStartTicks: string }
		owner.pid = 2_000_000_000; owner.processStartTicks = '1'
		await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 })
		const recovered = await recoverDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile })
		expect(recovered.coordinatorIdentity).toMatch(/^[0-9a-f]{64}$/)
		await expect(lstat(join(held.parent, '.coordinator.identity.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
	})

	test('rejects a symlinked coordinator identity without following it', async () => {
		const held = await coordinator()
		await initializeDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile, secretGenerator: secret(7) })
		const target = join(held.parent, 'public-copy.json')
		await writeFile(target, await readFile(held.profile.publicPath), { mode: 0o600 })
		await unlink(held.profile.publicPath); await symlink(target, held.profile.publicPath)
		await expect(initializeDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile }))
			.rejects.toThrow(/regular|entries|identity/)
	})

	test('requires independent ordered pins and binds them into the manifest output', async () => {
		const held = await coordinator()
		const identity = await initializeDemoFridayCoordinatorIdentity({ ...held.input, profile: held.profile, secretGenerator: secret(6) })
		const enrolled = await enrollments(), digests = enrolled.map((value) => value.hostPinDigest)
		const result = composeDemoFridayInitialDkgManifest({ coordinator: identity, enrollments: enrolled,
			expectedHostPinDigests: digests })
		expect(result.schema).toBe(DEMO_FRIDAY_COMPOSED_MANIFEST_SCHEMA)
		expect([...result.expectedHostPinDigests]).toEqual(digests)
		expect(result.manifest.participants.map((entry) => entry.participantId)).toEqual([1, 2, 3, 4])
		await expect(Promise.resolve().then(() => composeDemoFridayInitialDkgManifest({ coordinator: identity,
			enrollments: enrolled, expectedHostPinDigests: [`${'f'.repeat(64)}`, ...digests.slice(1)] })))
			.rejects.toThrow(/external pin/)
	})

	test('CLI creates and fsyncs one manifest plus receipt without overwriting either', async () => {
		const held = await manifestInputs(), inputs = [held.options.coordinator, ...held.enrolled], paths: string[] = []
		for (let index = 0; index < inputs.length; index++) {
			const path = join(held.root, `input-${index}.json`); await writeFile(path, `${JSON.stringify(inputs[index])}\n`, { mode: 0o600 }); paths.push(path)
		}
		const args = ['compose-manifest', '--output', held.options.outputPath, '--receipt', held.options.receiptPath,
			'--expected-host-pin-digests', held.enrolled.map((value) => value.hostPinDigest).join(','), ...paths]
		const result = await runDemoFridayDkgDeploymentCli(args)
		expect(result).toMatchObject({ schema: DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA })
		expect(JSON.parse(await readFile(held.options.receiptPath, 'utf8'))).toEqual(result)
		expect(JSON.parse(await readFile(held.options.outputPath, 'utf8'))).toMatchObject({ schema: DEMO_FRIDAY_COMPOSED_MANIFEST_SCHEMA })
		await expect(runDemoFridayDkgDeploymentCli(args)).rejects.toThrow(/destination or staging already exists/)
	})

	test('recovers the exact pair after interruption with only the staged manifest', async () => {
		const held = await manifestInputs()
		await expect(writeDemoFridayInitialDkgManifest({ ...held.options,
			faultInjection: async (phase) => { if (phase === 'after-manifest-stage') throw new Error('injected manifest-stage stop') } }))
			.rejects.toThrow(/injected manifest-stage stop/)
		await markManifestOwnerDead(held.root)
		const receipt = await recoverDemoFridayInitialDkgManifest(held.options)
		expect(JSON.parse(await readFile(held.options.receiptPath, 'utf8'))).toEqual(receipt)
		expect(JSON.parse(await readFile(held.options.outputPath, 'utf8'))).toMatchObject({ manifestDigest: receipt.manifestDigest })
		expect((await readdir(held.root)).filter((name) => name.startsWith('.friday-dkg-manifest-'))).toEqual([])
	})

	test('recovers the lock-bound pair after interruption before staging exists', async () => {
		const held = await manifestInputs()
		await expect(writeDemoFridayInitialDkgManifest({ ...held.options,
			faultInjection: async (phase) => { if (phase === 'after-lock') throw new Error('injected pre-staging stop') } }))
			.rejects.toThrow(/injected pre-staging stop/)
		await markManifestOwnerDead(held.root)
		await expect(recoverDemoFridayInitialDkgManifest(held.options)).resolves
			.toMatchObject({ schema: DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA })
		expect(JSON.parse(await readFile(held.options.outputPath, 'utf8'))).toMatchObject({ schema: DEMO_FRIDAY_COMPOSED_MANIFEST_SCHEMA })
	})

	test('recovers after receipt-first promotion and rejects changed recovery inputs', async () => {
		const held = await manifestInputs()
		await expect(writeDemoFridayInitialDkgManifest({ ...held.options,
			faultInjection: async (phase) => { if (phase === 'after-receipt-promotion') throw new Error('injected partial promotion') } }))
			.rejects.toThrow(/injected partial promotion/)
		await expect(lstat(held.options.receiptPath)).resolves.toMatchObject({ mode: expect.any(Number) })
		await expect(lstat(held.options.outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
		const staging = (await readdir(held.root)).find((name) => name.endsWith('.staging'))
		expect(staging).toBeDefined()
		expect(await readdir(join(held.root, staging!))).toEqual(['manifest.json'])
		await markManifestOwnerDead(held.root)
		await expect(recoverDemoFridayInitialDkgManifest({ ...held.options,
			expectedHostPinDigests: [`${'f'.repeat(64)}`, ...held.options.expectedHostPinDigests.slice(1)] }))
			.rejects.toThrow(/external pin|requested pair/)
		const receipt = await recoverDemoFridayInitialDkgManifest(held.options)
		expect(JSON.parse(await readFile(held.options.receiptPath, 'utf8'))).toEqual(receipt)
	})

	test('recovers only the lock after both exact files were durably promoted', async () => {
		const held = await manifestInputs()
		await expect(writeDemoFridayInitialDkgManifest({ ...held.options,
			faultInjection: async (phase) => { if (phase === 'after-parent-sync') throw new Error('injected post-sync stop') } }))
			.rejects.toThrow(/injected post-sync stop/)
		await markManifestOwnerDead(held.root)
		const before = await readFile(held.options.outputPath)
		await expect(recoverDemoFridayInitialDkgManifest(held.options)).resolves
			.toMatchObject({ schema: DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA })
		expect(await readFile(held.options.outputPath)).toEqual(before)
		expect((await readdir(held.root)).filter((name) => name.startsWith('.friday-dkg-manifest-'))).toEqual([])
	})

	test('a competing composer cannot pass a live composition lock', async () => {
		const held = await manifestInputs()
		let release!: () => void
		const barrier = new Promise<void>((resolve) => { release = resolve })
		let locked!: () => void
		const lockObserved = new Promise<void>((resolve) => { locked = resolve })
		const first = writeDemoFridayInitialDkgManifest({ ...held.options, faultInjection: async (phase) => {
			if (phase === 'after-lock') { locked(); await barrier }
		} })
		await lockObserved
		await expect(writeDemoFridayInitialDkgManifest(held.options)).rejects.toThrow(/lock exists/)
		release(); await expect(first).resolves.toMatchObject({ schema: DEMO_FRIDAY_COMPOSED_MANIFEST_RECEIPT_SCHEMA })
	})
})
