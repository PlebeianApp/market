import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import type { NostrRelayPort } from '@sdk/core/ports/nostrRelay'
import { buildExtensionHost } from './host'
import { collectSecretValues, createRedactingLogger, REDACTED, type LogSink } from './logger'
import { createScopedRelayPort } from './relays'
import { createMemoryKeyValueStorage, createNamespacedStorage } from './storage'

function recordingRelayPort() {
	const calls: { op: string; relayUrls: readonly string[] }[] = []
	const port: NostrRelayPort = {
		fetchEvents: async (_filters, relayUrls) => {
			calls.push({ op: 'fetch', relayUrls })
			return []
		},
		subscribe: (_filters, _onEvent, relayUrls) => {
			calls.push({ op: 'subscribe', relayUrls })
			return () => calls.push({ op: 'unsubscribe', relayUrls })
		},
		publish: async (_event, relayUrls) => {
			calls.push({ op: 'publish', relayUrls })
			return { acceptedRelays: [...relayUrls] }
		},
	}
	return { port, calls }
}

describe('scoped relay port', () => {
	test('always uses the Platform relay list and closes subscriptions on stop', async () => {
		const { port, calls } = recordingRelayPort()
		const controller = new AbortController()
		const scoped = createScopedRelayPort(port, { relayUrls: ['wss://app.example'], allowPublish: false, signal: controller.signal })
		await scoped.fetchEvents({ kinds: [1] })
		scoped.subscribe({ kinds: [1] }, () => undefined)
		controller.abort()
		expect(calls).toEqual([
			{ op: 'fetch', relayUrls: ['wss://app.example'] },
			{ op: 'subscribe', relayUrls: ['wss://app.example'] },
			{ op: 'unsubscribe', relayUrls: ['wss://app.example'] },
		])
		expect(scoped.publish).toBeUndefined()
	})

	test('fetchEvents honours the query signal and the extension lifetime', async () => {
		const hanging: NostrRelayPort = { ...recordingRelayPort().port, fetchEvents: () => new Promise(() => undefined) }
		const lifetime = new AbortController()
		const scoped = createScopedRelayPort(hanging, { relayUrls: ['wss://app.example'], allowPublish: false, signal: lifetime.signal })
		const query = new AbortController()
		const first = scoped.fetchEvents({}, { signal: query.signal })
		query.abort()
		await expect(first).rejects.toBeDefined()
		const second = scoped.fetchEvents({})
		lifetime.abort()
		await expect(second).rejects.toBeDefined()
	})

	test('publish accepts only validly signed events', async () => {
		const { port, calls } = recordingRelayPort()
		const scoped = createScopedRelayPort(port, { relayUrls: ['wss://app.example'], allowPublish: true })
		const signed = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'hi' }, generateSecretKey())
		await expect(scoped.publish!({ ...signed, content: 'tampered' })).rejects.toThrow()
		expect(await scoped.publish!(signed)).toEqual({ acceptedRelays: ['wss://app.example'] })
		expect(calls.map((call) => call.op)).toEqual(['publish'])
	})
})

describe('namespaced storage', () => {
	test('isolates extensions and enforces limits', async () => {
		const base = createMemoryKeyValueStorage()
		const a = createNamespacedStorage(base, 'a')
		const b = createNamespacedStorage(base, 'b')
		await a.set('cursor', '1')
		expect(await a.get('cursor')).toBe('1')
		expect(await b.get('cursor')).toBeNull()
		expect(await base.get('ext:a:cursor')).toBe('1')
		await expect(a.set('big', 'x'.repeat(70_000))).rejects.toThrow()
		expect(() => a.get('')).toThrow()
	})
})

describe('redacting logger', () => {
	test('removes every private string from messages and nested fields', () => {
		const entries: unknown[][] = []
		const sink: LogSink = (level, message, fields) => entries.push([level, message, fields])
		const log = createRedactingLogger('ai', { apiKey: 'sk-supersecret', nested: { token: 'cashuAbc123' }, short: 'abc' }, sink)
		log.error('provider rejected sk-supersecret', {
			header: 'Bearer sk-supersecret',
			list: ['cashuAbc123'],
			error: new Error('bad sk-supersecret'),
		})
		const written = JSON.stringify(entries)
		expect(written).not.toContain('sk-supersecret')
		expect(written).not.toContain('cashuAbc123')
		expect(written).toContain(REDACTED)
		expect(written).toContain('[extension:ai]')
		expect(collectSecretValues({ short: 'abc' })).toEqual([])
	})
})

describe('extension host builder', () => {
	const manifest = {
		id: 'ai',
		version: '1.0.0',
		displayName: 'AI',
		capabilities: [],
		runtimes: ['server'] as const,
		publicConfig: { parse: (value: unknown) => value },
		hostPorts: ['relays:read', 'http', 'storage'] as const,
		egress: ['https://api.example'],
	}

	test('injects only requested and granted ports and counts calls', async () => {
		const { port } = recordingRelayPort()
		let relayPortCreated = 0
		const environment = {
			relayUrls: ['wss://app.example'],
			getRelayPort: () => {
				relayPortCreated++
				return port
			},
			storage: createMemoryKeyValueStorage(),
			allowLocalhostEgress: false,
			fetch: async () => new Response('{}'),
			logSink: () => undefined,
		}
		const full = buildExtensionHost(manifest, undefined, environment, new AbortController().signal)
		expect(Object.keys(full.host).sort()).toEqual(['http', 'log', 'relays', 'storage'])
		expect(full.host.relays?.publish).toBeUndefined()
		await full.host.relays!.fetchEvents({})
		await full.host.http!.request({ url: 'https://api.example/x' })
		await full.host.storage!.set('k', 'v')
		expect(full.usage).toEqual({ relays: 1, http: 1, storage: 1 })

		const limited = buildExtensionHost(manifest, undefined, { ...environment, grantedPorts: () => ['http'] }, new AbortController().signal)
		expect(Object.keys(limited.host).sort()).toEqual(['http', 'log'])

		const none = buildExtensionHost({ ...manifest, hostPorts: [], egress: [] }, undefined, environment, new AbortController().signal)
		expect(Object.keys(none.host)).toEqual(['log'])
		expect(relayPortCreated).toBe(1)
	})
})
