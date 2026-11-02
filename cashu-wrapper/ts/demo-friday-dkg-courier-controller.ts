#!/usr/bin/env bun
/**
 * Local public/ciphertext-only courier controller for the R18 DKG ceremony.
 *
 * The production CLI has no caller-selected path. It owns one absolute local
 * root, one pinned relay executable and one read-only manifest/digest pair.
 * Host commands are deliberately out of process: an operator must durably
 * claim one invocation here before running it, then feed its bounded stdout
 * and public/ciphertext artifact back on stdin. A second claim is refused.
 */
import { chmod, lstat, mkdir, open, readFile, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { demoFridayDkgManifestDigest, type DemoFridayDkgPublicManifestV1 } from './demo-friday-per-validator-dkg-bootstrap'
import { verifyDemoFridayDkgAuthenticatedHostReceiptV2 } from './demo-friday-dkg-host-receipt'

const IDS = [1, 2, 3, 4] as const
type ParticipantId = typeof IDS[number]
const STAGES = [
	'enroll', 'confirm-transport', 'persist-transport', 'round1', 'round1-agree',
	'round2', 'finalize', 'inspect', 'attest',
] as const
type Stage = typeof STAGES[number]
const PHASES = ['enrollment', 'confirmations', 'persist-transport', 'round1', 'agreement', 'round2', 'final'] as const
type Phase = typeof PHASES[number]

const HEX_32 = /^[0-9a-f]{64}$/
const MAX_INPUT_BYTES = 4 * 1024 * 1024
export const FRIDAY_R18_COURIER_ROOT =
	'/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/.operator/friday-r18-dkg-ceremony' as const
export const FRIDAY_R18_RELAY =
	'/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/live-bin-friday-candidate-r18/plebeian-friday-dkg-relay' as const
export const FRIDAY_R18_MANIFEST =
	'/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/deploy/friday/dkg-ceremony-r18/manifest.json' as const
export const FRIDAY_R18_MANIFEST_PIN =
	'/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/deploy/friday/dkg-ceremony-r18/owner-approved-manifest-digest.txt' as const
export const FRIDAY_R18_MANIFEST_DIGEST =
	'5c91cffa47f0cc90412472b7401b42f02a3416c68a70099357c2cf4cd6f87a87' as const
export const FRIDAY_R18_RELAY_SHA256 =
	'7bc6df270bc7f7be626503994831d3250e4c6072962f5e9c58f24ebfdbcf6f3b' as const

export interface FridayR18CourierProfile {
	root: string
	manifestPath: string
	manifestPinPath: string
	relayPath: string
	relaySha256: string
	expectedManifestDigest: string
	expectedUid: number
	expectedGid: number
}

type RelayExecutor = (request: unknown) => Promise<unknown>

function fail(message: string): never {
	throw new Error(`FRIDAY_R18_DKG_COURIER: ${message}`)
}

function canonicalAbsolute(path: string, label: string): string {
	if (!path.startsWith('/') || path === '/' || path.endsWith('/') || path.includes('//') || resolve(path) !== path) {
		fail(`${label} must be a canonical dedicated absolute path`)
	}
	return path
}

function productionProfile(): FridayR18CourierProfile {
	return {
		root: FRIDAY_R18_COURIER_ROOT,
		manifestPath: FRIDAY_R18_MANIFEST,
		manifestPinPath: FRIDAY_R18_MANIFEST_PIN,
		relayPath: FRIDAY_R18_RELAY,
		relaySha256: FRIDAY_R18_RELAY_SHA256,
		expectedManifestDigest: FRIDAY_R18_MANIFEST_DIGEST,
		expectedUid: 1000,
		expectedGid: 1000,
	}
}

function digest(bytes: Uint8Array | string): string {
	return bytesToHex(sha256(typeof bytes === 'string' ? utf8ToBytes(bytes) : bytes))
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, 'r')
	try { await handle.sync() } finally { await handle.close() }
}

async function exactProtectedFile(path: string, profile: FridayR18CourierProfile, executable = false): Promise<Uint8Array> {
	canonicalAbsolute(path, 'protected file')
	const metadata = await lstat(path)
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== profile.expectedUid
		|| metadata.gid !== profile.expectedGid || await realpath(path) !== path
		|| executable && (metadata.mode & 0o111) === 0
		|| (metadata.mode & 0o022) !== 0) fail('protected file identity, ownership or mode is invalid')
	return new Uint8Array(await readFile(path))
}

