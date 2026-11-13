/**
 * Incident-bounded, read-only signer health probe.
 *
 * It signs only FRIDAY_SIGNER_HEALTH_REQUEST_V1 with the APP-local coordinator
 * identity, validates the successor public enrollment and signed health reply,
 * and stores no anchor or process state.
 */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { constants } from 'node:fs'
import { lstat, open, readFile } from 'node:fs/promises'

import { probeFridaySignerHealthTranscript } from './demo-friday-signer-health'
import { INCIDENT_SIGNER_SUCCESSORS_20261109 } from './demo-signer-incident-successors-20261106'
import type { DemoSignerDurableBindingV1 } from './demo-signer-rpc'

const COORDINATOR_SECRET = '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/coordinator-rpc-identity.key'
const COORDINATOR_IDENTITY = 'd2d90d33c11d484fe88c99df6010184f9a44a36e786b7ff5cf79ef11012d89d7'
const LINUX_O_CLOEXEC = 0o2000000
const ENDPOINTS = [
	'http://[fdad:d221:cb5f:1d78:1125:b3f6:1a8f:44f8]:39101/v1/frost',
	'http://[fdd5:9c40:b25b:2ded:d43:fe2d:11c5:4703]:39101/v1/frost',
	'http://[fd16:51a0:bc17:19bc:8a04:2076:e388:74a3]:39101/v1/frost',
	'http://[fdbd:1deb:a2b0:9e60:dcb1:10df:90d7:5776]:39101/v1/frost',
] as const
const PINS = Object.freeze({
	deploymentId: 'friday-demo-20261030-separated-v1',
	chainId: 'plebeian-auctions-mvp-20261102',
	genesisSha256: 'c2bb4df3a19b543e270017322ea2bae37b54ae640c7964fc89ef79c77a17cc76',
	validatorsHash: 'd1936c5e5e9d09d0a96107031ae144068dcc2ad3f1d071e7f8fe871a8aaff773',
	committeeKeysetId: 'friday-demo-frost-keyset-separated-v1', committeeKeysetVersion: '3',
	dkgRunId: 'friday-demo-20261030-separated-v1-dkg1',
	publicKeyPackageSha256: '954382a53b3589dc0b6069df298c803d2cebcfdec9502645f3c0264e668bdde5',
	signerRosterDigest: 'c1aca1467fa1485dadfb7260024adf31f23e2d0912c99569292ee920d6d1eea1',
	mintUrl: 'https://139.162.161.233',
})

type Enrollment = {
	schema: string
	binding: DemoSignerDurableBindingV1
	signerIdentity: string
	digest: string
	signature: string
}

export type IncidentSignerHealthProbeFailureV1 = {
	schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_PROBE_FAILURE_20261108_V1'
	status: 'FAIL'
	participantId: 1 | 2 | 3 | 4 | null
	reasonCode: string
}

function fail(message: string): never { throw new Error(`DEMO_SIGNER_INCIDENT_HEALTH: ${message}`) }

export const INCIDENT_SIGNER_HEALTH_FAILURE_CODES: ReadonlySet<string> = new Set([
	'HEALTH_ENDPOINT_BINDING', 'HEALTH_RESPONSE', 'HEALTH_RESPONSE_SIZE', 'HEALTH_CANCELLED',
	'HEALTH_TRANSCRIPT_SHAPE', 'HEALTH_TRANSCRIPT_IDENTITY', 'HEALTH_REQUEST_SHAPE',
	'HEALTH_REPLY_SHAPE', 'HEALTH_BINDING_SHAPE', 'HEALTH_TRANSCRIPT_REQUEST',
	'HEALTH_TRANSCRIPT_REPLY', 'HEALTH_ENROLLMENT_BINDING', 'HEALTH_EPOCH_BINDING',
	'HEALTH_TIMEOUT_OR_ABORT', 'HEALTH_FETCH', 'ARGUMENTS', 'ENROLLMENT_HASH',
	'ENROLLMENT_JSON', 'ENROLLMENT_SHAPE', 'ENROLLMENT_BINDING_SHAPE', 'ENROLLMENT_SIGNATURE',
	'COORDINATOR_SECRET_OWNER', 'COORDINATOR_SECRET_BOUNDARY', 'COORDINATOR_SECRET_CHANGED',
	'COORDINATOR_SECRET_SHAPE', 'COORDINATOR_IDENTITY', 'SIGNER_NOT_READY',
	'ENROLLMENT_FIELDS', 'INCIDENT_PROBE', 'UNCLASSIFIED',
])

