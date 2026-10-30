import { failure, type Result } from '../result'
import type { RuntimeSchema } from '../validation'
import {
	actionTransports,
	ExtensionActionError,
	isValidExtensionActionName,
	toExtensionActionErrorResponse,
	type AnyExtensionActionDefinition,
	type ExtensionActionResponseBody,
	type ExtensionCaller,
} from './actions'
import { parseExtensionActionEnvelope } from './client'

/** Prefix keeps extension tools apart from first-party ContextVM tools such as `get_btc_price`. */
export const EXTENSION_TOOL_PREFIX = 'ext.'
export const MAX_TOOL_NAME_LENGTH = 128

const EXTENSION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const PUBKEY = /^[0-9a-f]{64}$/

/** `ext.<extension-id>.<action>`; action names never contain dots, so the last dot is unambiguous. */
export function extensionActionToolName(extensionId: string, actionName: string): string {
	return `${EXTENSION_TOOL_PREFIX}${extensionId}.${actionName}`
}

export function parseExtensionActionToolName(toolName: string): { extensionId: string; actionName: string } | undefined {
	if (!toolName.startsWith(EXTENSION_TOOL_PREFIX) || toolName.length > MAX_TOOL_NAME_LENGTH) return undefined
	const rest = toolName.slice(EXTENSION_TOOL_PREFIX.length)
	const split = rest.lastIndexOf('.')
	if (split <= 0) return undefined
	const extensionId = rest.slice(0, split)
	const actionName = rest.slice(split + 1)
	if (!EXTENSION_ID.test(extensionId) || !isValidExtensionActionName(actionName)) return undefined
	return { extensionId, actionName }
}

export interface ExtensionActionToolDescriptor {
	name: string
	extensionId: string
	actionName: string
	description?: string
	inputSchema: Readonly<Record<string, unknown>>
}

/** MCP tool listings for actions that opted into the `contextvm` transport. */
export function describeExtensionActionTools(
	extensionId: string,
	actions: Readonly<Record<string, AnyExtensionActionDefinition>> | undefined,
): ExtensionActionToolDescriptor[] {
	if (!actions) return []
	return Object.entries(actions)
		.filter(([, action]) => actionTransports(action).includes('contextvm'))
		.map(([actionName, action]) => ({
			name: extensionActionToolName(extensionId, actionName),
			extensionId,
			actionName,
			...(action.description ? { description: action.description } : {}),
			inputSchema: action.inputJsonSchema ?? { type: 'object' },
		}))
}

/**
 * Reads the caller from `_meta.clientPubkey`, which is trustworthy only when the server transport runs
 * with `injectClientPubkey: true` (it then overwrites any client-supplied value with the signed event's pubkey).
 */
export function callerFromContextVmMeta(meta: unknown, isAdmin: (pubkey: string) => boolean): ExtensionCaller | undefined {
	if (typeof meta !== 'object' || meta === null) return undefined
	const pubkey = (meta as { clientPubkey?: unknown }).clientPubkey
	if (typeof pubkey !== 'string' || !PUBKEY.test(pubkey)) return undefined
	return { pubkey, isAdmin: isAdmin(pubkey), transport: 'contextvm' }
}

export interface ContextVmToolResult {
	content: { type: 'text'; text: string }[]
	structuredContent: Record<string, unknown>
	isError?: boolean
}

/** Wraps a pipeline result in the same envelope as HTTP; errors carry only public codes and messages. */
export function toContextVmToolResult(result: Result<unknown, unknown>): ContextVmToolResult {
	const body: ExtensionActionResponseBody<unknown> = result.ok
		? { ok: true, value: result.value }
		: toExtensionActionErrorResponse(result.error).body
	return {
		content: [{ type: 'text', text: JSON.stringify(body) }],
		structuredContent: body as unknown as Record<string, unknown>,
		...(result.ok ? {} : { isError: true }),
	}
}

/** Decodes an untrusted MCP tool result, preferring `structuredContent` and falling back to JSON text content. */
export function parseContextVmToolResult<Output = unknown>(
	result: unknown,
	output?: RuntimeSchema<Output>,
): Result<Output, ExtensionActionError> {
	if (typeof result !== 'object' || result === null) return failure(new ExtensionActionError('extension_failed'))
	const record = result as { structuredContent?: unknown; content?: unknown; isError?: unknown }
	const succeeded = record.isError !== true
	const body = record.structuredContent ?? firstJsonText(record.content)
	return parseExtensionActionEnvelope(body, { succeeded, fallback: succeeded ? 'invalid_output' : 'extension_failed' }, output)
}

/** Injected MCP `callTool`, e.g. from a `@modelcontextprotocol/sdk` Client over a ContextVM `NostrClientTransport`. */
export type ContextVmCallTool = (
	request: { name: string; arguments: Record<string, unknown> },
	options?: { signal?: AbortSignal },
) => Promise<unknown>

export interface InvokeOverContextVmOptions<Output> {
	output?: RuntimeSchema<Output>
	signal?: AbortSignal
}

/**
 * Calls an extension action as a ContextVM tool. The caller is authenticated by the Nostr request event
 * the transport signs, so no NIP-98 header is involved. MCP arguments must be a JSON object.
 */
export async function invokeExtensionActionOverContextVm<Output = unknown>(
	callTool: ContextVmCallTool,
	extensionId: string,
	actionName: string,
	input: Record<string, unknown>,
	options: InvokeOverContextVmOptions<Output> = {},
): Promise<Result<Output, ExtensionActionError>> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return failure(new ExtensionActionError('invalid_input', 'ContextVM action input must be a JSON object'))
	}
	let result: unknown
	try {
		result = await callTool({ name: extensionActionToolName(extensionId, actionName), arguments: input }, { signal: options.signal })
	} catch (cause) {
		return failure(new ExtensionActionError('network_error', undefined, cause))
	}
	return parseContextVmToolResult(result, options.output)
}

function firstJsonText(content: unknown): unknown {
	if (!Array.isArray(content)) return undefined
	const text = content.find((item) => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')?.text
	if (typeof text !== 'string') return undefined
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}
