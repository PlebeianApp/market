import { nip19 } from 'nostr-tools'
import {
	buildRepositorySnapshot,
	collectRegistryServers,
	CONTEXTVM_SERVER_ANNOUNCEMENT_KIND,
	CONTEXTVM_TOOLS_LIST_KIND,
	EXTENSION_REGISTRY_D_TAG,
	EXTENSION_REGISTRY_LIST_KIND,
	type RepositorySnapshot,
} from '@sdk/core/extensions'
import type { NostrRelayPort } from '@sdk/core/ports/nostrRelay'

/**
 * Curator pubkeys of the Plebeian Market default extension registry. Empty until a curator key is chosen;
 * operators add registries with `EXTENSIONS_REGISTRY_CURATORS`.
 */
export const DEFAULT_REGISTRY_CURATORS: readonly string[] = []

export const REPOSITORY_CACHE_TTL_MS = 5 * 60_000
/** After a failed relay read, retry no sooner than this so the store cannot hammer relays. */
export const REPOSITORY_RETRY_MS = 30_000
const MAX_LISTED_SERVERS = 200

export interface RepositoryConfig {
	curators: string[]
	relays: string[]
	errors: string[]
}

/**
 * - `EXTENSIONS_REGISTRY_CURATORS`: comma-separated hex or npub curator keys, added to the default registry.
 * - `EXTENSIONS_REGISTRY_RELAYS`: comma-separated relay URLs to read from; defaults to the app relay, so no
 *   other relay is contacted unless the operator opts in.
 *
 * The `EXTENSIONS_` prefix (plural) keeps these apart from per-extension `EXTENSION_<ID>_` settings.
 */
export function readRepositoryConfig(env: Readonly<Record<string, string | undefined>>, appRelay: string | undefined): RepositoryConfig {
	const errors: string[] = []
	const curators = new Set(DEFAULT_REGISTRY_CURATORS)
	for (const value of splitList(env.EXTENSIONS_REGISTRY_CURATORS)) {
		const hex = toHexPubkey(value)
		if (hex) curators.add(hex)
		else errors.push(`Ignoring invalid registry curator: ${value.slice(0, 20)}`)
	}
	const relays = new Set<string>()
	for (const value of splitList(env.EXTENSIONS_REGISTRY_RELAYS)) {
		if (/^wss?:\/\/[^\s]+$/.test(value)) relays.add(value)
		else errors.push(`Ignoring invalid registry relay: ${value.slice(0, 60)}`)
	}
	if (relays.size === 0 && appRelay) relays.add(appRelay)
	return { curators: [...curators], relays: [...relays], errors }
}

export interface RepositoryLoaderOptions {
	curators: readonly string[]
	relays: readonly string[]
	getRelayPort: () => NostrRelayPort
	/** Server pubkeys sideloaded by admins; read on every load. */
	getSideloads?: () => readonly string[]
	ttlMs?: number
	nowMs?: () => number
}

/** Reads registry lists and announcements from the configured relays, cached and de-duplicated across callers. */
export function createRepositoryLoader(options: RepositoryLoaderOptions) {
	const now = options.nowMs ?? (() => Date.now())
	const ttl = options.ttlMs ?? REPOSITORY_CACHE_TTL_MS
	let cached: RepositorySnapshot | undefined
	let lastAttemptAt = -Infinity
	// Bumped by invalidate(); a load started before an admin change never overwrites newer state.
	let generation = 0
	let inFlight: Promise<RepositorySnapshot> | undefined

	const load = async (): Promise<RepositorySnapshot> => {
		const sideloaded = [...(options.getSideloads?.() ?? [])]
		const base = { curators: options.curators, relays: options.relays, sideloaded }
		try {
			const port = options.getRelayPort()
			const registryEvents =
				options.curators.length === 0
					? []
					: await port.fetchEvents(
							{ kinds: [EXTENSION_REGISTRY_LIST_KIND], authors: [...options.curators], '#d': [EXTENSION_REGISTRY_D_TAG] },
							options.relays,
						)
			const listed = [...collectRegistryServers(options.curators, registryEvents).listedBy.keys()]
			const servers = [...new Set([...sideloaded, ...listed])].slice(0, MAX_LISTED_SERVERS)
			const announcementEvents =
				servers.length === 0
					? []
					: await port.fetchEvents(
							{ kinds: [CONTEXTVM_SERVER_ANNOUNCEMENT_KIND, CONTEXTVM_TOOLS_LIST_KIND], authors: servers },
							options.relays,
						)
			return buildRepositorySnapshot({ ...base, registryEvents, announcementEvents, nowMs: now() })
		} catch {
			// Keep the last good listing visible; relay errors are reported, never thrown to the store.
			const fallback = cached ?? buildRepositorySnapshot({ ...base, registryEvents: [], announcementEvents: [], nowMs: now() })
			return { ...fallback, problem: 'Could not read the extension registry from the configured relays' }
		}
	}

	return {
		/** Drops the cache, e.g. after an admin sideloads or removes a server. */
		invalidate() {
			generation++
			cached = undefined
			lastAttemptAt = -Infinity
			inFlight = undefined
		},
		/** `undefined` only when no relay is configured; with no sources, an empty snapshot lets admins sideload. */
		async getSnapshot(): Promise<RepositorySnapshot | undefined> {
			if (options.relays.length === 0) return undefined
			if (cached && now() - lastAttemptAt < (cached.problem ? REPOSITORY_RETRY_MS : ttl)) return cached
			const startedAt = generation
			const pending = (inFlight ??= load())
			const snapshot = await pending
			if (startedAt === generation) {
				cached = snapshot
				lastAttemptAt = now()
				if (inFlight === pending) inFlight = undefined
			}
			return snapshot
		},
	}
}

function toHexPubkey(value: string): string | undefined {
	if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase()
	if (!value.startsWith('npub1')) return undefined
	try {
		const decoded = nip19.decode(value)
		return decoded.type === 'npub' ? decoded.data : undefined
	} catch {
		return undefined
	}
}

function splitList(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}
