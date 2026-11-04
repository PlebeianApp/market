import { failure, success } from '@sdk/core/result'
import {
	EXTENSION_HTTP_METHODS,
	ExtensionHttpError,
	isEgressAllowed,
	isLocalhostOrigin,
	parseEgressOrigin,
	type ExtensionHttpResponse,
	type ScopedHttpPort,
} from '@sdk/core/extensions'

export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>

export interface ScopedHttpPortOptions {
	/** Origins declared in the extension manifest. */
	egress: readonly string[]
	/** Operator allowlist; when set, the effective egress is the intersection with the manifest. */
	operatorEgress?: readonly string[]
	/** Loopback origins are permitted only outside production. */
	allowLocalhost: boolean
	fetch?: HttpFetch
	timeoutMs?: number
	maxResponseBytes?: number
	maxRequestBytes?: number
	/** Aborts every in-flight request when the extension stops. */
	signal?: AbortSignal
}

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000
export const DEFAULT_MAX_REQUEST_BYTES = 256_000

/** Computes the origins an extension may reach: manifest ∩ operator allowlist, minus loopback in production. */
export function resolveEffectiveEgress(options: Pick<ScopedHttpPortOptions, 'egress' | 'operatorEgress' | 'allowLocalhost'>): string[] {
	const normalize = (values: readonly string[]) =>
		values.flatMap((value) => {
			const parsed = parseEgressOrigin(value)
			return parsed.ok ? [parsed.value] : []
		})
	const declared = normalize(options.egress)
	const operator = options.operatorEgress ? new Set(normalize(options.operatorEgress)) : undefined
	return [...new Set(declared)].filter(
		(origin) => (!operator || operator.has(origin)) && (options.allowLocalhost || !isLocalhostOrigin(origin)),
	)
}

/**
 * Egress-restricted HTTP for one extension. Redirects are never followed (a redirect could leave the
 * allowlist), each request has a deadline, and bodies are read with a hard size cap.
 */
export function createScopedHttpPort(options: ScopedHttpPortOptions): ScopedHttpPort {
	const allowed = resolveEffectiveEgress(options)
	const fetchImpl: HttpFetch = options.fetch ?? ((url, init) => fetch(url, init))
	const defaultTimeout = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS
	const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
	const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES

	return {
		async request(request) {
			if (!isEgressAllowed(request.url, allowed)) {
				return failure(new ExtensionHttpError('egress_denied', 'Origin is not in the extension egress allowlist'))
			}
			const method = request.method ?? 'GET'
			if (!EXTENSION_HTTP_METHODS.includes(method)) return failure(new ExtensionHttpError('network', 'Unsupported HTTP method'))
			if (request.body !== undefined && new TextEncoder().encode(request.body).byteLength > maxRequestBytes) {
				return failure(new ExtensionHttpError('network', 'Request body exceeds the size limit'))
			}

			const timeoutMs = Math.min(request.timeoutMs ?? defaultTimeout, defaultTimeout)
			const timeout = AbortSignal.timeout(timeoutMs)
			const signals = [timeout, request.signal, options.signal].filter((signal): signal is AbortSignal => signal !== undefined)
			const signal = AbortSignal.any(signals)

			try {
				const response = await fetchImpl(request.url, {
					method,
					headers: request.headers ? { ...request.headers } : undefined,
					body: request.body,
					signal,
					redirect: 'manual',
				})
				const body = await readCapped(response, maxResponseBytes)
				if (body === undefined) return failure(new ExtensionHttpError('response_too_large', 'Response exceeds the size limit'))
				const result: ExtensionHttpResponse = { status: response.status, headers: headersToRecord(response.headers), body }
				return success(result)
			} catch {
				if (timeout.aborted) return failure(new ExtensionHttpError('timeout', `Request timed out after ${timeoutMs}ms`))
				if (signal.aborted) return failure(new ExtensionHttpError('aborted', 'Request was aborted'))
				// The cause is withheld: transport errors can include URLs with credentials or provider detail.
				return failure(new ExtensionHttpError('network', 'Request failed'))
			}
		},
	}
}

async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
	const declared = Number(response.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > maxBytes) {
		await response.body?.cancel().catch(() => undefined)
		return undefined
	}
	if (!response.body) return ''
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		total += value.byteLength
		if (total > maxBytes) {
			await reader.cancel().catch(() => undefined)
			return undefined
		}
		chunks.push(value)
	}
	const bytes = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return new TextDecoder().decode(bytes)
}

function headersToRecord(headers: Headers): Record<string, string> {
	const record: Record<string, string> = {}
	headers.forEach((value, key) => {
		if (key !== 'set-cookie') record[key] = value
	})
	return record
}
