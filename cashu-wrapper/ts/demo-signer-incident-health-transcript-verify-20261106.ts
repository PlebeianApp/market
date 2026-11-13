/** Offline verifier for one retained four-signer incident-health batch. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { verifyFridaySignerHealthTranscript, type FridaySignerHealthTranscriptV1 } from './demo-friday-signer-health'
import {
	INCIDENT_SIGNER_SUCCESSORS_20261109,
	type IncidentSignerSuccessorPinV1,
	type IncidentSignerSuccessorPinsV1,
} from './demo-signer-incident-successors-20261106'
import type { DemoSignerDurableBindingV1 } from './demo-signer-rpc'
import type { FridayHealthPins } from './demo-friday-readiness'

const COORDINATOR_IDENTITY = 'd2d90d33c11d484fe88c99df6010184f9a44a36e786b7ff5cf79ef11012d89d7'
const PINS = Object.freeze({
	deploymentId: 'friday-demo-20261030-separated-v1', chainId: 'plebeian-auctions-mvp-20261102',
	genesisSha256: 'c2bb4df3a19b543e270017322ea2bae37b54ae640c7964fc89ef79c77a17cc76',
	validatorsHash: 'd1936c5e5e9d09d0a96107031ae144068dcc2ad3f1d071e7f8fe871a8aaff773',
	committeeKeysetId: 'friday-demo-frost-keyset-separated-v1', committeeKeysetVersion: '3',
	dkgRunId: 'friday-demo-20261030-separated-v1-dkg1',
	publicKeyPackageSha256: '954382a53b3589dc0b6069df298c803d2cebcfdec9502645f3c0264e668bdde5',
	signerRosterDigest: 'c1aca1467fa1485dadfb7260024adf31f23e2d0912c99569292ee920d6d1eea1',
	mintUrl: 'https://139.162.161.233',
})

type Enrollment = { schema: string; binding: DemoSignerDurableBindingV1; signerIdentity: string; digest: string; signature: string }
export type IncidentSignerHealthRecordV1 = {
	schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_TRANSCRIPT_RECORD_20261106_V1'; status: 'PASS'; participantId: number
	restartEpoch: number; enrollmentSha256: string; startedAt: number; completedAt: number
	transcript: FridaySignerHealthTranscriptV1
}
export type IncidentSignerHealthBatchV1 = {
	schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_TRANSCRIPT_BATCH_20261106_V1'; status: 'PASS'
	startedAt: number; completedAt: number; records: IncidentSignerHealthRecordV1[]
}

function fail(message: string): never { throw new Error(`DEMO_SIGNER_INCIDENT_HEALTH_TRANSCRIPT: ${message}`) }
function exactKeys(value: unknown, expected: string[], label: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail(`${label} fields differ`)
}
function validateEnrollment(input: unknown, slot: number, enrollmentSha256: string,
	pins: FridayHealthPins, successor: IncidentSignerSuccessorPinV1): Enrollment {
	if (enrollmentSha256 !== successor.enrollmentSha256) fail('successor enrollment hash differs')
	exactKeys(input, ['schema','binding','signerIdentity','digest','signature'], 'enrollment')
	const value = input as unknown as Enrollment
	exactKeys(value.binding, ['schema','participantId','keysetId','keysetVersion','dkgRunId','publicKeyPackageSha256',
		'signerRosterDigest','restartEpoch','journalGeneration','stateDirectory','stateDirectoryIdentity','processIdentity',
		'verifyingShare'], 'binding')
	const digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', value.binding, value.signerIdentity,
	]))))
	if (value.schema !== 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1' || value.binding.schema !== 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1'
		|| value.binding.participantId !== slot || value.binding.keysetId !== pins.committeeKeysetId
		|| value.binding.keysetVersion !== pins.committeeKeysetVersion || value.binding.dkgRunId !== pins.dkgRunId
		|| value.binding.publicKeyPackageSha256 !== pins.publicKeyPackageSha256
		|| value.binding.signerRosterDigest !== pins.signerRosterDigest
		|| value.binding.processIdentity !== value.signerIdentity || value.digest !== digest
		|| value.binding.restartEpoch !== successor.restartEpoch || value.signerIdentity !== successor.signerIdentity
		|| !/^[0-9a-f]{64}$/.test(value.signerIdentity) || !/^[0-9a-f]{128}$/.test(value.signature)
		|| !schnorr.verify(hexToBytes(value.signature), hexToBytes(digest), hexToBytes(value.signerIdentity))) fail('signed enrollment differs')
	return structuredClone(value)
}

export async function verifyIncidentHealthBatch(batchInput: unknown, enrollmentRoot: string): Promise<{
	batchSha256: string; processInstanceIds: Record<string, string>; enrollmentSha256: Record<string, string>
}>;
export async function verifyIncidentHealthBatch(batchInput: unknown, enrollmentRoot: string, expected: {
	coordinatorIdentity: string; pins: FridayHealthPins; successors: IncidentSignerSuccessorPinsV1
}): Promise<{ batchSha256: string; processInstanceIds: Record<string, string>; enrollmentSha256: Record<string, string> }>;
export async function verifyIncidentHealthBatch(batchInput: unknown, enrollmentRoot: string, expected = {
	coordinatorIdentity: COORDINATOR_IDENTITY, pins: PINS as FridayHealthPins,
	successors: INCIDENT_SIGNER_SUCCESSORS_20261109,
}): Promise<{ batchSha256: string; processInstanceIds: Record<string, string>; enrollmentSha256: Record<string, string> }> {
	exactKeys(batchInput, ['schema','status','startedAt','completedAt','records'], 'batch')
	const batch = batchInput as unknown as IncidentSignerHealthBatchV1
	if (batch.schema !== 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_TRANSCRIPT_BATCH_20261106_V1' || batch.status !== 'PASS'
		|| !Number.isSafeInteger(batch.startedAt) || !Number.isSafeInteger(batch.completedAt)
		|| batch.completedAt < batch.startedAt || batch.completedAt - batch.startedAt > 5_000
		|| !Array.isArray(batch.records) || batch.records.length !== 4) fail('batch boundary differs')
	const slots = batch.records.map((record) => record.participantId)
	if (JSON.stringify(slots) !== JSON.stringify([1,2,3,4])) fail('batch participants differ')
	const starts: number[] = [], processIds = new Set<string>()
	const processInstanceIds: Record<string, string> = {}, enrollmentSha256: Record<string, string> = {}
	for (const record of batch.records) {
		exactKeys(record, ['schema','status','participantId','restartEpoch','enrollmentSha256','startedAt','completedAt','transcript'], 'record')
		const slot = record.participantId
		if (record.schema !== 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_TRANSCRIPT_RECORD_20261106_V1' || record.status !== 'PASS'
			|| !Number.isSafeInteger(record.startedAt) || !Number.isSafeInteger(record.completedAt)
			|| record.startedAt < batch.startedAt || record.completedAt > batch.completedAt
			|| record.completedAt < record.startedAt || record.completedAt - record.startedAt > 4_500) fail('record boundary differs')
		const enrollmentBytes = await readFile(join(enrollmentRoot, `signer-${slot}.json`))
		const enrollmentHash = bytesToHex(sha256(enrollmentBytes))
		if (record.enrollmentSha256 !== enrollmentHash) fail('enrollment hash differs')
		const successor = expected.successors[slot as 1 | 2 | 3 | 4]
		if (successor === undefined) fail('successor pin is absent')
		const enrollment = validateEnrollment(JSON.parse(enrollmentBytes.toString('utf8')) as unknown,
			slot, enrollmentHash, expected.pins, successor)
		const verified = verifyFridaySignerHealthTranscript({ transcript: record.transcript,
			coordinatorIdentity: expected.coordinatorIdentity, participantId: slot, signerIdentity: enrollment.signerIdentity,
			pins: expected.pins, enrollment: enrollment.binding })
		if (!verified.ready || record.restartEpoch !== enrollment.binding.restartEpoch
			|| record.transcript.request.issuedAt !== record.startedAt) fail('ready binding differs')
		starts.push(record.startedAt); processIds.add(verified.processInstanceId)
		processInstanceIds[String(slot)] = verified.processInstanceId
		enrollmentSha256[String(slot)] = enrollmentHash
	}
	if (Math.max(...starts) - Math.min(...starts) > 1_000 || processIds.size !== 4) fail('batch is not one unique four-signer sample')
	const canonical = JSON.stringify(batch)
	return { batchSha256: bytesToHex(sha256(utf8ToBytes(canonical))), processInstanceIds, enrollmentSha256 }
}

async function main(argv: string[]): Promise<void> {
	if (argv.length !== 4 || argv[0] !== '--batch' || argv[2] !== '--enrollment-root'
		|| !argv[1]!.startsWith('/') || !argv[3]!.startsWith('/')) fail('usage differs')
	const raw = await readFile(argv[1]!)
	const verified = await verifyIncidentHealthBatch(JSON.parse(raw.toString('utf8')) as unknown, argv[3]!)
	process.stdout.write(`${JSON.stringify({
		schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_TRANSCRIPT_VERIFY_20261106_V1', status: 'PASS', ...verified,
	})}\n`)
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)) }
	catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'DEMO_SIGNER_INCIDENT_HEALTH_TRANSCRIPT: unknown error'}\n`); process.exitCode = 1 }
}
