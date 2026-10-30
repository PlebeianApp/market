import type { ExtensionActionContext, ExtensionActionTransport, ExtensionCaller } from '../extensions/actions'
import {
	ExtensionHttpError,
	isEgressAllowed,
	type ExtensionHostPorts,
	type ExtensionHttpRequest,
	type ExtensionHttpResponse,
	type ExtensionLogFields,
	type ExtensionLogger,
	type ScopedHttpPort,
	type ScopedRelayPort,
} from '../extensions/hostPorts'
import type { NostrEventLike } from '../nostr/eventLike'
import type { NostrFilter } from '../ports/nostrRelay'
import type { KeyValueStoragePort } from '../ports/storage'
import { failure, success } from '../result'

type FakeHttpHandler = (
	request: ExtensionHttpRequest,
) => ExtensionHttpResponse | ExtensionHttpError | Promise<ExtensionHttpResponse | ExtensionHttpError>

/** Records requests and enforces the same exact-origin egress rule as Platform. Never touches the network. */
export function createFakeHttpPort(handler: FakeHttpHandler, options: { egress?: readonly string[] } = {}) {
	const requests: ExtensionHttpRequest[] = []
	const port: ScopedHttpPort = {
		async request(request) {
			if (options.egress && !isEgressAllowed(request.url, options.egress)) {
				return failure(new ExtensionHttpError('egress_denied', 'Origin not in egress allowlist'))
			}
			requests.push(request)
			const result = await handler(request)
			return result instanceof ExtensionHttpError ? failure(result) : success(result)
		},
	}
	return { port, requests }
}

export function jsonResponse(status: number, body: unknown): ExtensionHttpResponse {
	return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/** In-memory relay port supporting `ids`, `authors`, `kinds`, `#<tag>`, `since`, `until`, and `limit`. */
export function createFakeRelayPort(events: readonly NostrEventLike[] = []) {
	const queries: NostrFilter[][] = []
	const port: ScopedRelayPort = {
		async fetchEvents(filters) {
			const list = toFilterList(filters)
			queries.push(list)
			const matched = new Map<string, NostrEventLike>()
			for (const filter of list) {
				const hits = events.filter((event) => matchesFilter(event, filter)).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
				const limit = typeof filter.limit === 'number' ? filter.limit : hits.length
				for (const event of hits.slice(0, limit)) matched.set(event.id, event)
			}
			return [...matched.values()]
		},
		subscribe(filters, onEvent) {
			const list = toFilterList(filters)
			queries.push(list)
			for (const event of events) if (list.some((filter) => matchesFilter(event, filter))) onEvent(event)
			return () => undefined
		},
	}
	return { port, queries }
}

export function createMemoryStorage(): KeyValueStoragePort & { entries: Map<string, string> } {
	const entries = new Map<string, string>()
	return {
		entries,
		get: async (key) => entries.get(key) ?? null,
		set: async (key, value) => {
			entries.set(key, value)
		},
		remove: async (key) => {
			entries.delete(key)
		},
	}
}

export interface RecordedLogEntry {
	level: 'debug' | 'info' | 'warn' | 'error'
	message: string
	fields?: ExtensionLogFields
}

export function createRecordingLogger(): ExtensionLogger & { entries: RecordedLogEntry[] } {
	const entries: RecordedLogEntry[] = []
	const record = (level: RecordedLogEntry['level']) => (message: string, fields?: ExtensionLogFields) => {
		entries.push({ level, message, ...(fields ? { fields } : {}) })
	}
	return { entries, debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') }
}

export function createTestActionContext<PublicConfig, PrivateConfig = never>(params: {
	publicConfig: PublicConfig
	privateConfig?: PrivateConfig
	host?: Partial<ExtensionHostPorts>
	signal?: AbortSignal
	instanceId?: string
}): ExtensionActionContext<PublicConfig, PrivateConfig> {
	return {
		instanceId: params.instanceId ?? 'test-instance',
		runtime: 'server',
		publicConfig: params.publicConfig,
		privateConfig: params.privateConfig,
		signal: params.signal ?? new AbortController().signal,
		host: { log: createRecordingLogger(), ...params.host },
	}
}

export const testCaller = (pubkey = 'a'.repeat(64), isAdmin = false, transport: ExtensionActionTransport = 'http'): ExtensionCaller => ({
	pubkey,
	isAdmin,
	transport,
})

function toFilterList(filters: NostrFilter | readonly NostrFilter[]): NostrFilter[] {
	return Array.isArray(filters) ? [...filters] : [filters as NostrFilter]
}

function matchesFilter(event: NostrEventLike, filter: NostrFilter): boolean {
	const created = event.created_at ?? 0
	if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) return false
	if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) return false
	if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false
	if (typeof filter.since === 'number' && created < filter.since) return false
	if (typeof filter.until === 'number' && created > filter.until) return false
	for (const [key, values] of Object.entries(filter)) {
		if (!key.startsWith('#') || !Array.isArray(values)) continue
		const name = key.slice(1)
		if (!event.tags.some((tag) => tag[0] === name && values.includes(tag[1]))) return false
	}
	return true
}
