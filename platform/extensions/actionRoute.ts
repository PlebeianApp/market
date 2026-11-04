import {
	EXTENSION_ACTION_ERROR_STATUS,
	executeExtensionAction,
	ExtensionActionError,
	toExtensionActionErrorResponse,
	type ExtensionActionErrorCode,
} from '@sdk/core/extensions'
import { verifyHttpAuth, type HttpAuthReplayCache } from './nip98'
import type { ExtensionRateLimiter } from './rateLimiter'
import type { ExtensionRegistry } from './registry'

export const EXTENSION_ACTION_ROUTE = '/api/extensions/:id/actions/:action'
export const MAX_ACTION_BODY_BYTES = 64_000
export const ACTION_TIMEOUT_MS = 60_000

export interface ExtensionActionHandlerDeps {
	getRegistry: () => ExtensionRegistry | undefined
	isAdmin: (pubkey: string) => boolean
	replayCache: HttpAuthReplayCache
	rateLimiter: ExtensionRateLimiter
	/** Origins a NIP-98 `u` tag may use for this request. */
	acceptedOrigins: (request: Request) => readonly string[]
	nowMs?: () => number
	/** Server-side diagnostics; receives the internal reason, never sent to the client. */
	onError?: (info: { extensionId: string; actionName: string; reason: string; cause?: unknown }) => void
}

/**
 * `POST /api/extensions/:id/actions/:action` (ADR-0023 §2). Order: existence → NIP-98 → rate limit →
 * shared SDK pipeline (role, input, handler, output). Error bodies carry only public codes and messages.
 */
export function createExtensionActionHandler(deps: ExtensionActionHandlerDeps) {
	const now = deps.nowMs ?? (() => Date.now())

	return async (request: Request & { params?: Record<string, string> }): Promise<Response> => {
		const extensionId = request.params?.id ?? ''
		const actionName = request.params?.action ?? ''

		// 1. Disabled, unknown, and action-less extensions are indistinguishable.
		const target = deps.getRegistry()?.getActionTarget(extensionId)
		const action =
			target?.definition.actions && Object.hasOwn(target.definition.actions, actionName) ? target.definition.actions[actionName] : undefined
		if (!target || !action || !(action.transports ?? ['http']).includes('http')) return errorResponse('not_found')

		const declaredLength = Number(request.headers.get('content-length'))
		if (Number.isFinite(declaredLength) && declaredLength > MAX_ACTION_BODY_BYTES) return errorResponse('invalid_input')
		let body: string
		try {
			body = await request.text()
		} catch {
			return errorResponse('invalid_input')
		}
		if (new TextEncoder().encode(body).byteLength > MAX_ACTION_BODY_BYTES) return errorResponse('invalid_input')

		// 2. NIP-98 over the exact path and query the client signed.
		const url = new URL(request.url)
		const auth = verifyHttpAuth({
			authorization: request.headers.get('authorization'),
			acceptedUrls: deps.acceptedOrigins(request).map((origin) => `${origin}${url.pathname}${url.search}`),
			method: request.method,
			body,
			nowSeconds: Math.floor(now() / 1000),
			replayCache: deps.replayCache,
		})
		if (!auth.ok) {
			deps.onError?.({ extensionId, actionName, reason: `auth_${auth.reason}` })
			return errorResponse('unauthorized', { 'www-authenticate': 'Nostr' })
		}

		// 3. Per-pubkey budget, shared across transports.
		const decision = deps.rateLimiter.consume({ extensionId, actionName, pubkey: auth.pubkey, limit: action.rateLimit, nowMs: now() })
		if (!decision.allowed) return errorResponse('rate_limited', { 'retry-after': String(decision.retryAfterSeconds) })

		// 4. Body is JSON; a parse failure is reported without echoing it.
		let rawInput: unknown
		try {
			rawInput = body.length === 0 ? {} : JSON.parse(body)
		} catch {
			return errorResponse('invalid_input')
		}

		// 5–7. Shared pipeline with a signal tied to the request, the extension lifetime, and a deadline.
		const signal = AbortSignal.any([target.context.signal, request.signal, AbortSignal.timeout(ACTION_TIMEOUT_MS)])
		const result = await executeExtensionAction({
			actions: target.definition.actions,
			actionName,
			rawInput,
			caller: { pubkey: auth.pubkey, isAdmin: deps.isAdmin(auth.pubkey), transport: 'http' },
			context: { ...target.context, signal },
		})
		if (result.ok) return json(200, { ok: true, value: result.value })

		deps.onError?.({ extensionId, actionName, reason: result.error.reason, cause: result.error.cause })
		const response = toExtensionActionErrorResponse(result.error)
		return json(response.status, response.body)
	}
}

function errorResponse(code: ExtensionActionErrorCode, headers: Record<string, string> = {}): Response {
	const response = toExtensionActionErrorResponse(new ExtensionActionError(code))
	return json(response.status ?? EXTENSION_ACTION_ERROR_STATUS.extension_failed, response.body, headers)
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

export interface ExtensionCatalogHandlerDeps {
	getCatalog: () => unknown | Promise<unknown>
	isAdmin: (pubkey: string) => boolean
	replayCache: HttpAuthReplayCache
	acceptedOrigins: (request: Request) => readonly string[]
	nowMs?: () => number
}

/**
 * `GET /api/extensions/catalog` (ADR-0023 §7): admin-only store listing. Non-admins get 404, so the
 * store's existence and contents are not disclosed to public visitors.
 */
export function createExtensionCatalogHandler(deps: ExtensionCatalogHandlerDeps) {
	const now = deps.nowMs ?? (() => Date.now())
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		const auth = verifyHttpAuth({
			authorization: request.headers.get('authorization'),
			acceptedUrls: deps.acceptedOrigins(request).map((origin) => `${origin}${url.pathname}${url.search}`),
			method: request.method,
			body: '',
			nowSeconds: Math.floor(now() / 1000),
			replayCache: deps.replayCache,
		})
		if (!auth.ok) return errorResponse('unauthorized', { 'www-authenticate': 'Nostr' })
		if (!deps.isAdmin(auth.pubkey)) return errorResponse('not_found')
		return json(200, { ok: true, value: await deps.getCatalog() })
	}
}