/** Reduce a probe exception to one finite, non-secret reason code. */
export function incidentSignerHealthProbeFailure(error: unknown,
	participantId: 1 | 2 | 3 | 4 | null): IncidentSignerHealthProbeFailureV1 {
	const name = error instanceof Error ? error.name : 'UnknownError'
	const message = error instanceof Error ? error.message : 'unknown error'
	let reasonCode = 'UNCLASSIFIED'
	if (INCIDENT_SIGNER_HEALTH_FAILURE_CODES.has(message)) reasonCode = message
	else if (name === 'TimeoutError' || name === 'AbortError') {
		reasonCode = 'HEALTH_TIMEOUT_OR_ABORT'
	} else if (message === 'fetch failed') reasonCode = 'HEALTH_FETCH'
	else if (name === 'SyntaxError') reasonCode = 'ENROLLMENT_JSON'
	else if (message.startsWith('DEMO_SIGNER_INCIDENT_HEALTH: ')) {
		const detail = message.slice('DEMO_SIGNER_INCIDENT_HEALTH: '.length)
		const exact: Record<string, string> = {
			'usage: --slot 1..4 --enrollment /absolute/file': 'ARGUMENTS',
			'arguments differ': 'ARGUMENTS',
			'successor enrollment hash differs': 'ENROLLMENT_HASH',
			'enrollment is not an object': 'ENROLLMENT_SHAPE',
			'binding is not an object': 'ENROLLMENT_BINDING_SHAPE',
			'signed enrollment differs': 'ENROLLMENT_SIGNATURE',
			'coordinator secret owner is unavailable': 'COORDINATOR_SECRET_OWNER',
			'coordinator secret file boundary differs': 'COORDINATOR_SECRET_BOUNDARY',
			'coordinator secret changed while opened': 'COORDINATOR_SECRET_CHANGED',
			'coordinator secret file shape differs': 'COORDINATOR_SECRET_SHAPE',
			'coordinator secret changed while read': 'COORDINATOR_SECRET_CHANGED',
			'coordinator identity differs': 'COORDINATOR_IDENTITY',
			'signer did not return signed ready true': 'SIGNER_NOT_READY',
		}
		reasonCode = exact[detail] ?? (/ fields differ$/.test(detail) ? 'ENROLLMENT_FIELDS' : 'INCIDENT_PROBE')
	}
	return {
		schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_PROBE_FAILURE_20261108_V1', status: 'FAIL',
		participantId, reasonCode,
	}
}
function exactKeys(value: object, expected: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail(`${label} fields differ`)
}
function validateEnrollment(input: unknown, slot: 1 | 2 | 3 | 4, enrollmentSha256: string): Enrollment {
	const expected = INCIDENT_SIGNER_SUCCESSORS_20261109[slot]
	if (enrollmentSha256 !== expected.enrollmentSha256) fail('successor enrollment hash differs')
	if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('enrollment is not an object')
	exactKeys(input, ['schema','binding','signerIdentity','digest','signature'], 'enrollment')
	const value = input as Enrollment
	if (value.binding === null || typeof value.binding !== 'object' || Array.isArray(value.binding)) fail('binding is not an object')
	const digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', value.binding, value.signerIdentity,
	]))))
	if (value.schema !== 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1' || value.binding.schema !== 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1'
		|| value.binding.participantId !== slot || value.binding.keysetId !== PINS.committeeKeysetId
		|| value.binding.keysetVersion !== PINS.committeeKeysetVersion || value.binding.dkgRunId !== PINS.dkgRunId
		|| value.binding.publicKeyPackageSha256 !== PINS.publicKeyPackageSha256
		|| value.binding.signerRosterDigest !== PINS.signerRosterDigest
		|| value.binding.processIdentity !== value.signerIdentity || value.digest !== digest
		|| value.binding.restartEpoch !== expected.restartEpoch || value.signerIdentity !== expected.signerIdentity
		|| !/^[0-9a-f]{64}$/.test(value.signerIdentity) || !/^[0-9a-f]{128}$/.test(value.signature)
		|| !schnorr.verify(hexToBytes(value.signature), hexToBytes(digest), hexToBytes(value.signerIdentity))) fail('signed enrollment differs')
	return structuredClone(value)
}

