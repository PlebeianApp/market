/**
 * Authenticated-process boundary for participant-local admission policy.
 *
 * The coordinator receives only the derived public evidence. Mint proofs,
 * proof-use storage and Comet trust roots stay inside the participant worker.
 * The local live harness derives the peer PID from the child handle; the
 * four-host FIPS RPC must additionally authenticate the configured signer
 * identity and is still a separate deployment gate.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import type {
	DemoAdmissionParticipantPolicyRequestV1,
	DemoAdmissionParticipantPorts,
} from './demo-integrated-admission-service'
import type { DemoIntegratedAdmissionPolicyEvidenceV1 } from './demo-integrated-admission-policy'

type ParticipantId = 1 | 2 | 3 | 4

interface RequestEnvelope {
	schema: 'COCO_DEMO_ADMISSION_PARTICIPANT_REQUEST_V1'
	requestId: number
	participantId: ParticipantId
	request: DemoAdmissionParticipantPolicyRequestV1
}

type ResponseEnvelope =
	| { schema: 'COCO_DEMO_ADMISSION_PARTICIPANT_RESPONSE_V1'; requestId: number; participantId: ParticipantId; ok: true; evidence: DemoIntegratedAdmissionPolicyEvidenceV1 }
	| { schema: 'COCO_DEMO_ADMISSION_PARTICIPANT_RESPONSE_V1'; requestId: number; participantId: ParticipantId; ok: false; error: string }

interface Pending {
	resolve(value: DemoIntegratedAdmissionPolicyEvidenceV1): void
	reject(error: Error): void
}

export interface DemoAdmissionParticipantProcess extends DemoAdmissionParticipantPorts {
	readonly processId: number
	close(): Promise<void>
}

function fail(message: string): Error { return new Error(`DEMO_ADMISSION_PARTICIPANT_PROCESS: ${message}`) }

function exactAbsoluteCommand(command: [string, ...string[]]): void {
	if (!command[0].startsWith('/') || command[0] === '/' || command[0].includes('//')
		|| command[0].split('/').some((part) => part === '.' || part === '..')) {
		throw fail('worker executable must be a canonical absolute path')
	}
}

function writeLine(child: ChildProcessWithoutNullStreams, value: unknown): Promise<void> {
	return new Promise((resolve, reject) => child.stdin.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : resolve()))
}

export function createDemoAdmissionParticipantProcess(options: {
	participantId: ParticipantId
	command: [string, ...string[]]
	/** Exact environment for the isolated worker. Callers must not put bearer proofs here. */
	env?: NodeJS.ProcessEnv
}): DemoAdmissionParticipantProcess {
	exactAbsoluteCommand(options.command)
	const child = spawn(options.command[0], options.command.slice(1), {
		stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
		env: options.env === undefined ? process.env : { ...options.env },
	})
	if (child.pid === undefined) throw fail('worker received no operating-system pid')
	const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
	child.stderr.resume()
	let sequence = 1
	let closed: Error | undefined
	const pending = new Map<number, Pending>()
	const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
	const failAll = (error: Error): void => {
		closed = error
		for (const waiter of pending.values()) waiter.reject(error)
		pending.clear()
	}
	lines.on('line', (line) => {
		let response: ResponseEnvelope
		try { response = JSON.parse(line) as ResponseEnvelope }
		catch { child.kill(); return failAll(fail('worker emitted non-JSON stdout')) }
		const waiter = pending.get(response.requestId)
		if (waiter === undefined || response.schema !== 'COCO_DEMO_ADMISSION_PARTICIPANT_RESPONSE_V1'
			|| response.participantId !== options.participantId) {
			child.kill(); return failAll(fail('worker emitted unsolicited or wrong-identity output'))
		}
		pending.delete(response.requestId)
		if (response.ok) waiter.resolve(structuredClone(response.evidence))
		else waiter.reject(fail(response.error))
	})
	child.once('error', (error) => failAll(fail(`worker error: ${error.message}`)))
	child.once('exit', (code, signal) => failAll(fail(`worker exited (${code ?? signal ?? 'unknown'})`)))

	return Object.freeze({
		participantId: options.participantId,
		processId: child.pid,
		async validateExact(request: DemoAdmissionParticipantPolicyRequestV1) {
			if (closed !== undefined) throw closed
			const requestId = sequence++
			const result = new Promise<DemoIntegratedAdmissionPolicyEvidenceV1>((resolve, reject) => pending.set(requestId, { resolve, reject }))
			await writeLine(child, {
				schema: 'COCO_DEMO_ADMISSION_PARTICIPANT_REQUEST_V1', requestId,
				participantId: options.participantId, request: structuredClone(request),
			} satisfies RequestEnvelope)
			return result
		},
		async close() {
			if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
			await exited
		},
	})
}

/** Run in the participant process after constructing local mint/Comet/store ports. */
export async function serveDemoAdmissionParticipant(worker: DemoAdmissionParticipantPorts): Promise<void> {
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
	for await (const line of lines) {
		let envelope: RequestEnvelope | undefined
		try {
			envelope = JSON.parse(line) as RequestEnvelope
			if (envelope.schema !== 'COCO_DEMO_ADMISSION_PARTICIPANT_REQUEST_V1'
				|| envelope.participantId !== worker.participantId || !Number.isSafeInteger(envelope.requestId)) {
				throw fail('malformed or wrong-identity request')
			}
			// The participant owns admission time. A coordinator cannot extend a
			// receipt by supplying an earlier clock value on the wire.
			const localRequest = structuredClone(envelope.request)
			localRequest.nowSeconds = Math.floor(Date.now() / 1000)
			const evidence = await worker.validateExact(localRequest)
			const response: ResponseEnvelope = {
				schema: 'COCO_DEMO_ADMISSION_PARTICIPANT_RESPONSE_V1', requestId: envelope.requestId,
				participantId: worker.participantId, ok: true, evidence: structuredClone(evidence),
			}
			process.stdout.write(`${JSON.stringify(response)}\n`)
		} catch (error) {
			const response: ResponseEnvelope = {
				schema: 'COCO_DEMO_ADMISSION_PARTICIPANT_RESPONSE_V1', requestId: envelope?.requestId ?? -1,
				participantId: worker.participantId, ok: false,
				error: error instanceof Error ? error.message : 'participant refused request',
			}
			process.stdout.write(`${JSON.stringify(response)}\n`)
		}
	}
}
