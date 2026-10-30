import { ValidationError } from '../errors'
import type { NostrEventLike } from '../nostr/eventLike'
import type { NostrFilter, RelayPublishResult } from '../ports/nostrRelay'
import type { KeyValueStoragePort } from '../ports/storage'
import { failure, success, type Result } from '../result'

export const EXTENSION_HOST_PORTS = ['relays:read', 'relays:publish', 'http', 'storage'] as const
export type ExtensionHostPortName = (typeof EXTENSION_HOST_PORTS)[number]

export interface ScopedRelayQueryOptions {
	signal?: AbortSignal
}

/**
 * Relay access bound by Platform to the instance's relay list. Extensions cannot choose relay targets.
 * `publish` is present only when `relays:publish` is granted and accepts already-signed events only.
 */
export interface ScopedRelayPort<Event extends NostrEventLike = NostrEventLike> {
	fetchEvents(filters: NostrFilter | readonly NostrFilter[], options?: ScopedRelayQueryOptions): Promise<Event[]>
	subscribe(filters: NostrFilter | readonly NostrFilter[], onEvent: (event: Event) => void): () => void
	publish?(event: Event & { sig: string }): Promise<RelayPublishResult>
}

export const EXTENSION_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type ExtensionHttpMethod = (typeof EXTENSION_HTTP_METHODS)[number]

export interface ExtensionHttpRequest {
	url: string
	method?: ExtensionHttpMethod
	headers?: Readonly<Record<string, string>>
	body?: string
	signal?: AbortSignal
	/** Upper bound only; Platform may enforce a lower per-request timeout. */
	timeoutMs?: number
}

/** Fully-read, size-capped response. Bodies are untrusted provider data. */
export interface ExtensionHttpResponse {
	status: number
	headers: Readonly<Record<string, string>>
	body: string
}

export type ExtensionHttpErrorReason = 'egress_denied' | 'timeout' | 'aborted' | 'response_too_large' | 'network'

export class ExtensionHttpError extends Error {
	readonly reason: ExtensionHttpErrorReason

	constructor(reason: ExtensionHttpErrorReason, message: string) {
		super(message)
		this.name = 'ExtensionHttpError'
		this.reason = reason
	}
}

/** Egress restricted to declared origins; there is no ambient `fetch` for extensions. */
export interface ScopedHttpPort {
	request(request: ExtensionHttpRequest): Promise<Result<ExtensionHttpResponse, ExtensionHttpError>>
}

export type ExtensionLogFields = Readonly<Record<string, unknown>>

/** Platform implementations redact privateConfig values before anything is written. */
export interface ExtensionLogger {
	debug(message: string, fields?: ExtensionLogFields): void
	info(message: string, fields?: ExtensionLogFields): void
	warn(message: string, fields?: ExtensionLogFields): void
	error(message: string, fields?: ExtensionLogFields): void
}

/** Ports present only when the manifest requests them and the operator enables them. */
export interface ExtensionHostPorts {
	relays?: ScopedRelayPort
	http?: ScopedHttpPort
	/** Namespaced to the extension id by Platform. */
	storage?: KeyValueStoragePort
	log: ExtensionLogger
}

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Normalizes an egress entry to a bare origin. https only; http only for loopback hosts. */
export function parseEgressOrigin(value: string): Result<string, ValidationError> {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		return failure(new ValidationError('Egress entry must be an absolute URL origin'))
	}
	if (url.username || url.password) return failure(new ValidationError('Egress origin must not contain credentials'))
	if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
		return failure(new ValidationError('Egress entry must be an origin without path, query, or fragment'))
	}
	if (url.protocol === 'https:') return success(url.origin)
	if (url.protocol === 'http:' && LOCALHOST_NAMES.has(url.hostname)) return success(url.origin)
	return failure(new ValidationError('Egress origin must use https (http is allowed for localhost only)'))
}

export function isLocalhostOrigin(origin: string): boolean {
	try {
		return LOCALHOST_NAMES.has(new URL(origin).hostname)
	} catch {
		return false
	}
}

/** True only if the request URL's origin exactly matches an allowed origin. Unparseable URLs are denied. */
export function isEgressAllowed(requestUrl: string, allowedOrigins: readonly string[]): boolean {
	let origin: string
	try {
		const url = new URL(requestUrl)
		if (url.username || url.password) return false
		origin = url.origin
	} catch {
		return false
	}
	return allowedOrigins.some((allowed) => {
		const parsed = parseEgressOrigin(allowed)
		return parsed.ok && parsed.value === origin
	})
}

/** Parses an untrusted JSON response body without throwing. */
export function parseJsonResponseBody(response: ExtensionHttpResponse): Result<unknown, ValidationError> {
	try {
		return success(JSON.parse(response.body) as unknown)
	} catch {
		return failure(new ValidationError('Response body is not valid JSON'))
	}
}