async function createDirectory(path: string, profile: FridayR18CourierProfile): Promise<void> {
	await mkdir(path, { mode: 0o700 })
	await chmod(path, 0o700)
	const metadata = await lstat(path)
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== profile.expectedUid
		|| metadata.gid !== profile.expectedGid || (metadata.mode & 0o777) !== 0o700 || await realpath(path) !== path) {
		fail('courier directory identity is invalid')
	}
	await syncDirectory(dirname(path))
}

async function ensureDirectory(path: string, profile: FridayR18CourierProfile): Promise<void> {
	try { await createDirectory(path, profile) } catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
		const metadata = await lstat(path)
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== profile.expectedUid
			|| metadata.gid !== profile.expectedGid || (metadata.mode & 0o777) !== 0o700 || await realpath(path) !== path) {
			fail('existing courier directory identity is invalid')
		}
	}
}

async function createFile(path: string, bytes: Uint8Array | string, mode = 0o600): Promise<void> {
	const handle = await open(path, 'wx', mode)
	try {
		await handle.writeFile(bytes)
		await handle.sync()
	} finally { await handle.close() }
	await chmod(path, mode)
	await syncDirectory(dirname(path))
}

async function exactCourierFile(path: string, profile: FridayR18CourierProfile): Promise<Uint8Array> {
	const metadata = await lstat(path)
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
		|| metadata.uid !== profile.expectedUid || metadata.gid !== profile.expectedGid
		|| (metadata.mode & 0o777) !== 0o600 || await realpath(path) !== path || metadata.size > MAX_INPUT_BYTES) {
		fail('courier file identity, mode or size is invalid')
	}
	return new Uint8Array(await readFile(path))
}

function exactParticipant(value: number): ParticipantId {
	if (!IDS.includes(value as ParticipantId)) fail('participant must be 1..4')
	return value as ParticipantId
}

function exactStage(value: string): Stage {
	if (!STAGES.includes(value as Stage)) fail('stage is unsupported')
	return value as Stage
}

function exactPhase(value: string): Phase {
	if (!PHASES.includes(value as Phase)) fail('phase is unsupported')
	return value as Phase
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
	catch { fail(`${label} is not valid UTF-8 JSON`) }
}

async function readManifest(profile: FridayR18CourierProfile): Promise<DemoFridayDkgPublicManifestV1> {
	const bytes = await exactProtectedFile(profile.manifestPath, profile)
	const pinBytes = await exactProtectedFile(profile.manifestPinPath, profile)
	const pin = new TextDecoder().decode(pinBytes)
	if (pin !== `${profile.expectedManifestDigest}\n`) fail('manifest digest pin differs')
	const manifest = parseJson(bytes, 'manifest') as DemoFridayDkgPublicManifestV1
	if (demoFridayDkgManifestDigest(manifest) !== profile.expectedManifestDigest) fail('manifest canonical digest differs')
	return manifest
}

function claimPath(profile: FridayR18CourierProfile, stage: Stage, participant: ParticipantId): string {
	return join(profile.root, 'claims', stage, `participant-${participant}.json`)
}

function receiptPath(profile: FridayR18CourierProfile, stage: Stage, participant: ParticipantId): string {
	return join(profile.root, 'host-receipts', stage, `participant-${participant}.json`)
}

function artifactPath(
	profile: FridayR18CourierProfile, stage: Stage, participant: ParticipantId, recipient?: ParticipantId,
): string {
	const base = join(profile.root, 'inputs', stage)
	if (stage === 'round2') {
		if (!recipient || participant === recipient) fail('round2 artifact requires a distinct recipient')
		return join(base, `participant-${participant}-to-${recipient}.private.json`)
	}
	if (recipient) fail('recipient is valid only for round2')
	const names: Partial<Record<Stage, string>> = {
		enroll: `participant-${participant}.enrollment.json`,
		'confirm-transport': `participant-${participant}.confirmations.json`,
		round1: `participant-${participant}.round1.json`,
		'round1-agree': `participant-${participant}.agreement.json`,
		finalize: `participant-${participant}.public.json`,
		inspect: `participant-${participant}.inspection.json`,
		attest: `participant-${participant}.final-attestation.json`,
	}
	const name = names[stage]
	if (!name) fail(`${stage} has no courier artifact`)
	return join(base, name)
}

