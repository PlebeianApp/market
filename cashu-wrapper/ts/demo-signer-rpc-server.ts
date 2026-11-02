/**
 * Bounded HTTP listener for SignerRPCV1 over an already-established FIPS ULA.
 * FIPS supplies encrypted/routed transport; signed request/response envelopes
 * in demo-signer-rpc supply payment-service authentication.
 *
 * This module does not create a FIPS identity, interface, route or firewall.
 */
import type { DemoSignerRpcResponseV1 } from './demo-signer-rpc'
import { isIP } from 'node:net'
import { DemoSignerCachedRejection, DemoSignerOpaquePolicyRefusal } from './demo-signer-pure-policy'
import { DemoSignerTransientReadUnavailable } from './demo-signer-v1-local-attempt'

const MAX_BODY_BYTES = 256 * 1024

export interface DemoSignerRpcServerBinding {
	hostname: string
	port: number
}

export interface DemoSignerRpcHttpServer {
	readonly url: string
	stop(): Promise<void>
}

function exactFipsUla(value: string): string {
	const normalized = value.replaceAll('[', '').replaceAll(']', '').toLowerCase()
	if (isIP(normalized) !== 6 || !/^(?:fc|fd)/.test(normalized) || normalized.includes('%')) {
		throw new Error('DEMO_SIGNER_RPC_LISTENER: listener must be an exact FIPS IPv6 ULA without a zone identifier')
	}
	return normalized
}

async function boundedJson(request: Request, signal: AbortSignal, checkDeadline: () => void): Promise<unknown> {
	const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
	const advertised = Number(request.headers.get('content-length') ?? '0')
	const reader = request.body?.getReader()
	let canceled = false, complete = false
	const cancel = () => {
		if (canceled || reader === undefined) return
		canceled = true
		// Cancellation is requested, never awaited: a hostile source may not drain.
		try { void reader.cancel().catch(() => undefined) } catch { /* Reader already closed. */ }
	}
	try {
		checkDeadline()
		if (contentType !== 'application/json' || !Number.isSafeInteger(advertised) || advertised < 0 || advertised > MAX_BODY_BYTES) {
			throw new Error('DEMO_SIGNER_RPC_HTTP: invalid content type or body length')
		}
		if (reader === undefined) throw new Error('DEMO_SIGNER_RPC_HTTP: invalid body size')
		// One fixed buffer, including one-byte and zero-byte stream chunks. Never
		// retain an over-budget chunk or accumulate a list of pending race handlers.
		const buffer = new Uint8Array(MAX_BODY_BYTES)
		let used = 0
		for (;;) {
			checkDeadline()
			const chunk = await new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
				const onAbort = () => { cancel(); reject(signal.reason) }
				signal.addEventListener('abort', onAbort, { once: true })
				if (signal.aborted) { signal.removeEventListener('abort', onAbort); onAbort(); return }
				// Both callbacks remain attached even after abort/releaseLock, so late
				// read rejection cannot become an unhandled promise or dispatch work.
				void reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
			})
			checkDeadline() // Includes the read/EOF/abort race.
			if (chunk.done) break
			if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > MAX_BODY_BYTES - used) {
				throw new Error('DEMO_SIGNER_RPC_HTTP: invalid body size')
			}
			buffer.set(chunk.value, used); used += chunk.value.byteLength
		}
		if (used === 0) throw new Error('DEMO_SIGNER_RPC_HTTP: invalid body size')
		const body = JSON.parse(new TextDecoder().decode(buffer.subarray(0, used))) as unknown
		checkDeadline()
		complete = true
		return body
	} finally {
		if (!complete) cancel()
		try { reader?.releaseLock() } catch { /* Pending read is canceled and handled above. */ }
	}
}

