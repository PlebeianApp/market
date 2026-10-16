import { ValidationError } from '../errors'
import { failure, success, type Result } from '../result'
import { validateWithSchema, type RuntimeSchema } from '../validation'

export const EXTENSION_RUNTIMES = ['client', 'server', 'service'] as const
export type ExtensionRuntime = (typeof EXTENSION_RUNTIMES)[number]

const EXTENSION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const CAPABILITY = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface ExtensionManifest<PublicConfig = unknown, PrivateConfig = never> {
	id: string
	version: string
	displayName: string
	capabilities: readonly string[]
	runtimes: readonly ExtensionRuntime[]
	/** Values safe to ship to browsers and public config endpoints. */
	publicConfig: RuntimeSchema<PublicConfig>
	/** Credentials and server-only values; never delivered to the client runtime. */
	privateConfig?: RuntimeSchema<PrivateConfig>
}

export interface ExtensionContext<PublicConfig = unknown, PrivateConfig = never> {
	instanceId: string
	runtime: ExtensionRuntime
	publicConfig: PublicConfig
	privateConfig: PrivateConfig | undefined
	signal: AbortSignal
}

export interface ExtensionLifecycle<PublicConfig = unknown, PrivateConfig = never, Handle = unknown> {
	start(context: ExtensionContext<PublicConfig, PrivateConfig>): Handle | Promise<Handle>
	stop?(handle: Handle): void | Promise<void>
}

export interface ExtensionDefinition<PublicConfig = unknown, PrivateConfig = never, Handle = unknown> {
	manifest: ExtensionManifest<PublicConfig, PrivateConfig>
	lifecycle?: ExtensionLifecycle<PublicConfig, PrivateConfig, Handle>
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
	return success(undefined)
}

/** Validates the manifest eagerly so a malformed extension fails at import, not at instance start. */
export function defineExtension<PublicConfig, PrivateConfig = never, Handle = unknown>(
	definition: ExtensionDefinition<PublicConfig, PrivateConfig, Handle>,
): ExtensionDefinition<PublicConfig, PrivateConfig, Handle> {
	const result = validateExtensionManifest(definition.manifest as ExtensionManifest<unknown, unknown>)
	if (!result.ok) throw result.error
	return definition
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