function outputPath(profile: FridayR18CourierProfile, name: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) fail('output name is invalid')
	return join(profile.root, 'outputs', name)
}

async function writeHashReceipt(profile: FridayR18CourierProfile, path: string, bytes: Uint8Array): Promise<void> {
	const rel = relative(profile.root, path)
	if (rel.startsWith('../') || rel === '..') fail('receipt target escapes courier root')
	const name = rel.replaceAll('/', '__')
	await createFile(join(profile.root, 'file-receipts', `${name}.json`), `${JSON.stringify({
		schema: 'PLEBEIAN_FRIDAY_R18_COURIER_FILE_RECEIPT_V1',
		path: rel,
		sha256: digest(bytes),
		size: bytes.byteLength,
		manifestDigest: profile.expectedManifestDigest,
	})}\n`)
}

async function createCourierFileWithReceipt(
	profile: FridayR18CourierProfile, path: string, bytes: Uint8Array | string,
): Promise<void> {
	const value = typeof bytes === 'string' ? utf8ToBytes(bytes) : bytes
	await createFile(path, value)
	await writeHashReceipt(profile, path, value)
}

async function requireExists(path: string, profile: FridayR18CourierProfile): Promise<void> {
	await exactCourierFile(path, profile)
}

async function requireAllReceipts(profile: FridayR18CourierProfile, stage: Stage): Promise<void> {
	for (const participant of IDS) await requireExists(receiptPath(profile, stage, participant), profile)
}

async function requireAllArtifacts(profile: FridayR18CourierProfile, stage: Stage): Promise<void> {
	for (const participant of IDS) {
		if (stage === 'round2') {
			for (const recipient of IDS) if (recipient !== participant) {
				await requireExists(artifactPath(profile, stage, participant, recipient), profile)
			}
		} else await requireExists(artifactPath(profile, stage, participant), profile)
	}
}

async function requireBarrierForStage(profile: FridayR18CourierProfile, stage: Stage): Promise<void> {
	if (stage === 'inspect') {
		await requireAllReceipts(profile, 'finalize'); await requireAllArtifacts(profile, 'finalize'); return
	}
	if (stage === 'attest') {
		await requireAllReceipts(profile, 'inspect'); await requireAllArtifacts(profile, 'inspect'); return
	}
	const prerequisite: Partial<Record<Stage, string>> = {
		'confirm-transport': 'enrollments.bundle.json',
		'persist-transport': 'confirmations.complete.json',
		round1: 'persist-transport.complete.json',
		'round1-agree': 'round1.bundle.json',
		round2: 'agreement.bundle.json',
		finalize: 'round2.complete.json',
	}
	const name = prerequisite[stage]
	if (name) await requireExists(outputPath(profile, name), profile)
}

async function boundedStdin(): Promise<Uint8Array> {
	const reader = Bun.stdin.stream().getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	for (;;) {
		const next = await reader.read()
		if (next.done) break
		total += next.value.byteLength
		if (total > MAX_INPUT_BYTES) fail('stdin exceeds courier bound')
		chunks.push(next.value)
	}
	if (total === 0) fail('stdin is empty')
	const result = new Uint8Array(total); let offset = 0
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
	return result
}

async function defaultRelayExecutor(profile: FridayR18CourierProfile, request: unknown): Promise<unknown> {
	const relayBytes = await exactProtectedFile(profile.relayPath, profile, true)
	if (digest(relayBytes) !== profile.relaySha256) fail('relay executable hash differs')
	const child = Bun.spawn([profile.relayPath], {
		stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
		env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC' },
	})
	child.stdin.write(`${JSON.stringify(request)}\n`); child.stdin.end()
	const timer = setTimeout(() => { try { child.kill(9) } catch { /* exited */ } }, 30_000)
	try {
		const [status, stdout, stderr] = await Promise.all([
			child.exited, new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(),
		])
		const bytes = new Uint8Array(stdout)
		if (status !== 0 || stderr !== '' || bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) {
			fail('pinned relay failed, emitted diagnostics or exceeded output bound')
		}
		return parseJson(bytes, 'relay output')
	} finally { clearTimeout(timer) }
}

