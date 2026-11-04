import { ValidationError } from '../errors'
import { failure, success, type Result } from '../result'
import { validateWithSchema, type RuntimeSchema } from '../validation'
import {
	actionTransports,
	EXTENSION_ACTION_AUTH,
	EXTENSION_ACTION_TRANSPORTS,
	isValidExtensionActionName,
	type ExtensionActionDefinition,
} from './actions'
import { extensionActionToolName, MAX_TOOL_NAME_LENGTH } from './contextvm'
import { EXTENSION_HOST_PORTS, parseEgressOrigin, type ExtensionHostPortName, type ExtensionHostPorts } from './hostPorts'

export const EXTENSION_RUNTIMES = ['client', 'server', 'service'] as const
export type ExtensionRuntime = (typeof EXTENSION_RUNTIMES)[number]

const EXTENSION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const CAPABILITY = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface ExtensionManifest<PublicConfig = unknown, PrivateConfig = never> {
	id: string
	version: string
	displayName: string
	/** Logo: a root-relative path to a bundled asset (e.g. `/images/x.svg`) or an https URL. */
	icon?: string
	capabilities: readonly string[]
	runtimes: readonly ExtensionRuntime[]
	/** Values safe to ship to browsers and public config endpoints. */
	publicConfig: RuntimeSchema<PublicConfig>
	/** Credentials and server-only values; never delivered to the client runtime. */
	privateConfig?: RuntimeSchema<PrivateConfig>
	/** Host ports requested from Platform; a port is injected only if also enabled by the operator. */
	hostPorts?: readonly ExtensionHostPortName[]
	/** Origins the `http` port may reach (https, or http for localhost only). Required when `http` is requested. */
	egress?: readonly string[]
}

export interface ExtensionContext<PublicConfig = unknown, PrivateConfig = never> {
	instanceId: string
	runtime: ExtensionRuntime
	publicConfig: PublicConfig
	privateConfig: PrivateConfig | undefined
	signal: AbortSignal
	/** Capability-gated host ports. Absent when the runtime provides none. */
	host?: ExtensionHostPorts
}

export interface ExtensionLifecycle<PublicConfig = unknown, PrivateConfig = never, Handle = unknown> {
	start(context: ExtensionContext<PublicConfig, PrivateConfig>): Handle | Promise<Handle>
	stop?(handle: Handle): void | Promise<void>
}

export interface ExtensionDefinition<PublicConfig = unknown, PrivateConfig = never, Handle = unknown> {
	manifest: ExtensionManifest<PublicConfig, PrivateConfig>
	lifecycle?: ExtensionLifecycle<PublicConfig, PrivateConfig, Handle>
	/** Named client → server actions. Only valid for extensions that run in the `server` runtime. */
	actions?: Readonly<Record<string, ExtensionActionDefinition<any, any, PublicConfig, PrivateConfig>>>
}

export type AnyExtensionDefinition = ExtensionDefinition<any, any, any>

export interface ParsedExtensionConfig<PublicConfig = unknown, PrivateConfig = never> {
	publicConfig: PublicConfig
	privateConfig: PrivateConfig | undefined
}

export function validateExtensionManifest(manifest: ExtensionManifest<unknown, unknown>): Result<void, ValidationError> {
	if (!EXTENSION_ID.test(manifest.id)) return failure(new ValidationError('Extension id must be lowercase dot/dash separated', ['id']))
	if (!SEMVER.test(manifest.version)) return failure(new ValidationError('Extension version must be semver', ['version']))
	if (!manifest.displayName.trim()) return failure(new ValidationError('Extension displayName must be non-empty', ['displayName']))
	if (manifest.icon !== undefined && !isValidExtensionIcon(manifest.icon)) {
		return failure(new ValidationError('Extension icon must be a root-relative image path or an https URL', ['icon']))
	}
	if (manifest.runtimes.length === 0 || !manifest.runtimes.every((runtime) => EXTENSION_RUNTIMES.includes(runtime))) {
		return failure(new ValidationError('Extension runtimes must be a non-empty subset of client, server, service', ['runtimes']))
	}
	for (let index = 0; index < manifest.capabilities.length; index++) {
		if (!CAPABILITY.test(manifest.capabilities[index])) {
			return failure(new ValidationError('Extension capability has an invalid name', ['capabilities', index]))
		}
	}
	if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
		return failure(new ValidationError('Extension capabilities must be unique', ['capabilities']))
	}
	return validateHostPorts(manifest)
}

const BUNDLED_ICON = /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:svg|png|webp|jpe?g)$/
const MAX_ICON_LENGTH = 512

/** Bundled paths may not traverse (`..`) or carry a query; remote icons must be https. */
export function isValidExtensionIcon(icon: string): boolean {
	if (typeof icon !== 'string' || icon.length === 0 || icon.length > MAX_ICON_LENGTH) return false
	if (icon.startsWith('/')) return !icon.startsWith('//') && !icon.includes('..') && BUNDLED_ICON.test(icon)
	try {
		const url = new URL(icon)
		return url.protocol === 'https:' && !url.username && !url.password
	} catch {
		return false
	}
}

