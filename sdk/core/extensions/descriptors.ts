import { ValidationError } from '../errors'
import { failure, success, type Result } from '../result'
import {
	describeExtensionActions,
	EXTENSION_ACTION_AUTH,
	EXTENSION_ACTION_TRANSPORTS,
	isValidExtensionActionName,
	type ExtensionActionTransport,
	type PublicExtensionActionDescriptor,
} from './actions'
import { isValidExtensionIcon, type AnyExtensionDefinition } from './extension'

/** Client-safe view of an enabled extension, as published in `/api/config`. Never carries private config. */
export interface PublicExtensionDescriptor {
	id: string
	version: string
	displayName: string
	icon?: string
	capabilities: readonly string[]
	config: unknown
	actions: readonly PublicExtensionActionDescriptor[]
}

/** Builds the public descriptor for an enabled extension from its definition and parsed public config. */
export function describeExtension(definition: AnyExtensionDefinition, publicConfig: unknown): PublicExtensionDescriptor {
	const { manifest } = definition
	return {
		id: manifest.id,
		version: manifest.version,
		displayName: manifest.displayName,
		...(manifest.icon ? { icon: manifest.icon } : {}),
		capabilities: [...manifest.capabilities],
		config: publicConfig,
		actions: describeExtensionActions(definition.actions),
	}
}

const EXTENSION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const CAPABILITY = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/
const MAX_DESCRIPTORS = 100
const MAX_TEXT = 200

/**
 * Parses the untrusted `extensions` list from a public config response. Malformed entries are dropped
 * individually so one bad descriptor cannot hide the others; a non-array input is an error.
 */
export function parsePublicExtensionDescriptors(input: unknown): Result<PublicExtensionDescriptor[], ValidationError> {
	if (input === undefined) return success([])
	if (!Array.isArray(input)) return failure(new ValidationError('Extension descriptors must be an array', ['extensions']))
	const seen = new Set<string>()
	const descriptors: PublicExtensionDescriptor[] = []
	for (const entry of input.slice(0, MAX_DESCRIPTORS)) {
		const descriptor = parseDescriptor(entry)
		if (!descriptor || seen.has(descriptor.id)) continue
		seen.add(descriptor.id)
		descriptors.push(descriptor)
	}
	return success(descriptors)
}

export interface ExtensionActionTarget {
	extensionId: string
	action: PublicExtensionActionDescriptor
}

/**
 * Finds an action by capability, so UI never hard-codes extension ids. With an explicit `actionName`,
 * only that action matches; otherwise the extension must expose exactly one action on the transport.
 */
export function findExtensionAction(
	descriptors: readonly PublicExtensionDescriptor[],
	capability: string,
	options: { actionName?: string; transport?: ExtensionActionTransport } = {},
): ExtensionActionTarget | undefined {
	const transport = options.transport ?? 'http'
	for (const descriptor of descriptors) {
		if (!descriptor.capabilities.includes(capability)) continue
		const actions = descriptor.actions.filter(
			(action) => action.transports.includes(transport) && (options.actionName === undefined || action.name === options.actionName),
		)
		if (actions.length === 1) return { extensionId: descriptor.id, action: actions[0] }
	}
	return undefined
}

function parseDescriptor(input: unknown): PublicExtensionDescriptor | undefined {
	if (!isRecord(input)) return undefined
	const { id, version, displayName, icon, capabilities, config, actions } = input
	if (typeof id !== 'string' || !EXTENSION_ID.test(id)) return undefined
	if (typeof version !== 'string' || version.length > 64) return undefined
	if (!Array.isArray(capabilities) || !capabilities.every((value) => typeof value === 'string' && CAPABILITY.test(value))) return undefined
	const parsedActions = Array.isArray(actions) ? actions.map(parsePublicExtensionAction) : []
	if (parsedActions.some((action) => action === undefined)) return undefined
	return {
		id,
		version,
		displayName: typeof displayName === 'string' && displayName.trim() ? displayName.slice(0, MAX_TEXT) : id,
		// An invalid icon is dropped rather than failing the descriptor; UI falls back to a placeholder.
		...(typeof icon === 'string' && isValidExtensionIcon(icon) ? { icon } : {}),
		capabilities: [...capabilities],
		config: config ?? {},
		actions: parsedActions as PublicExtensionActionDescriptor[],
	}
}

export function parsePublicExtensionAction(input: unknown): PublicExtensionActionDescriptor | undefined {
	if (!isRecord(input)) return undefined
	const { name, description, auth, rateLimit, transports } = input
	if (typeof name !== 'string' || !isValidExtensionActionName(name)) return undefined
	if (typeof auth !== 'string' || !(EXTENSION_ACTION_AUTH as readonly string[]).includes(auth)) return undefined
	if (!isRecord(rateLimit) || !isPositiveInteger(rateLimit.perPubkey) || !isPositiveInteger(rateLimit.windowSeconds)) return undefined
	const parsedTransports = transports === undefined ? ['http'] : transports
	if (
		!Array.isArray(parsedTransports) ||
		parsedTransports.length === 0 ||
		!parsedTransports.every((value) => (EXTENSION_ACTION_TRANSPORTS as readonly unknown[]).includes(value))
	) {
		return undefined
	}
	return {
		name,
		...(typeof description === 'string' && description ? { description: description.slice(0, MAX_TEXT) } : {}),
		auth: auth as PublicExtensionActionDescriptor['auth'],
		rateLimit: { perPubkey: rateLimit.perPubkey, windowSeconds: rateLimit.windowSeconds },
		transports: [...new Set(parsedTransports as ExtensionActionTransport[])],
	}
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
