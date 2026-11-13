/** One bounded, create-once four-signer health-transcript collection. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
	INCIDENT_SIGNER_HEALTH_FAILURE_CODES,
	incidentSignerHealthProbeFailure,
	type IncidentSignerHealthProbeFailureV1,
} from './demo-signer-incident-health-probe-20261106'
import {
	verifyIncidentHealthBatch,
	type IncidentSignerHealthBatchV1,
	type IncidentSignerHealthRecordV1,
} from './demo-signer-incident-health-transcript-verify-20261106'

const RELEASE = '/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-signer-diagnostic-20261109'
const PROBE = `${RELEASE}/bin/plebeian-signer-incident-health-probe-20261109`
const ENROLLMENT_ROOT = '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/incidents/20261109/successors'
const DIAGNOSTIC_ROOT = '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/incidents/20261109-signer-health'
const ATTEMPT_MARKER = `${DIAGNOSTIC_ROOT}/attempted`
const OUTPUT = `${DIAGNOSTIC_ROOT}/success.json`
const FAILURE_OUTPUT = `${DIAGNOSTIC_ROOT}/failure.json`
const LINUX_O_CLOEXEC = 0o2000000
const PROBE_PROCESS_TIMEOUT_MS = 4_500
const COLLECTOR_SLOT_TIMEOUT_MS = 4_750
const STDOUT_LIMIT = 64 * 1024
const STDERR_LIMIT = 4 * 1024
const FAILURE_FILE_LIMIT = 16 * 1024
const SUCCESS_FILE_LIMIT = 512 * 1024

type Verified = Awaited<ReturnType<typeof verifyIncidentHealthBatch>>
type Slot = 1 | 2 | 3 | 4

export type IncidentSignerHealthSlotDiagnosticV1 = {
	schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_SLOT_DIAGNOSTIC_20261108_V1'
	status: 'PASS'
	participantId: Slot
	recordSha256: string
	enrollmentSha256: string | null
	processInstanceId: string | null
	startedAt: number | null
	completedAt: number | null
} | {
	schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_SLOT_DIAGNOSTIC_20261108_V1'
	status: 'FAIL'
	participantId: Slot
	stage: 'probe_process' | 'probe_contract' | 'probe_exception'
	exitCode: number | null
	reasonCode: string
	stdoutBytes: number
	stderrBytes: number
}

export type IncidentSignerHealthFailureBatchV1 = {
	schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_FAILURE_BATCH_20261108_V1'
	status: 'FAIL'
	stage: 'probe_collection' | 'batch_boundary' | 'batch_verify'
	reasonCode: string
	startedAt: number
	completedAt: number
	slots: IncidentSignerHealthSlotDiagnosticV1[]
}

export type IncidentSignerHealthSuccessV1 = {
	schema: 'PLEBEIAN_SIGNER_DIAGNOSTIC_SUCCESS_20261108_V1'
	status: 'PASS'
	batch: IncidentSignerHealthBatchV1
	verified: Verified
}

class IncidentProbeFailure extends Error {
	constructor(readonly evidence: Extract<IncidentSignerHealthSlotDiagnosticV1, { status: 'FAIL' }>) {
		super(evidence.reasonCode)
	}
}

function fail(message: string): never { throw new Error(`DEMO_SIGNER_INCIDENT_HEALTH_BATCH: ${message}`) }
function digestText(value: string): string { return bytesToHex(sha256(utf8ToBytes(value))) }

async function requireOutputBoundary(output: string): Promise<void> {
	const parent = await lstat(dirname(output)), uid = process.getuid?.()
	if (uid === undefined || !parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== uid
		|| (parent.mode & 0o777) !== 0o700) fail('output parent boundary differs')
	try { await lstat(output); fail('output already exists') }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
}

async function writeCreateOnce(path: string, value: unknown, maximumBytes: number,
	afterDirectorySync?: () => void): Promise<void> {
	const uid = process.getuid?.()
	if (uid === undefined || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) fail('output boundary is unavailable')
	const serialized = `${JSON.stringify(value)}\n`
	if (utf8ToBytes(serialized).length > maximumBytes) fail('output exceeds its fixed byte boundary')
	const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
		| constants.O_NOFOLLOW | LINUX_O_CLOEXEC, 0o600)
	try {
		await handle.writeFile(serialized, 'utf8'); await handle.sync(); await handle.chmod(0o600)
		const metadata = await handle.stat()
		if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== uid || (metadata.mode & 0o777) !== 0o600) {
			fail('output boundary differs')
		}
	} finally { await handle.close() }
	const parentHandle = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY
		| constants.O_NOFOLLOW | LINUX_O_CLOEXEC)
	try {
		const parent = await parentHandle.stat()
		if (!parent.isDirectory() || parent.uid !== uid || (parent.mode & 0o777) !== 0o700) {
			fail('output parent boundary changed')
		}
		await parentHandle.sync()
	} finally { await parentHandle.close() }
	afterDirectorySync?.()
}

class ProbeStreamLimitError extends Error {
	constructor(readonly streamName: 'stdout' | 'stderr', readonly observedBytes: number) { super('PROBE_STREAM_LIMIT') }
}
class ProbeProcessDeadlineError extends Error { constructor() { super('PROBE_PROCESS_DEADLINE') } }

async function boundedText(stream: ReadableStream<Uint8Array>, maximum: number,
	streamName: 'stdout' | 'stderr'): Promise<{ text: string; bytes: number }> {
	const reader = stream.getReader(), chunks: Uint8Array[] = []; let total = 0
	try {
		for (;;) {
			const part = await reader.read()
			if (part.done) break
			total += part.value.length
			if (total > maximum) {
				await reader.cancel()
				throw new ProbeStreamLimitError(streamName, maximum + 1)
			}
			chunks.push(part.value)
		}
	} finally { reader.releaseLock() }
	const joined = new Uint8Array(total); let offset = 0
	for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length }
	return { text: new TextDecoder('utf-8', { fatal: true }).decode(joined), bytes: total }
}

function childFailure(stderr: string, slot: Slot): Pick<IncidentSignerHealthProbeFailureV1, 'reasonCode'> | null {
	let parsed: unknown
	try { parsed = JSON.parse(stderr) } catch { return null }
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	const value = parsed as Partial<IncidentSignerHealthProbeFailureV1>
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
		'participantId', 'reasonCode', 'schema', 'status',
	].sort()) || value.schema !== 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_PROBE_FAILURE_20261108_V1'
		|| value.status !== 'FAIL' || value.participantId !== slot
		|| typeof value.reasonCode !== 'string' || !INCIDENT_SIGNER_HEALTH_FAILURE_CODES.has(value.reasonCode)) return null
	return { reasonCode: value.reasonCode }
}

function failedSlot(slot: Slot, stage: 'probe_process' | 'probe_contract' | 'probe_exception', exitCode: number | null,
	reasonCode: string, stdoutBytes: number, stderrBytes: number): IncidentProbeFailure {
	return new IncidentProbeFailure({
		schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_SLOT_DIAGNOSTIC_20261108_V1', status: 'FAIL',
		participantId: slot, stage, exitCode, reasonCode, stdoutBytes, stderrBytes,
	})
}

export async function runBoundedIncidentHealthProbeProcess(options: {
	slot: Slot
	command: string[]
	timeoutMs?: number
	stdoutLimit?: number
	stderrLimit?: number
}): Promise<IncidentSignerHealthRecordV1> {
	const timeoutMs = options.timeoutMs ?? PROBE_PROCESS_TIMEOUT_MS
	const stdoutLimit = options.stdoutLimit ?? STDOUT_LIMIT, stderrLimit = options.stderrLimit ?? STDERR_LIMIT
	if (options.command.length < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PROBE_PROCESS_TIMEOUT_MS
		|| !Number.isSafeInteger(stdoutLimit) || stdoutLimit < 1 || stdoutLimit > STDOUT_LIMIT
		|| !Number.isSafeInteger(stderrLimit) || stderrLimit < 1 || stderrLimit > STDERR_LIMIT) fail('probe process boundary differs')
	const child = Bun.spawn(options.command, {
		stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', cwd: '/', env: { PATH: '/usr/bin:/bin' },
	})
	const stdoutRead = boundedText(child.stdout, stdoutLimit, 'stdout')
	const stderrRead = boundedText(child.stderr, stderrLimit, 'stderr')
	const exited = child.exited
	let timer: ReturnType<typeof setTimeout> | undefined
	let result: [{ text: string; bytes: number }, { text: string; bytes: number }, number]
	try {
		result = await Promise.race([
			Promise.all([stdoutRead, stderrRead, exited]),
			new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ProbeProcessDeadlineError()), timeoutMs) }),
		])
	} catch (error) {
		if (timer !== undefined) clearTimeout(timer)
		try { child.kill('SIGKILL') } catch { /* process already exited */ }
		await Promise.allSettled([stdoutRead, stderrRead, exited])
		if (error instanceof ProbeStreamLimitError) {
			throw failedSlot(options.slot, 'probe_process', null,
				error.streamName === 'stdout' ? 'PROBE_STDOUT_LIMIT' : 'PROBE_STDERR_LIMIT',
				error.streamName === 'stdout' ? error.observedBytes : 0,
				error.streamName === 'stderr' ? error.observedBytes : 0)
		}
		if (error instanceof ProbeProcessDeadlineError) {
			throw failedSlot(options.slot, 'probe_process', null, 'PROBE_PROCESS_DEADLINE', 0, 0)
		}
		const classified = incidentSignerHealthProbeFailure(error, options.slot)
		throw failedSlot(options.slot, 'probe_process', null, classified.reasonCode, 0, 0)
	}
	if (timer !== undefined) clearTimeout(timer)
	const [stdoutResult, stderrResult, exitCode] = result
	const stdout = stdoutResult.text, stderr = stderrResult.text
	if (exitCode !== 0 || stderr !== '') {
		const parsed = childFailure(stderr, options.slot)
		throw failedSlot(options.slot, 'probe_process', exitCode,
			parsed?.reasonCode ?? 'PROBE_PROCESS_FAILURE', stdoutResult.bytes, stderrResult.bytes)
	}
	let parsed: unknown
	try { parsed = JSON.parse(stdout) }
	catch { throw failedSlot(options.slot, 'probe_contract', exitCode, 'PROBE_OUTPUT_JSON', stdoutResult.bytes, stderrResult.bytes) }
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
		|| (parsed as { participantId?: unknown }).participantId !== options.slot) {
		throw failedSlot(options.slot, 'probe_contract', exitCode, 'PROBE_OUTPUT_RECORD', stdoutResult.bytes, stderrResult.bytes)
	}
	return parsed as IncidentSignerHealthRecordV1
}

