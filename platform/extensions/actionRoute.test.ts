import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { z } from 'zod'
import { defineExtension, ExtensionActionError } from '@sdk/core/extensions'
import { buildHttpAuthTemplate, encodeHttpAuthHeader } from '@sdk/core/nostr/nip98'
import { failure, success } from '@sdk/core/result'
import { createExtensionActionHandler } from './actionRoute'
import { HttpAuthReplayCache } from './nip98'
import { buildExtensionHost } from './ports/host'
import { createMemoryKeyValueStorage } from './ports/storage'
import { ExtensionRateLimiter } from './rateLimiter'
import { ExtensionRegistry } from './registry'

const ORIGIN = 'https://market.example'
const NOW_MS = 1_700_000_000_000
const sellerKey = generateSecretKey()
const adminKey = generateSecretKey()

const extension = defineExtension({
	manifest: {
		id: 'example.echo',
		version: '0.1.0',
		displayName: 'Echo',
		capabilities: ['example.echo'],
		runtimes: ['server'],
		publicConfig: z.object({}),
		privateConfig: z.object({ apiKey: z.string() }),
	},
	actions: {
		echo: {
			input: z.object({ text: z.string().max(20) }),
			output: z.object({ echoed: z.string(), by: z.string() }),
			auth: 'user',
			rateLimit: { perPubkey: 2, windowSeconds: 60 },
			handler: async (_ctx, input: { text: string }, caller) => success({ echoed: input.text, by: caller.pubkey }),
		},
		'provider-down': {
			input: z.object({}),
			output: z.object({}),
			auth: 'user',
			rateLimit: { perPubkey: 5, windowSeconds: 60 },
			handler: async (ctx) =>
				failure(new ExtensionActionError('extension_unavailable', `balance low for ${(ctx.privateConfig as { apiKey: string }).apiKey}`)),
		},
		purge: {
			input: z.object({}),
			output: z.object({ ok: z.boolean() }),
			auth: 'admin',
			rateLimit: { perPubkey: 5, windowSeconds: 60 },
			handler: async () => success({ ok: true }),
		},
		'cvm-only': {
			input: z.object({}),
			output: z.object({}),
			auth: 'user',
			rateLimit: { perPubkey: 5, windowSeconds: 60 },
			transports: ['contextvm'],
			handler: async () => success({}),
		},
	},
})

async function setup() {
	const registry = new ExtensionRegistry('market').register(extension)
	registry.configure([{ id: 'example.echo', enabled: true, publicConfig: {}, privateConfig: { apiKey: 'sk-secret-value' } }])
	await registry.start('server', {
		createHost: (definition, privateConfig, signal) =>
			buildExtensionHost(
				definition.manifest,
				privateConfig,
				{
					relayUrls: [],
					getRelayPort: () => {
						throw new Error('unused')
					},
					storage: createMemoryKeyValueStorage(),
					allowLocalhostEgress: false,
					logSink: () => undefined,
				},
				signal,
			).host,
	})
	const handler = createExtensionActionHandler({
		getRegistry: () => registry,
		isAdmin: (pubkey) => pubkey === getPublicKey(adminKey),
		replayCache: new HttpAuthReplayCache(),
		rateLimiter: new ExtensionRateLimiter(),
		acceptedOrigins: () => [ORIGIN],
		nowMs: () => NOW_MS,
	})
	return { registry, handler }
}

function request(id: string, action: string, body: unknown, options: { key?: Uint8Array; auth?: string | null; createdAt?: number } = {}) {
	const url = `${ORIGIN}/api/extensions/${id}/actions/${action}`
	const text = typeof body === 'string' ? body : JSON.stringify(body)
	const auth =
		options.auth !== undefined
			? options.auth
			: encodeHttpAuthHeader(
					finalizeEvent(
						buildHttpAuthTemplate({ url, method: 'POST', body: text, createdAt: options.createdAt ?? NOW_MS / 1000 }),
						options.key ?? sellerKey,
					),
				)
	const req = new Request(url, {
		method: 'POST',
		body: text,
		headers: auth ? { authorization: auth, 'content-type': 'application/json' } : {},
	})
	return Object.assign(req, { params: { id, action } })
}

