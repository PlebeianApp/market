import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { addExtensionServer, removeExtensionServer, type ExtensionActionFetch } from '@sdk/core/extensions'
import { HttpAuthReplayCache } from './nip98'
import { createServerHandlers, parseServerPubkey } from './serverRoutes'
import { MAX_ADDED_SERVERS, SqliteExtensionStateStore } from './stateStore'
import { hashInputSchema, suggestBinding, type RepositorySnapshot } from '@sdk/core/extensions'

const ORIGIN = 'https://market.example'
const NOW_MS = 1_700_000_000_000
const adminKey = generateSecretKey()
const admin = getPublicKey(adminKey)
const visitorKey = generateSecretKey()
const server = getPublicKey(generateSecretKey())
const signerFor = (key: Uint8Array) => ({ sign: async (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, key) })

function setup(snapshot?: RepositorySnapshot) {
	const store = new SqliteExtensionStateStore(':memory:')
	let changes = 0
	const handlers = createServerHandlers({
		store: () => store,
		getSnapshot: async () => snapshot,
		isAdmin: (pubkey) => pubkey === admin,
		replayCache: new HttpAuthReplayCache(),
		acceptedOrigins: () => [ORIGIN],
		onChange: () => changes++,
		nowMs: () => NOW_MS,
	})
	const fetch: ExtensionActionFetch = async (url, init) => {
		const request = new Request(url, { method: init.method, headers: init.headers, body: init.body })
		const path = new URL(url).pathname
		const response =
			init.method === 'POST'
				? await handlers.add(request)
				: await handlers.remove(Object.assign(request, { params: { pubkey: decodeURIComponent(path.split('/').pop() ?? '') } }))
		return { status: response.status, text: () => response.text() }
	}
	return { store, fetch, changes: () => changes }
}

const options = (fetch: ExtensionActionFetch) => ({ baseUrl: ORIGIN, fetch, now: () => NOW_MS })

