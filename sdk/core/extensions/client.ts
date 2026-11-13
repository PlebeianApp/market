import { toRawEvent, type NostrEventLike } from '../nostr/eventLike'
import { buildHttpAuthTemplate, encodeHttpAuthHeader } from '../nostr/nip98'
import type { Signer, SignedEventLike } from '../ports/signer'
import { failure, success, type Result } from '../result'
import { validateWithSchema, type RuntimeSchema } from '../validation'
import { EXTENSION_ACTION_ERROR_STATUS, ExtensionActionError, extensionActionPath, type ExtensionActionWireErrorCode } from './actions'
import { EXTENSION_PAYMENT_HEADER } from './payments'

export type ExtensionActionFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
	status: number
	text(): Promise<string>
}>

export interface InvokeExtensionActionOptions<Output> {
	/** Origin of the marketplace server. Defaults to `globalThis.location.origin` in browsers. */
	baseUrl?: string
	/** Validates the response value; strongly recommended because responses are untrusted. */
	output?: RuntimeSchema<Output>
	fetch?: ExtensionActionFetch
	signal?: AbortSignal
	now?: () => number
	/** Cashu token paying for a marketplace-collected action (ADR-0023 §7.9). */
	paymentToken?: string
}

/**
 * Calls a server-side extension action with a NIP-98 Authorization header signed by the user's signer.
 * Returns data only; anything to be published is signed by the user through the normal flows.
 */
export async function invokeExtensionAction<Output = unknown>(
	extensionId: string,
	actionName: string,
	input: unknown,
	signer: Signer<SignedEventLike & NostrEventLike>,
	options: InvokeExtensionActionOptions<Output> = {},
): Promise<Result<Output, ExtensionActionError>> {
	return (await invokeExtensionActionWithPayment(extensionId, actionName, input, signer, options)).result
}

/** Like `invokeExtensionAction`, also returning a change or refund token the server sent back. */
export async function invokeExtensionActionWithPayment<Output = unknown>(
	extensionId: string,
	actionName: string,
	input: unknown,
	signer: Signer<SignedEventLike & NostrEventLike>,
	options: InvokeExtensionActionOptions<Output> = {},
): Promise<{ result: Result<Output, ExtensionActionError>; returnedToken?: string }> {
	const result = await sendAction(extensionId, actionName, input, signer, options)
	if ('result' in result) return result
	const returnedToken = extractReturnedToken(result.text)
	return { result: parseExtensionActionResponse(result.status, result.text, options.output), ...(returnedToken ? { returnedToken } : {}) }
}

async function sendAction<Output>(
	extensionId: string,
	actionName: string,
	input: unknown,
	signer: Signer<SignedEventLike & NostrEventLike>,
	options: InvokeExtensionActionOptions<Output>,
): Promise<{ status: number; text: string } | { result: Result<Output, ExtensionActionError> }> {
	const baseUrl = options.baseUrl ?? (globalThis as { location?: { origin?: string } }).location?.origin
	if (!baseUrl)
		return { result: failure(new ExtensionActionError('network_error', 'invokeExtensionAction requires a baseUrl outside the browser')) }
	const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as ExtensionActionFetch | undefined)
	if (!fetchImpl) return { result: failure(new ExtensionActionError('network_error', 'No fetch implementation available')) }

	const url = new URL(extensionActionPath(extensionId, actionName), baseUrl).toString()
	const body = JSON.stringify(input ?? null)
	const createdAt = Math.floor((options.now?.() ?? Date.now()) / 1000)

	let authorization: string
	try {
		const signed = await signer.sign(buildHttpAuthTemplate({ url, method: 'POST', body, createdAt }))
		authorization = encodeHttpAuthHeader(toRawEvent(signed))
	} catch (cause) {
		return { result: failure(new ExtensionActionError('unauthorized', 'Could not sign the request', cause)) }
	}

	let status: number
	let text: string
	try {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization,
				...(options.paymentToken ? { [EXTENSION_PAYMENT_HEADER]: options.paymentToken } : {}),
			},
			body,
			signal: options.signal,
		})
		status = response.status
		text = await response.text()
	} catch (cause) {
		return { result: failure(new ExtensionActionError('network_error', undefined, cause)) }
	}
	return { status, text }
}

/** A `change` (success) or `refund` (failure) Cashu token in an action response; anything else is ignored. */
function extractReturnedToken(text: string): string | undefined {
	try {
		const body = JSON.parse(text) as { change?: { token?: unknown }; refund?: { token?: unknown } }
		const token = body?.change?.token ?? body?.refund?.token
		return typeof token === 'string' && /^cashu[AB][A-Za-z0-9_\-+/=]+$/.test(token) && token.length <= 20_000 ? token : undefined
	} catch {
		return undefined
	}
}

/** Decodes an HTTP action response. Unknown shapes are reported as errors, never trusted. */
export function parseExtensionActionResponse<Output = unknown>(
	status: number,
	text: string,
	output?: RuntimeSchema<Output>,
): Result<Output, ExtensionActionError> {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return failure(new ExtensionActionError(fallbackCode(status)))
	}
	return parseExtensionActionEnvelope(parsed, { succeeded: status >= 200 && status < 300, fallback: fallbackCode(status) }, output)
}

/**
 * Transport-neutral envelope decoding shared by HTTP and ContextVM. `succeeded` is the transport's own
 * success signal (2xx, or a tool result without `isError`); both it and `ok: true` are required.
 */
export function parseExtensionActionEnvelope<Output = unknown>(
	body: unknown,
	transport: { succeeded: boolean; fallback: ExtensionActionWireErrorCode },
	output?: RuntimeSchema<Output>,
): Result<Output, ExtensionActionError> {
	if (!isRecord(body)) return failure(new ExtensionActionError(transport.fallback))

	if (body.ok === true && transport.succeeded) {
		if (!output) return success(body.value as Output)
		const value = validateWithSchema(body.value, output)
		return value.ok ? success(value.value) : failure(new ExtensionActionError('invalid_output', undefined, value.error))
	}

	const error = isRecord(body.error) ? body.error : undefined
	const code = typeof error?.code === 'string' && isWireCode(error.code) ? error.code : transport.fallback
	const message = typeof error?.message === 'string' ? error.message.slice(0, 200) : undefined
	return failure(new ExtensionActionError(code, message))
}

function fallbackCode(status: number): ExtensionActionWireErrorCode {
	const match = (Object.entries(EXTENSION_ACTION_ERROR_STATUS) as [ExtensionActionWireErrorCode, number][]).find(
		([, value]) => value === status,
	)
	if (match) return match[0]
	return status >= 200 && status < 300 ? 'invalid_output' : 'extension_failed'
}

function isWireCode(code: string): code is ExtensionActionWireErrorCode {
	return Object.hasOwn(EXTENSION_ACTION_ERROR_STATUS, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
