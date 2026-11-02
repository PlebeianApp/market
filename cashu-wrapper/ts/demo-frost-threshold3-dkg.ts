import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

import type { DemoFipsDkgPhase, DemoFipsDkgPhaseJournal } from './demo-fips-dkg-phase-journal'
import { DEMO_FROST_THRESHOLD3_VERSION } from './demo-frost-threshold3-rust-participant-worker'

const PARTICIPANTS = [1, 2, 3, 4] as const

type ParticipantId = typeof PARTICIPANTS[number]

interface DkgEnvelopeBundle {
	version: typeof DEMO_FROST_THRESHOLD3_VERSION
	entries: unknown[]
}

export interface DemoThreshold3PublicInspection {
	version: 'COCO_DEMO_FROST_PUBLIC_INSPECTION_V1'
	run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	source_participant_id: ParticipantId
	public_key_package_sha256: string
	committee_public_key: string
	min_signers: 3
	max_signers: 4
	verifying_shares: Array<{ participant_id: ParticipantId; verifying_share_hex: string }>
}

export interface DemoThreshold3EphemeralKeyset {
	root: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	publicKeyPackagePath: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	committeePublicKey: string
	participants: Array<{
		participantId: ParticipantId
		configPath: string
		stateDirectory: string
		verifyingShare: string
	}>
}

export interface DemoThreshold3DkgOptions {
	root: string
	participantBinaryPath: string
	inspectorBinaryPath: string
	dkgRunId: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	commandTimeoutMs?: number
	phaseJournal?: Pick<DemoFipsDkgPhaseJournal, 'run'>
}

async function phase<T>(
	options: DemoThreshold3DkgOptions,
	stage: DemoFipsDkgPhase,
	action: () => Promise<T>,
): Promise<T> {
	return options.phaseJournal ? options.phaseJournal.run(stage, action) : action()
}

function secretHex(): string {
	for (;;) {
		const candidate = randomBytes(32)
		try {
			schnorr.getPublicKey(candidate)
			return candidate.toString('hex')
		} catch {
			// Negligible invalid-scalar case. Generate a fresh candidate.
		}
	}
}

async function privateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
	await chmod(path, 0o600)
}

async function publicJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
	await chmod(path, 0o600)
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

async function runBounded(command: string[], timeoutMs: number): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	let timedOut = false
	const timeout = setTimeout(() => {
		timedOut = true
		child.kill()
	}, timeoutMs)
	try {
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
		if (timedOut) throw new Error(`DEMO_FROST_DKG_TIMEOUT: command exceeded ${timeoutMs}ms`)
		if (exitCode !== 0) throw new Error(`DEMO_FROST_DKG_COMMAND: command exited ${exitCode}: ${stderr.trim() || 'no diagnostic'}`)
	} finally {
		clearTimeout(timeout)
	}
}

function exactInspection(value: DemoThreshold3PublicInspection): DemoThreshold3PublicInspection {
	if (value.version !== 'COCO_DEMO_FROST_PUBLIC_INSPECTION_V1'
		|| !/^[0-9a-f]{64}$/.test(value.public_key_package_sha256)
		|| !/^02[0-9a-f]{64}$/.test(value.committee_public_key)
		|| value.min_signers !== 3 || value.max_signers !== 4
		|| value.verifying_shares.length !== 4
		|| new Set(value.verifying_shares.map((entry) => entry.participant_id)).size !== 4
		|| new Set(value.verifying_shares.map((entry) => entry.verifying_share_hex)).size !== 4
		|| value.verifying_shares.some((entry) => !/^(?:02|03)[0-9a-f]{64}$/.test(entry.verifying_share_hex))) {
		throw new Error('DEMO_FROST_DKG_PUBLIC: malformed 3-of-4 public inspection')
	}
	return value
}

export function demoThreshold3SignerRosterDigest(value: DemoThreshold3PublicInspection): string {
	const inspection = exactInspection(structuredClone(value))
	return createHash('sha256').update(JSON.stringify([
		'COCO_DEMO_FROST_SIGNER_ROSTER_V1', inspection.run_id, inspection.committee_keyset_id,
		inspection.committee_keyset_version, inspection.public_key_package_sha256,
		inspection.committee_public_key, inspection.min_signers, inspection.max_signers,
		[...inspection.verifying_shares].sort((left, right) => left.participant_id - right.participant_id),
	])).digest('hex')
}

