import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { EventTemplate } from 'nostr-tools/pure'
import type { NostrEventLike } from './eventLike'

/** NIP-98 HTTP Auth event kind. */
export const HTTP_AUTH_KIND = 27235

export interface HttpAuthTemplateParams {
	/** Absolute request URL, including query string, exactly as the server will see it. */
	url: string
	method: string
	/** Exact request body bytes as sent; a `payload` tag is added when non-empty. */
	body?: string
	createdAt: number
}

export function sha256Hex(text: string): string {
	return bytesToHex(sha256(new TextEncoder().encode(text)))
}

export function buildHttpAuthTemplate(params: HttpAuthTemplateParams): EventTemplate {
	const tags = [
		['u', params.url],
		['method', params.method.toUpperCase()],
	]
	if (params.body) tags.push(['payload', sha256Hex(params.body)])
	return { kind: HTTP_AUTH_KIND, created_at: params.createdAt, content: '', tags }
}

/** Encodes a signed kind 27235 event as an `Authorization` header value. */
export function encodeHttpAuthHeader(event: NostrEventLike): string {
	const { id, pubkey, created_at, kind, tags, content, sig } = event
	return `Nostr ${base64EncodeUtf8(JSON.stringify({ id, pubkey, created_at, kind, tags, content, sig }))}`
}

function base64EncodeUtf8(text: string): string {
	const bytes = new TextEncoder().encode(text)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}
