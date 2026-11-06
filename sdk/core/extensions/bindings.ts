import { ValidationError } from '../errors'
import type { NostrEventLike } from '../nostr/eventLike'
import type { Signer, SignedEventLike } from '../ports/signer'
import { failure, success, type Result } from '../result'
import { EXTENSION_ACTION_AUTH, ExtensionActionError, type ExtensionActionAuth, type ExtensionActionRateLimit } from './actions'
import { sendAdminRequest, type FetchExtensionCatalogOptions } from './catalog'
import { actionNameProblem, capabilityProblem } from './names'

export { actionNameProblem, CAPABILITY_FORMAT_HINT, capabilityProblem } from './names'

/**
 * Remote bindings (ADR-0023 §7.5): an admin maps one tool of a repository ContextVM server to a capability.
 * Clients call it like any action, under extension id `remote.<server-pubkey>`.
 */
export const REMOTE_EXTENSION_PREFIX = 'remote.'
export const EXTENSION_BINDINGS_PATH = '/api/extensions/bindings'
export const MAX_REMOTE_TEXT = 4_000
export const MAX_REMOTE_DATA_BYTES = 16_000

const HEX_PUBKEY = /^[0-9a-f]{64}$/
const DEFAULT_RATE_LIMIT: ExtensionActionRateLimit = { perPubkey: 30, windowSeconds: 3600 }
const MAX_RATE_PER_PUBKEY = 1_000
const MAX_WINDOW_SECONDS = 86_400

export function remoteExtensionId(serverPubkey: string): string {
	return `${REMOTE_EXTENSION_PREFIX}${serverPubkey}`
}

export function parseRemoteExtensionId(extensionId: string): string | undefined {
	if (!extensionId.startsWith(REMOTE_EXTENSION_PREFIX)) return undefined
	const pubkey = extensionId.slice(REMOTE_EXTENSION_PREFIX.length)
	return HEX_PUBKEY.test(pubkey) ? pubkey : undefined
}

export interface RemoteBindingRequest {
	serverPubkey: string
	toolName: string
	actionName: string
	capability: string
	auth: ExtensionActionAuth
	rateLimit: ExtensionActionRateLimit
	/** The admin confirmed that user input for this action is sent to the third-party server. */
	acknowledgedDataFlow: true
}

/** Validates an untrusted bind request. The pin is not part of the request: Platform takes it from its own snapshot. */
export function parseRemoteBindingRequest(input: unknown): Result<RemoteBindingRequest, ValidationError> {
	if (!isRecord(input)) return failure(new ValidationError('Binding request must be an object'))
	const { serverPubkey, toolName, actionName, capability, auth, rateLimit, acknowledgedDataFlow } = input
	if (typeof serverPubkey !== 'string' || !HEX_PUBKEY.test(serverPubkey))
		return failure(new ValidationError('Unknown server', ['serverPubkey']))
	if (typeof toolName !== 'string' || !toolName || toolName.length > 100) return failure(new ValidationError('Unknown tool', ['toolName']))
	const actionProblem = typeof actionName === 'string' ? actionNameProblem(actionName) : 'Enter an action name'
	if (actionProblem) return failure(new ValidationError(actionProblem, ['actionName']))
	const capabilityError = typeof capability === 'string' ? capabilityProblem(capability) : 'Enter a capability'
	if (capabilityError) return failure(new ValidationError(capabilityError, ['capability']))
	if (typeof auth !== 'string' || !(EXTENSION_ACTION_AUTH as readonly string[]).includes(auth)) {
		return failure(new ValidationError('Choose who may call this action', ['auth']))
	}
	const limit = rateLimit === undefined ? DEFAULT_RATE_LIMIT : parseRateLimit(rateLimit)
	if (!limit)
		return failure(
			new ValidationError(`Rate limit must be 1-${MAX_RATE_PER_PUBKEY} calls per 1-${MAX_WINDOW_SECONDS} seconds`, ['rateLimit']),
		)
	if (acknowledgedDataFlow !== true)
		return failure(new ValidationError('Confirm that user input will be sent to the third-party server', ['acknowledgedDataFlow']))
	return success({
		serverPubkey,
		toolName,
		actionName: actionName as string,
		capability: capability as string,
		auth: auth as ExtensionActionAuth,
		rateLimit: limit,
		acknowledgedDataFlow: true,
	})
}

/** Store states (ADR-0023 §7.3) a binding can be in. Only `installed_enabled` is callable or advertised. */
export const REMOTE_BINDING_STATES = ['installed_enabled', 'installed_disabled', 'misconfigured', 'unreachable'] as const
export type RemoteBindingState = (typeof REMOTE_BINDING_STATES)[number]

export interface RemoteBindingView {
	serverPubkey: string
	serverName: string
	toolName: string
	actionName: string
	capability: string
	auth: ExtensionActionAuth
	rateLimit: ExtensionActionRateLimit
	enabled: boolean
	state: RemoteBindingState
	/** Admin-facing reason for a non-enabled state. */
	problem?: string
}