async function runLiveProbe(slot: Slot): Promise<IncidentSignerHealthRecordV1> {
	const metadata = await lstat(PROBE)
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== 0
		|| (metadata.mode & 0o777) !== 0o755) fail('probe executable boundary differs')
	return runBoundedIncidentHealthProbeProcess({ slot,
		command: [PROBE, '--slot', String(slot), '--enrollment', `${ENROLLMENT_ROOT}/signer-${slot}.json`] })
}

function passedSlot(slot: Slot, record: IncidentSignerHealthRecordV1): IncidentSignerHealthSlotDiagnosticV1 {
	const enrollmentSha256 = typeof record.enrollmentSha256 === 'string' && /^[0-9a-f]{64}$/.test(record.enrollmentSha256)
		? record.enrollmentSha256 : null
	const processInstanceId = typeof record.transcript?.reply?.processInstanceId === 'string'
		&& /^[0-9a-f]{64}$/.test(record.transcript.reply.processInstanceId) ? record.transcript.reply.processInstanceId : null
	return {
		schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_SLOT_DIAGNOSTIC_20261108_V1', status: 'PASS', participantId: slot,
		recordSha256: digestText(JSON.stringify(record)), enrollmentSha256, processInstanceId,
		startedAt: Number.isSafeInteger(record.startedAt) ? record.startedAt : null,
		completedAt: Number.isSafeInteger(record.completedAt) ? record.completedAt : null,
	}
}

