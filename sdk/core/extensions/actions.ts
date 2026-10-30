import { SdkError } from '../errors'
import { failure, success, type Result } from '../result'
import { validateWithSchema, type RuntimeSchema } from '../validation'
import type { ExtensionContext } from './extension'
import type { ExtensionHostPorts } from './hostPorts'

export const EXTENSION_ACTION_AUTH = ['user', 'admin'] as const
export type ExtensionActionAuth = (typeof EXTENSION_ACTION_AUTH)[number]

export interface ExtensionActionRateLimit {
	perPubkey: number
	windowSeconds: number
}

/** Authenticated caller as established by Platform (NIP-98); extensions never authenticate on their own. */
export interface ExtensionCaller {
	pubkey: string
	isAdmin: boolean
}

/** Server handlers always receive host ports; `log` is unconditional. */
export type ExtensionActionContext<PublicConfig = unknown, PrivateConfig = never> = ExtensionContext<PublicConfig, PrivateConfig> & {
	host: ExtensionHostPorts
}

export interface ExtensionActionDefinition<Input = unknown, Output = unknown, PublicConfig = unknown, PrivateConfig = never> {
	/** Public, client-safe description surfaced in extension descriptors. */
	description?: string
	input: RuntimeSchema<Input>
	output: RuntimeSchema<Output>
	auth: ExtensionActionAuth
	rateLimit: ExtensionActionRateLimit
	handler(
		context: ExtensionActionContext<PublicConfig, PrivateConfig>,
		input: Input,
		caller: ExtensionCaller,
	): Promise<Result<Output, SdkError>>
}

export type AnyExtensionActionDefinition = ExtensionActionDefinition<any, any, any, any>

export interface PublicExtensionActionDescriptor {
	name: string
	description?: string
	auth: ExtensionActionAuth
	rateLimit: ExtensionActionRateLimit
}

/**
 * Wire-level error vocabulary shared by Platform and the SDK client. Provider billing failures
 * are availability errors: payment-state vocabulary is reserved for marketplace payments.
 */
export const EXTENSION_ACTION_ERROR_STATUS = {
	invalid_input: 400,
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	rate_limited: 429,
	extension_failed: 500,
	invalid_output: 502,
	extension_unavailable: 503,
	upstream_timeout: 504,
} as const

export type ExtensionActionWireErrorCode = keyof typeof EXTENSION_ACTION_ERROR_STATUS
/** `extension_misconfigured` is server-internal and is reported to clients as `extension_unavailable`. */
export type ExtensionActionErrorCode = ExtensionActionWireErrorCode | 'extension_misconfigured' | 'network_error'

const PUBLIC_MESSAGES: Record<ExtensionActionWireErrorCode, string> = {
	invalid_input: 'Invalid action input',
	unauthorized: 'Authentication required',
	forbidden: 'Not allowed',
	not_found: 'Not found',
	rate_limited: 'Too many requests',
	extension_failed: 'Extension failed',
	invalid_output: 'Extension returned an invalid response',
	extension_unavailable: 'Extension is temporarily unavailable',
	upstream_timeout: 'Extension timed out',
}

const RETRYABLE: ReadonlySet<ExtensionActionErrorCode> = new Set(['rate_limited', 'upstream_timeout', 'network_error'])

export class ExtensionActionError extends SdkError {
	readonly reason: ExtensionActionErrorCode
	readonly retryable: boolean

	constructor(reason: ExtensionActionErrorCode, message?: string, cause?: unknown) {
		super('operation_failed', message ?? defaultMessage(reason), cause)
		this.name = 'ExtensionActionError'
		this.reason = reason
		this.retryable = RETRYABLE.has(reason)
	}
}

export interface ExtensionActionErrorBody {
	ok: false
	error: { code: ExtensionActionWireErrorCode; message: string; retryable: boolean }
}

export interface ExtensionActionSuccessBody<Output> {
	ok: true
	value: Output
}

export type ExtensionActionResponseBody<Output> = ExtensionActionSuccessBody<Output> | ExtensionActionErrorBody

const ACTION_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MAX_ACTION_NAME_LENGTH = 64

export function isValidExtensionActionName(name: string): boolean {
	return name.length <= MAX_ACTION_NAME_LENGTH && ACTION_NAME.test(name)
}

