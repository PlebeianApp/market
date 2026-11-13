import { getEventHandler } from './EventHandler'
import { determineStage, getInstanceConfig, RELAY_URL } from './runtime'
import { createPoolRelayPort, type NostrRelayPort } from '@sdk/core'
import { relayPoolAdapter } from '@sdk/core/nostr-io'
import {
	describeCatalogEntry,
	EXTENSION_CATALOG_PATH,
	EXTENSION_BINDINGS_PATH,
	EXTENSION_BUILTINS_PATH,
	EXTENSION_SERVERS_PATH,
	parseRemoteExtensionId,
	type AnyExtensionDefinition,
	type ExtensionCatalog,
	type RemoteBindingView,
} from '@sdk/core/extensions'
import { createExtensionActionHandler, createExtensionCatalogHandler, EXTENSION_ACTION_ROUTE } from '../extensions/actionRoute'
import { BUILTIN_EXTENSIONS } from '../extensions/builtins'
import { extensionEnvPrefix, readExtensionEnvConfig, type ExtensionEnvPolicy } from '../extensions/envConfig'
import { HttpAuthReplayCache } from '../extensions/nip98'
import { buildExtensionHost, type ExtensionPortUsage } from '../extensions/ports/host'
import { createMemoryKeyValueStorage } from '../extensions/ports/storage'
import { ExtensionRateLimiter } from '../extensions/rateLimiter'
import { createBindingHandlers } from '../extensions/bindingRoutes'
import { resolveBuiltinSettings } from '../extensions/builtinSettings'
import { adminError, adminOk, authenticateAdminRequest, parseJsonBody } from '../extensions/adminAuth'
import {
	createContextVmToolCaller,
	createRemoteTarget,
	describeRemoteBindings,
	evaluateBindings,
	resolveClientKey,
	type RemoteActionTarget,
	type RemoteToolCaller,
} from '../extensions/remoteBindings'
import { createRepositoryLoader, readRepositoryConfig, REPOSITORY_CACHE_TTL_MS } from '../extensions/repository'
import { createServerHandlers } from '../extensions/serverRoutes'
import { DEFAULT_EXTENSIONS_STATE_PATH, SqliteExtensionStateStore, type ExtensionStateStore } from '../extensions/stateStore'
import { ExtensionRegistry, type PublicExtensionDescriptor } from '../extensions/registry'
import type { BunRoutes } from './http/types'

interface ExtensionRuntimeState {
	registry: ExtensionRegistry
	usage: Map<string, ExtensionPortUsage>
	/** Admin-safe reasons an extension is not running, keyed by id. Never contains private values. */
	problems: Map<string, string>
	repository: ReturnType<typeof createRepositoryLoader>
	stateStore: ExtensionStateStore
	/** Built-in configuration inputs, kept so admin enable/disable can reapply them without a restart. */
	builtins: {
		definitions: readonly AnyExtensionDefinition[]
		envConfig: ReturnType<typeof readExtensionEnvConfig>
		disabledByAdmin: Set<string>
		enableable: Set<string>
	}
	/** Remote binding runtime (ADR-0023 §7.5). */
	remote: {
		getCaller: () => RemoteToolCaller | undefined
		close: () => Promise<void>
		lastFailureAt: Map<string, number>
		refreshTimer: ReturnType<typeof setInterval>
		/** Set when remote calls cannot be made at all, e.g. an invalid client key. */
		problem?: string
	}
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
	const state = globalState[STATE_KEY]
	if (!state) return []
	return [...state.registry.getPublicDescriptors(), ...describeRemoteBindings(remoteBindingViews(state), state.repository.peek())]
}

/** Binding states from the cached snapshot only; no relay I/O, so it is safe for public endpoints. */
function remoteBindingViews(state: ExtensionRuntimeState): RemoteBindingView[] {
	const views = evaluateBindings(state.stateStore.listBindings(), state.repository.peek(), state.remote.lastFailureAt, Date.now())
	if (!state.remote.problem) return views
	return views.map((view) => (view.state === 'installed_enabled' ? { ...view, state: 'unreachable', problem: state.remote.problem } : view))
}

