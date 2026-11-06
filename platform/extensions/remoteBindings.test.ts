import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import {
	createRemoteBinding,
	createRemoteBindings,
	deleteRemoteBinding,
	hashInputSchema,
	suggestBinding,
	updateRemoteBinding,
	type ExtensionActionFetch,
	type RepositoryExtensionEntry,
	type RepositorySnapshot,
} from '@sdk/core/extensions'
import { buildHttpAuthTemplate, encodeHttpAuthHeader } from '@sdk/core/nostr/nip98'
import { success } from '@sdk/core/result'
import { createExtensionActionHandler } from './actionRoute'
import { createBindingHandlers } from './bindingRoutes'
import { HttpAuthReplayCache } from './nip98'
import { ExtensionRateLimiter } from './rateLimiter'
import {
	createRemoteTarget,
	describeRemoteBindings,
	evaluateBindings,
	resolveClientKey,
	UNREACHABLE_FOR_MS,
	type RemoteToolCaller,
} from './remoteBindings'
import { SqliteExtensionStateStore, type RemoteBindingRecord } from './stateStore'

const ORIGIN = 'https://market.example'
const NOW_MS = 1_700_000_000_000
const adminKey = generateSecretKey()
const admin = getPublicKey(adminKey)
const userKey = generateSecretKey()
const server = getPublicKey(generateSecretKey())
const quoteSchema = { type: 'object', properties: { weight: { type: 'number' } } }
const signerFor = (key: Uint8Array) => ({ sign: async (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, key) })

const entry = (tools: RepositoryExtensionEntry['tools']): RepositoryExtensionEntry => ({
	serverPubkey: server,
	listedBy: [],
	added: true,
	sideloaded: true,
	state: 'listed',
	name: 'Rates',
	tools,
	paid: tools.some((tool) => tool.price),
	encrypted: false,
})
const quoteTool = {
	name: 'quote',
	inputFields: ['weight'],
	inputSchemaHash: hashInputSchema(quoteSchema),
	suggestedBinding: suggestBinding('quote', undefined),
}
const snapshotWith = (entries: RepositoryExtensionEntry[]): RepositorySnapshot => ({
	curators: [],
	relays: ['wss://app.example'],
	added: [server],
	entries,
	missingRegistries: [],
	fetchedAt: 0,
})

const record = (change: Partial<RemoteBindingRecord> = {}): RemoteBindingRecord => ({
	serverPubkey: server,
	toolName: 'quote',
	actionName: 'get-quote',
	capability: 'shipping.quote',
	auth: 'user',
	perPubkey: 2,
	windowSeconds: 60,
	inputSchemaHash: quoteTool.inputSchemaHash,
	serverName: 'Rates',
	enabled: true,
	createdBy: admin,
	createdAt: 1,
	...change,
})

describe('binding state', () => {
	const snapshot = snapshotWith([entry([quoteTool])])

	test('evaluates every state from pin, listing, payment, and call health', () => {
		const state = (records: RemoteBindingRecord[], snap = snapshot, failures = new Map<string, number>()) =>
			evaluateBindings(records, snap, failures, NOW_MS).map((view) => [view.state, view.problem])
		expect(state([record()])).toEqual([['installed_enabled', undefined]])
		expect(state([record({ enabled: false })])).toEqual([['installed_disabled', undefined]])
		expect(state([record({ inputSchemaHash: 'f'.repeat(64) })])[0][0]).toBe('misconfigured')
		expect(state([record()], snapshotWith([]))[0]).toEqual(['misconfigured', 'The extension is no longer added to this marketplace'])
		expect(state([record()], snapshotWith([entry([{ ...quoteTool, price: { amount: '1', unit: 'sats' } }])]))[0][0]).toBe('misconfigured')
		expect(state([record()], snapshotWith([{ ...entry([quoteTool]), state: 'unavailable' }]))[0][0]).toBe('unreachable')
		expect(evaluateBindings([record()], undefined, new Map(), NOW_MS)[0].state).toBe('unreachable')
		expect(state([record()], snapshot, new Map([[server, NOW_MS - 1_000]]))[0][0]).toBe('unreachable')
		expect(state([record()], snapshot, new Map([[server, NOW_MS - UNREACHABLE_FOR_MS - 1]]))[0][0]).toBe('installed_enabled')
	})

	test('only enabled, healthy bindings are advertised, grouped per server', () => {
		const views = evaluateBindings([record(), record({ actionName: 'off', enabled: false })], snapshot, new Map(), NOW_MS)
		expect(describeRemoteBindings(views, snapshot)).toEqual([
			{
				id: `remote.${server}`,
				version: '0.0.0',
				displayName: 'Rates',
				capabilities: ['shipping.quote'],
				config: {},
				actions: [
					{
						name: 'get-quote',
						description: 'Third-party tool "quote" on Rates',
						auth: 'user',
						rateLimit: { perPubkey: 2, windowSeconds: 60 },
						transports: ['http'],
					},
				],
			},
		])
	})
})