export async function initializeFridayR18Courier(profile: FridayR18CourierProfile): Promise<void> {
	canonicalAbsolute(profile.root, 'courier root')
	if (process.geteuid?.() !== profile.expectedUid || process.getegid?.() !== profile.expectedGid) {
		fail('courier must run as the fixed existing operator account')
	}
	const manifest = await readManifest(profile)
	const relay = await exactProtectedFile(profile.relayPath, profile, true)
	if (digest(relay) !== profile.relaySha256) fail('relay executable hash differs')
	await ensureDirectory(dirname(profile.root), profile)
	await createDirectory(profile.root, profile)
	for (const name of ['claims', 'host-receipts', 'inputs', 'outputs', 'file-receipts']) {
		await createDirectory(join(profile.root, name), profile)
	}
	for (const stage of STAGES) {
		await createDirectory(join(profile.root, 'claims', stage), profile)
		await createDirectory(join(profile.root, 'host-receipts', stage), profile)
		if (stage !== 'persist-transport') await createDirectory(join(profile.root, 'inputs', stage), profile)
	}
	await createCourierFileWithReceipt(profile, join(profile.root, 'manifest.snapshot.json'), `${JSON.stringify(manifest)}\n`)
	await createCourierFileWithReceipt(profile, join(profile.root, 'manifest-digest.snapshot.txt'), `${profile.expectedManifestDigest}\n`)
	await createCourierFileWithReceipt(profile, join(profile.root, 'controller-init.json'), `${JSON.stringify({
		schema: 'PLEBEIAN_FRIDAY_R18_COURIER_INIT_V1',
		uid: profile.expectedUid, gid: profile.expectedGid, relayPath: profile.relayPath,
		relaySha256: profile.relaySha256, manifestDigest: profile.expectedManifestDigest,
	})}\n`)
}

async function loadInitialized(profile: FridayR18CourierProfile): Promise<DemoFridayDkgPublicManifestV1> {
	if (process.geteuid?.() !== profile.expectedUid || process.getegid?.() !== profile.expectedGid) {
		fail('courier must run as the fixed existing operator account')
	}
	await requireExists(join(profile.root, 'controller-init.json'), profile)
	const current = await readManifest(profile)
	const snapshot = parseJson(await exactCourierFile(join(profile.root, 'manifest.snapshot.json'), profile), 'manifest snapshot')
	if (JSON.stringify(snapshot) !== JSON.stringify(current)) fail('read-only manifest changed after courier initialization')
	return current
}

export async function claimFridayR18HostStage(
	profile: FridayR18CourierProfile, stageValue: string, participantValue: number,
): Promise<void> {
	await loadInitialized(profile)
	const stage = exactStage(stageValue); const participant = exactParticipant(participantValue)
	await requireBarrierForStage(profile, stage)
	await createCourierFileWithReceipt(profile, claimPath(profile, stage, participant), `${JSON.stringify({
		schema: 'PLEBEIAN_FRIDAY_R18_HOST_STAGE_CLAIM_V1', stage, participant,
		manifestDigest: profile.expectedManifestDigest,
	})}\n`)
}

export async function captureFridayR18HostReceipt(
	profile: FridayR18CourierProfile, stageValue: string, participantValue: number, bytes: Uint8Array,
): Promise<void> {
	const manifest = await loadInitialized(profile)
	const stage = exactStage(stageValue); const participant = exactParticipant(participantValue)
	await requireExists(claimPath(profile, stage, participant), profile)
	verifyDemoFridayDkgAuthenticatedHostReceiptV2({
		receipt: parseJson(bytes, 'host stage receipt'), manifest,
		expectedManifestDigest: profile.expectedManifestDigest,
		expectedParticipantId: participant, expectedStage: stage, expectedStatus: 'completed',
	})
	await createCourierFileWithReceipt(profile, receiptPath(profile, stage, participant), bytes)
}