export function extensionActionPath(extensionId: string, actionName: string): string {
	return `/api/extensions/${encodeURIComponent(extensionId)}/actions/${encodeURIComponent(actionName)}`
}

export function describeExtensionActions(actions: Readonly<Record<string, AnyExtensionActionDefinition>> | undefined) {
	if (!actions) return [] as PublicExtensionActionDescriptor[]
	return Object.entries(actions).map(
		([name, action]): PublicExtensionActionDescriptor => ({
			name,
			...(action.description ? { description: action.description } : {}),
			auth: action.auth,
			rateLimit: { ...action.rateLimit },
		}),
	)
}

/** Converts any handler/pipeline failure into a status and a body that never carries internal messages or causes. */
export function toExtensionActionErrorResponse(error: unknown): { status: number; body: ExtensionActionErrorBody } {
	const reason = error instanceof ExtensionActionError ? error.reason : 'extension_failed'
	const code = toWireCode(reason)
	return {
		status: EXTENSION_ACTION_ERROR_STATUS[code],
		body: { ok: false, error: { code, message: PUBLIC_MESSAGES[code], retryable: RETRYABLE.has(code) } },
	}
}

/**
 * Maps an upstream provider HTTP status (e.g. an OpenAI-compatible API) to an action error.
 * 401/403 → misconfigured, 402 → unavailable (operator balance), 408/504 → timeout, 429/5xx → unavailable.
 */
export function providerStatusToActionError(status: number): ExtensionActionError | undefined {
	if (status >= 200 && status < 300) return undefined
	if (status === 401 || status === 403)
		return new ExtensionActionError('extension_misconfigured', `Provider rejected credentials (${status})`)
	if (status === 402) return new ExtensionActionError('extension_unavailable', 'Provider balance insufficient')
	if (status === 408 || status === 504) return new ExtensionActionError('upstream_timeout', `Provider timed out (${status})`)
	if (status === 429 || status >= 500) return new ExtensionActionError('extension_unavailable', `Provider unavailable (${status})`)
	return new ExtensionActionError('extension_failed', `Provider request failed (${status})`)
}

export interface ExecuteExtensionActionParams {
	actions: Readonly<Record<string, AnyExtensionActionDefinition>> | undefined
	actionName: string
	rawInput: unknown
	caller: ExtensionCaller
	context: ExtensionActionContext<any, any>
}

/**
 * Transport-neutral action pipeline: lookup, role check, input parse, handler, output parse.
 * Authentication (NIP-98) and rate limiting stay with the transport in Platform.
 */
export async function executeExtensionAction(params: ExecuteExtensionActionParams): Promise<Result<unknown, ExtensionActionError>> {
	const { actions, actionName, rawInput, caller, context } = params
	const action = actions && Object.hasOwn(actions, actionName) ? actions[actionName] : undefined
	if (!action) return failure(new ExtensionActionError('not_found'))
	if (action.auth === 'admin' && !caller.isAdmin) return failure(new ExtensionActionError('forbidden'))

	// The parse cause is withheld: schema errors can echo user input.
	const input = validateWithSchema(rawInput, action.input)
	if (!input.ok) return failure(new ExtensionActionError('invalid_input'))

	let result: Result<unknown, SdkError>
	try {
		result = await action.handler(context, input.value, caller)
	} catch (cause) {
		if (context.signal.aborted) return failure(new ExtensionActionError('upstream_timeout', undefined, cause))
		return failure(new ExtensionActionError('extension_failed', undefined, cause))
	}
	if (!result.ok) {
		return failure(
			result.error instanceof ExtensionActionError ? result.error : new ExtensionActionError('extension_failed', undefined, result.error),
		)
	}

	const output = validateWithSchema(result.value, action.output)
	if (!output.ok) return failure(new ExtensionActionError('invalid_output', undefined, output.error))
	return success(output.value)
}

function toWireCode(reason: ExtensionActionErrorCode): ExtensionActionWireErrorCode {
	if (reason === 'extension_misconfigured') return 'extension_unavailable'
	if (reason === 'network_error') return 'extension_failed'
	return reason
}

function defaultMessage(reason: ExtensionActionErrorCode): string {
	if (reason === 'extension_misconfigured') return 'Extension is misconfigured'
	if (reason === 'network_error') return 'Could not reach the extension endpoint'
	return PUBLIC_MESSAGES[reason]
}
