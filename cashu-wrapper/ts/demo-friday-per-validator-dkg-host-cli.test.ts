import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, test } from 'bun:test'
import { x25519 } from '@noble/curves/ed25519.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoFridayDkgManifestDigest,
	demoFridayDkgRosterDigest,
	type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	createDemoFridayDkgEnrollmentAttestationV2,
	deriveDemoFridayDkgProvisionalV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
	DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA,
	DEMO_FRIDAY_DKG_ENROLLMENT_BUNDLE_SCHEMA,
	DEMO_FRIDAY_DKG_HOST_FAILURE_SCHEMA,
	DEMO_FRIDAY_DKG_HOST_LOCK_SCHEMA,
	executeDemoFridayPerValidatorDkgHostStage,
	recoverDemoFridayPerValidatorDkgHostLock,
	runDemoFridayPinnedChildClassifierFixture,
	type DemoFridayDkgHostFilesystemProfile,
} from './demo-friday-per-validator-dkg-host-cli'
import {
	DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
} from './demo-friday-per-validator-dkg-plan'

const IDS = [1, 2, 3, 4] as const
const dkgPrivate = IDS.map((id) => new Uint8Array(32).fill(id))
const signerPrivate = IDS.map((id) => new Uint8Array(32).fill(id + 10))
const kexPrivate = IDS.map((id) => new Uint8Array(32).fill(id + 20))
const coordinatorPrivate = new Uint8Array(32).fill(31)
const RUN_ID = 'friday-dkg-r12'

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

function fixtureManifest(participantBinary: Uint8Array, inspectorBinary: Uint8Array): DemoFridayDkgPublicManifestV1 {
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
		participantBinarySha256: hash(participantBinary), inspectorBinarySha256: hash(inspectorBinary),
		configPath: `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/participant.config.json`,
		stateDirectory: `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/state`,
	})) as unknown as DemoFridayDkgPublicManifestV1['participants']
	return {
		schema: 'PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1', valueProfile: 'FAKE_MONEY_ONLY',
		deploymentId: 'friday-v2-r12', applicationRunId: 'friday-auctions-r12', dkgRunId: RUN_ID,
		committeeKeysetId: 'friday-committee-v1', committeeKeysetVersion: '1', roster: IDS,
		rosterDigest: demoFridayDkgRosterDigest(participants), coordinatorParticipantId: 1,
		coordinatorIdentity: bytesToHex(schnorr.getPublicKey(coordinatorPrivate)), participants,
	}
}

interface Fixture {
	root: string
	profile: DemoFridayDkgHostFilesystemProfile
	manifest: DemoFridayDkgPublicManifestV1
	manifestDigest: string
	exchange: string
}

async function writeExact(path: string, value: string | Uint8Array, mode = 0o600): Promise<void> {
	await writeFile(path, value, { mode, flag: 'wx' })
	await chmod(path, mode)
}

async function setup(participantBinaryOverride?: Uint8Array): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), 'friday-per-validator-host-'))
	await chmod(root, 0o700)
	const participantBinary = participantBinaryOverride ?? utf8ToBytes('#!/bin/false\nfixture participant binary\n')
	const inspectorBinary = utf8ToBytes('#!/bin/false\nfixture inspector binary\n')
	const participantBinaryPath = join(root, 'participant-bin')
	const inspectorBinaryPath = join(root, 'inspector-bin')
	await writeExact(participantBinaryPath, participantBinary, 0o700)
	await writeExact(inspectorBinaryPath, inspectorBinary, 0o700)
	const manifest = fixtureManifest(participantBinary, inspectorBinary)
	const manifestDigest = demoFridayDkgManifestDigest(manifest)
	await writeExact(join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
	await writeExact(join(root, 'owner-approved-manifest-digest.txt'), `${manifestDigest}\n`)
	await writeExact(join(root, 'identity-signing-key.hex'), `${bytesToHex(dkgPrivate[0]!)}\n`)
	await writeExact(join(root, 'kex-private-key.hex'), `${bytesToHex(kexPrivate[0]!)}\n`)
	await writeExact(join(root, 'participant.config.json'), `${JSON.stringify({
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: RUN_ID,
		committee_keyset_id: manifest.committeeKeysetId,
		committee_keyset_version: manifest.committeeKeysetVersion,
		participant_id: 1, max_signers: 4, min_signers: 3, roster: IDS,
	})}\n`)
	return {
		root, manifest, manifestDigest, exchange: join(root, 'exchange', RUN_ID),
			profile: {
				filesystemRoot: root, participantBinary: participantBinaryPath, inspectorBinary: inspectorBinaryPath,
				trustedBinaryOwnerUid: process.geteuid!(), trustedBinaryParentRoot: root,
			},
	}
}