export function createDemoSignerRpcHttpServer(options: {
	binding: DemoSignerRpcServerBinding
	handle: (body: unknown, signal: AbortSignal) => Promise<DemoSignerRpcResponseV1>
	admissionHandle?: (body: unknown, signal: AbortSignal) => Promise<unknown>
	fundingAbortHandle?: (body: unknown, signal: AbortSignal) => Promise<unknown>
	healthHandle?: (body: unknown, signal: AbortSignal) => Promise<unknown>
	requestTimeoutMs?: number
}): DemoSignerRpcHttpServer {
	const hostname = exactFipsUla(options.binding.hostname)
	if (!Number.isSafeInteger(options.binding.port) || options.binding.port < 1_024 || options.binding.port > 65_535) {
		throw new Error('DEMO_SIGNER_RPC_LISTENER: port is outside the bounded non-privileged range')
	}
	const requestTimeoutMs = options.requestTimeoutMs ?? 15_000
	if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30_000) {
		throw new Error('DEMO_SIGNER_RPC_LISTENER: request timeout is invalid')
	}
	const server = Bun.serve({
		hostname,
		port: options.binding.port,
		idleTimeout: Math.ceil(requestTimeoutMs / 1_000),
		maxRequestBodySize: MAX_BODY_BYTES,
		async fetch(request) {
			const url = new URL(request.url)
			if (request.method !== 'POST' || !['/v1/frost', '/v1/admission', '/v1/funding-abort', '/v1/health'].includes(url.pathname)
				|| url.search !== '' || (url.pathname === '/v1/health' && options.healthHandle === undefined) || (url.pathname === '/v1/admission' && options.admissionHandle === undefined)
				|| (url.pathname === '/v1/funding-abort' && options.fundingAbortHandle === undefined)) {
				return Response.json({ error: 'not found' }, { status: 404 })
			}
			if (request.headers.get('x-plebeian-fips-plaintext-probe') !== 'PLEBEIAN-FRIDAY-SIGNER-TRANSPORT-V1') {
				return Response.json({ error: 'missing reviewed FIPS plaintext probe' }, { status: 403 })
			}
			const abort = new AbortController()
			const operationSignal = AbortSignal.any([abort.signal, request.signal])
			const deadline = performance.now() + requestTimeoutMs
			const timer = setTimeout(() => abort.abort(new Error('signer request timed out')), requestTimeoutMs)
			const checkDeadline = () => {
				if (performance.now() >= deadline && !abort.signal.aborted) abort.abort(new Error('signer request timed out'))
				operationSignal.throwIfAborted()
			}
			try {
				const body = await boundedJson(request, operationSignal, checkDeadline)
				checkDeadline()
				const response = url.pathname === '/v1/health' ? await options.healthHandle!(body, operationSignal) : url.pathname === '/v1/frost'
					? await options.handle(body, operationSignal)
					: url.pathname === '/v1/admission'
						? await options.admissionHandle!(body, operationSignal)
						: await options.fundingAbortHandle!(body, operationSignal)
				return Response.json(response, { status: 200, headers: { 'cache-control': 'no-store' } })
			} catch (error) {
				return demoSignerRpcErrorResponse(error)
			} finally {
				clearTimeout(timer)
			}
		},
	})
	return Object.freeze({
		url: `http://[${hostname}]:${server.port}/v1/frost`,
		async stop() { await server.stop(true) },
	})
}


/** V1-compatible errors are opaque. Typed cached bytes bypass legacy regex. */
export function demoSignerRpcErrorResponse(error: unknown): Response {
	if (error instanceof DemoSignerCachedRejection || error instanceof DemoSignerOpaquePolicyRefusal) return new Response(error.body, {
		status: 422, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	})
	if (error instanceof DemoSignerTransientReadUnavailable) return Response.json({ error: 'signer observation temporarily unavailable' }, {
		status: 503, headers: { 'cache-control': 'no-store' },
	})
	const message = error instanceof Error ? error.message : 'signer request refused'
	const status = /AUTHENTICATION|AUTHORITY|QUARANTINED|BINDING/.test(message) ? 403 : 422
	return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } })
}