function hexNibble(value: number): number {
	if (value >= 0x30 && value <= 0x39) return value - 0x30
	if (value >= 0x61 && value <= 0x66) return value - 0x61 + 10
	fail('coordinator secret file shape differs')
}

/** Read one runtime-owned, single-link 0600 secret without creating a JS string copy. */
export async function readIncidentCoordinatorSecret(path: string, expectedUid = process.getuid?.()): Promise<Uint8Array> {
	if (expectedUid === undefined) fail('coordinator secret owner is unavailable')
	const before = await lstat(path)
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== expectedUid
		|| (before.mode & 0o777) !== 0o600 || before.size < 64 || before.size > 66) {
		fail('coordinator secret file boundary differs')
	}
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | LINUX_O_CLOEXEC)
	let raw: Buffer | undefined
	try {
		const opened = await handle.stat()
		if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== expectedUid || (opened.mode & 0o777) !== 0o600
			|| opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
			fail('coordinator secret changed while opened')
		}
		raw = await handle.readFile()
		const end = raw.length === 64 ? 64
			: raw.length === 65 && raw[64] === 0x0a ? 64
				: raw.length === 66 && raw[64] === 0x0d && raw[65] === 0x0a ? 64 : -1
		if (end !== 64) fail('coordinator secret file shape differs')
		const secret = new Uint8Array(32)
		for (let index = 0; index < secret.length; index++) {
			secret[index] = (hexNibble(raw[index * 2]!) << 4) | hexNibble(raw[index * 2 + 1]!)
		}
		const after = await handle.stat()
		if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || after.nlink !== 1) {
			secret.fill(0); fail('coordinator secret changed while read')
		}
		return secret
	} finally {
		raw?.fill(0)
		await handle.close()
	}
}

async function main(argv: string[]): Promise<void> {
	if (argv.length !== 4 || argv[0] !== '--slot' || argv[2] !== '--enrollment') fail('usage: --slot 1..4 --enrollment /absolute/file')
	const slot = Number(argv[1]) as 1 | 2 | 3 | 4, enrollmentPath = argv[3]!
	if (![1,2,3,4].includes(slot) || !enrollmentPath.startsWith('/') || enrollmentPath.includes('//')) fail('arguments differ')
	const enrollmentBytes = await readFile(enrollmentPath)
	const enrollmentSha256 = bytesToHex(sha256(enrollmentBytes))
	const enrollment = validateEnrollment(JSON.parse(enrollmentBytes.toString('utf8')) as unknown, slot, enrollmentSha256)
	const secret = await readIncidentCoordinatorSecret(COORDINATOR_SECRET)
	try {
		if (bytesToHex(schnorr.getPublicKey(secret)) !== COORDINATOR_IDENTITY) fail('coordinator identity differs')
		const startedAt = Date.now()
		const transcript = await probeFridaySignerHealthTranscript({
			endpoint: ENDPOINTS[slot - 1]!, participantId: slot, signerIdentity: enrollment.signerIdentity,
			coordinatorSecret: secret, pins: PINS, enrollment: enrollment.binding,
			signal: AbortSignal.timeout(4_000), now: () => startedAt,
		})
		const completedAt = Date.now()
		if (!transcript.reply.ready || !/^[0-9a-f]{64}$/.test(transcript.reply.processInstanceId)) {
			fail('signer did not return signed ready true')
		}
		process.stdout.write(`${JSON.stringify({
			schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_TRANSCRIPT_RECORD_20261106_V1', status: 'PASS', participantId: slot,
			restartEpoch: enrollment.binding.restartEpoch, enrollmentSha256,
			startedAt, completedAt, transcript,
		})}\n`)
	} finally { secret.fill(0) }
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)) }
	catch (error) {
		const raw = Number(process.argv[3])
		const participantId = ([1,2,3,4] as const).find((slot) => slot === raw) ?? null
		process.stderr.write(`${JSON.stringify(incidentSignerHealthProbeFailure(error, participantId))}\n`)
		process.exitCode = 1
	}
}
