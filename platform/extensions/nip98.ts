import { HTTP_AUTH_KIND, sha256Hex } from '@sdk/core/nostr/nip98'
import { verifyNostrEvent } from '@sdk/core/nostr/eventValidation'

export const NIP98_MAX_SKEW_SECONDS = 60
const MAX_HEADER_LENGTH = 8_192

export type HttpAuthFailureReason =
	| 'missing'
	| 'malformed'
	| 'bad_signature'
	| 'wrong_kind'
	| 'stale'
	| 'url_mismatch'
	| 'method_mismatch'
	| 'payload_mismatch'
	| 'replayed'

export type HttpAuthResult = { ok: true; pubkey: string; eventId: string } | { ok: false; reason: HttpAuthFailureReason }

/** Remembers accepted auth event ids for the skew window so a captured header cannot be replayed. */
export class HttpAuthReplayCache {
	private readonly seen = new Map<string, number>()

	constructor(private readonly ttlSeconds = NIP98_MAX_SKEW_SECONDS * 2 + 5) {}

	/** Returns false if the id was already used; otherwise records it. */
	claim(eventId: string, nowSeconds: number): boolean {
		this.prune(nowSeconds)
		if (this.seen.has(eventId)) return false
		this.seen.set(eventId, nowSeconds + this.ttlSeconds)
		return true
	}

	get size(): number {
		return this.seen.size
	}

	private prune(nowSeconds: number) {
		for (const [id, expiresAt] of this.seen) if (expiresAt <= nowSeconds) this.seen.delete(id)
	}
}

export interface VerifyHttpAuthParams {
	authorization: string | null
	/** Absolute URLs (including query) the event's `u` tag may equal. */
	acceptedUrls: readonly string[]
	method: string
	/** Raw request body exactly as received. */
	body: string
	nowSeconds: number
	replayCache: HttpAuthReplayCache
	maxSkewSeconds?: number
}

/**
 * Verifies a NIP-98 `Authorization: Nostr <base64 event>` header: signature, kind 27235, `created_at`
 * within the skew window, exact `u` and `method`, and the body hash. A non-empty body requires `payload`.
 */
export function verifyHttpAuth(params: VerifyHttpAuthParams): HttpAuthResult {
	const header = params.authorization?.trim()
	if (!header) return { ok: false, reason: 'missing' }
	if (header.length > MAX_HEADER_LENGTH || !/^Nostr\s+/i.test(header)) return { ok: false, reason: 'malformed' }

	let decoded: unknown
	try {
		decoded = JSON.parse(base64DecodeUtf8(header.replace(/^Nostr\s+/i, '')))
	} catch {
		return { ok: false, reason: 'malformed' }
	}

	const verified = verifyNostrEvent(decoded)
	if (!verified.ok) return { ok: false, reason: verified.error.path?.[0] === 'sig' ? 'bad_signature' : 'malformed' }
	const event = verified.value
	if (event.kind !== HTTP_AUTH_KIND) return { ok: false, reason: 'wrong_kind' }

	const skew = params.maxSkewSeconds ?? NIP98_MAX_SKEW_SECONDS
	if (Math.abs(params.nowSeconds - event.created_at) > skew) return { ok: false, reason: 'stale' }

	const tag = (name: string) => {
		const values = event.tags.filter((item) => item[0] === name)
		return values.length === 1 ? values[0][1] : undefined
	}
	const url = tag('u')
	if (!url || !params.acceptedUrls.includes(url)) return { ok: false, reason: 'url_mismatch' }
	if (tag('method')?.toUpperCase() !== params.method.toUpperCase()) return { ok: false, reason: 'method_mismatch' }

	const payload = tag('payload')
	if (params.body.length > 0 || payload !== undefined) {
		if (!payload || payload.toLowerCase() !== sha256Hex(params.body)) return { ok: false, reason: 'payload_mismatch' }
	}

	if (!params.replayCache.claim(event.id, params.nowSeconds)) return { ok: false, reason: 'replayed' }
	return { ok: true, pubkey: event.pubkey, eventId: event.id }
}

function base64DecodeUtf8(value: string): string {
	const binary = atob(value.trim())
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