function rejectedSlot(slot: Slot, reason: unknown): IncidentSignerHealthSlotDiagnosticV1 {
	if (reason instanceof IncidentProbeFailure && reason.evidence.participantId === slot) return reason.evidence
	const classified = incidentSignerHealthProbeFailure(reason, slot)
	return {
		schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_SLOT_DIAGNOSTIC_20261108_V1', status: 'FAIL', participantId: slot,
		stage: 'probe_exception', exitCode: null, reasonCode: classified.reasonCode, stdoutBytes: 0, stderrBytes: 0,
	}
}

async function persistFailure(options: { failureOutput: string; startedAt: number; completedAt: number
	stage: IncidentSignerHealthFailureBatchV1['stage']; reasonCode: string
	slots: IncidentSignerHealthSlotDiagnosticV1[] }): Promise<void> {
	const failure: IncidentSignerHealthFailureBatchV1 = {
		schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_FAILURE_BATCH_20261108_V1', status: 'FAIL',
		stage: options.stage, reasonCode: options.reasonCode,
		startedAt: options.startedAt, completedAt: options.completedAt, slots: options.slots,
	}
	await writeCreateOnce(options.failureOutput, failure, FAILURE_FILE_LIMIT)
}

async function collectSlotWithinDeadline(slot: Slot,
	probe: (slot: Slot) => Promise<IncidentSignerHealthRecordV1>, timeoutMs: number): Promise<IncidentSignerHealthRecordV1> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			Promise.resolve().then(() => probe(slot)),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(failedSlot(slot, 'probe_exception', null,
					'PROBE_DEADLINE', 0, 0)), timeoutMs)
			}),
		])
	} finally { if (timer !== undefined) clearTimeout(timer) }
}