describe('remote target', () => {
	const view = evaluateBindings([record()], snapshotWith([entry([quoteTool])]), new Map(), NOW_MS)[0]

	test('converts the result and records failures by kind', async () => {
		const failures: string[] = []
		const ok: RemoteToolCaller = { callTool: async () => ({ content: [{ type: 'text', text: '1200 sats' }] }), close: async () => {} }
		expect(
			await createRemoteTarget(
				view,
				ok,
				(pubkey) => failures.push(pubkey),
				() => {},
			).invoke({}, new AbortController().signal),
		).toEqual({
			ok: true,
			value: { text: '1200 sats' },
		})

		const timeout: RemoteToolCaller = {
			callTool: async () => {
				throw Object.assign(new Error('Request timed out'), { code: -32001 })
			},
			close: async () => {},
		}
		expect(
			await createRemoteTarget(
				view,
				timeout,
				(pubkey) => failures.push(pubkey),
				() => {},
			).invoke({}, new AbortController().signal),
		).toMatchObject({
			ok: false,
			error: { reason: 'upstream_timeout' },
		})
		expect(failures).toEqual([server])
	})

	test('client key accepts hex or nsec, generates an ephemeral key otherwise, and rejects garbage', () => {
		const secret = generateSecretKey()
		const hex = Buffer.from(secret).toString('hex')
		expect(resolveClientKey(hex)).toMatchObject({ pubkey: getPublicKey(secret), ephemeral: false })
		expect(resolveClientKey(nip19.nsecEncode(secret))).toMatchObject({ pubkey: getPublicKey(secret), ephemeral: false })
		expect(resolveClientKey(undefined).ephemeral).toBe(true)
		expect(() => resolveClientKey('npub1xyz')).toThrow()
	})
})