describe('server routes', () => {
	test('admins add by npub or hex, duplicates are idempotent, and remove works', async () => {
		const { store, fetch, changes } = setup()
		expect(await addExtensionServer(signerFor(adminKey), nip19.npubEncode(server), options(fetch))).toEqual({
			ok: true,
			value: { pubkey: server },
		})
		expect(await addExtensionServer(signerFor(adminKey), server.toUpperCase(), options(fetch))).toEqual({
			ok: true,
			value: { pubkey: server },
		})
		expect(store.listAddedServers()).toEqual([{ pubkey: server, addedBy: admin, addedAt: NOW_MS / 1000 }])
		expect(changes()).toBe(1)

		expect(await removeExtensionServer(signerFor(adminKey), server, options(fetch))).toEqual({ ok: true, value: { pubkey: server } })
		expect(store.listAddedServers()).toEqual([])
		expect(await removeExtensionServer(signerFor(adminKey), server, { ...options(fetch), now: () => NOW_MS + 1000 })).toMatchObject({
			ok: false,
			error: { reason: 'not_found' },
		})
		expect(changes()).toBe(2)
	})

	test('non-admins get 404 and nothing is stored', async () => {
		const { store, fetch } = setup()
		expect(await addExtensionServer(signerFor(visitorKey), server, options(fetch))).toMatchObject({
			ok: false,
			error: { reason: 'not_found' },
		})
		expect(store.listAddedServers()).toEqual([])
	})

	test('invalid server values are rejected with a helpful message', async () => {
		const { fetch } = setup()
		const nsec = nip19.nsecEncode(generateSecretKey())
		for (const value of ['nope', nsec, nip19.noteEncode('a'.repeat(64))]) {
			expect(await addExtensionServer(signerFor(adminKey), value, options(fetch))).toMatchObject({
				ok: false,
				error: { reason: 'invalid_input', message: 'Enter a server pubkey as 64-character hex or npub' },
			})
		}
	})

	test('the store enforces the sideload limit', () => {
		const store = new SqliteExtensionStateStore(':memory:')
		for (let index = 0; index < MAX_ADDED_SERVERS; index++) {
			expect(store.addServer({ pubkey: index.toString(16).padStart(64, '0'), addedBy: admin, addedAt: index })).toBe('added')
		}
		expect(store.addServer({ pubkey: 'f'.repeat(64), addedBy: admin, addedAt: 0 })).toBe('limit_reached')
	})

	test('removal is refused while the server has bindings', async () => {
		const { store, fetch } = setup()
		await addExtensionServer(signerFor(adminKey), server, options(fetch))
		store.addBinding({
			serverPubkey: server,
			toolName: 'echo',
			actionName: 'echo',
			capability: 'dev.echo',
			auth: 'admin',
			perPubkey: 1,
			windowSeconds: 60,
			inputSchemaHash: 'a'.repeat(64),
			serverName: 'Echo',
			enabled: true,
			createdBy: admin,
			createdAt: 1,
		})
		expect(await removeExtensionServer(signerFor(adminKey), server, { ...options(fetch), now: () => NOW_MS + 1000 })).toMatchObject({
			ok: false,
			error: { reason: 'invalid_input', message: "Remove this server's binding first" },
		})
		expect(store.listAddedServers()).toHaveLength(1)
	})

	test('migrates the legacy sideloads table into added servers', () => {
		const { Database } = require('bun:sqlite') as typeof import('bun:sqlite')
		const path = `${require('node:os').tmpdir()}/ext-migrate-${Date.now()}.sqlite`
		const legacy = new Database(path, { create: true })
		legacy.exec('CREATE TABLE sideloads (pubkey TEXT PRIMARY KEY, added_by TEXT NOT NULL, added_at INTEGER NOT NULL)')
		legacy.query('INSERT INTO sideloads VALUES (?, ?, ?)').run(server, admin, 5)
		legacy.close()
		const store = new SqliteExtensionStateStore(path)
		expect(store.listAddedServers()).toEqual([{ pubkey: server, addedBy: admin, addedAt: 5 }])
		store.close()
		require('node:fs').rmSync(path, { force: true })
	})

	test('add can accept bindings in the same request, all or none', async () => {
		const tool = (name: string) => ({
			name,
			inputFields: [],
			inputSchemaHash: hashInputSchema({}),
			suggestedBinding: suggestBinding(name, undefined),
		})
		const snapshot: RepositorySnapshot = {
			curators: [],
			relays: [],
			added: [],
			entries: [
				{
					serverPubkey: server,
					listedBy: ['c'.repeat(64)],
					added: false,
					sideloaded: false,
					state: 'listed',
					name: 'Echo',
					tools: [tool('echo'), tool('ping')],
					paid: false,
					encrypted: false,
				},
			],
			missingRegistries: [],
			fetchedAt: 0,
		}
		const { store, fetch } = setup(snapshot)
		const binding = (toolName: string, actionName = toolName) => ({
			serverPubkey: server,
			toolName,
			actionName,
			capability: `dev.${toolName}`,
			auth: 'admin' as const,
			rateLimit: { perPubkey: 5, windowSeconds: 60 },
			acknowledgedDataFlow: true as const,
		})
		expect(await addExtensionServer(signerFor(adminKey), server, options(fetch), [binding('echo'), binding('missing')])).toMatchObject({
			ok: false,
			error: { message: 'missing: The server does not announce this tool' },
		})
		expect(store.listAddedServers()).toEqual([])

		expect(
			await addExtensionServer(signerFor(adminKey), server, { ...options(fetch), now: () => NOW_MS + 1000 }, [
				binding('echo'),
				binding('ping'),
			]),
		).toMatchObject({
			ok: true,
		})
		expect(store.listAddedServers().map((record) => record.pubkey)).toEqual([server])
		expect(store.listBindings().map((record) => record.actionName)).toEqual(['echo', 'ping'])
	})

	test('server and bindings roll back together when a binding cannot be stored', () => {
		const store = new SqliteExtensionStateStore(':memory:')
		const record = (actionName: string) => ({
			serverPubkey: server,
			toolName: actionName,
			actionName,
			capability: 'a.b',
			auth: 'admin' as const,
			perPubkey: 1,
			windowSeconds: 60,
			inputSchemaHash: 'a'.repeat(64),
			serverName: 'Echo',
			enabled: true,
			createdBy: admin,
			createdAt: 0,
		})
		store.addBinding(record('echo'))
		expect(store.addServerWithBindings({ pubkey: server, addedBy: admin, addedAt: 0 }, [record('ping'), record('echo')])).toEqual({
			status: 'exists',
			actionName: 'echo',
		})
		expect(store.listAddedServers()).toEqual([])
		expect(store.listBindings().map((item) => item.actionName)).toEqual(['echo'])
	})

	test('parses hex and npub only', () => {
		expect(parseServerPubkey(` ${nip19.npubEncode(server)} `)).toBe(server)
		expect(parseServerPubkey(nip19.nprofileEncode({ pubkey: server }))).toBeUndefined()
		expect(parseServerPubkey(42)).toBeUndefined()
	})
})
