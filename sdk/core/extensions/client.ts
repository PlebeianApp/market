import { toRawEvent, type NostrEventLike } from '../nostr/eventLike'
import { buildHttpAuthTemplate, encodeHttpAuthHeader } from '../nostr/nip98'
import type { Signer, SignedEventLike } from '../ports/signer'
import { failure, success, type Result } from '../result'
import { validateWithSchema, type RuntimeSchema } from '../validation'
import { EXTENSION_ACTION_ERROR_STATUS, ExtensionActionError, extensionActionPath, type ExtensionActionWireErrorCode } from './actions'

export type ExtensionActionFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
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
	const baseUrl = options.baseUrl ?? (globalThis as { location?: { origin?: string } }).location?.origin
	if (!baseUrl) return failure(new ExtensionActionError('network_error', 'invokeExtensionAction requires a baseUrl outside the browser'))
	const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as ExtensionActionFetch | undefined)
	if (!fetchImpl) return failure(new ExtensionActionError('network_error', 'No fetch implementation available'))

	const url = new URL(extensionActionPath(extensionId, actionName), baseUrl).toString()
	const body = JSON.stringify(input ?? null)
	const createdAt = Math.floor((options.now?.() ?? Date.now()) / 1000)

	let authorization: string
	try {
		const signed = await signer.sign(buildHttpAuthTemplate({ url, method: 'POST', body, createdAt }))
		authorization = encodeHttpAuthHeader(toRawEvent(signed))
	} catch (cause) {
		return failure(new ExtensionActionError('unauthorized', 'Could not sign the request', cause))
	}

	let status: number
	let text: string
	try {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization },
			body,
			signal: options.signal,
		})
		status = response.status
		text = await response.text()
	} catch (cause) {
		return failure(new ExtensionActionError('network_error', undefined, cause))
	}

	return parseExtensionActionResponse(status, text, options.output)
}

/** Decodes an action response envelope. Unknown shapes are reported as invalid output, never trusted. */
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
	if (!isRecord(parsed)) return failure(new ExtensionActionError(fallbackCode(status)))

	if (parsed.ok === true && status >= 200 && status < 300) {
		if (!output) return success(parsed.value as Output)
		const value = validateWithSchema(parsed.value, output)
		return value.ok ? success(value.value) : failure(new ExtensionActionError('invalid_output', undefined, value.error))
	}

	const error = isRecord(parsed.error) ? parsed.error : undefined
	const code = typeof error?.code === 'string' && isWireCode(error.code) ? error.code : fallbackCode(status)
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