function getRemoteTarget(extensionId: string, actionName: string): RemoteActionTarget | undefined {
	const state = globalState[STATE_KEY]
	const serverPubkey = parseRemoteExtensionId(extensionId)
	if (!state || !serverPubkey) return undefined
	const view = remoteBindingViews(state).find(
		(item) => item.serverPubkey === serverPubkey && item.actionName === actionName && item.state === 'installed_enabled',
	)
	const caller = view && state.remote.getCaller()
	if (!view || !caller) return undefined
	return createRemoteTarget(
		view,
		caller,
		(pubkey) => state.remote.lastFailureAt.set(pubkey, Date.now()),
		(pubkey) => state.remote.lastFailureAt.delete(pubkey),
	)
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

	const usage = new Map<string, ExtensionPortUsage>()
	const problems = new Map<string, string>()
	const stateStore = new SqliteExtensionStateStore(env.EXTENSIONS_STATE_PATH || DEFAULT_EXTENSIONS_STATE_PATH)
	const repositoryConfig = readRepositoryConfig(env, RELAY_URL)
	for (const error of repositoryConfig.errors) console.error(`[extensions] ${error}`)
	const repository = createRepositoryLoader({
		curators: repositoryConfig.curators,
		relays: repositoryConfig.relays,
		getRelayPort: sharedRelayPort,
		getAddedServers: () => stateStore.listAddedServers().map((record) => record.pubkey),
	})
	const remote = startRemoteBindings(env, repositoryConfig.relays, stateStore, repository)
	const envConfig = readExtensionEnvConfig(definitions, env)
	for (const error of envConfig.errors) console.error(`[extensions] ${error.id} disabled: ${error.message}`)
	const state: ExtensionRuntimeState = {
		registry,
		usage,
		problems,
		repository,
		stateStore,
		remote,
		builtins: { definitions, envConfig, disabledByAdmin: new Set(), enableable: new Set() },
	}
	globalState[STATE_KEY] = state
	await applyBuiltins(state)

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
	clearInterval(state.remote.refreshTimer)
	await state.remote.close().catch(() => undefined)
	state.stateStore.close()
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
 * (Re)configures and starts built-in extensions from the environment plus admin overrides. Running extensions are
 * stopped first; a bad extension is logged by id and stays off, it never blocks the marketplace.
 */
async function applyBuiltins(state: ExtensionRuntimeState): Promise<void> {
	const { registry, usage, problems, builtins } = state
	await registry.stop().catch((error) => console.error('[extensions] stop failed:', error instanceof Error ? error.message : error))
	usage.clear()
	problems.clear()
	for (const error of builtins.envConfig.errors) problems.set(error.id, error.message)

	const resolution = resolveBuiltinSettings(builtins.definitions, builtins.envConfig, state.stateStore.listBuiltinOverrides())
	builtins.disabledByAdmin = resolution.disabledByAdmin
	builtins.enableable = resolution.enableable
	for (const [id, message] of resolution.problems) problems.set(id, message)

	const configured = registry.configure(resolution.settings)
	if (!configured.ok) {
		for (const error of configured.error) console.error(`[extensions] configuration rejected: ${error.message}`)
		return
	}

	const policyFor = (id: string): ExtensionEnvPolicy | undefined => builtins.envConfig.policies.get(id)
	const failures = await registry.start('server', {
		isolateFailures: true,
		createHost: (definition, privateConfig, signal) => {
			const built = buildExtensionHost(
				definition.manifest,
				privateConfig,
				{
					relayUrls: RELAY_URL ? [RELAY_URL] : [],
					getRelayPort: sharedRelayPort,
					storage,
					allowLocalhostEgress: determineStage() !== 'production',
					grantedPorts: (id) => policyFor(id)?.hostPorts,
					operatorEgress: (id) => policyFor(id)?.egress,
					operatorAllowsLocalhost: (id) => policyFor(id)?.allowLocalhost === true,
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
		problems.set(failure.id, `Failed to start (${name}). See the server log.`)
	}
}

/** Admin switch for a built-in extension. Returns an error message when the change is not possible. */
export async function setBuiltinEnabled(id: string, enabled: boolean, adminPubkey: string): Promise<string | undefined> {
	const state = globalState[STATE_KEY]
	if (!state) return 'Extensions are not started'
	if (!state.builtins.definitions.some((definition) => definition.manifest.id === id)) return 'Unknown extension'
	if (enabled && !state.builtins.enableable.has(id)) return 'Needs private settings in the server environment'
	state.stateStore.setBuiltinOverride(id, enabled, adminPubkey, Math.floor(Date.now() / 1000))
	await applyBuiltins(state)
	return undefined
}

function sharedRelayPort(): NostrRelayPort {
	return (relayPort ??= createPoolRelayPort(relayPoolAdapter(), { deadlineMs: 8_000 }))
}

/**
 * Remote calls sign with `EXTENSIONS_CLIENT_KEY`, never the app key. The ContextVM client is created on first
 * use, and while bindings exist the repository is refreshed in the background so pins and descriptors stay current.
 */
function startRemoteBindings(
	env: Readonly<Record<string, string | undefined>>,
	relays: readonly string[],
	stateStore: ExtensionStateStore,
	repository: ReturnType<typeof createRepositoryLoader>,
): ExtensionRuntimeState['remote'] {
	let problem: string | undefined
	let clientKey: ReturnType<typeof resolveClientKey> | undefined
	try {
		clientKey = resolveClientKey(env.EXTENSIONS_CLIENT_KEY)
	} catch (error) {
		problem = 'EXTENSIONS_CLIENT_KEY is invalid, so remote extensions cannot be called'
		console.error(`[extensions] ${error instanceof Error ? error.message : 'Invalid EXTENSIONS_CLIENT_KEY'}`)
	}

	if (clientKey && stateStore.listBindings().length > 0) {
		const note = clientKey.ephemeral ? ' (ephemeral: set EXTENSIONS_CLIENT_KEY for a stable key)' : ''
		console.log(`[extensions] remote bindings call servers as ${clientKey.pubkey}${note}`)
	}

	let caller: RemoteToolCaller | undefined
	const refresh = () => {
		if (stateStore.listBindings().length > 0) void repository.getSnapshot()
	}
	refresh()
	const refreshTimer = setInterval(refresh, REPOSITORY_CACHE_TTL_MS)
	refreshTimer.unref?.()

	return {
		getCaller: () => {
			if (!clientKey || relays.length === 0) return undefined
			caller ??= createContextVmToolCaller({ privateKeyHex: clientKey.privateKeyHex, relays })
			return caller
		},
		close: async () => {
			await caller?.close()
			caller = undefined
		},
		lastFailureAt: new Map(),
		refreshTimer,
		...(problem ? { problem } : {}),
	}
}

/**
 * Admin store listing: every built-in with its state, plus third-party entries from configured repositories.
 * Config values are never included.
 */
export async function getExtensionCatalog(): Promise<ExtensionCatalog> {
	const state = globalState[STATE_KEY]
	if (!state) return { entries: [] }
	const entries = state.registry.getDefinitions().map((definition) => {
		const id = definition.manifest.id
		const problem = state.problems.get(id)
		const status = state.registry.isEnabled(id)
			? 'installed_enabled'
			: state.builtins.disabledByAdmin.has(id)
				? 'installed_disabled'
				: problem
					? 'misconfigured'
					: 'available'
		return describeCatalogEntry(definition, {
			state: status,
			envPrefix: extensionEnvPrefix(id),
			canEnable: state.builtins.enableable.has(id),
			...(problem ? { problem } : {}),
		})
	})
	const repository = await state.repository.getSnapshot()
	return { entries, ...(repository ? { repository } : {}), bindings: remoteBindingViews(state) }
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

const servers = createServerHandlers({
	getSnapshot: async () => globalState[STATE_KEY]?.repository.getSnapshot(),
	store: () => {
		const state = globalState[STATE_KEY]
		if (!state) throw new Error('Extensions are not started')
		return state.stateStore
	},
	isAdmin: (pubkey) => getEventHandler().isAdmin(pubkey),
	replayCache,
	acceptedOrigins,
	onChange: () => globalState[STATE_KEY]?.repository.invalidate(),
})

const bindings = createBindingHandlers({
	store: () => {
		const state = globalState[STATE_KEY]
		if (!state) throw new Error('Extensions are not started')
		return state.stateStore
	},
	getSnapshot: async () => globalState[STATE_KEY]?.repository.getSnapshot(),
	isAdmin: (pubkey) => getEventHandler().isAdmin(pubkey),
	replayCache,
	acceptedOrigins,
	onChange: () => undefined,
})

const builtinAuth = { isAdmin: (pubkey: string) => getEventHandler().isAdmin(pubkey), replayCache, acceptedOrigins }

/** `PATCH /api/extensions/builtins/:id` with `{ enabled }`: admin enable/disable of a built-in (NIP-98, 404 otherwise). */
async function updateBuiltin(request: Request & { params?: Record<string, string> }): Promise<Response> {
	const auth = await authenticateAdminRequest(request, builtinAuth)
	if (!auth.ok) return auth.response
	const enabled = (parseJsonBody(auth.body) as { enabled?: unknown } | undefined)?.enabled
	if (typeof enabled !== 'boolean') return adminError('invalid_input', 'enabled must be true or false')
	const id = request.params?.id ?? ''
	const problem = await setBuiltinEnabled(id, enabled, auth.pubkey)
	if (problem === 'Unknown extension') return adminError('not_found')
	if (problem) return adminError('invalid_input', problem)
	return adminOk({ id, enabled })
}

export const extensionRoutes: BunRoutes = {
	[`${EXTENSION_BUILTINS_PATH}/:id`]: { PATCH: updateBuiltin },
	[EXTENSION_BINDINGS_PATH]: { POST: bindings.create },
	[`${EXTENSION_BINDINGS_PATH}/:server/:action`]: { PATCH: bindings.update, DELETE: bindings.remove },
	[EXTENSION_SERVERS_PATH]: { POST: servers.add },
	[`${EXTENSION_SERVERS_PATH}/:pubkey`]: { DELETE: servers.remove },
	[EXTENSION_CATALOG_PATH]: {
		GET: createExtensionCatalogHandler({
			getCatalog: getExtensionCatalog,
			isAdmin: (pubkey) => getEventHandler().isAdmin(pubkey),
			replayCache,
			acceptedOrigins,
		}),
	},
	[EXTENSION_ACTION_ROUTE]: {
		POST: createExtensionActionHandler({
			getRegistry: getExtensionRegistry,
			getRemoteTarget,
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
