/**
 * Persistent direct-child stdio transport for one participant worker.
 *
 * Peer facts are derived from the configured enrollment and the OS child
 * handle, never from a participant-controlled response body. A failed or
 * aborted exchange terminates the child so a later process cannot silently
 * continue the same coordinator round.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import type {
	DemoFrostObservedProcess,
	DemoFrostProcessEnrollment,
	DemoFrostProcessExchange,
	DemoFrostProcessRoundOneRequest,
	DemoFrostProcessRoundOneResponse,
	DemoFrostProcessRoundTwoRequest,
	DemoFrostProcessRoundTwoResponse,
	DemoFrostProcessTransport,
} from './demo-frost-process-boundary'
import type { DemoFrostParticipantWorker } from './demo-frost-rust-participant-worker'

type WorkerRequest =
	| { schema: 'COCO_DEMO_FROST_STDIO_REQUEST_V1'; requestId: number; method: 'roundOne'; request: DemoFrostProcessRoundOneRequest }
	| { schema: 'COCO_DEMO_FROST_STDIO_REQUEST_V1'; requestId: number; method: 'roundTwo'; request: DemoFrostProcessRoundTwoRequest }

type WorkerResponse =
	| { schema: 'COCO_DEMO_FROST_STDIO_RESPONSE_V1'; requestId: number; ok: true; message: DemoFrostProcessRoundOneResponse | DemoFrostProcessRoundTwoResponse }
	| { schema: 'COCO_DEMO_FROST_STDIO_RESPONSE_V1'; requestId: number; ok: false; error: string }

interface PendingResponse {
	resolve(value: DemoFrostProcessRoundOneResponse | DemoFrostProcessRoundTwoResponse): void
	reject(error: Error): void
}

export interface DemoFrostStdioProcessTransportOptions {
	command: [string, ...string[]]
	enrollment: DemoFrostProcessEnrollment
	restartCounter: number
	/** Exact child environment; never include long-lived production credentials. */
	env?: NodeJS.ProcessEnv
	/** Local test diagnostic only; the coordinator must never make a policy decision from it. */
	onWorkerRefusal?: (message: string) => void
}

function workerError(message: string): Error {
	return new Error(`DEMO_FROST_STDIO: ${message}`)
}

function writeLine(child: ChildProcessWithoutNullStreams, value: unknown): Promise<void> {
	return new Promise((resolve, reject) => {
		child.stdin.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : resolve())
	})
}

export function createDemoFrostStdioProcessTransport(
	options: DemoFrostStdioProcessTransportOptions,
): DemoFrostProcessTransport & { readonly processId: number; close(): void; waitClosed(): Promise<void> } {
	if (!options.command[0].startsWith('/')) throw workerError('participant executable must be an absolute path')
	if (!Number.isSafeInteger(options.restartCounter) || options.restartCounter < 0) {
		throw workerError('restartCounter must be a non-negative safe integer')
	}
	const child = spawn(options.command[0], options.command.slice(1), {
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
		env: options.env === undefined ? process.env : { ...options.env },
	})
	if (child.pid === undefined) throw workerError('participant child did not receive a pid')
	const processId = child.pid
	const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
	const peer: DemoFrostObservedProcess = {
		...options.enrollment,
		processInstanceId: `${options.enrollment.processIdentity}:pid:${child.pid}`,
		restartCounter: options.restartCounter,
	}
	let nextRequestId = 1
	let closed: Error | undefined
	const pending = new Map<number, PendingResponse>()
	const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
	lines.on('line', (line) => {
		let response: WorkerResponse
		try {
			response = JSON.parse(line) as WorkerResponse
		} catch {
			closed = workerError('participant emitted non-JSON stdout')
			child.kill()
			return
		}
		const waiting = pending.get(response.requestId)
		if (!waiting || response.schema !== 'COCO_DEMO_FROST_STDIO_RESPONSE_V1') {
			closed = workerError('participant emitted an unsolicited or malformed response')
			child.kill()
			return
		}
		pending.delete(response.requestId)
		if (response.ok) waiting.resolve(response.message)
		else {
			try { options.onWorkerRefusal?.(response.error.slice(0, 512)) } catch { /* diagnostics cannot affect protocol */ }
			waiting.reject(workerError(response.error))
		}
	})
	const failAll = (error: Error): void => {
		closed = error
		for (const waiting of pending.values()) waiting.reject(error)
		pending.clear()
	}
	child.once('error', (error) => failAll(workerError(`participant child error: ${error.message}`)))
	child.once('exit', (code, signal) => failAll(workerError(`participant child exited (${code ?? signal ?? 'unknown'})`)))
	// Drain diagnostics so the child cannot block on a full stderr pipe. The
	// coordinator intentionally does not reinterpret diagnostics as protocol.
	child.stderr.resume()

	const exchange = async <T extends DemoFrostProcessRoundOneResponse | DemoFrostProcessRoundTwoResponse>(
		method: 'roundOne' | 'roundTwo',
		request: DemoFrostProcessRoundOneRequest | DemoFrostProcessRoundTwoRequest,
		signal: AbortSignal,
	): Promise<DemoFrostProcessExchange<T>> => {
		if (closed) throw closed
		if (signal.aborted) throw workerError('request aborted before dispatch')
		const requestId = nextRequestId++
		const response = new Promise<DemoFrostProcessRoundOneResponse | DemoFrostProcessRoundTwoResponse>((resolve, reject) => {
			pending.set(requestId, { resolve, reject })
		})
		const abort = (): void => {
			const waiting = pending.get(requestId)
			pending.delete(requestId)
			waiting?.reject(workerError('request aborted'))
			child.kill()
		}
		signal.addEventListener('abort', abort, { once: true })
		try {
			const wireRequest: WorkerRequest = method === 'roundOne'
				? { schema: 'COCO_DEMO_FROST_STDIO_REQUEST_V1', requestId, method, request: request as DemoFrostProcessRoundOneRequest }
				: { schema: 'COCO_DEMO_FROST_STDIO_REQUEST_V1', requestId, method, request: request as DemoFrostProcessRoundTwoRequest }
			await writeLine(child, wireRequest)
			return { peer: { ...peer }, message: await response as T }
		} finally {
			signal.removeEventListener('abort', abort)
		}
	}

	return {
		processId,
		roundOne: (request, { signal }) => exchange<DemoFrostProcessRoundOneResponse>('roundOne', request, signal),
		roundTwo: (request, { signal }) => exchange<DemoFrostProcessRoundTwoResponse>('roundTwo', request, signal),
		close: () => {
			if (!closed) child.kill()
		},
		waitClosed: () => exited,
	}
}