describe('binding routes', () => {
	function setup(
		snapshot: RepositorySnapshot | undefined = snapshotWith([
			entry([
				quoteTool,
				{
					name: 'paid',
					inputFields: [],
					inputSchemaHash: hashInputSchema({}),
					suggestedBinding: suggestBinding('paid', undefined),
					price: { amount: '5', unit: 'sats' },
				},
			]),
		]),
	) {
		const store = new SqliteExtensionStateStore(':memory:')
		store.addServer({ pubkey: server, addedBy: admin, addedAt: 0 })
		let current = snapshot
		const handlers = createBindingHandlers({
			store: () => store,
			getSnapshot: async () => current,
			isAdmin: (pubkey) => pubkey === admin,
			replayCache: new HttpAuthReplayCache(),
			acceptedOrigins: () => [ORIGIN],
			onChange: () => {},
			nowMs: () => NOW_MS,
		})
		let tick = 0
		const fetch: ExtensionActionFetch = async (url, init) => {
			const [, , , , server, action] = new URL(url).pathname.split('/')
			const request = Object.assign(new Request(url, { method: init.method, headers: init.headers, body: init.body }), {
				params: { server: server ?? '', action: action ?? '' },
			})
			const handler = init.method === 'POST' ? handlers.create : init.method === 'PATCH' ? handlers.update : handlers.remove
			const response = await handler(request)
			return { status: response.status, text: () => response.text() }
		}
		const options = () => ({ baseUrl: ORIGIN, fetch, now: () => NOW_MS + tick++ * 1000 })
		return { store, options, setSnapshot: (next: RepositorySnapshot) => (current = next) }
	}
	const bind = {
		serverPubkey: server,
		toolName: 'quote',
		actionName: 'get-quote',
		capability: 'shipping.quote',
		auth: 'user' as const,
		rateLimit: { perPubkey: 2, windowSeconds: 60 },
		acknowledgedDataFlow: true as const,
	}

	test('binds a listed tool and pins its announced schema', async () => {
		const { store, options } = setup()
		expect(await createRemoteBinding(signerFor(adminKey), bind, options())).toEqual({
			ok: true,
			value: { serverPubkey: server, actionName: 'get-quote' },
		})
		expect(store.listBindings()).toEqual([
			expect.objectContaining({
				serverPubkey: server,
				toolName: 'quote',
				inputSchemaHash: quoteTool.inputSchemaHash,
				serverName: 'Rates',
				enabled: true,
				createdBy: admin,
			}),
		])
		expect(await createRemoteBinding(signerFor(adminKey), bind, options())).toMatchObject({ ok: false, error: { reason: 'invalid_input' } })
	})

	test('accepts several suggestions in one request, all or none', async () => {
		const twoTools = snapshotWith([
			entry([
				quoteTool,
				{ name: 'track', inputFields: [], inputSchemaHash: hashInputSchema({}), suggestedBinding: suggestBinding('track', undefined) },
			]),
		])
		const { store, options } = setup(twoTools)
		const track = { ...bind, toolName: 'track', actionName: 'track', capability: 'shipping.track' }

		expect(await createRemoteBindings(signerFor(adminKey), [bind, { ...track, toolName: 'missing' }], options())).toMatchObject({
			ok: false,
			error: { reason: 'invalid_input', message: expect.stringContaining('missing: ') },
		})
		expect(store.listBindings()).toEqual([])

		expect(await createRemoteBindings(signerFor(adminKey), [bind, { ...track, actionName: 'get-quote' }], options())).toMatchObject({
			ok: false,
			error: { message: expect.stringContaining('Two bindings use the action name get-quote') },
		})
		expect(store.listBindings()).toEqual([])

		expect(await createRemoteBindings(signerFor(adminKey), [bind, track], options())).toEqual({ ok: true, value: { created: 2 } })
		expect(store.listBindings().map((record) => record.actionName)).toEqual(['get-quote', 'track'])

		expect(await createRemoteBindings(signerFor(adminKey), [{ ...bind, actionName: 'other' }, track], options())).toMatchObject({
			ok: false,
			error: { message: 'This server already has an action named track' },
		})
		expect(store.listBindings()).toHaveLength(2)
	})

	test('refuses tools of servers that were not added first', async () => {
		const { store, options } = setup()
		store.removeServer(server)
		expect(await createRemoteBinding(signerFor(adminKey), bind, options())).toMatchObject({
			ok: false,
			error: { reason: 'invalid_input', message: 'Add this extension to the marketplace before binding its tools' },
		})
		expect(store.listBindings()).toEqual([])
	})

	test('a binding stops when its server is no longer added', () => {
		const notAdded = snapshotWith([{ ...entry([quoteTool]), added: false, sideloaded: false }])
		expect(evaluateBindings([record()], notAdded, new Map(), NOW_MS)[0]).toMatchObject({ state: 'misconfigured' })
	})

	test('refuses paid, unknown, and unlisted tools, and non-admins', async () => {
		const { store, options } = setup()
		expect(await createRemoteBinding(signerFor(adminKey), { ...bind, toolName: 'paid' }, options())).toMatchObject({
			ok: false,
			error: { reason: 'invalid_input', message: expect.stringContaining('Paid tools') },
		})
		expect(await createRemoteBinding(signerFor(adminKey), { ...bind, toolName: 'missing' }, options())).toMatchObject({ ok: false })
		expect(await createRemoteBinding(signerFor(adminKey), { ...bind, serverPubkey: admin }, options())).toMatchObject({ ok: false })
		expect(await createRemoteBinding(signerFor(userKey), bind, options())).toMatchObject({ ok: false, error: { reason: 'not_found' } })
		expect(store.listBindings()).toEqual([])
	})

	test('approve re-pins to the current definition; disable and remove work', async () => {
		const { store, options, setSnapshot } = setup()
		await createRemoteBinding(signerFor(adminKey), bind, options())
		const changedHash = hashInputSchema({ ...quoteSchema, required: ['weight'] })
		setSnapshot(snapshotWith([entry([{ ...quoteTool, inputSchemaHash: changedHash }])]))

		expect(
			await updateRemoteBinding(signerFor(adminKey), server, 'get-quote', { approveCurrentDefinition: true }, options()),
		).toMatchObject({ ok: true })
		expect(store.listBindings()[0].inputSchemaHash).toBe(changedHash)
		expect(await updateRemoteBinding(signerFor(adminKey), server, 'get-quote', { enabled: false }, options())).toMatchObject({ ok: true })
		expect(store.listBindings()[0].enabled).toBe(false)
		expect(await deleteRemoteBinding(signerFor(adminKey), server, 'get-quote', options())).toMatchObject({ ok: true })
		expect(store.listBindings()).toEqual([])
		expect(await deleteRemoteBinding(signerFor(adminKey), server, 'get-quote', options())).toMatchObject({
			ok: false,
			error: { reason: 'not_found' },
		})
	})
})

