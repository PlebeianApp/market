import {
	EXTENSION_ACTION_ERROR_STATUS,
	EXTENSION_PAYMENT_HEADER,
	executeExtensionAction,
	ExtensionActionError,
	toExtensionActionErrorResponse,
	type ExtensionActionErrorCode,
} from '@sdk/core/extensions'
import { validateWithSchema } from '@sdk/core/validation'
import { verifyHttpAuth, type HttpAuthReplayCache } from './nip98'
import { checkCollectorToken, type CashuCollector } from './payments/collector'
import type { ExtensionRateLimiter } from './rateLimiter'
import type { ExtensionRegistry } from './registry'
import type { RemoteActionTarget } from './remoteBindings'

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
	/** Enabled, healthy remote binding for `remote.<server>` ids (ADR-0023 §7.5). */
	getRemoteTarget?: (extensionId: string, actionName: string) => RemoteActionTarget | undefined
	/** Server-side diagnostics; receives the internal reason, never sent to the client. */
	onError?: (info: { extensionId: string; actionName: string; reason: string; cause?: unknown }) => void
	/** Wallet for marketplace-collected payments; without it, those actions are unavailable. */
	collector?: CashuCollector
	/** Ledger hook for collected payments. Never receives token contents. */
	onPayment?: (event: CollectedPaymentEvent) => void
}

export interface CollectedPaymentEvent {
	extensionId: string
	actionName: string
	pubkey: string
	outcome: 'rejected' | 'collected' | 'change_sent' | 'change_failed' | 'refunded' | 'refund_failed'
	sats?: number
	mint?: string
	reason?: string
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
		const builtin = target && action && (action.transports ?? ['http']).includes('http') ? { target, action } : undefined
		const remote = builtin ? undefined : deps.getRemoteTarget?.(extensionId, actionName)
		if (!builtin && !remote) return errorResponse('not_found')
		const rateLimit = builtin ? builtin.action.rateLimit : remote!.rateLimit

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
		const decision = deps.rateLimiter.consume({ extensionId, actionName, pubkey: auth.pubkey, limit: rateLimit, nowMs: now() })
		if (!decision.allowed) return errorResponse('rate_limited', { 'retry-after': String(decision.retryAfterSeconds) })

		// 4. Body is JSON; a parse failure is reported without echoing it.
		let rawInput: unknown
		try {
			rawInput = body.length === 0 ? {} : JSON.parse(body)
		} catch {
			return errorResponse('invalid_input')
		}

		if (remote) return respondRemote(remote, rawInput, auth.pubkey, request.signal, extensionId, actionName)

		const { target: builtinTarget, action: builtinAction } = builtin!
		const price = builtinAction.payment?.(builtinTarget.context.publicConfig)
		let collected: { mint: string; sats: number; price: number } | undefined
		if (price?.collectedBy === 'marketplace') {
			// Nothing is collected for a request that cannot run.
			if (!validateWithSchema(rawInput, builtinAction.input).ok) return errorResponse('invalid_input')
			const payment = await collectPayment(request, price.amountSats, { extensionId, actionName, pubkey: auth.pubkey })
			if (payment instanceof Response) return payment
			collected = payment
		}

		// 5–7. Shared pipeline with a signal tied to the request, the extension lifetime, and a deadline.
		const signal = AbortSignal.any([builtinTarget.context.signal, request.signal, AbortSignal.timeout(ACTION_TIMEOUT_MS)])
		const result = await executeExtensionAction({
			actions: builtinTarget.definition.actions,
			actionName,
			rawInput,
			caller: {
				pubkey: auth.pubkey,
				isAdmin: deps.isAdmin(auth.pubkey),
				transport: 'http',
				...(collected ? { payment: { collectedSats: collected.sats, mint: collected.mint } } : {}),
			},
			context: { ...builtinTarget.context, signal },
		})
		const ledger = { extensionId, actionName, pubkey: auth.pubkey }
		if (result.ok) {
			const change = collected ? await returnSats(collected.sats - collected.price, collected.mint, 'change', ledger) : undefined
			return json(200, { ok: true, value: result.value, ...(change ? { change: { token: change } } : {}) })
		}