/** Run inside the directly spawned participant child. */
export async function serveDemoFrostParticipantWorker(worker: DemoFrostParticipantWorker): Promise<void> {
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
	let chain = Promise.resolve()
	let activeController: AbortController | undefined
	let stopping = false
	let forcedExit: ReturnType<typeof setTimeout> | undefined
	const stop = (): void => {
		if (stopping) return
		stopping = true
		activeController?.abort()
		lines.close()
		// A non-cooperative injected worker must not keep an orphaned participant
		// process alive forever. The production worker cooperates by killing and
		// awaiting its Rust child as soon as this controller is aborted.
		forcedExit = setTimeout(() => process.exit(143), 2_000)
		forcedExit.unref()
	}
	process.once('SIGTERM', stop)
	process.once('SIGHUP', stop)
	try {
		for await (const line of lines) {
			chain = chain.then(async () => {
				let request: WorkerRequest | undefined
				let controller: AbortController | undefined
				try {
					if (stopping) throw workerError('participant is stopping')
					request = JSON.parse(line) as WorkerRequest
					if (request.schema !== 'COCO_DEMO_FROST_STDIO_REQUEST_V1'
						|| !Number.isSafeInteger(request.requestId)
						|| !['roundOne', 'roundTwo'].includes(request.method)) {
						throw workerError('malformed request')
					}
					controller = new AbortController()
					activeController = controller
					const message = request.method === 'roundOne'
						? await worker.roundOne(request.request as DemoFrostProcessRoundOneRequest, controller.signal)
						: await worker.roundTwo(request.request as DemoFrostProcessRoundTwoRequest, controller.signal)
					const response: WorkerResponse = {
						schema: 'COCO_DEMO_FROST_STDIO_RESPONSE_V1',
						requestId: request.requestId,
						ok: true,
						message,
					}
					process.stdout.write(`${JSON.stringify(response)}\n`)
				} catch (error) {
					const response: WorkerResponse = {
						schema: 'COCO_DEMO_FROST_STDIO_RESPONSE_V1',
						requestId: request?.requestId ?? -1,
						ok: false,
						error: error instanceof Error ? error.message : 'participant refused request',
					}
					process.stdout.write(`${JSON.stringify(response)}\n`)
				} finally {
					if (activeController === controller) activeController = undefined
				}
			})
		}
		stopping = true
		activeController?.abort()
		await chain
	} finally {
		process.removeListener('SIGTERM', stop)
		process.removeListener('SIGHUP', stop)
		if (forcedExit !== undefined) clearTimeout(forcedExit)
	}
}
