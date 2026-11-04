import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { CONTEXTVM_SERVER_ANNOUNCEMENT_KIND, EXTENSION_REGISTRY_D_TAG } from '@sdk/core/extensions'
import type { NostrRelayPort } from '@sdk/core/ports/nostrRelay'
import { createRepositoryLoader, readRepositoryConfig, REPOSITORY_RETRY_MS } from './repository'

const curatorKey = generateSecretKey()
const curator = getPublicKey(curatorKey)
const serverKey = generateSecretKey()
const server = getPublicKey(serverKey)

const events = [
	finalizeEvent(
		{
			kind: 30000,
			created_at: 1,
			tags: [
				['d', EXTENSION_REGISTRY_D_TAG],
				['p', server],
			],
			content: '',
		},
		curatorKey,
	),
	finalizeEvent({ kind: CONTEXTVM_SERVER_ANNOUNCEMENT_KIND, created_at: 1, tags: [['name', 'Rates']], content: '{}' }, serverKey),
]

function fakeRelayPort(options: { fail?: boolean } = {}) {
	const calls: { filters: unknown; relays: readonly string[] }[] = []
	const port: NostrRelayPort = {
		fetchEvents: async (filters, relays) => {
			calls.push({ filters, relays })
			if (options.fail) throw new Error('relay down')
			const filter = filters as { kinds: number[]; authors: string[] }
			return events.filter((event) => filter.kinds.includes(event.kind) && filter.authors.includes(event.pubkey))
		},
		subscribe: () => () => undefined,
		publish: async () => ({ acceptedRelays: [] }),
	}
	return { port, calls }
}

describe('repository config', () => {
	test('accepts hex and npub curators, defaults relays to the app relay, and reports bad values', () => {
		const config = readRepositoryConfig(
			{ EXTENSIONS_REGISTRY_CURATORS: `${curator}, ${nip19.npubEncode(server)}, nope` },
			'wss://app.example',
		)
		expect(config.curators).toEqual([curator, server])
		expect(config.relays).toEqual(['wss://app.example'])
		expect(config.errors).toEqual(['Ignoring invalid registry curator: nope'])

		const relays = readRepositoryConfig({ EXTENSIONS_REGISTRY_RELAYS: 'wss://a.example, https://b.example' }, 'wss://app.example')
		expect(relays.relays).toEqual(['wss://a.example'])
		expect(relays.errors).toHaveLength(1)
	})
})

describe('repository loader', () => {
	test('reads only from configured relays, scoped to curators and listed servers, and caches', async () => {
		const { port, calls } = fakeRelayPort()
		let now = 0
		const loader = createRepositoryLoader({
			curators: [curator],
			relays: ['wss://app.example'],
			getRelayPort: () => port,
			nowMs: () => now,
		})
		const snapshot = await loader.getSnapshot()
		expect(snapshot?.entries.map((entry) => entry.name)).toEqual(['Rates'])
		expect(calls).toEqual([
			{ filters: { kinds: [30000], authors: [curator], '#d': [EXTENSION_REGISTRY_D_TAG] }, relays: ['wss://app.example'] },
			{ filters: { kinds: [11316, 11317], authors: [server] }, relays: ['wss://app.example'] },
		])
		now = 60_000
		await loader.getSnapshot()
		expect(calls).toHaveLength(2)
	})

	test('reports relay failures without throwing and backs off before retrying', async () => {
		const { port, calls } = fakeRelayPort({ fail: true })
		let now = 0
		const loader = createRepositoryLoader({
			curators: [curator],
			relays: ['wss://app.example'],
			getRelayPort: () => port,
			nowMs: () => now,
		})
		expect(await loader.getSnapshot()).toMatchObject({ entries: [], problem: expect.stringContaining('Could not read') })
		now = REPOSITORY_RETRY_MS - 1
		await loader.getSnapshot()
		expect(calls).toHaveLength(1)
		now = REPOSITORY_RETRY_MS + 1
		await loader.getSnapshot()
		expect(calls).toHaveLength(2)
	})

	test('without curators it returns an empty snapshot without reading relays; without relays it is disabled', async () => {
		const { port, calls } = fakeRelayPort()
		const empty = await createRepositoryLoader({ curators: [], relays: ['wss://a.example'], getRelayPort: () => port }).getSnapshot()
		expect(empty).toMatchObject({ entries: [], sideloaded: [] })
		expect(await createRepositoryLoader({ curators: [curator], relays: [], getRelayPort: () => port }).getSnapshot()).toBeUndefined()
		expect(calls).toHaveLength(0)
	})

	test('sideloaded servers are read even when no registry lists them, and invalidate refreshes', async () => {
		const { port, calls } = fakeRelayPort()
		let sideloads: string[] = []
		const loader = createRepositoryLoader({
			curators: [],
			relays: ['wss://a.example'],
			getRelayPort: () => port,
			getSideloads: () => sideloads,
			nowMs: () => 0,
		})
		expect((await loader.getSnapshot())?.entries).toEqual([])
		sideloads = [server]
		expect((await loader.getSnapshot())?.entries).toEqual([])
		loader.invalidate()
		const snapshot = await loader.getSnapshot()
		expect(snapshot?.entries.map((entry) => [entry.name, entry.sideloaded, entry.listedBy])).toEqual([['Rates', true, []]])
		expect(calls.at(-1)).toEqual({ filters: { kinds: [11316, 11317], authors: [server] }, relays: ['wss://a.example'] })
	})

	test('a load started before invalidate does not overwrite newer state', async () => {
		let release: () => void = () => undefined
		const gate = new Promise<void>((resolve) => (release = resolve))
		let sideloads: string[] = []
		const { port } = fakeRelayPort()
		const slowPort: NostrRelayPort = { ...port, fetchEvents: async (filters, relays) => (await gate, port.fetchEvents(filters, relays)) }
		const loader = createRepositoryLoader({
			curators: [curator],
			relays: ['wss://a.example'],
			getRelayPort: () => slowPort,
			getSideloads: () => sideloads,
			nowMs: () => 0,
		})
		const stale = loader.getSnapshot()
		sideloads = [server]
		loader.invalidate()
		const fresh = loader.getSnapshot()
		release()
		await stale
		expect((await fresh)?.sideloaded).toEqual([server])
		expect((await loader.getSnapshot())?.sideloaded).toEqual([server])
	})
})