async function call(handler: Awaited<ReturnType<typeof setup>>['handler'], req: Request & { params: Record<string, string> }) {
	const response = await handler(req)
	return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, unknown> }
}

describe('extension action route', () => {
	test('runs an authenticated action and returns the envelope', async () => {
		const { handler } = await setup()
		const result = await call(handler, request('example.echo', 'echo', { text: 'hi' }))
		expect(result).toMatchObject({ status: 200, body: { ok: true, value: { echoed: 'hi', by: getPublicKey(sellerKey) } } })
		expect(result.headers.get('cache-control')).toBe('no-store')
	})

	test('unknown extensions, unknown actions, and wrong-transport actions are 404 before auth', async () => {
		const { handler, registry } = await setup()
		for (const [id, action] of [
			['missing', 'echo'],
			['example.echo', 'missing'],
			['example.echo', 'toString'],
			['example.echo', 'cvm-only'],
		]) {
			expect((await call(handler, request(id, action, {}, { auth: null }))).status).toBe(404)
		}
		await registry.stop()
		expect((await call(handler, request('example.echo', 'echo', { text: 'hi' }))).status).toBe(404)
	})

	test('requires valid NIP-98 auth and rejects replays', async () => {
		const { handler } = await setup()
		expect(await call(handler, request('example.echo', 'echo', { text: 'hi' }, { auth: null }))).toMatchObject({
			status: 401,
			body: { ok: false, error: { code: 'unauthorized' } },
		})
		expect((await call(handler, request('example.echo', 'echo', { text: 'hi' }, { createdAt: NOW_MS / 1000 - 120 }))).status).toBe(401)

		const first = request('example.echo', 'echo', { text: 'hi' })
		const auth = first.headers.get('authorization')
		expect((await call(handler, first)).status).toBe(200)
		expect((await call(handler, request('example.echo', 'echo', { text: 'hi' }, { auth }))).status).toBe(401)
	})

	test('rate limits per pubkey with Retry-After', async () => {
		const { handler } = await setup()
		expect((await call(handler, request('example.echo', 'echo', { text: 'a' }))).status).toBe(200)
		expect((await call(handler, request('example.echo', 'echo', { text: 'b' }))).status).toBe(200)
		const limited = await call(handler, request('example.echo', 'echo', { text: 'c' }))
		expect(limited).toMatchObject({ status: 429, body: { error: { code: 'rate_limited', retryable: true } } })
		expect(limited.headers.get('retry-after')).toBe('60')
		expect((await call(handler, request('example.echo', 'echo', { text: 'd' }, { key: adminKey }))).status).toBe(200)
	})

	test('invalid JSON and schema failures are 400 without echoing input', async () => {
		const { handler } = await setup()
		const invalid = await call(handler, request('example.echo', 'echo', '{not json'))
		expect(invalid).toMatchObject({ status: 400, body: { error: { code: 'invalid_input' } } })
		const tooLong = await call(handler, request('example.echo', 'echo', { text: 'secret-input-'.repeat(5) }))
		expect(tooLong.status).toBe(400)
		expect(JSON.stringify(tooLong.body)).not.toContain('secret-input')
	})

	test('admin actions require an admin caller', async () => {
		const { handler } = await setup()
		expect((await call(handler, request('example.echo', 'purge', {}))).status).toBe(403)
		expect(await call(handler, request('example.echo', 'purge', {}, { key: adminKey }))).toMatchObject({
			status: 200,
			body: { value: { ok: true } },
		})
	})

	test('provider unavailability is 503, never 402, and never leaks private config', async () => {
		const { handler } = await setup()
		const result = await call(handler, request('example.echo', 'provider-down', {}))
		expect(result).toMatchObject({ status: 503, body: { ok: false, error: { code: 'extension_unavailable' } } })
		expect(JSON.stringify(result.body)).not.toContain('sk-secret-value')
	})
})
