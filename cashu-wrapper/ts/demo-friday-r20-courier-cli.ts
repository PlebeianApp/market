#!/usr/bin/env bun
/** Fixed-path local executable for the R20 public/ciphertext courier. */
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
	composeDemoFridayR20BoundManifest, executeDemoFridayR20CourierPhase,
	initializeDemoFridayR20Courier, type DemoFridayR20CourierPhase,
	type DemoFridayR20CourierProfile,
} from './demo-friday-r20-coordinator-courier'
import { verifyDemoFridayR20FreshDkgProfile } from './demo-friday-r20-fresh-profile'
import { requireDemoFridayR20PredecessorPermissionSeal } from './demo-friday-r20-r18-permission-seal'
import type { DemoFridayDkgPublicManifestV1 } from './demo-friday-per-validator-dkg-bootstrap'
import {
	DEMO_FRIDAY_R20_COURIER_INPUT_ROOT, DEMO_FRIDAY_R20_COURIER_OPERATOR_ROOT,
} from './demo-friday-r20-path-contract'

export const FRIDAY_R20_COURIER_INPUT_ROOT = DEMO_FRIDAY_R20_COURIER_INPUT_ROOT
export const FRIDAY_R20_COURIER_ROOT = DEMO_FRIDAY_R20_COURIER_OPERATOR_ROOT
const O_CLOEXEC = 0o2000000
const MAX_INPUT = 4 * 1024 * 1024
const PHASES: DemoFridayR20CourierPhase[] = [
	'enrollment', 'confirmations', 'round1', 'agreement',
	'round2-1', 'round2-2', 'round2-3', 'round2-4', 'final',
]

