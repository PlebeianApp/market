import type { ExtensionHostPortName, ExtensionHostPorts, ExtensionManifest } from '@sdk/core/extensions'
import type { NostrRelayPort } from '@sdk/core/ports/nostrRelay'
import type { KeyValueStoragePort } from '@sdk/core/ports/storage'
import { createScopedHttpPort, type HttpFetch } from './http'
import { createRedactingLogger, type LogSink } from './logger'
import { createScopedRelayPort } from './relays'
import { createNamespacedStorage } from './storage'

/** Per-port call counters for the admin view (ADR-0023 §7, LNbits-style metering). */
export interface ExtensionPortUsage {
	relays: number
	http: number
	storage: number
}

/** Instance-level dependencies Platform uses to build each extension's ports. */
export interface ExtensionHostEnvironment {
	relayUrls: readonly string[]
	/** Created lazily, so instances without relay-reading extensions open no extra connections. */
	getRelayPort: () => NostrRelayPort
	storage: KeyValueStoragePort
	allowLocalhostEgress: boolean
	fetch?: HttpFetch
	logSink?: LogSink
	/** Operator switch per extension; `undefined` grants every port the manifest requests. */
	grantedPorts?: (extensionId: string) => readonly ExtensionHostPortName[] | undefined
	operatorEgress?: (extensionId: string) => readonly string[] | undefined
}

export interface BuiltExtensionHost {
	host: ExtensionHostPorts
	usage: ExtensionPortUsage
}

/** A port is injected only if the manifest requests it and the operator grants it. */
export function buildExtensionHost(
	manifest: ExtensionManifest<unknown, unknown>,
	privateConfig: unknown,
	environment: ExtensionHostEnvironment,
	signal: AbortSignal,
): BuiltExtensionHost {
	const requested = new Set(manifest.hostPorts ?? [])
	const granted = environment.grantedPorts?.(manifest.id)
	const has = (port: ExtensionHostPortName) => requested.has(port) && (granted === undefined || granted.includes(port))
	const usage: ExtensionPortUsage = { relays: 0, http: 0, storage: 0 }
	const host: ExtensionHostPorts = { log: createRedactingLogger(manifest.id, privateConfig, environment.logSink) }

	if (has('relays:read')) {
		const relays = createScopedRelayPort(environment.getRelayPort(), {
			relayUrls: environment.relayUrls,
			allowPublish: has('relays:publish'),
			signal,
		})
		host.relays = {
			fetchEvents: (filters, options) => {
				usage.relays++
				return relays.fetchEvents(filters, options)
			},
			subscribe: (filters, onEvent) => {
				usage.relays++
				return relays.subscribe(filters, onEvent)
			},
			...(relays.publish
				? {
						publish: (event: Parameters<NonNullable<typeof relays.publish>>[0]) => {
							usage.relays++
							return relays.publish!(event)
						},
					}
				: {}),
		}
	}

	if (has('http')) {
		const http = createScopedHttpPort({
			egress: manifest.egress ?? [],
			operatorEgress: environment.operatorEgress?.(manifest.id),
			allowLocalhost: environment.allowLocalhostEgress,
			fetch: environment.fetch,
			signal,
		})
		host.http = {
			request: (request) => {
				usage.http++
				return http.request(request)
			},
		}
	}

	if (has('storage')) {
		const storage = createNamespacedStorage(environment.storage, manifest.id)
		host.storage = {
			get: (key) => {
				usage.storage++
				return storage.get(key)
			},
			set: (key, value) => {
				usage.storage++
				return storage.set(key, value)
			},
			remove: (key) => {
				usage.storage++
				return storage.remove(key)
			},
		}
	}

	return { host, usage }
}
