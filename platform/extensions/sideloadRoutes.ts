import { nip19 } from 'nostr-tools'
import { ExtensionActionError, toExtensionActionErrorResponse, type ExtensionActionErrorCode } from '@sdk/core/extensions'
import { verifyHttpAuth, type HttpAuthReplayCache } from './nip98'
import { MAX_SIDELOADS, type ExtensionStateStore } from './stateStore'

const MAX_BODY_BYTES = 4_096

export interface SideloadRouteDeps {
	store: () => ExtensionStateStore
	isAdmin: (pubkey: string) => boolean
	replayCache: HttpAuthReplayCache
	acceptedOrigins: (request: Request) => readonly string[]
	/** Called after a change so cached repository listings are refreshed. */
	onChange: () => void
	nowMs?: () => number
}

/** Hex pubkey from a hex string or npub; anything else (nsec, nprofile, garbage) is rejected. */
export function parseServerPubkey(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
	if (!trimmed.startsWith('npub1')) return undefined
	try {
		const decoded = nip19.decode(trimmed)
		return decoded.type === 'npub' ? decoded.data : undefined
	} catch {
		return undefined
	}
}

/**
 * `POST /api/extensions/sideloads` and `DELETE /api/extensions/sideloads/:pubkey` (ADR-0023 §7.2). Admin-only via
 * NIP-98; non-admins get 404 like the catalog. Sideloading lists a server for review; it grants it nothing.
 */
export function createSideloadHandlers(deps: SideloadRouteDeps) {
	const now = deps.nowMs ?? (() => Date.now())

	const authenticate = (request: Request, body: string) => {
		const url = new URL(request.url)
		return verifyHttpAuth({
			authorization: request.headers.get('authorization'),
			acceptedUrls: deps.acceptedOrigins(request).map((origin) => `${origin}${url.pathname}${url.search}`),
			method: request.method,
			body,
			nowSeconds: Math.floor(now() / 1000),
			replayCache: deps.replayCache,
		})
	}

	const add = async (request: Request): Promise<Response> => {
		const declared = Number(request.headers.get('content-length'))
		if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return error('invalid_input')
		const body = await request.text().catch(() => undefined)
		if (body === undefined || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return error('invalid_input')

		const auth = authenticate(request, body)
		if (!auth.ok) return error('unauthorized')
		if (!deps.isAdmin(auth.pubkey)) return error('not_found')

		let server: string | undefined
		try {
			server = parseServerPubkey((JSON.parse(body) as { server?: unknown }).server)
		} catch {
			server = undefined
		}
		if (!server) return error('invalid_input', 'Enter a server pubkey as 64-character hex or npub')

		const result = deps.store().addSideload({ pubkey: server, addedBy: auth.pubkey, addedAt: Math.floor(now() / 1000) })
		if (result === 'limit_reached') return error('invalid_input', `At most ${MAX_SIDELOADS} servers can be sideloaded`)
		if (result === 'added') deps.onChange()
		return ok({ pubkey: server })
	}

	const remove = async (request: Request & { params?: Record<string, string> }): Promise<Response> => {
		const auth = authenticate(request, '')
		if (!auth.ok) return error('unauthorized')
		if (!deps.isAdmin(auth.pubkey)) return error('not_found')
		const pubkey = parseServerPubkey(request.params?.pubkey)
		if (!pubkey || !deps.store().removeSideload(pubkey)) return error('not_found')
		deps.onChange()
		return ok({ pubkey })
	}

	return { add, remove }
}

function ok(value: unknown): Response {
	return Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } })
}

function error(code: ExtensionActionErrorCode, message?: string): Response {
	const response = toExtensionActionErrorResponse(new ExtensionActionError(code))
	const body = message ? { ...response.body, error: { ...response.body.error, message } } : response.body
	return Response.json(body, {
		status: response.status,
		headers: { 'cache-control': 'no-store', ...(code === 'unauthorized' ? { 'www-authenticate': 'Nostr' } : {}) },
	})
}
