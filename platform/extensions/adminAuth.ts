import { ExtensionActionError, toExtensionActionErrorResponse, type ExtensionActionErrorCode } from '@sdk/core/extensions'
import { verifyHttpAuth, type HttpAuthReplayCache } from './nip98'

export const MAX_ADMIN_BODY_BYTES = 8_192

export interface AdminAuthDeps {
	isAdmin: (pubkey: string) => boolean
	replayCache: HttpAuthReplayCache
	acceptedOrigins: (request: Request) => readonly string[]
	nowMs?: () => number
}

export type AdminRequestResult = { ok: true; pubkey: string; body: string } | { ok: false; response: Response }

/**
 * Reads a capped body and authenticates an extension store admin request with NIP-98. Non-admins get 404, so the
 * store's endpoints are indistinguishable from missing ones for public visitors.
 */
export async function authenticateAdminRequest(request: Request, deps: AdminAuthDeps): Promise<AdminRequestResult> {
	const declared = Number(request.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > MAX_ADMIN_BODY_BYTES) return { ok: false, response: adminError('invalid_input') }
	const body = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text().catch(() => undefined)
	if (body === undefined || new TextEncoder().encode(body).byteLength > MAX_ADMIN_BODY_BYTES)
		return { ok: false, response: adminError('invalid_input') }

	const url = new URL(request.url)
	const auth = verifyHttpAuth({
		authorization: request.headers.get('authorization'),
		acceptedUrls: deps.acceptedOrigins(request).map((origin) => `${origin}${url.pathname}${url.search}`),
		method: request.method,
		body,
		nowSeconds: Math.floor((deps.nowMs?.() ?? Date.now()) / 1000),
		replayCache: deps.replayCache,
	})
	if (!auth.ok) return { ok: false, response: adminError('unauthorized') }
	if (!deps.isAdmin(auth.pubkey)) return { ok: false, response: adminError('not_found') }
	return { ok: true, pubkey: auth.pubkey, body }
}

export function adminOk(value: unknown): Response {
	return Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } })
}

/** Error envelope; `message` overrides the public default only for our own validation text. */
export function adminError(code: ExtensionActionErrorCode, message?: string): Response {
	const response = toExtensionActionErrorResponse(new ExtensionActionError(code))
	const body = message ? { ...response.body, error: { ...response.body.error, message } } : response.body
	return Response.json(body, {
		status: response.status,
		headers: { 'cache-control': 'no-store', ...(code === 'unauthorized' ? { 'www-authenticate': 'Nostr' } : {}) },
	})
}

export function parseJsonBody(body: string): unknown {
	try {
		return JSON.parse(body)
	} catch {
		return undefined
	}
}