export function parseRemoteBindingViews(input: unknown): RemoteBindingView[] {
	if (!Array.isArray(input)) return []
	return input.slice(0, 200).flatMap((raw): RemoteBindingView[] => {
		if (!isRecord(raw)) return []
		const request = parseRemoteBindingRequest({ ...raw, acknowledgedDataFlow: true })
		if (!request.ok) return []
		if (typeof raw.state !== 'string' || !(REMOTE_BINDING_STATES as readonly string[]).includes(raw.state)) return []
		const { acknowledgedDataFlow: _, ...binding } = request.value
		return [
			{
				...binding,
				serverName:
					typeof raw.serverName === 'string' && raw.serverName.trim()
						? raw.serverName.slice(0, 100)
						: `${binding.serverPubkey.slice(0, 8)}…`,
				enabled: raw.enabled === true,
				state: raw.state as RemoteBindingState,
				...(typeof raw.problem === 'string' && raw.problem ? { problem: raw.problem.slice(0, 300) } : {}),
			},
		]
	})
}

/** What a remote action returns to clients: untrusted plain text, plus small structured data when present. */
export interface RemoteActionOutput {
	text: string
	data?: Record<string, unknown>
}

export const RemoteActionOutputSchema = {
	parse(value: unknown): RemoteActionOutput {
		if (!isRecord(value) || typeof value.text !== 'string') throw new ValidationError('Invalid remote action output')
		return { text: value.text.slice(0, MAX_REMOTE_TEXT), ...(isRecord(value.data) ? { data: value.data } : {}) }
	},
}

/**
 * Converts an untrusted MCP `CallToolResult` into `RemoteActionOutput`. Text is joined from text content items,
 * control characters are stripped, and both text and structured data are size-capped. A tool error becomes
 * `extension_failed` without the remote message: provider error bodies never reach clients.
 */
export function toRemoteActionOutput(result: unknown): Result<RemoteActionOutput, ExtensionActionError> {
	if (!isRecord(result)) return failure(new ExtensionActionError('invalid_output'))
	if (result.isError === true) return failure(new ExtensionActionError('extension_failed', 'The remote tool reported an error'))

	const texts = Array.isArray(result.content)
		? result.content.flatMap((item) => (isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : []))
		: []
	// eslint-disable-next-line no-control-regex
	const text = texts
		.join('\n')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
		.slice(0, MAX_REMOTE_TEXT)

	let data: Record<string, unknown> | undefined
	if (isRecord(result.structuredContent)) {
		const serialized = JSON.stringify(result.structuredContent)
		if (new TextEncoder().encode(serialized).byteLength <= MAX_REMOTE_DATA_BYTES) data = JSON.parse(serialized) as Record<string, unknown>
	}
	if (!text && !data) return failure(new ExtensionActionError('invalid_output'))
	return success({ text, ...(data ? { data } : {}) })
}

type AdminSigner = Signer<SignedEventLike & NostrEventLike>

const bindingResult = {
	parse(value: unknown): { serverPubkey: string; actionName: string } {
		if (!isRecord(value) || typeof value.serverPubkey !== 'string' || typeof value.actionName !== 'string') {
			throw new ValidationError('Invalid binding response')
		}
		return { serverPubkey: value.serverPubkey, actionName: value.actionName }
	},
}

const bindingPath = (serverPubkey: string, actionName: string) =>
	`${EXTENSION_BINDINGS_PATH}/${encodeURIComponent(serverPubkey)}/${encodeURIComponent(actionName)}`

/** Admin-only: bind a repository tool. */
export function createRemoteBinding(signer: AdminSigner, request: RemoteBindingRequest, options: FetchExtensionCatalogOptions = {}) {
	return sendAdminRequest(signer, 'POST', EXTENSION_BINDINGS_PATH, JSON.stringify(request), options, bindingResult)
}

const batchResult = {
	parse(value: unknown): { created: number } {
		if (!isRecord(value) || !Array.isArray(value.created)) throw new ValidationError('Invalid binding response')
		return { created: value.created.length }
	},
}

/** Admin-only: create several bindings in one signed request. The server stores all of them or none. */
export function createRemoteBindings(
	signer: AdminSigner,
	requests: readonly RemoteBindingRequest[],
	options: FetchExtensionCatalogOptions = {},
) {
	return sendAdminRequest(signer, 'POST', EXTENSION_BINDINGS_PATH, JSON.stringify({ bindings: requests }), options, batchResult)
}

/** Admin-only: enable/disable a binding, or approve its current tool definition after a change. */
export function updateRemoteBinding(
	signer: AdminSigner,
	serverPubkey: string,
	actionName: string,
	change: { enabled?: boolean; approveCurrentDefinition?: true },
	options: FetchExtensionCatalogOptions = {},
) {
	return sendAdminRequest(signer, 'PATCH', bindingPath(serverPubkey, actionName), JSON.stringify(change), options, bindingResult)
}

/** Admin-only: remove a binding. */
export function deleteRemoteBinding(
	signer: AdminSigner,
	serverPubkey: string,
	actionName: string,
	options: FetchExtensionCatalogOptions = {},
) {
	return sendAdminRequest(signer, 'DELETE', bindingPath(serverPubkey, actionName), undefined, options, bindingResult)
}

function parseRateLimit(value: unknown): ExtensionActionRateLimit | undefined {
	if (!isRecord(value)) return undefined
	const { perPubkey, windowSeconds } = value
	const valid = (number: unknown, max: number) => typeof number === 'number' && Number.isSafeInteger(number) && number > 0 && number <= max
	return valid(perPubkey, MAX_RATE_PER_PUBKEY) && valid(windowSeconds, MAX_WINDOW_SECONDS)
		? { perPubkey: perPubkey as number, windowSeconds: windowSeconds as number }
		: undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