async function prepareTransport(fixture: Fixture): Promise<void> {
	await executeDemoFridayPerValidatorDkgHostStage({
		stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
	})
	const signed = IDS.map((participantId, index) => createDemoFridayDkgEnrollmentAttestationV2({
		manifest: fixture.manifest, expectedManifestDigest: fixture.manifestDigest, participantId,
		dkgIdentityPrivateKey: dkgPrivate[index]!,
	}))
	await writeExact(join(fixture.exchange, 'enrollments.bundle.json'), `${JSON.stringify({
		schema: DEMO_FRIDAY_DKG_ENROLLMENT_BUNDLE_SCHEMA, manifestDigest: fixture.manifestDigest, entries: signed,
	})}\n`)
	await executeDemoFridayPerValidatorDkgHostStage({
		stage: 'confirm-transport', participantId: 1, runId: RUN_ID, profile: fixture.profile,
	})
	const provisionals = IDS.map((participantId, index) => deriveDemoFridayDkgProvisionalV2({
		manifest: fixture.manifest, expectedManifestDigest: fixture.manifestDigest, enrollments: signed,
		participantId, dkgIdentityPrivateKey: dkgPrivate[index]!, kexPrivateKey: kexPrivate[index]!,
	}))
	const entries = provisionals.slice(1).map((provisional) =>
		provisional.confirmationsToSend.find((confirmation) => confirmation.recipientParticipantId === 1)!)
	await writeExact(join(fixture.exchange, 'participant-1.peer-confirmations.bundle.json'), `${JSON.stringify({
		schema: DEMO_FRIDAY_DKG_CONFIRMATION_BUNDLE_SCHEMA, manifestDigest: fixture.manifestDigest,
		participantId: 1, entries,
	})}\n`)
	await executeDemoFridayPerValidatorDkgHostStage({
		stage: 'persist-transport', participantId: 1, runId: RUN_ID, profile: fixture.profile,
	})
}

function localRound1(
	manifest: DemoFridayDkgPublicManifestV1,
	options: { domain?: string; hashRounds?: number } = {},
	participantId: typeof IDS[number] = 1,
) {
	const payload_hex = participantId.toString(16).padStart(2, '0').repeat(64)
	const message = rustFrame(options.domain ?? 'COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', [
		utf8ToBytes(DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION), utf8ToBytes(manifest.dkgRunId),
		utf8ToBytes(manifest.committeeKeysetId), utf8ToBytes(manifest.committeeKeysetVersion),
		Uint8Array.of(0, participantId), utf8ToBytes(payload_hex),
	])
	let signingMessage = message
	for (let index = 0; index < (options.hashRounds ?? 1); index += 1) signingMessage = sha256(signingMessage)
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: manifest.dkgRunId,
		committee_keyset_id: manifest.committeeKeysetId, committee_keyset_version: manifest.committeeKeysetVersion,
		sender: participantId, payload_hex,
		auth_signature_hex: bytesToHex(schnorr.sign(signingMessage, dkgPrivate[participantId - 1]!, new Uint8Array(32))),
	}
}

function localAgreement(
	manifest: DemoFridayDkgPublicManifestV1, round1Digest: string,
	options: { domain?: string; hashRounds?: number } = {},
) {
	const message = rustFrame(options.domain ?? 'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1', [
		utf8ToBytes(DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION), utf8ToBytes(manifest.dkgRunId),
		utf8ToBytes(manifest.committeeKeysetId), utf8ToBytes(manifest.committeeKeysetVersion),
		Uint8Array.of(0, 1), utf8ToBytes(round1Digest),
	])
	let signingMessage = message
	for (let index = 0; index < (options.hashRounds ?? 1); index += 1) signingMessage = sha256(signingMessage)
	return {
		version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, run_id: manifest.dkgRunId,
		committee_keyset_id: manifest.committeeKeysetId, committee_keyset_version: manifest.committeeKeysetVersion,
		participant_id: 1, round1_digest: round1Digest,
		auth_signature_hex: bytesToHex(schnorr.sign(signingMessage, dkgPrivate[0]!, new Uint8Array(32))),
	}
}