		deps.onError?.({ extensionId, actionName, reason: result.error.reason, cause: result.error.cause })
		const response = toExtensionActionErrorResponse(result.error)
		// The seller paid for a result they did not get: return everything they sent.
		const refund = collected ? await returnSats(collected.sats, collected.mint, 'refund', ledger) : undefined
		return json(response.status, { ...response.body, ...(refund ? { refund: { token: refund } } : {}) })
	}

	/**
	 * Checks the seller's token offline (unit, accepted mint, amount), then redeems it into the collector wallet
	 * before the action runs, so it cannot be reused. A rejected token is left untouched for the seller to reclaim.
	 */
	async function collectPayment(
		request: Request,
		price: number,
		ledger: Pick<CollectedPaymentEvent, 'extensionId' | 'actionName' | 'pubkey'>,
	): Promise<{ mint: string; sats: number; price: number } | Response> {
		const collector = deps.collector
		if (!collector) return errorResponse('extension_unavailable')
		const token = request.headers.get(EXTENSION_PAYMENT_HEADER)?.trim()
		if (!token) return errorResponse('payment_required')
		let mints: string[]
		try {
			mints = await collector.acceptedMints()
		} catch {
			deps.onPayment?.({ ...ledger, outcome: 'rejected', reason: 'collector_unavailable' })
			return errorResponse('extension_unavailable')
		}
		const check = checkCollectorToken(token, mints, price)
		if (!check.ok || !check.mint || check.amount === undefined) {
			deps.onPayment?.({ ...ledger, outcome: 'rejected', reason: check.reason, ...(check.mint ? { mint: check.mint } : {}) })
			return errorResponse('payment_required')
		}
		try {
			await collector.receive(token)
		} catch {
			// Spent, invalid at the mint, or the wallet is down; either way nothing was collected.
			deps.onPayment?.({ ...ledger, outcome: 'rejected', reason: 'redeem_failed', mint: check.mint, sats: check.amount })
			return errorResponse('payment_required')
		}
		deps.onPayment?.({ ...ledger, outcome: 'collected', mint: check.mint, sats: check.amount })
		return { mint: check.mint, sats: check.amount, price }
	}

	async function returnSats(
		sats: number,
		mint: string,
		kind: 'change' | 'refund',
		ledger: Pick<CollectedPaymentEvent, 'extensionId' | 'actionName' | 'pubkey'>,
	): Promise<string | undefined> {
		if (sats <= 0 || !deps.collector) return undefined
		try {
			const token = await deps.collector.send(sats, mint)
			deps.onPayment?.({ ...ledger, outcome: kind === 'change' ? 'change_sent' : 'refunded', sats, mint })
			return token
		} catch {
			deps.onPayment?.({ ...ledger, outcome: kind === 'change' ? 'change_failed' : 'refund_failed', sats, mint })
			return undefined
		}
	}

	/** Remote tools take a JSON object; the remote server validates it against the pinned schema it announced. */
	async function respondRemote(
		remote: RemoteActionTarget,
		rawInput: unknown,
		pubkey: string,
		requestSignal: AbortSignal,
		extensionId: string,
		actionName: string,
	): Promise<Response> {
		if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) return errorResponse('invalid_input')
		if (remote.auth === 'admin' && !deps.isAdmin(pubkey)) return errorResponse('forbidden')
		const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(ACTION_TIMEOUT_MS)])
		const result = await remote.invoke(rawInput as Record<string, unknown>, signal)
		if (result.ok) return json(200, { ok: true, value: result.value })
		deps.onError?.({ extensionId, actionName, reason: result.error.reason })
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