export interface DemoFridayR20CourierCliProfile {
	inputRoot: string
	courier: DemoFridayR20CourierProfile
}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R20_COURIER_CLI: ${message}`) }
function canonicalRoot(value: string, label: string): string {
	if (!value.startsWith('/') || value === '/' || value.endsWith('/') || value.includes('//') || resolve(value) !== value) {
		fail(`${label} is not a dedicated canonical absolute path`)
	}
	return value
}
function productionProfile(): DemoFridayR20CourierCliProfile {
	const uid = process.geteuid?.(), gid = process.getegid?.()
	if (uid === undefined || gid === undefined || uid !== 1000 || gid !== 1000) {
		fail('production courier must run as the fixed existing operator account')
	}
	return { inputRoot: FRIDAY_R20_COURIER_INPUT_ROOT,
		courier: { root: FRIDAY_R20_COURIER_ROOT, expectedUid: uid, expectedGid: gid } }
}
function exactProfile(value: DemoFridayR20CourierCliProfile): DemoFridayR20CourierCliProfile {
	canonicalRoot(value.inputRoot, 'input root'); canonicalRoot(value.courier.root, 'courier root')
	if (!Number.isSafeInteger(value.courier.expectedUid) || value.courier.expectedUid < 1
		|| !Number.isSafeInteger(value.courier.expectedGid) || value.courier.expectedGid < 1) fail('expected identity is invalid')
	return value
}
async function exactInput(path: string, profile: DemoFridayR20CourierCliProfile): Promise<Uint8Array> {
	if (!path.startsWith(`${profile.inputRoot}/`)) fail('input escaped fixed root')
	const before = await lstat(path)
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
		|| before.uid !== profile.courier.expectedUid || before.gid !== profile.courier.expectedGid
		|| (before.mode & 0o777) !== 0o600 || before.size < 2 || before.size > MAX_INPUT
		|| await realpath(path) !== path) fail('fixed input identity, ownership, mode, or size is invalid')
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC)
	try {
		const opened = await handle.stat()
		if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
			|| opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) fail('fixed input changed while opened')
		const bytes = new Uint8Array(await handle.readFile())
		const after = await handle.stat()
		if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || bytes.length !== opened.size) {
			fail('fixed input changed while read')
		}
		return bytes
	} finally { await handle.close() }
}
async function json(path: string, profile: DemoFridayR20CourierCliProfile): Promise<unknown> {
	try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await exactInput(path, profile))) }
	catch (error) { if (error instanceof Error && error.message.startsWith('DEMO_FRIDAY_R20_COURIER_CLI:')) throw error
		return fail('fixed JSON input is malformed') }
}
async function exactText(path: string, profile: DemoFridayR20CourierCliProfile): Promise<string> {
	const value = new TextDecoder('utf-8', { fatal: true }).decode(await exactInput(path, profile))
	if (!/^[0-9a-f]{64}\n$/.test(value)) fail('owner digest pin is malformed')
	return value.trim()
}
async function boundedStdin(): Promise<Uint8Array> {
	const reader = Bun.stdin.stream().getReader(), chunks: Uint8Array[] = []
	let size = 0
	for (;;) {
		const next = await reader.read()
		if (next.done) break
		size += next.value.length
		if (size > MAX_INPUT) fail('stdin exceeds the public/ciphertext input bound')
		chunks.push(next.value)
	}
	if (size < 2) fail('stdin is empty')
	const output = new Uint8Array(size); let offset = 0
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
	return output
}

async function inputs(profile: DemoFridayR20CourierCliProfile) {
	const predecessorManifest = await json(join(profile.inputRoot, 'r18-predecessor-manifest.json'), profile)
	const abortRecord = await json(join(profile.inputRoot, 'r18-abort-record.json'), profile)
	const acknowledgements = await Promise.all([1, 2, 3, 4].map((slot) =>
		json(join(profile.inputRoot, `participant-${slot}.abort-acknowledgement.json`), profile)))
	const expectedPredecessorAbortDigest = await exactText(
		join(profile.inputRoot, 'owner-approved-predecessor-abort-digest.txt'), profile)
	const profileBinding = verifyDemoFridayR20FreshDkgProfile({ predecessorManifest, abortRecord,
		acknowledgements, expectedPredecessorAbortDigest })
	const permissionSeals = await Promise.all([1, 2, 3, 4].map((slot) =>
		json(join(profile.inputRoot, `participant-${slot}.r18-permission-seal.json`), profile)))
	for (let index = 0; index < permissionSeals.length; index += 1) {
		requireDemoFridayR20PredecessorPermissionSeal({ value: permissionSeals[index],
			expectedAbortDigest: profileBinding.predecessorAbortDigest,
			expectedManifestDigest: profileBinding.predecessorManifestDigest,
			expectedParticipantId: (index + 1) as 1 | 2 | 3 | 4 })
	}
	return { predecessorManifest, profileBinding }
}

export async function runDemoFridayR20CourierCli(
	argv = process.argv.slice(2), profileValue?: DemoFridayR20CourierCliProfile, stdinValue?: Uint8Array,
): Promise<void> {
	const init = argv.length === 1 && argv[0] === 'init'
	const relay = argv.length === 2 && argv[0] === 'relay'
		&& PHASES.includes(argv[1] as DemoFridayR20CourierPhase)
	if (!init && !relay) {
		fail('usage: plebeian-friday-r20-courier init | relay enrollment|confirmations|round1|agreement|round2-1|round2-2|round2-3|round2-4|final')
	}
	const profile = exactProfile(profileValue ?? productionProfile())
	const fixed = await inputs(profile)
	if (init) {
		const coordinator = await json(join(profile.inputRoot, 'coordinator-public.json'), profile)
		const enrollments = await Promise.all([1, 2, 3, 4].map((slot) =>
			json(join(profile.inputRoot, `participant-${slot}.host-enrollment.json`), profile)))
		const pinsValue = await json(join(profile.inputRoot, 'owner-approved-host-pin-digests.json'), profile)
		if (pinsValue === null || typeof pinsValue !== 'object' || Array.isArray(pinsValue)
			|| JSON.stringify(Object.keys(pinsValue).sort()) !== JSON.stringify(['digests', 'schema'])) {
			fail('owner host-pin list has missing or unexpected fields')
		}
		const pins = pinsValue as { schema?: unknown; digests?: unknown }
		if (pins.schema !== 'PLEBEIAN_FRIDAY_R20_HOST_PIN_DIGESTS_V1' || !Array.isArray(pins.digests)) {
			fail('owner host-pin list is malformed')
		}
		const bound = composeDemoFridayR20BoundManifest({ profile: fixed.profileBinding,
			predecessorManifest: fixed.predecessorManifest as DemoFridayDkgPublicManifestV1, coordinator, enrollments,
			expectedHostPinDigests: pins.digests as string[] })
		await initializeDemoFridayR20Courier(profile.courier, bound)
		return
	}
	if (relay) {
		const phase = argv[1] as DemoFridayR20CourierPhase
		const raw = stdinValue ?? await boundedStdin()
		let request: unknown
		try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) }
		catch { return fail('courier request is malformed') }
		const manifestPin = await exactText(join(profile.inputRoot, 'owner-approved-manifest-binding-digest.txt'), profile)
		await executeDemoFridayR20CourierPhase({ profile: profile.courier,
			profileBinding: fixed.profileBinding,
			predecessorManifest: fixed.predecessorManifest as DemoFridayDkgPublicManifestV1,
			expectedManifestBindingDigest: manifestPin, phase, request })
		return
	}
}

if (import.meta.main) {
	try { await runDemoFridayR20CourierCli() }
	catch { process.stderr.write('Friday R20 courier command rejected\n'); process.exitCode = 1 }
}