describe('per-validator DKG host CLI durability', () => {
	test('requires the externally provisioned pin and create-once 0600 local artifacts', async () => {
		const fixture = await setup()
		try {
			await chmod(join(fixture.root, 'owner-approved-manifest-digest.txt'), 0o644)
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
				})).rejects.toThrow('owned, single-link')
			await chmod(join(fixture.root, 'owner-approved-manifest-digest.txt'), 0o600)
			const first = await executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})
			expect(first.status).toBe('completed')
			const second = await executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})
			expect(second.status).toBe('already_completed')
			const enrollmentMode = (await Bun.file(join(fixture.exchange, 'participant-1.enrollment.json')).stat()).mode & 0o777
			expect(enrollmentMode).toBe(0o600)
			const identityPath = join(fixture.root, 'identity-signing-key.hex')
			const realIdentityPath = join(fixture.root, 'identity-signing-key.real')
			await writeExact(realIdentityPath, `${bytesToHex(dkgPrivate[0]!)}\n`)
			await unlink(identityPath); await symlink(realIdentityPath, identityPath)
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})).rejects.toThrow('without symlinks')
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('persists only exact confirmed local transport material and never writes the KEX secret', async () => {
		const fixture = await setup()
		try {
			await prepareTransport(fixture)
			const transportPath = join(fixture.root, 'transport-secrets.json')
			const encoded = await readFile(transportPath, 'utf8')
			const transport = JSON.parse(encoded) as { participant_id: number; round2_pairwise_keys: unknown[] }
			expect(transport.participant_id).toBe(1)
			expect(transport.round2_pairwise_keys).toHaveLength(3)
			expect(encoded).not.toContain(bytesToHex(kexPrivate[0]!))
			expect((await Bun.file(transportPath).stat()).mode & 0o777).toBe(0o600)
			const confirmations = await readFile(join(fixture.exchange, 'participant-1.confirmations.json'), 'utf8')
			expect(confirmations).not.toMatch(/identity_signing_key_hex|round2_pairwise_keys|key_hex/)
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('retains the exact lock after a child crash and refuses normal replay', async () => {
		const fixture = await setup()
		try {
			await prepareTransport(fixture)
			let commands = 0
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
				runCommand: async (command) => {
					commands += 1
					await writeExact(command[command.length - 1]!, `${JSON.stringify(localRound1(fixture.manifest))}\n`)
					throw new Error('synthetic crash after durable Rust output')
				},
			})).rejects.toThrow('synthetic crash')
			const lock = join(fixture.exchange, 'participant-1.host.lock')
			expect((await lstat(lock)).isDirectory()).toBe(true)
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
				runCommand: async () => { commands += 1; throw new Error('must not run') },
			})).rejects.toThrow('lock already exists or is stranded')
			expect(commands).toBe(1)
			const journal = await readFile(join(fixture.exchange, 'participant-1.host-journal.jsonl'), 'utf8')
			expect(journal).toContain('"status":"indeterminate"')
			const last = JSON.parse(journal.trim().split('\n').at(-1)!) as { stage: string; status: string }
			expect(last).toEqual(expect.objectContaining({ stage: 'round1', status: 'indeterminate' }))
			const failureText = await readFile(join(fixture.exchange, 'participant-1.round1.failure.json'), 'utf8')
			const failure = JSON.parse(failureText) as Record<string, unknown>
			expect(failure).toMatchObject({
				schema: DEMO_FRIDAY_DKG_HOST_FAILURE_SCHEMA, stage: 'round1',
				failurePhase: 'stage_action_unknown', failureClass: 'outcome_unavailable', childStarted: true,
			})
			expect(failureText).not.toContain('synthetic crash')
			await expect(recoverDemoFridayPerValidatorDkgHostLock({
				participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})).rejects.toThrow('still live')
			expect((await lstat(lock)).isDirectory()).toBe(true)
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('records a bounded child exit classification without retaining stderr', async () => {
		const sentinel = 'PRIVATE_DIAGNOSTIC_SENTINEL_MUST_NOT_PERSIST'
		const fixture = await setup(utf8ToBytes(`#!/bin/sh\nprintf '%s\\n' '${sentinel}' >&2\nexit 23\n`))
		try {
			await prepareTransport(fixture)
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})).rejects.toThrow('sanitized classification')
			const text = await readFile(join(fixture.exchange, 'participant-1.round1.failure.json'), 'utf8')
			expect(text).not.toContain(sentinel)
			expect(JSON.parse(text)).toMatchObject({
				schema: DEMO_FRIDAY_DKG_HOST_FAILURE_SCHEMA, stage: 'round1', failurePhase: 'child_process',
				failureClass: 'nonzero_exit', childStarted: true, exitCode: 23, signalCode: null,
				timedOut: false, stdoutBytes: 0, diagnosticClass: 'redacted_nonempty',
			})
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('classifies only a typed diagnostic-size overflow as diagnostic_overflow', async () => {
		const fixture = await setup(utf8ToBytes('#!/bin/sh\n/usr/bin/head -c 65537 /dev/zero >&2\n'))
		try {
			await prepareTransport(fixture)
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})).rejects.toThrow('sanitized classification')
			const failure = JSON.parse(await readFile(
				join(fixture.exchange, 'participant-1.round1.failure.json'), 'utf8',
			)) as Record<string, unknown>
			expect(failure).toMatchObject({
				failurePhase: 'child_process', failureClass: 'diagnostic_overflow', childStarted: true,
				stdoutBytes: null, stderrBytes: null, diagnosticClass: 'unavailable',
			})
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('classifies a non-overflow stream failure as outcome_unavailable and stops the child', async () => {
		let stops = 0
		const failed = new ReadableStream<Uint8Array<ArrayBuffer>>({
			start(controller) { controller.error(new Error('synthetic stream failure')) },
		})
		const empty = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.close() } })
		try {
			await runDemoFridayPinnedChildClassifierFixture({
				stdout: failed, stderr: empty, exited: Promise.resolve(0),
				kill: () => { stops += 1; return true }, exitCode: null, signalCode: null,
			})
			expect.unreachable()
		} catch (error) {
			expect((error as { sanitized?: { failureClass?: string } }).sanitized?.failureClass)
				.toBe('outcome_unavailable')
		}
		expect(stops).toBe(1)
	})

	test('rejects old, double-hashed, wrong-domain and mutated round-one contracts after child success', async () => {
		for (const mutation of ['old', 'double', 'domain', 'run', 'keyset', 'participant', 'payload'] as const) {
			const fixture = await setup()
			try {
				await prepareTransport(fixture)
				const envelope = localRound1(fixture.manifest, mutation === 'old' ? { hashRounds: 0 }
					: mutation === 'double' ? { hashRounds: 2 }
						: mutation === 'domain' ? { domain: 'COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1_MUTATED' } : {})
				if (mutation === 'run') envelope.run_id = 'mutated-run'
				if (mutation === 'keyset') envelope.committee_keyset_id = 'mutated-keyset'
				if (mutation === 'participant') envelope.sender = 2
				if (mutation === 'payload') envelope.payload_hex = `02${envelope.payload_hex.slice(2)}`
				await expect(executeDemoFridayPerValidatorDkgHostStage({
					stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
					runCommand: async (command) => writeExact(
						command[command.length - 1]!, `${JSON.stringify(envelope)}\n`,
					),
				})).rejects.toThrow()
				const failure = JSON.parse(await readFile(
					join(fixture.exchange, 'participant-1.round1.failure.json'), 'utf8',
				)) as Record<string, unknown>
				expect(failure).toMatchObject({
					failurePhase: 'post_spawn_verification', failureClass: 'post_spawn_rejected', exitCode: 0,
				})
			} finally { await rm(fixture.root, { recursive: true, force: true }) }
		}
	}, 20_000)

	test('rejects old, double-hashed, wrong-domain and mutated agreement contracts after child success', async () => {
		for (const mutation of ['old', 'double', 'domain', 'run', 'keyset', 'participant', 'transcript'] as const) {
			const fixture = await setup()
			try {
				await prepareTransport(fixture)
				const round1Entries = IDS.map((participantId) => localRound1(fixture.manifest, {}, participantId))
				await executeDemoFridayPerValidatorDkgHostStage({
					stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
					runCommand: async (command) => writeExact(
						command[command.length - 1]!, `${JSON.stringify(round1Entries[0])}\n`,
					),
				})
				await writeExact(join(fixture.exchange, 'round1.bundle.json'), `${JSON.stringify({
					version: DEMO_FRIDAY_PER_VALIDATOR_DKG_PARTICIPANT_VERSION, entries: round1Entries,
				})}\n`)
				const round1Digest = hash(JSON.stringify(round1Entries))
				const agreement = localAgreement(fixture.manifest, round1Digest,
					mutation === 'old' ? { hashRounds: 0 }
						: mutation === 'double' ? { hashRounds: 2 }
							: mutation === 'domain' ? { domain: 'COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1_MUTATED' } : {})
				if (mutation === 'run') agreement.run_id = 'mutated-run'
				if (mutation === 'keyset') agreement.committee_keyset_id = 'mutated-keyset'
				if (mutation === 'participant') agreement.participant_id = 2
				if (mutation === 'transcript') agreement.round1_digest = 'f'.repeat(64)
				await expect(executeDemoFridayPerValidatorDkgHostStage({
					stage: 'round1-agree', participantId: 1, runId: RUN_ID, profile: fixture.profile,
					runCommand: async (command) => writeExact(
						command[command.length - 1]!, `${JSON.stringify(agreement)}\n`,
					),
				})).rejects.toThrow()
				const failure = JSON.parse(await readFile(
					join(fixture.exchange, 'participant-1.round1-agree.failure.json'), 'utf8',
				)) as Record<string, unknown>
				expect(failure).toMatchObject({
					failurePhase: 'post_spawn_verification', failureClass: 'post_spawn_rejected', exitCode: 0,
				})
			} finally { await rm(fixture.root, { recursive: true, force: true }) }
		}
	}, 20_000)

	test('runs the exact pinned Rust round-one binary against disposable transport when explicitly selected', async () => {
		const exactPath = process.env.FRIDAY_R18_EXACT_PARTICIPANT_BINARY
		if (!exactPath) return
		const bytes = new Uint8Array(await readFile(exactPath))
		expect(hash(bytes)).toBe('ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578')
		const fixture = await setup(bytes)
		try {
			await prepareTransport(fixture)
			const result = await executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})
			expect(result.status).toBe('completed')
			expect((await lstat(join(fixture.root, 'state', 'dkg-round1.state'))).isFile()).toBe(true)
			const outputPath = join(fixture.exchange, 'participant-1.round1.json')
			expect((await lstat(outputPath)).isFile()).toBe(true)
			const captured = JSON.parse(await readFile(outputPath, 'utf8')) as ReturnType<typeof localRound1>
			const frame = rustFrame('COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1', [
				utf8ToBytes(captured.version), utf8ToBytes(captured.run_id),
				utf8ToBytes(captured.committee_keyset_id), utf8ToBytes(captured.committee_keyset_version),
				Uint8Array.of(0, captured.sender), utf8ToBytes(captured.payload_hex),
			])
			const publicKey = fixture.manifest.participants[0]!.dkgIdentity
			expect(schnorr.verify(hexToBytes(captured.auth_signature_hex), sha256(frame), hexToBytes(publicKey))).toBe(true)
			expect(schnorr.verify(hexToBytes(captured.auth_signature_hex), frame, hexToBytes(publicKey))).toBe(false)
			expect(schnorr.verify(hexToBytes(captured.auth_signature_hex), sha256(sha256(frame)), hexToBytes(publicKey))).toBe(false)
			await expect(lstat(join(fixture.exchange, 'participant-1.round1.failure.json'))).rejects.toMatchObject({ code: 'ENOENT' })
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('refuses a changed participant executable before spawning it', async () => {
		const fixture = await setup()
		try {
			await prepareTransport(fixture)
			await writeFile(fixture.profile.participantBinary, 'changed binary\n')
			await chmod(fixture.profile.participantBinary, 0o700)
			let commands = 0
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
				runCommand: async () => { commands += 1 },
			})).rejects.toThrow('hash differs from the enrolled manifest')
			expect(commands).toBe(0)
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('rechecks the executable identity immediately before spawn and rejects hard links', async () => {
		const fixture = await setup()
		try {
			await prepareTransport(fixture)
			const original = await readFile(fixture.profile.participantBinary)
			let commands = 0
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: fixture.profile,
				beforeSpawnRecheck: async () => {
					await unlink(fixture.profile.participantBinary)
					await writeExact(fixture.profile.participantBinary, original, 0o700)
				},
				runCommand: async () => { commands += 1 },
			})).rejects.toThrow('identity changed after verification and before spawn')
			expect(commands).toBe(0)
		} finally { await rm(fixture.root, { recursive: true, force: true }) }

		const linkedFixture = await setup()
		try {
			await prepareTransport(linkedFixture)
			await link(linkedFixture.profile.participantBinary, join(linkedFixture.root, 'participant-bin-hardlink'))
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'round1', participantId: 1, runId: RUN_ID, profile: linkedFixture.profile,
				runCommand: async () => { throw new Error('must not spawn') },
			})).rejects.toThrow('protected single-link executable')
		} finally { await rm(linkedFixture.root, { recursive: true, force: true }) }
	})

	test('snapshots public relay input as a single-link owned file', async () => {
		const fixture = await setup()
		try {
			await link(join(fixture.root, 'manifest.json'), join(fixture.root, 'manifest-hardlink.json'))
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})).rejects.toThrow('single-link')
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('explicitly recovers only dead-owner authenticated evidence and reconciles exact stranded links', async () => {
		const fixture = await setup()
		try {
			await executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})
			const deadPid = 2_147_483_647
			const lock = join(fixture.exchange, 'participant-1.host.lock')
			await mkdir(lock, { mode: 0o700 }); await chmod(lock, 0o700)
			const ownerPath = join(lock, 'owner.json')
			await writeExact(ownerPath, `${JSON.stringify({
				schema: DEMO_FRIDAY_DKG_HOST_LOCK_SCHEMA, pid: deadPid,
				bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), processStartTicks: '1',
				manifestDigest: fixture.manifestDigest, participantId: 1,
			})}\n`)
			await link(ownerPath, `${ownerPath}.tmp-${deadPid}`)
			const enrollmentPath = join(fixture.exchange, 'participant-1.enrollment.json')
			await link(enrollmentPath, `${enrollmentPath}.tmp-${deadPid}`)
			const result = await recoverDemoFridayPerValidatorDkgHostLock({
				participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})
			expect(result.status).toBe('lock_recovered')
			expect((await lstat(enrollmentPath)).nlink).toBe(1)
			await expect(lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('explicit recovery refuses a lock whose exact process identity is live', async () => {
		const fixture = await setup()
		try {
			await executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})
			const processStat = await readFile(`/proc/${process.pid}/stat`, 'utf8')
			const fields = processStat.slice(processStat.lastIndexOf(')') + 1).trim().split(/\s+/)
			const lock = join(fixture.exchange, 'participant-1.host.lock')
			await mkdir(lock, { mode: 0o700 }); await chmod(lock, 0o700)
			await writeExact(join(lock, 'owner.json'), `${JSON.stringify({
				schema: DEMO_FRIDAY_DKG_HOST_LOCK_SCHEMA, pid: process.pid,
				bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), processStartTicks: fields[19],
				manifestDigest: fixture.manifestDigest, participantId: 1,
			})}\n`)
			await expect(recoverDemoFridayPerValidatorDkgHostLock({
				participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})).rejects.toThrow('still live')
			expect((await lstat(lock)).isDirectory()).toBe(true)
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})

	test('refuses a stranded lock and never guesses that it is stale', async () => {
		const fixture = await setup()
		try {
			await mkdir(join(fixture.exchange), { recursive: true, mode: 0o700 }); await chmod(join(fixture.root, 'exchange'), 0o700)
			await chmod(fixture.exchange, 0o700)
			await mkdir(join(fixture.exchange, 'participant-1.host.lock'), { mode: 0o700 })
			await expect(executeDemoFridayPerValidatorDkgHostStage({
				stage: 'enroll', participantId: 1, runId: RUN_ID, profile: fixture.profile,
			})).rejects.toThrow('lock already exists or is stranded')
		} finally { await rm(fixture.root, { recursive: true, force: true }) }
	})
})