describe('remote actions through the action route', () => {
	function setup(view = evaluateBindings([record()], snapshotWith([entry([quoteTool])]), new Map(), NOW_MS)[0]) {
		const calls: { args: Record<string, unknown> }[] = []
		const caller: RemoteToolCaller = {
			callTool: async ({ args }) => {
				calls.push({ args })
				return { content: [{ type: 'text', text: `quote for ${String(args.weight)}g` }], structuredContent: { sats: 1200 } }
			},
			close: async () => {},
		}
		const handler = createExtensionActionHandler({
			getRegistry: () => undefined,
			getRemoteTarget: (extensionId, actionName) =>
				extensionId === `remote.${server}` && actionName === view.actionName
					? createRemoteTarget(
							view,
							caller,
							() => {},
							() => {},
						)
					: undefined,
			isAdmin: (pubkey) => pubkey === admin,
			replayCache: new HttpAuthReplayCache(),
			rateLimiter: new ExtensionRateLimiter(),
			acceptedOrigins: () => [ORIGIN],
			nowMs: () => NOW_MS,
		})
		const call = async (body: unknown, key = userKey, action = view.actionName) => {
			const url = `${ORIGIN}/api/extensions/remote.${server}/actions/${action}`
			const text = JSON.stringify(body)
			const auth = encodeHttpAuthHeader(
				finalizeEvent(buildHttpAuthTemplate({ url, method: 'POST', body: text, createdAt: NOW_MS / 1000 }), key),
			)
			const response = await handler(
				Object.assign(new Request(url, { method: 'POST', body: text, headers: { authorization: auth } }), {
					params: { id: `remote.${server}`, action },
				}),
			)
			return { status: response.status, body: (await response.json()) as Record<string, unknown> }
		}
		return { call, calls }
	}

	test('calls the remote tool after auth and rate limit, returning the untrusted envelope', async () => {
		const { call, calls } = setup()
		expect(await call({ weight: 500 })).toEqual({
			status: 200,
			body: { ok: true, value: { text: 'quote for 500g', data: { sats: 1200 } } },
		})
		expect(calls).toEqual([{ args: { weight: 500 } }])
		expect((await call({ weight: 600 })).status).toBe(200)
		expect((await call({ weight: 700 })).status).toBe(429)
		expect(calls).toHaveLength(2)
	})

	test('rejects non-object input, unknown actions, and non-admins on admin bindings', async () => {
		const { call, calls } = setup()
		expect((await call([1, 2])).status).toBe(400)
		expect((await call({}, userKey, 'missing')).status).toBe(404)

		const adminOnly = setup(evaluateBindings([record({ auth: 'admin' })], snapshotWith([entry([quoteTool])]), new Map(), NOW_MS)[0])
		expect((await adminOnly.call({ weight: 1 })).status).toBe(403)
		expect((await adminOnly.call({ weight: 1 }, adminKey)).status).toBe(200)
		expect(calls).toHaveLength(0)
	})

	test('remote success is still validated output', async () => {
		const handler = createExtensionActionHandler({
			getRegistry: () => undefined,
			getRemoteTarget: () => ({
				auth: 'user',
				rateLimit: { perPubkey: 5, windowSeconds: 60 },
				invoke: async () => success({ text: 'ok' }),
			}),
			isAdmin: () => false,
			replayCache: new HttpAuthReplayCache(),
			rateLimiter: new ExtensionRateLimiter(),
			acceptedOrigins: () => [ORIGIN],
			nowMs: () => NOW_MS,
		})
		const url = `${ORIGIN}/api/extensions/remote.${server}/actions/x`
		const auth = encodeHttpAuthHeader(
			finalizeEvent(buildHttpAuthTemplate({ url, method: 'POST', body: '{}', createdAt: NOW_MS / 1000 }), userKey),
		)
		const response = await handler(
			Object.assign(new Request(url, { method: 'POST', body: '{}', headers: { authorization: auth } }), {
				params: { id: `remote.${server}`, action: 'x' },
			}),
		)
		expect(await response.json()).toEqual({ ok: true, value: { text: 'ok' } })
	})
})