export async function captureFridayR18Artifact(
	profile: FridayR18CourierProfile, stageValue: string, participantValue: number,
	bytes: Uint8Array, recipientValue?: number,
): Promise<void> {
	await loadInitialized(profile)
	const stage = exactStage(stageValue); const participant = exactParticipant(participantValue)
	const recipient = recipientValue === undefined ? undefined : exactParticipant(recipientValue)
	await requireExists(receiptPath(profile, stage, participant), profile)
	parseJson(bytes, 'host courier artifact')
	await createCourierFileWithReceipt(profile, artifactPath(profile, stage, participant, recipient), bytes)
}

async function storeOutput(profile: FridayR18CourierProfile, name: string, value: unknown): Promise<void> {
	await createCourierFileWithReceipt(profile, outputPath(profile, name), `${JSON.stringify(value)}\n`)
}

function relayRequest(profile: FridayR18CourierProfile, action: string, manifest: DemoFridayDkgPublicManifestV1): Record<string, unknown> {
	return {
		schema: 'PLEBEIAN_FRIDAY_DKG_PUBLIC_RELAY_REQUEST_V1', action, manifest,
		expectedManifestDigest: profile.expectedManifestDigest,
	}
}

async function readArtifacts(profile: FridayR18CourierProfile, stage: Stage): Promise<unknown[]> {
	const result: unknown[] = []
	for (const participant of IDS) {
		result.push(parseJson(await exactCourierFile(artifactPath(profile, stage, participant), profile), `${stage} artifact`))
	}
	return result
}

export async function assembleFridayR18Phase(
	profile: FridayR18CourierProfile, phaseValue: string, executeRelay?: RelayExecutor,
): Promise<void> {
	const manifest = await loadInitialized(profile); const phase = exactPhase(phaseValue)
	const relay = executeRelay ?? ((request: unknown) => defaultRelayExecutor(profile, request))
	if (phase === 'enrollment') {
		await requireAllReceipts(profile, 'enroll'); await requireAllArtifacts(profile, 'enroll')
		const result = await relay({ ...relayRequest(profile, 'enrollment_bundle', manifest), entries: await readArtifacts(profile, 'enroll') })
		await storeOutput(profile, 'enrollments.bundle.json', result); return
	}
	if (phase === 'confirmations') {
		await requireAllReceipts(profile, 'confirm-transport'); await requireAllArtifacts(profile, 'confirm-transport')
		const result = await relay({
			...relayRequest(profile, 'route_confirmations', manifest),
			sourceBundles: await readArtifacts(profile, 'confirm-transport'),
		})
		if (!Array.isArray(result) || result.length !== 4) fail('confirmation relay did not return four bundles')
		await storeOutput(profile, 'confirmations.routed.json', result)
		for (const participant of IDS) await storeOutput(profile, `participant-${participant}.peer-confirmations.bundle.json`, result[participant - 1])
		await storeOutput(profile, 'confirmations.complete.json', { phase, manifestDigest: profile.expectedManifestDigest }); return
	}
	if (phase === 'persist-transport') {
		await requireAllReceipts(profile, 'persist-transport')
		await storeOutput(profile, 'persist-transport.complete.json', { phase, manifestDigest: profile.expectedManifestDigest }); return
	}
	if (phase === 'round1') {
		await requireAllReceipts(profile, 'round1'); await requireAllArtifacts(profile, 'round1')
		const result = await relay({ ...relayRequest(profile, 'round1_bundle', manifest), entries: await readArtifacts(profile, 'round1') })
		await storeOutput(profile, 'round1.bundle.json', result); return
	}
	if (phase === 'agreement') {
		await requireAllReceipts(profile, 'round1-agree'); await requireAllArtifacts(profile, 'round1-agree')
		const result = await relay({ ...relayRequest(profile, 'agreement_bundle', manifest), entries: await readArtifacts(profile, 'round1-agree') })
		await storeOutput(profile, 'agreement.bundle.json', result); return
	}
	if (phase === 'round2') {
		await requireAllReceipts(profile, 'round2'); await requireAllArtifacts(profile, 'round2')
		const agreement = parseJson(await exactCourierFile(outputPath(profile, 'agreement.bundle.json'), profile), 'agreement bundle') as { entries?: Array<{ round1_digest?: unknown }> }
		const transcript = agreement.entries?.[0]?.round1_digest
		if (typeof transcript !== 'string' || !HEX_32.test(transcript)) fail('agreement transcript digest is invalid')
		for (const recipient of IDS) {
			const envelopes: unknown[] = []
			for (const sender of IDS) if (sender !== recipient) {
				envelopes.push(parseJson(await exactCourierFile(artifactPath(profile, 'round2', sender, recipient), profile), 'round2 envelope'))
			}
			const result = await relay({
				...relayRequest(profile, 'round2_bundle', manifest), recipientParticipantId: recipient,
				round1TranscriptDigest: transcript, envelopes,
			})
			await storeOutput(profile, `participant-${recipient}.round2.bundle.json`, result)
		}
		await storeOutput(profile, 'round2.complete.json', { phase, manifestDigest: profile.expectedManifestDigest }); return
	}
	await requireAllReceipts(profile, 'finalize'); await requireAllArtifacts(profile, 'finalize')
	await requireAllReceipts(profile, 'inspect'); await requireAllArtifacts(profile, 'inspect')
	await requireAllReceipts(profile, 'attest'); await requireAllArtifacts(profile, 'attest')
	const enrollmentsBundle = parseJson(await exactCourierFile(outputPath(profile, 'enrollments.bundle.json'), profile), 'enrollment bundle') as { entries?: unknown[] }
	const checkpoint = {
		expectedManifestDigest: profile.expectedManifestDigest, manifest,
		enrollments: enrollmentsBundle.entries,
		round1Bundle: parseJson(await exactCourierFile(outputPath(profile, 'round1.bundle.json'), profile), 'round1 bundle'),
		agreementBundle: parseJson(await exactCourierFile(outputPath(profile, 'agreement.bundle.json'), profile), 'agreement bundle'),
		finalPublicPackages: await readArtifacts(profile, 'finalize'),
		publicInspections: await readArtifacts(profile, 'inspect'),
		finalAttestations: await readArtifacts(profile, 'attest'),
	}
	const result = await relay({ schema: 'PLEBEIAN_FRIDAY_DKG_PUBLIC_RELAY_REQUEST_V1', action: 'compose_authenticated_result', checkpoint })
	await storeOutput(profile, 'authenticated-dkg-result-v2.json', result)
}

