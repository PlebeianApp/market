import { verifyEvent, type Event } from 'nostr-tools/pure'

/**
 * NIP-98 HTTP-Auth helpers.
 *
 * The path-oracle backend exposes two privileged HTTP endpoints
 * (`/api/auctions/path-request`, `/api/auctions/settlement-plan`) that the
 * AUCTIONS spec §7.5.1 / §7.5.3 says MUST authenticate the caller's Nostr
 * identity. NIP-98 is the standard way to do that without restructuring the
 * existing fetch flows: the caller signs a kind-27235 event covering the URL
 * + method (+ optional body sha256) and ships it as
 * `Authorization: Nostr <base64(eventJson)>`. The backend verifies the
 * signature and returns the signer's pubkey.
 */

export const NIP98_HTTP_AUTH_KIND = 27235
const NIP98_DEFAULT_MAX_AGE_SECONDS = 60

export interface VerifiedNip98Auth {
	pubkey: string
	event: Event
}

const decodeBase64ToString = (input: string): string => {
	if (typeof globalThis.atob === 'function') return globalThis.atob(input)
	return Buffer.from(input, 'base64').toString('utf-8')
}

const encodeStringToBase64 = (input: string): string => {
	if (typeof globalThis.btoa === 'function') return globalThis.btoa(input)
	return Buffer.from(input, 'utf-8').toString('base64')
}

const sha256Hex = async (value: string): Promise<string> => {
	const data = new TextEncoder().encode(value)
	const digest = await crypto.subtle.digest('SHA-256', data)
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

const getTagValue = (event: Event, name: string): string | undefined => event.tags.find((tag) => tag[0] === name)?.[1]

/**
 * Reconstruct the public-facing URL the browser saw when calling this
 * endpoint. Bun's `req.url` reports the *internal* URL (e.g.
 * `http://0.0.0.0:3000/...`), but the browser signs the public URL
 * (`https://auctionsdev.plebeian.market/...`). When this server is behind a
 * TLS terminator / reverse proxy, the proxy MUST forward the original
 * scheme + host (we honour the standard `X-Forwarded-Proto` /
 * `X-Forwarded-Host` headers).
 */
export const resolvePublicRequestUrl = (req: Request): string => {
	const url = new URL(req.url)
	const fwdProto = req.headers.get('x-forwarded-proto')
	const fwdHost = req.headers.get('x-forwarded-host') || req.headers.get('host')
	if (fwdProto) url.protocol = fwdProto.split(',')[0].trim() + ':'
	if (fwdHost) {
		const hostValue = fwdHost.split(',')[0].trim()
		const colonIndex = hostValue.lastIndexOf(':')
		if (colonIndex > 0) {
			url.hostname = hostValue.slice(0, colonIndex)
			url.port = hostValue.slice(colonIndex + 1)
		} else {
			url.hostname = hostValue
			url.port = ''
		}
	}
	return url.toString()
}

/**
 * Verify a NIP-98 Authorization header. Throws on any mismatch (malformed,
 * stale, wrong URL/method, bad signature, body hash mismatch). Returns the
 * verified signer pubkey on success.
 *
 * `requestUrl` MUST be the full external URL the client invoked (scheme +
 * host + path + query). When behind a reverse proxy use
 * `resolvePublicRequestUrl(req)` to derive it from `X-Forwarded-*` headers.
 */
export const verifyNip98HttpAuth = async (params: {
	authorizationHeader: string | null | undefined
	requestUrl: string
	method: string
	body?: string
	maxAgeSeconds?: number
}): Promise<VerifiedNip98Auth> => {
	const header = (params.authorizationHeader || '').trim()
	if (!header) throw new Error('Missing Authorization header (NIP-98 required)')
	const match = /^Nostr\s+(.+)$/i.exec(header)
	if (!match) throw new Error('Authorization header must use the "Nostr" scheme (NIP-98)')

	let event: Event
	try {
		const json = decodeBase64ToString(match[1].trim())
		event = JSON.parse(json) as Event
	} catch {
		throw new Error('Authorization payload is not valid base64-encoded JSON')
	}

	if (event.kind !== NIP98_HTTP_AUTH_KIND) {
		throw new Error(`Authorization event must be kind ${NIP98_HTTP_AUTH_KIND}`)
	}

	const maxAge = params.maxAgeSeconds ?? NIP98_DEFAULT_MAX_AGE_SECONDS
	const now = Math.floor(Date.now() / 1000)
	if (Math.abs(now - (event.created_at || 0)) > maxAge) {
		throw new Error('Authorization event is stale')
	}

	const taggedUrl = getTagValue(event, 'u')
	if (!taggedUrl) throw new Error('Authorization event is missing required "u" tag')
	if (taggedUrl !== params.requestUrl) {
		throw new Error('Authorization "u" tag does not match the request URL')
	}

	const taggedMethod = getTagValue(event, 'method')
	if (!taggedMethod) throw new Error('Authorization event is missing required "method" tag')
	if (taggedMethod.toUpperCase() !== params.method.toUpperCase()) {
		throw new Error('Authorization "method" tag does not match the request method')
	}

	if (params.body && params.body.length > 0) {
		const taggedPayload = getTagValue(event, 'payload')
		if (!taggedPayload) {
			throw new Error('Authorization event is missing required "payload" tag for non-empty body')
		}
		const expectedHash = await sha256Hex(params.body)
		if (taggedPayload.toLowerCase() !== expectedHash.toLowerCase()) {
			throw new Error('Authorization "payload" tag does not match request body sha256')
		}
	}

	if (!verifyEvent(event)) {
		throw new Error('Authorization event signature is invalid')
	}

	return { pubkey: event.pubkey, event }
}

/**
 * Build the `Authorization: Nostr <base64(event)>` header value from a
 * NIP-98 event. The event MUST already be signed by the caller.
 */
export const formatNip98AuthorizationHeader = (signedEvent: Event): string => {
	const json = JSON.stringify(signedEvent)
	return `Nostr ${encodeStringToBase64(json)}`
}

/**
 * Compute the canonical request URL string used as the `u` tag in the
 * NIP-98 event. Browsers receive their own `window.location` so this is
 * usually trivial; we expose a helper to keep call sites symmetric with the
 * server.
 */
export const buildNip98PayloadHash = sha256Hex

export const buildNip98AuthEventTemplate = async (params: {
	requestUrl: string
	method: string
	body?: string
	createdAt?: number
}): Promise<{
	kind: number
	created_at: number
	tags: string[][]
	content: string
}> => {
	const tags: string[][] = [
		['u', params.requestUrl],
		['method', params.method.toUpperCase()],
	]
	if (params.body && params.body.length > 0) {
		tags.push(['payload', await sha256Hex(params.body)])
	}
	return {
		kind: NIP98_HTTP_AUTH_KIND,
		created_at: params.createdAt ?? Math.floor(Date.now() / 1000),
		tags,
		content: '',
	}
}
