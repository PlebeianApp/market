import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { addSideloadedServer, removeSideloadedServer, type ExtensionActionFetch } from '@sdk/core/extensions'
import { HttpAuthReplayCache } from './nip98'
import { createSideloadHandlers, parseServerPubkey } from './sideloadRoutes'
import { MAX_SIDELOADS, SqliteExtensionStateStore } from './stateStore'

const ORIGIN = 'https://market.example'
const NOW_MS = 1_700_000_000_000
const adminKey = generateSecretKey()
const admin = getPublicKey(adminKey)
const visitorKey = generateSecretKey()
const server = getPublicKey(generateSecretKey())
const signerFor = (key: Uint8Array) => ({ sign: async (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, key) })

function setup() {
	const store = new SqliteExtensionStateStore(':memory:')
	let changes = 0
	const handlers = createSideloadHandlers({
		store: () => store,
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

describe('sideload routes', () => {
	test('admins add by npub or hex, duplicates are idempotent, and remove works', async () => {
		const { store, fetch, changes } = setup()
		expect(await addSideloadedServer(signerFor(adminKey), nip19.npubEncode(server), options(fetch))).toEqual({
			ok: true,
			value: { pubkey: server },
		})
		expect(await addSideloadedServer(signerFor(adminKey), server.toUpperCase(), options(fetch))).toEqual({
			ok: true,
			value: { pubkey: server },
		})
		expect(store.listSideloads()).toEqual([{ pubkey: server, addedBy: admin, addedAt: NOW_MS / 1000 }])
		expect(changes()).toBe(1)

		expect(await removeSideloadedServer(signerFor(adminKey), server, options(fetch))).toEqual({ ok: true, value: { pubkey: server } })
		expect(store.listSideloads()).toEqual([])
		expect(await removeSideloadedServer(signerFor(adminKey), server, { ...options(fetch), now: () => NOW_MS + 1000 })).toMatchObject({
			ok: false,
			error: { reason: 'not_found' },
		})
		expect(changes()).toBe(2)
	})

	test('non-admins get 404 and nothing is stored', async () => {
		const { store, fetch } = setup()
		expect(await addSideloadedServer(signerFor(visitorKey), server, options(fetch))).toMatchObject({
			ok: false,
			error: { reason: 'not_found' },
		})
		expect(store.listSideloads()).toEqual([])
	})

	test('invalid server values are rejected with a helpful message', async () => {
		const { fetch } = setup()
		const nsec = nip19.nsecEncode(generateSecretKey())
		for (const value of ['nope', nsec, nip19.noteEncode('a'.repeat(64))]) {
			expect(await addSideloadedServer(signerFor(adminKey), value, options(fetch))).toMatchObject({
				ok: false,
				error: { reason: 'invalid_input', message: 'Enter a server pubkey as 64-character hex or npub' },
			})
		}
	})

	test('the store enforces the sideload limit', () => {
		const store = new SqliteExtensionStateStore(':memory:')
		for (let index = 0; index < MAX_SIDELOADS; index++) {
			expect(store.addSideload({ pubkey: index.toString(16).padStart(64, '0'), addedBy: admin, addedAt: index })).toBe('added')
		}
		expect(store.addSideload({ pubkey: 'f'.repeat(64), addedBy: admin, addedAt: 0 })).toBe('limit_reached')
	})

	test('parses hex and npub only', () => {
		expect(parseServerPubkey(` ${nip19.npubEncode(server)} `)).toBe(server)
		expect(parseServerPubkey(nip19.nprofileEncode({ pubkey: server }))).toBeUndefined()
		expect(parseServerPubkey(42)).toBeUndefined()
	})
})