function exactArgs(argv: string[]): { command: string; stageOrPhase?: string; participant?: number; recipient?: number } {
	const command = argv[0]
	if (command === 'init' && argv.length === 1) return { command }
	if (command === 'assemble' && argv.length === 2) return { command, stageOrPhase: argv[1] }
	if ((command === 'claim-stage' || command === 'capture-receipt') && argv.length === 4 && argv[2] === '--participant') {
		return { command, stageOrPhase: argv[1], participant: Number(argv[3]) }
	}
	if (command === 'capture-artifact' && (argv.length === 4 || argv.length === 6) && argv[2] === '--participant'
		&& (argv.length === 4 || argv[4] === '--recipient')) {
		return { command, stageOrPhase: argv[1], participant: Number(argv[3]), recipient: argv.length === 6 ? Number(argv[5]) : undefined }
	}
	fail('usage: courier init | claim-stage/capture-receipt STAGE --participant N | capture-artifact STAGE --participant N [--recipient N] | assemble PHASE')
}

export async function runFridayR18CourierCli(argv = process.argv.slice(2)): Promise<void> {
	const args = exactArgs(argv); const profile = productionProfile()
	if (args.command === 'init') await initializeFridayR18Courier(profile)
	else if (args.command === 'claim-stage') await claimFridayR18HostStage(profile, args.stageOrPhase!, args.participant!)
	else if (args.command === 'capture-receipt') await captureFridayR18HostReceipt(profile, args.stageOrPhase!, args.participant!, await boundedStdin())
	else if (args.command === 'capture-artifact') await captureFridayR18Artifact(profile, args.stageOrPhase!, args.participant!, await boundedStdin(), args.recipient)
	else await assembleFridayR18Phase(profile, args.stageOrPhase!)
	process.stdout.write(`${JSON.stringify({ status: 'completed', command: args.command })}\n`)
}

if (import.meta.main) {
	try { await runFridayR18CourierCli() }
	catch {
		process.stderr.write('Friday R18 DKG courier command rejected\n')
		process.exitCode = 1
	}
}

