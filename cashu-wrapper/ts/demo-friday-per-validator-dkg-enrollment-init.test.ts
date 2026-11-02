import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
	chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA,
	DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA,
	demoFridayDkgEnrollmentInitArgs,
	demoFridayDkgOwnerApprovedHostPinDigest,
	initializeDemoFridayDkgHostEnrollment,
	runDemoFridayEnrollmentNoReplaceSelfTest,
	recoverDemoFridayDkgHostEnrollment,
	verifyDemoFridayDkgHostEnrollment,
	type DemoFridayDkgEnrollmentFaultPhase,
	type DemoFridayDkgEnrollmentFilesystemProfile,
	type DemoFridayDkgEnrollmentKeyGenerator,
	type DemoFridayDkgOwnerApprovedHostPinV1,
} from './demo-friday-per-validator-dkg-enrollment-init'
import { DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT } from './demo-friday-per-validator-dkg-plan'

const cleanup: string[] = []

afterEach(async () => {
	for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true })
})

function secret(value: number): Uint8Array {
	const bytes = new Uint8Array(32)
	bytes[31] = value
	return bytes
}

function pin(participantId: 1 | 2 | 3 | 4 = 2): DemoFridayDkgOwnerApprovedHostPinV1 {
	const ula = `fd42:706c:6562::${participantId}`
	return {
		schema: DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-demo-v2', applicationRunId: 'friday-run-v2', dkgRunId: 'dkg-run-v2',
		committeeKeysetId: 'friday-keyset', committeeKeysetVersion: '2', participantId,
		hostId: `linode-${108175000 + participantId}`, underlayIpv4: `198.51.100.${participantId}`,
		fipsNpub: `npub1${['q', 'p', 'z', 'r'][participantId - 1]!.repeat(58)}`, fipsUla: ula,
		signerEndpoint: `http://[${ula}]:39101/v1/frost`,
		participantBinarySha256: String(participantId).repeat(64),
		inspectorBinarySha256: String(participantId + 4).repeat(64),
		configPath: `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/participant.config.json`,
		stateDirectory: `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/state`,
	}
}

function generator(counter?: { calls: number }): DemoFridayDkgEnrollmentKeyGenerator {
	return {
		dkgIdentitySecret: () => { if (counter) counter.calls += 1; return secret(11) },
		kexSecret: () => { if (counter) counter.calls += 1; return new Uint8Array(32).fill(22) },
		signerIdentitySecret: () => { if (counter) counter.calls += 1; return secret(33) },
	}
}

function forbiddenGenerator(): DemoFridayDkgEnrollmentKeyGenerator {
	const fail = (): Uint8Array => { throw new Error('generator must not be called') }
	return { dkgIdentitySecret: fail, kexSecret: fail, signerIdentitySecret: fail }
}

async function fixture(participantId: 1 | 2 | 3 | 4 = 2): Promise<{
	pin: DemoFridayDkgOwnerApprovedHostPinV1
	digest: string
	profile: DemoFridayDkgEnrollmentFilesystemProfile
}> {
	const parentDirectory = await mkdtemp(join(tmpdir(), 'plebeian-per-host-enrollment-'))
	cleanup.push(parentDirectory)
	await chmod(parentDirectory, 0o700)
	const value = pin(participantId)
	const hostPinPath = join(parentDirectory, 'owner-approved-host-enrollment-pin.json')
	await writeFile(hostPinPath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
	await chmod(hostPinPath, 0o600)
	return {
		pin: value, digest: demoFridayDkgOwnerApprovedHostPinDigest(value),
		profile: { parentDirectory, filesystemRoot: join(parentDirectory, 'keyset-v1'), hostPinPath },
	}
}

const crashPhase = process.env.A1_DKG_ENROLLMENT_CRASH_PHASE as DemoFridayDkgEnrollmentFaultPhase | undefined
if (crashPhase) {
	const payload = JSON.parse(process.env.A1_DKG_ENROLLMENT_CRASH_OPTIONS ?? 'null') as {
		participantId: 1 | 2 | 3 | 4
		expectedHostPinDigest: string
		profile: DemoFridayDkgEnrollmentFilesystemProfile
	}
	await initializeDemoFridayDkgHostEnrollment({
		...payload, keyGenerator: generator(),
		faultInjection: async (phase) => {
			if (phase !== crashPhase) return
			process.kill(process.pid, 'SIGKILL')
			await new Promise<never>(() => undefined)
		},
	})
	process.exit(93)
}

async function crashInNewProcess(
	held: Awaited<ReturnType<typeof fixture>>,
	phase: DemoFridayDkgEnrollmentFaultPhase,
): Promise<number> {
	const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
		stdout: 'ignore', stderr: 'ignore', env: {
			...process.env, A1_DKG_ENROLLMENT_CRASH_PHASE: phase,
			A1_DKG_ENROLLMENT_CRASH_OPTIONS: JSON.stringify({
				participantId: held.pin.participantId, expectedHostPinDigest: held.digest, profile: held.profile,
			}),
		},
	})
	return child.exited
}