function validateHostPorts(manifest: ExtensionManifest<unknown, unknown>): Result<void, ValidationError> {
	const hostPorts = manifest.hostPorts ?? []
	for (let index = 0; index < hostPorts.length; index++) {
		if (!EXTENSION_HOST_PORTS.includes(hostPorts[index])) {
			return failure(new ValidationError('Extension host port is not recognised', ['hostPorts', index]))
		}
	}
	if (new Set(hostPorts).size !== hostPorts.length)
		return failure(new ValidationError('Extension host ports must be unique', ['hostPorts']))

	const egress = manifest.egress ?? []
	const wantsHttp = hostPorts.includes('http')
	if (wantsHttp && egress.length === 0)
		return failure(new ValidationError('The http host port requires at least one egress origin', ['egress']))
	if (!wantsHttp && egress.length > 0) return failure(new ValidationError('Egress origins require the http host port', ['egress']))

	const origins = new Set<string>()
	for (let index = 0; index < egress.length; index++) {
		const parsed = parseEgressOrigin(egress[index])
		if (!parsed.ok) return failure(new ValidationError(parsed.error.message, ['egress', index]))
		if (origins.has(parsed.value)) return failure(new ValidationError('Egress origins must be unique', ['egress', index]))
		origins.add(parsed.value)
	}
	return success(undefined)
}

/** Validates the manifest plus declared actions (names, auth, rate limits, schemas, handlers). */
export function validateExtensionDefinition(definition: AnyExtensionDefinition): Result<void, ValidationError> {
	const manifestResult = validateExtensionManifest(definition.manifest)
	if (!manifestResult.ok) return manifestResult

	const actions = definition.actions ?? {}
	const names = Object.keys(actions)
	if (names.length > 0 && !definition.manifest.runtimes.includes('server')) {
		return failure(new ValidationError('Extension actions require the server runtime', ['actions']))
	}
	for (const name of names) {
		const action = actions[name]
		const path = ['actions', name]
		if (!isValidExtensionActionName(name)) return failure(new ValidationError('Extension action name must be lowercase kebab-case', path))
		if (!EXTENSION_ACTION_AUTH.includes(action.auth))
			return failure(new ValidationError('Extension action auth must be user or admin', [...path, 'auth']))
		const { perPubkey, windowSeconds } = action.rateLimit ?? {}
		if (!isPositiveInteger(perPubkey) || !isPositiveInteger(windowSeconds)) {
			return failure(
				new ValidationError('Extension action rateLimit requires positive integer perPubkey and windowSeconds', [...path, 'rateLimit']),
			)
		}
		if (typeof action.input?.parse !== 'function' || typeof action.output?.parse !== 'function') {
			return failure(new ValidationError('Extension action requires input and output schemas', path))
		}
		if (typeof action.handler !== 'function')
			return failure(new ValidationError('Extension action requires a handler', [...path, 'handler']))
		if (action.transports !== undefined) {
			const transports = action.transports
			if (
				transports.length === 0 ||
				!transports.every((transport) => EXTENSION_ACTION_TRANSPORTS.includes(transport)) ||
				new Set(transports).size !== transports.length
			) {
				return failure(
					new ValidationError('Extension action transports must be a non-empty unique subset of http, contextvm', [...path, 'transports']),
				)
			}
		}
		if (action.inputJsonSchema !== undefined && (typeof action.inputJsonSchema !== 'object' || action.inputJsonSchema === null)) {
			return failure(new ValidationError('Extension action inputJsonSchema must be an object', [...path, 'inputJsonSchema']))
		}
		if (
			actionTransports(action).includes('contextvm') &&
			extensionActionToolName(definition.manifest.id, name).length > MAX_TOOL_NAME_LENGTH
		) {
			return failure(new ValidationError('Extension id and action name are too long for a ContextVM tool name', path))
		}
	}
	return success(undefined)
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Validates the manifest eagerly so a malformed extension fails at import, not at instance start. */
export function defineExtension<PublicConfig, PrivateConfig = never, Handle = unknown>(
	definition: ExtensionDefinition<PublicConfig, PrivateConfig, Handle>,
): ExtensionDefinition<PublicConfig, PrivateConfig, Handle> {
	const result = validateExtensionDefinition(definition as AnyExtensionDefinition)
	if (!result.ok) throw result.error
	return definition
}

/**
 * Returns an identity helper that types action handlers against the manifest's config and infers
 * input/output from the schemas: `const action = defineActionFor(manifest); action({ input, output, ... })`.
 */
export function defineActionFor<PublicConfig, PrivateConfig>(_manifest: ExtensionManifest<PublicConfig, PrivateConfig>) {
	return <Input, Output>(
		action: ExtensionActionDefinition<Input, Output, PublicConfig, PrivateConfig>,
	): ExtensionActionDefinition<Input, Output, PublicConfig, PrivateConfig> => action
}

/** Parses untrusted instance values against the extension's schemas. Performs no I/O. */
export function parseExtensionConfig<PublicConfig, PrivateConfig>(
	manifest: ExtensionManifest<PublicConfig, PrivateConfig>,
	input: { publicConfig?: unknown; privateConfig?: unknown },
): Result<ParsedExtensionConfig<PublicConfig, PrivateConfig>, ValidationError> {
	const publicResult = validateWithSchema(input.publicConfig ?? {}, manifest.publicConfig)
	if (!publicResult.ok)
		return failure(new ValidationError(`${manifest.id}: ${publicResult.error.message}`, ['publicConfig'], publicResult.error))

	if (!manifest.privateConfig) {
		if (input.privateConfig !== undefined) {
			return failure(new ValidationError(`${manifest.id}: extension declares no private config`, ['privateConfig']))
		}
		return success({ publicConfig: publicResult.value, privateConfig: undefined })
	}

	const privateResult = validateWithSchema(input.privateConfig ?? {}, manifest.privateConfig)
	if (!privateResult.ok) {
		// Private parse errors may echo secret values, so the cause is not attached.
		return failure(new ValidationError(`${manifest.id}: invalid private config`, ['privateConfig']))
	}
	return success({ publicConfig: publicResult.value, privateConfig: privateResult.value })
}
