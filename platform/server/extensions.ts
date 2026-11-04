import { getEventHandler } from './EventHandler'
import { determineStage, getInstanceConfig, RELAY_URL } from './runtime'
import { createPoolRelayPort, type NostrRelayPort } from '@sdk/core'
import { relayPoolAdapter } from '@sdk/core/nostr-io'
import type { AnyExtensionDefinition } from '@sdk/core/extensions'
import { createExtensionActionHandler, EXTENSION_ACTION_ROUTE } from '../extensions/actionRoute'
import { BUILTIN_EXTENSIONS } from '../extensions/builtins'
import { readExtensionEnvConfig, type ExtensionEnvPolicy } from '../extensions/envConfig'
import { HttpAuthReplayCache } from '../extensions/nip98'
import { buildExtensionHost, type ExtensionPortUsage } from '../extensions/ports/host'
import { createMemoryKeyValueStorage } from '../extensions/ports/storage'
import { ExtensionRateLimiter } from '../extensions/rateLimiter'
import { ExtensionRegistry, type PublicExtensionDescriptor } from '../extensions/registry'
import type { BunRoutes } from './http/types'

interface ExtensionRuntimeState {
	registry: ExtensionRegistry
	usage: Map<string, ExtensionPortUsage>
}

// Kept on globalThis so a hot reload of the entrypoint stops the previous registry instead of leaking it.
const STATE_KEY = Symbol.for('plebeian.extensions.runtime')
type GlobalWithState = typeof globalThis & { [STATE_KEY]?: ExtensionRuntimeState }
const globalState = globalThis as GlobalWithState

let relayPort: NostrRelayPort | undefined
let shutdownHooked = false
const storage = createMemoryKeyValueStorage()
const replayCache = new HttpAuthReplayCache()
const rateLimiter = new ExtensionRateLimiter()

export function getExtensionRegistry(): ExtensionRegistry | undefined {
	return globalState[STATE_KEY]?.registry
}

/** Client-safe descriptors for `/api/config`; empty until extensions start or when none are enabled. */
export function getPublicExtensionDescriptors(): PublicExtensionDescriptor[] {
	return getExtensionRegistry()?.getPublicDescriptors() ?? []
}

export function getExtensionPortUsage(id: string): ExtensionPortUsage | undefined {
	const usage = globalState[STATE_KEY]?.usage.get(id)
	return usage ? { ...usage } : undefined
}

/**
 * Registers built-in extensions, configures them from `EXTENSION_<ID>_*` environment variables, and starts
 * the server runtime. A bad extension is logged by id and left disabled; it never blocks the marketplace.
 */
export async function startExtensions(
	definitions: readonly AnyExtensionDefinition[] = BUILTIN_EXTENSIONS,
	env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
	await stopExtensions()

	const registry = new ExtensionRegistry(getInstanceConfig().handlerId)
	for (const definition of definitions) registry.register(definition)

	const config = readExtensionEnvConfig(definitions, env)
	for (const error of config.errors) console.error(`[extensions] ${error.id} disabled: ${error.message}`)
	const configured = registry.configure(config.settings)
	if (!configured.ok) {
		for (const error of configured.error) console.error(`[extensions] configuration rejected: ${error.message}`)
		return
	}

	const usage = new Map<string, ExtensionPortUsage>()
	const policyFor = (id: string): ExtensionEnvPolicy | undefined => config.policies.get(id)
	const failures = await registry.start('server', {
		isolateFailures: true,
		createHost: (definition, privateConfig, signal) => {
			const built = buildExtensionHost(
				definition.manifest,
				privateConfig,
				{
					relayUrls: RELAY_URL ? [RELAY_URL] : [],
					getRelayPort: () => (relayPort ??= createPoolRelayPort(relayPoolAdapter(), { deadlineMs: 8_000 })),
					storage,
					allowLocalhostEgress: determineStage() !== 'production',
					grantedPorts: (id) => policyFor(id)?.hostPorts,
					operatorEgress: (id) => policyFor(id)?.egress,
				},
				signal,
			)
			usage.set(definition.manifest.id, built.usage)
			return built.host
		},
	})
	for (const failure of failures) {
		const name = failure.error instanceof Error ? failure.error.name : typeof failure.error
		console.error(`[extensions] ${failure.id} failed to start (${name}); it stays disabled`)
		usage.delete(failure.id)
	}

	globalState[STATE_KEY] = { registry, usage }
	const running = registry.getPublicDescriptors()
	if (running.length > 0) {
		console.log(`[extensions] running: ${running.map((descriptor) => descriptor.id).join(', ')}`)
		if (determineStage() !== 'development' && !process.env.INSTANCE_SITE_URL) {
			console.error('[extensions] INSTANCE_SITE_URL is not set: extension actions will reject every request outside development')
		}
		hookShutdown()
	}
}

export async function stopExtensions(): Promise<void> {
	const state = globalState[STATE_KEY]
	if (!state) return
	globalState[STATE_KEY] = undefined
	await state.registry.stop().catch((error) => console.error('[extensions] stop failed:', error instanceof Error ? error.message : error))
}

/** Only hooked when an extension runs, so instances without extensions keep the default signal behaviour. */
function hookShutdown() {
	if (shutdownHooked) return
	shutdownHooked = true
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, () => {
			void stopExtensions().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
		})
	}
}

/**
 * NIP-98 `u` origins. The request origin comes from the client-controlled Host header, so it is trusted only
 * in development; elsewhere only `INSTANCE_SITE_URL` is accepted, and without it every action call is refused.
 */
export function resolveAcceptedOrigins(
	request: Request,
	stage: 'production' | 'staging' | 'development',
	siteUrl: string | undefined,
): string[] {
	const origins = new Set<string>()
	if (siteUrl) {
		try {
			origins.add(new URL(siteUrl).origin)
		} catch {
			// Invalid INSTANCE_SITE_URL is rejected by instance config parsing; ignore it here.
		}
	}
	if (stage === 'development') origins.add(new URL(request.url).origin)
	return [...origins]
}

const acceptedOrigins = (request: Request) => resolveAcceptedOrigins(request, determineStage(), process.env.INSTANCE_SITE_URL)

export const extensionRoutes: BunRoutes = {
	[EXTENSION_ACTION_ROUTE]: {
		POST: createExtensionActionHandler({
			getRegistry: getExtensionRegistry,
			isAdmin: (pubkey) => getEventHandler().isAdmin(pubkey),
			replayCache,
			rateLimiter,
			acceptedOrigins,
			onError: ({ extensionId, actionName, reason, cause }) => {
				const name = cause instanceof Error ? cause.name : cause === undefined ? 'none' : typeof cause
				console.warn(`[extensions] ${extensionId}.${actionName} failed: ${reason} (cause: ${name})`)
			},
		}),
	},
}