describe('single-host per-validator enrollment initialization', () => {
	test('runs the bounded compiled-boundary no-replace canary without identities', async () => {
		const root = join(tmpdir(), `plebeian-friday-enrollment-noreplace-${randomUUID()}`)
		cleanup.push(root)
		expect(await runDemoFridayEnrollmentNoReplaceSelfTest(root)).toEqual({
			schema: 'PLEBEIAN_FRIDAY_ENROLLMENT_NOREPLACE_SELF_TEST_V1', supported: true,
		})
	})
	test('atomically creates only one host identity set and emits a dual-signed public enrollment', async () => {
		const held = await fixture(2)
		const result = await initializeDemoFridayDkgHostEnrollment({
			participantId: 2, expectedHostPinDigest: held.digest, profile: held.profile, keyGenerator: generator(),
		})
		expect(result.schema).toBe(DEMO_FRIDAY_DKG_HOST_ENROLLMENT_SCHEMA)
		expect(result.hostPin.participantId).toBe(2)
		expect(verifyDemoFridayDkgHostEnrollment(result, held.digest)).toEqual(result)
		const rootEntries = await Array.fromAsync(new Bun.Glob('*').scan({ cwd: held.profile.filesystemRoot, onlyFiles: false }))
		expect(rootEntries.sort()).toEqual([
			'exchange', 'identity-signing-key.hex', 'kex-private-key.hex', 'participant.config.json',
			'signer-rpc-identity.key', 'state',
		])
		for (const name of ['identity-signing-key.hex', 'kex-private-key.hex', 'signer-rpc-identity.key', 'participant.config.json']) {
			const metadata = await lstat(join(held.profile.filesystemRoot, name))
			expect(metadata.mode & 0o777).toBe(0o600)
			expect(metadata.nlink).toBe(1)
		}
		for (const name of ['state', 'exchange']) {
			expect((await lstat(join(held.profile.filesystemRoot, name))).mode & 0o777).toBe(0o700)
		}
		const enrollmentPath = join(
			held.profile.filesystemRoot, 'exchange', held.pin.dkgRunId, 'participant-2.host-enrollment.json',
		)
		expect(JSON.parse(await readFile(enrollmentPath, 'utf8'))).toEqual(result)
		const publicBytes = JSON.stringify(result)
		expect(publicBytes).not.toContain(Buffer.from(secret(11)).toString('hex'))
		expect(publicBytes).not.toContain(Buffer.from(new Uint8Array(32).fill(22)).toString('hex'))
		expect(publicBytes).not.toContain(Buffer.from(secret(33)).toString('hex'))
	})

	test('replays the exact public enrollment without generating replacement identities', async () => {
		const held = await fixture(3)
		const first = await initializeDemoFridayDkgHostEnrollment({
			participantId: 3, expectedHostPinDigest: held.digest, profile: held.profile, keyGenerator: generator(),
		})
		const replay = await initializeDemoFridayDkgHostEnrollment({
			participantId: 3, expectedHostPinDigest: held.digest, profile: held.profile,
			keyGenerator: forbiddenGenerator(),
		})
		expect(replay).toEqual(first)
	})

	test('refuses to overwrite or bless a changed existing private identity', async () => {
		const held = await fixture(3)
		await initializeDemoFridayDkgHostEnrollment({
			participantId: 3, expectedHostPinDigest: held.digest, profile: held.profile, keyGenerator: generator(),
		})
		const signerPath = join(held.profile.filesystemRoot, 'signer-rpc-identity.key')
		await writeFile(signerPath, `${Buffer.from(secret(44)).toString('hex')}\n`, { mode: 0o600 })
		await chmod(signerPath, 0o600)
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 3, expectedHostPinDigest: held.digest, profile: held.profile,
			keyGenerator: forbiddenGenerator(),
		})).rejects.toThrow(/existing final enrollment root failed verification; state was preserved/)
	})

	test('preserves empty and incomplete final roots instead of treating nested ENOENT as root absence', async () => {
		for (const partial of [false, true]) {
			const held = await fixture(3)
			await mkdir(held.profile.filesystemRoot, { mode: 0o700 })
			if (partial) await writeFile(join(held.profile.filesystemRoot, 'partial-state'), 'preserve\n', { mode: 0o600 })
			const counter = { calls: 0 }
			await expect(initializeDemoFridayDkgHostEnrollment({
				participantId: 3, expectedHostPinDigest: held.digest, profile: held.profile,
				keyGenerator: generator(counter),
			})).rejects.toThrow(/existing final enrollment root failed verification; state was preserved/)
			expect(counter.calls).toBe(0)
			expect((await readdir(held.profile.filesystemRoot)).sort()).toEqual(partial ? ['partial-state'] : [])
		}
	})

	test('uses atomic no-replace promotion when an empty destination races initialization or recovery', async () => {
		const initializing = await fixture(1)
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 1, expectedHostPinDigest: initializing.digest, profile: initializing.profile,
			keyGenerator: generator(),
			faultInjection: async (phase) => {
				if (phase === 'after-staging-sync') await mkdir(initializing.profile.filesystemRoot, { mode: 0o700 })
			},
		})).rejects.toThrow(/appeared before atomic promotion/)
		expect(await readdir(initializing.profile.filesystemRoot)).toEqual([])
		expect((await lstat(join(initializing.profile.parentDirectory, '.keyset-v1.initializing'))).isDirectory()).toBe(true)

		const recovering = await fixture(2)
		const exit = await crashInNewProcess(recovering, 'after-staging-sync')
		expect(exit).not.toBe(0)
		await expect(recoverDemoFridayDkgHostEnrollment({
			participantId: 2, expectedHostPinDigest: recovering.digest, profile: recovering.profile,
			beforePromotion: async () => mkdir(recovering.profile.filesystemRoot, { mode: 0o700 }).then(() => undefined),
		})).rejects.toThrow(/appeared before atomic promotion/)
		expect(await readdir(recovering.profile.filesystemRoot)).toEqual([])
		expect((await lstat(join(recovering.profile.parentDirectory, '.keyset-v1.initializing'))).isDirectory()).toBe(true)
	})

	test('refuses a symlink substituted at promotion and descriptor-binds the owner pin', async () => {
		const raced = await fixture(4)
		const redirect = join(raced.profile.parentDirectory, 'redirect-target')
		await mkdir(redirect, { mode: 0o700 })
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 4, expectedHostPinDigest: raced.digest, profile: raced.profile, keyGenerator: generator(),
			faultInjection: async (phase) => {
				if (phase === 'after-staging-sync') await symlink(redirect, raced.profile.filesystemRoot, 'dir')
			},
		})).rejects.toThrow(/appeared before atomic promotion/)
		expect(await readlink(raced.profile.filesystemRoot)).toBe(redirect)
		expect((await lstat(join(raced.profile.parentDirectory, '.keyset-v1.initializing'))).isDirectory()).toBe(true)

		const linkedPin = await fixture(1)
		const realPin = join(linkedPin.profile.parentDirectory, 'saved-owner-pin.json')
		await rename(linkedPin.profile.hostPinPath, realPin)
		await symlink(realPin, linkedPin.profile.hostPinPath)
		const counter = { calls: 0 }
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 1, expectedHostPinDigest: linkedPin.digest, profile: linkedPin.profile,
			keyGenerator: generator(counter),
		})).rejects.toThrow(/owner-approved host pin must be an owned regular/)
		expect(counter.calls).toBe(0)
	})

	test('promotes a complete staging tree when the final root is genuinely absent', async () => {
		const held = await fixture(2)
		await expect(lstat(held.profile.filesystemRoot)).rejects.toMatchObject({ code: 'ENOENT' })
		const counter = { calls: 0 }
		const enrollment = await initializeDemoFridayDkgHostEnrollment({
			participantId: 2, expectedHostPinDigest: held.digest, profile: held.profile,
			keyGenerator: generator(counter),
		})
		expect(counter.calls).toBe(3)
		expect(verifyDemoFridayDkgHostEnrollment(enrollment, held.digest)).toEqual(enrollment)
		expect((await lstat(held.profile.filesystemRoot)).isDirectory()).toBe(true)
	})

	test('rejects an unapproved digest or participant before any key generator runs', async () => {
		const held = await fixture(2)
		const counter = { calls: 0 }
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 2, expectedHostPinDigest: 'f'.repeat(64), profile: held.profile, keyGenerator: generator(counter),
		})).rejects.toThrow(/externally supplied digest/)
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 1, expectedHostPinDigest: held.digest, profile: held.profile, keyGenerator: generator(counter),
		})).rejects.toThrow(/requested participant/)
		expect(counter.calls).toBe(0)
		await expect(lstat(held.profile.filesystemRoot)).rejects.toMatchObject({ code: 'ENOENT' })
	})

	test('uses the manifest exact host and npub formats before any key generation', async () => {
		const invalidHost = await fixture(2)
		await writeFile(invalidHost.profile.hostPinPath, `${JSON.stringify({
			...invalidHost.pin, hostId: 'validator-2',
		})}\n`, { mode: 0o600 })
		const hostCounter = { calls: 0 }
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 2, expectedHostPinDigest: invalidHost.digest, profile: invalidHost.profile,
			keyGenerator: generator(hostCounter),
		})).rejects.toThrow(/host identity or FIPS binding/)
		expect(hostCounter.calls).toBe(0)

		const invalidNpub = await fixture(3)
		await writeFile(invalidNpub.profile.hostPinPath, `${JSON.stringify({
			...invalidNpub.pin, fipsNpub: `npub1${'q'.repeat(57)}`,
		})}\n`, { mode: 0o600 })
		const npubCounter = { calls: 0 }
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 3, expectedHostPinDigest: invalidNpub.digest, profile: invalidNpub.profile,
			keyGenerator: generator(npubCounter),
		})).rejects.toThrow(/host identity or FIPS binding/)
		expect(npubCounter.calls).toBe(0)
	})

	test('recovers fully verified staging or promoted roots after real subprocess SIGKILL without generating keys', async () => {
		for (const phase of [
			'after-public-enrollment', 'after-staging-sync', 'after-rename', 'after-parent-sync',
		] as const) {
			const held = await fixture(2)
			const exit = await crashInNewProcess(held, phase)
			expect(exit).not.toBe(0)
			expect(exit).not.toBe(93)
			const recovered = await recoverDemoFridayDkgHostEnrollment({
				participantId: 2, expectedHostPinDigest: held.digest, profile: held.profile,
			})
			expect(verifyDemoFridayDkgHostEnrollment(recovered, held.digest)).toEqual(recovered)
			const replay = await initializeDemoFridayDkgHostEnrollment({
				participantId: 2, expectedHostPinDigest: held.digest, profile: held.profile,
				keyGenerator: forbiddenGenerator(),
			})
			expect(replay).toEqual(recovered)
			await expect(lstat(join(held.profile.parentDirectory, '.keyset-v1.initializing')))
				.rejects.toMatchObject({ code: 'ENOENT' })
			await expect(lstat(join(held.profile.parentDirectory, '.keyset-v1.enrollment-init.lock')))
				.rejects.toMatchObject({ code: 'ENOENT' })
		}
	})

	test('preserves incomplete SIGKILL state and requires manual recovery without regenerating identities', async () => {
		for (const phase of ['after-lock-owner', 'after-journal-start', 'after-staging-directory', 'after-private-files'] as const) {
			const held = await fixture(4)
			const exit = await crashInNewProcess(held, phase)
			expect(exit).not.toBe(0)
			await expect(recoverDemoFridayDkgHostEnrollment({
				participantId: 4, expectedHostPinDigest: held.digest, profile: held.profile,
			})).rejects.toThrow(/manual recovery required/)
			await expect(initializeDemoFridayDkgHostEnrollment({
				participantId: 4, expectedHostPinDigest: held.digest, profile: held.profile,
				keyGenerator: forbiddenGenerator(),
			})).rejects.toThrow(/lock exists or is stranded/)
			expect((await lstat(join(held.profile.parentDirectory, '.keyset-v1.enrollment-init.lock'))).isDirectory()).toBe(true)
		}
	})

	test('surfaces an anonymous lock window and a live owner without deleting either', async () => {
		const anonymous = await fixture(1)
		const exit = await crashInNewProcess(anonymous, 'after-lock-directory')
		expect(exit).not.toBe(0)
		await expect(recoverDemoFridayDkgHostEnrollment({
			participantId: 1, expectedHostPinDigest: anonymous.digest, profile: anonymous.profile,
		})).rejects.toThrow(/without an authenticated owner record/)

		const live = await fixture(2)
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 2, expectedHostPinDigest: live.digest, profile: live.profile,
			keyGenerator: forbiddenGenerator(),
			faultInjection: async (phase) => {
				if (phase === 'after-journal-start') throw new Error('synthetic in-process stop')
			},
		})).rejects.toThrow(/synthetic in-process stop/)
		await expect(recoverDemoFridayDkgHostEnrollment({
			participantId: 2, expectedHostPinDigest: live.digest, profile: live.profile,
		})).rejects.toThrow(/owner is still live/)
	})

	test('fails closed on stranded phase ownership and never guesses recovery', async () => {
		const held = await fixture(4)
		await mkdir(join(held.profile.parentDirectory, '.keyset-v1.enrollment-init.lock'), { mode: 0o700 })
		const counter = { calls: 0 }
		await expect(initializeDemoFridayDkgHostEnrollment({
			participantId: 4, expectedHostPinDigest: held.digest, profile: held.profile, keyGenerator: generator(counter),
		})).rejects.toThrow(/lock exists or is stranded/)
		expect(counter.calls).toBe(0)
	})

	test('rejects changed public bindings and exposes no all-host command form', async () => {
		const held = await fixture(1)
		const result = await initializeDemoFridayDkgHostEnrollment({
			participantId: 1, expectedHostPinDigest: held.digest, profile: held.profile, keyGenerator: generator(),
		})
		expect(() => verifyDemoFridayDkgHostEnrollment({ ...result, kexPublicKey: 'a'.repeat(64) }, held.digest))
			.toThrow(/signatures/)
		expect(demoFridayDkgEnrollmentInitArgs([
			'init', '--participant', '1', '--expected-host-pin-digest', held.digest,
		])).toEqual({ participantId: 1, expectedHostPinDigest: held.digest })
		expect(() => demoFridayDkgEnrollmentInitArgs(['init', '--all', '--expected-host-pin-digest', held.digest]))
			.toThrow(/usage/)
		expect(() => demoFridayDkgEnrollmentInitArgs([
			'init', '--participant', '1', '--expected-host-pin-digest', held.digest, '--participant', '2',
		])).toThrow(/usage/)
	})
})