/**
 * Run one fresh, throwaway four-party DKG using the pinned Rust participant.
 * The returned state directories contain private shares and must be deleted by
 * the caller. Nothing is written outside `root`.
 */
export async function provisionEphemeralDemoThreshold3(
	options: DemoThreshold3DkgOptions,
): Promise<DemoThreshold3EphemeralKeyset> {
	if (!options.root.startsWith('/tmp/') || options.root.includes('..')) {
		throw new Error('DEMO_FROST_DKG_ROOT: ephemeral DKG root must be a dedicated /tmp path')
	}
	const timeoutMs = options.commandTimeoutMs ?? 30_000
	await phase(options, 'dkg_root_creation', async () => {
		await mkdir(options.root, { recursive: false, mode: 0o700 })
		await chmod(options.root, 0o700)
	})

	const identitySecrets = new Map<ParticipantId, string>()
	const identityPublic = new Map<ParticipantId, string>()
	const pairwise = new Map<string, string>()

	const paths = PARTICIPANTS.map((participantId) => ({
		participantId,
		configPath: join(options.root, `participant-${participantId}.config.json`),
		transportPath: join(options.root, `participant-${participantId}.transport.json`),
		stateDirectory: join(options.root, `participant-${participantId}.state`),
		round1Path: join(options.root, `participant-${participantId}.round1.json`),
		agreementPath: join(options.root, `participant-${participantId}.agreement.json`),
		round2Directory: join(options.root, `participant-${participantId}.round2-out`),
		finalPath: join(options.root, `participant-${participantId}.public.json`),
	}))

	await phase(options, 'dkg_identity_material', async () => {
		for (const participantId of PARTICIPANTS) {
			const secret = secretHex()
			identitySecrets.set(participantId, secret)
			identityPublic.set(participantId, Buffer.from(schnorr.getPublicKey(hexToBytes(secret))).toString('hex'))
		}
		for (let left = 1; left <= 4; left += 1) {
			for (let right = left + 1; right <= 4; right += 1) {
				pairwise.set(`${left}:${right}`, randomBytes(32).toString('hex'))
			}
		}
		for (const path of paths) {
			await mkdir(path.stateDirectory, { mode: 0o700 })
			await chmod(path.stateDirectory, 0o700)
			const binding = {
				version: DEMO_FROST_THRESHOLD3_VERSION,
				run_id: options.dkgRunId,
				committee_keyset_id: options.committeeKeysetId,
				committee_keyset_version: options.committeeKeysetVersion,
				participant_id: path.participantId,
			}
			await publicJson(path.configPath, { ...binding, max_signers: 4, min_signers: 3, roster: PARTICIPANTS })
			await privateJson(path.transportPath, {
				...binding,
				identity_signing_key_hex: identitySecrets.get(path.participantId),
				identity_verifying_keys: PARTICIPANTS.map((participantId) => ({
					participant_id: participantId,
					verifying_key_hex: identityPublic.get(participantId),
				})),
				round2_pairwise_keys: PARTICIPANTS.filter((peerId) => peerId !== path.participantId).map((peerId) => ({
					peer_id: peerId,
					key_hex: pairwise.get(`${Math.min(peerId, path.participantId)}:${Math.max(peerId, path.participantId)}`),
				})),
			})
		}
	})

	const round1BundlePath = join(options.root, 'round1.bundle.json')
	await phase(options, 'dkg_round1', async () => {
		for (const path of paths) {
			await runBounded([
				options.participantBinaryPath, 'dkg-round1', path.configPath, path.stateDirectory,
				path.transportPath, path.round1Path,
			], timeoutMs)
		}
		await publicJson(round1BundlePath, {
			version: DEMO_FROST_THRESHOLD3_VERSION,
			entries: await Promise.all(paths.map((path) => readJson(path.round1Path))),
		} satisfies DkgEnvelopeBundle)
	})

	const agreementBundlePath = join(options.root, 'agreement.bundle.json')
	await phase(options, 'dkg_agreement', async () => {
		for (const path of paths) {
			await runBounded([
				options.participantBinaryPath, 'dkg-round1-agree', path.configPath, path.stateDirectory,
				path.transportPath, round1BundlePath, path.agreementPath,
			], timeoutMs)
		}
		await publicJson(agreementBundlePath, {
			version: DEMO_FROST_THRESHOLD3_VERSION,
			entries: await Promise.all(paths.map((path) => readJson(path.agreementPath))),
		} satisfies DkgEnvelopeBundle)
	})

	await phase(options, 'dkg_round2', async () => {
		for (const path of paths) {
			await runBounded([
				options.participantBinaryPath, 'dkg-round2', path.configPath, path.stateDirectory,
				path.transportPath, round1BundlePath, agreementBundlePath, path.round2Directory,
			], timeoutMs)
		}
	})

	await phase(options, 'dkg_finalize', async () => {
		for (const recipient of paths) {
			const bundlePath = join(options.root, `participant-${recipient.participantId}.round2.bundle.json`)
			await privateJson(bundlePath, {
				version: DEMO_FROST_THRESHOLD3_VERSION,
				entries: await Promise.all(paths
					.filter((sender) => sender.participantId !== recipient.participantId)
					.map((sender) => readJson(join(sender.round2Directory, `to-${recipient.participantId}.private.json`)))),
			} satisfies DkgEnvelopeBundle)
			await runBounded([
				options.participantBinaryPath, 'dkg-finalize', recipient.configPath, recipient.stateDirectory,
				recipient.transportPath, round1BundlePath, agreementBundlePath, bundlePath, recipient.finalPath,
			], timeoutMs)
		}
	})

	const publicPackages = await phase(options, 'dkg_public_validation', async () => {
		const values = await Promise.all(paths.map((path) => readJson<{
			version: string
			run_id: string
			committee_keyset_id: string
			committee_keyset_version: string
			participant_id: number
			public_key_package_hex: string
			public_key_package_sha256: string
		}>(path.finalPath)))
		if (values.some((value, index) => value.version !== DEMO_FROST_THRESHOLD3_VERSION
			|| value.run_id !== options.dkgRunId || value.committee_keyset_id !== options.committeeKeysetId
			|| value.committee_keyset_version !== options.committeeKeysetVersion
			|| value.participant_id !== paths[index]!.participantId
			|| !/^[0-9a-f]+$/.test(value.public_key_package_hex) || value.public_key_package_hex.length % 2 !== 0
			|| createHash('sha256').update(Buffer.from(value.public_key_package_hex, 'hex')).digest('hex') !== value.public_key_package_sha256)
			|| new Set(values.map((value) => value.public_key_package_sha256)).size !== 1
			|| new Set(values.map((value) => value.public_key_package_hex)).size !== 1) {
			throw new Error('DEMO_FROST_DKG_AGREEMENT: participant bindings or public-package agreement are invalid')
		}
		return values
	})
	const inspectionPath = join(options.root, 'public.inspection.json')
	const inspection = await phase(options, 'dkg_public_inspection', async () => {
		await runBounded([options.inspectorBinaryPath, paths[0]!.finalPath, inspectionPath], timeoutMs)
		const value = exactInspection(await readJson<DemoThreshold3PublicInspection>(inspectionPath))
		if (value.run_id !== options.dkgRunId
			|| value.committee_keyset_id !== options.committeeKeysetId
			|| value.committee_keyset_version !== options.committeeKeysetVersion
			|| value.source_participant_id !== paths[0]!.participantId
			|| value.public_key_package_sha256 !== publicPackages[0]!.public_key_package_sha256) {
			throw new Error('DEMO_FROST_DKG_PUBLIC: inspection binding mismatch')
		}
		return value
	})
	return {
		root: options.root,
		dkgRunId: options.dkgRunId,
		committeeKeysetId: options.committeeKeysetId,
		committeeKeysetVersion: options.committeeKeysetVersion,
		publicKeyPackagePath: paths[0]!.finalPath,
		publicKeyPackageSha256: inspection.public_key_package_sha256,
		signerRosterDigest: demoThreshold3SignerRosterDigest(inspection),
		committeePublicKey: inspection.committee_public_key,
		participants: paths.map((path) => ({
			participantId: path.participantId,
			configPath: path.configPath,
			stateDirectory: path.stateDirectory,
			verifyingShare: inspection.verifying_shares.find((share) => share.participant_id === path.participantId)!.verifying_share_hex,
		})),
	}
}