export async function collectIncidentHealthBatch(options: {
	enrollmentRoot: string
	attemptMarker: string
	output: string
	failureOutput: string
	probe(slot: Slot): Promise<IncidentSignerHealthRecordV1>
	slotTimeoutMs?: number
	onAttemptDirectorySynced?: () => void
	now?: () => number
	verify?: (batch: IncidentSignerHealthBatchV1, enrollmentRoot: string) => Promise<Verified>
}): Promise<Verified> {
	if (!options.enrollmentRoot.startsWith('/') || !options.attemptMarker.startsWith('/') || !options.output.startsWith('/')
		|| !options.failureOutput.startsWith('/') || new Set([options.attemptMarker, options.output, options.failureOutput]).size !== 3) {
		fail('paths are not exact')
	}
	await requireOutputBoundary(options.output); await requireOutputBoundary(options.failureOutput)
	await requireOutputBoundary(options.attemptMarker)
	const now = options.now ?? Date.now
	const slotTimeoutMs = options.slotTimeoutMs ?? COLLECTOR_SLOT_TIMEOUT_MS
	if (!Number.isSafeInteger(slotTimeoutMs) || slotTimeoutMs < 1 || slotTimeoutMs > COLLECTOR_SLOT_TIMEOUT_MS) {
		fail('slot timeout boundary differs')
	}
	const startedAt = now()
	if (!Number.isSafeInteger(startedAt)) fail('batch start time boundary differs')
	await writeCreateOnce(options.attemptMarker, {
		schema: 'PLEBEIAN_SIGNER_DIAGNOSTIC_ATTEMPT_20261108_V1', status: 'ATTEMPTED', startedAt,
	}, 1_024, options.onAttemptDirectorySynced)
	const slots = [1, 2, 3, 4] as const
	const settled = await Promise.allSettled(slots.map((slot) => collectSlotWithinDeadline(slot, options.probe, slotTimeoutMs)))
	const completedAt = now()
	const diagnostics = settled.map((result, index) => result.status === 'fulfilled'
		? passedSlot(slots[index]!, result.value) : rejectedSlot(slots[index]!, result.reason))
	if (!Number.isSafeInteger(completedAt) || completedAt < startedAt || completedAt - startedAt > 5_000) {
		const safeCompletedAt = Number.isSafeInteger(completedAt) && completedAt >= startedAt ? completedAt : startedAt
		await persistFailure({ failureOutput: options.failureOutput, startedAt, completedAt: safeCompletedAt,
			stage: 'batch_boundary', reasonCode: 'BATCH_TIME_BOUNDARY', slots: diagnostics })
		fail('batch time boundary differs; failure evidence retained')
	}
	if (settled.some((result) => result.status === 'rejected')) {
		await persistFailure({ failureOutput: options.failureOutput, startedAt, completedAt,
			stage: 'probe_collection', reasonCode: 'PROBE_COLLECTION', slots: diagnostics })
		fail('one or more probes failed; failure evidence retained')
	}
	const records = settled.map((result) => (result as PromiseFulfilledResult<IncidentSignerHealthRecordV1>).value)
	const batch: IncidentSignerHealthBatchV1 = {
		schema: 'PLEBEIAN_SIGNER_INCIDENT_HEALTH_TRANSCRIPT_BATCH_20261106_V1', status: 'PASS',
		startedAt, completedAt, records,
	}
	let verified: Verified
	try { verified = await (options.verify ?? verifyIncidentHealthBatch)(batch, options.enrollmentRoot) }
	catch (error) {
		await persistFailure({ failureOutput: options.failureOutput, startedAt, completedAt,
			stage: 'batch_verify', reasonCode: 'BATCH_VERIFY', slots: diagnostics })
		fail('signed batch verification failed; failure evidence retained')
	}
	const success: IncidentSignerHealthSuccessV1 = {
		schema: 'PLEBEIAN_SIGNER_DIAGNOSTIC_SUCCESS_20261108_V1', status: 'PASS', batch, verified,
	}
	await writeCreateOnce(options.output, success, SUCCESS_FILE_LIMIT)
	return verified
}

async function main(argv: string[]): Promise<void> {
	if (argv.length !== 0) fail('arguments are not accepted')
	const verified = await collectIncidentHealthBatch({
		enrollmentRoot: ENROLLMENT_ROOT, attemptMarker: ATTEMPT_MARKER,
		output: OUTPUT, failureOutput: FAILURE_OUTPUT, probe: runLiveProbe,
	})
	process.stdout.write(`${JSON.stringify({
		schema: 'PLEBEIAN_SIGNER_DIAGNOSTIC_COLLECT_20261108_V1', status: 'PASS', ...verified,
	})}\n`)
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)) }
	catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'DEMO_SIGNER_INCIDENT_HEALTH_BATCH: unknown error'}\n`); process.exitCode = 1 }
}
