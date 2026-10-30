import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { failure, success } from '../result'
import {
	createFakeHttpPort,
	createFakeRelayPort,
	createRecordingLogger,
	createTestActionContext,
	jsonResponse,
	testCaller,
} from '../testing/extensionHost'
import {
	describeExtensionActions,
	executeExtensionAction,
	ExtensionActionError,
	providerStatusToActionError,
	toExtensionActionErrorResponse,
} from './actions'
import { defineActionFor, defineExtension, type ExtensionManifest } from './extension'
import { parseJsonResponseBody } from './hostPorts'

const SELLER = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

const manifest = {
	id: 'example.suggest',
	version: '0.1.0',
	displayName: 'Example suggestion',
	capabilities: ['product.description.suggest'],
	runtimes: ['server'],
	hostPorts: ['relays:read', 'http'],
	egress: ['https://provider.example'],
	publicConfig: z.object({ maxChars: z.number().int().default(40) }),
	privateConfig: z.object({ apiKey: z.string().startsWith('sk-') }),
} satisfies ExtensionManifest<{ maxChars: number }, { apiKey: string }>

const action = defineActionFor(manifest)

const extension = defineExtension({
	manifest,
	actions: {
		suggest: action({
			description: 'Suggest a product description',
			input: z.object({ title: z.string().min(1).max(200) }),
			output: z.object({ description: z.string() }),
			auth: 'user',
			rateLimit: { perPubkey: 10, windowSeconds: 3600 },
			async handler(ctx, input, caller) {
				const listings = (await ctx.host.relays?.fetchEvents({ kinds: [30402], authors: [caller.pubkey], limit: 3 })) ?? []
				const response = await ctx.host.http!.request({
					url: 'https://provider.example/v1/chat/completions',
					method: 'POST',
					headers: { authorization: `Bearer ${ctx.privateConfig!.apiKey}` },
					body: JSON.stringify({ prompt: `${input.title} (${listings.length} listings)` }),
					signal: ctx.signal,
				})
				if (!response.ok) return failure(new ExtensionActionError('upstream_timeout'))
				const providerError = providerStatusToActionError(response.value.status)
				if (providerError) return failure(providerError)
				const body = parseJsonResponseBody(response.value)
				if (!body.ok) return failure(new ExtensionActionError('extension_failed'))
				const text = String((body.value as { text?: unknown }).text ?? '')
				return success({ description: text.slice(0, ctx.publicConfig.maxChars) })
			},
		}),
		purge: action({
			input: z.object({}),
			output: z.object({ purged: z.boolean() }),
			auth: 'admin',
			rateLimit: { perPubkey: 1, windowSeconds: 60 },
			handler: async () => success({ purged: true }),
		}),
	},
})

function setup(providerStatus = 200, providerBody: unknown = { text: 'A hand-made oak table, finished with natural oils and wax.' }) {
	const relays = createFakeRelayPort([
		{ id: '1', pubkey: SELLER, kind: 30402, content: '', tags: [['d', 'a']], created_at: 1 },
		{ id: '2', pubkey: OTHER, kind: 30402, content: '', tags: [['d', 'b']], created_at: 2 },
	])
	const http = createFakeHttpPort(() => jsonResponse(providerStatus, providerBody), { egress: manifest.egress })
	const log = createRecordingLogger()
	const context = createTestActionContext({
		publicConfig: { maxChars: 40 },
		privateConfig: { apiKey: 'sk-test' },
		host: { relays: relays.port, http: http.port, log },
	})
	return { relays, http, context }
}

describe('executeExtensionAction', () => {
	test('runs the handler with parsed input and returns parsed, truncated output', async () => {
		const { relays, http, context } = setup()
		const result = await executeExtensionAction({
			actions: extension.actions,
			actionName: 'suggest',
			rawInput: { title: 'Oak table' },
			caller: testCaller(SELLER),
			context,
		})
		expect(result).toEqual({ ok: true, value: { description: 'A hand-made oak table, finished with nat' } })
		expect(relays.queries[0][0]).toMatchObject({ authors: [SELLER] })
		expect(http.requests[0].body).toContain('1 listings')
	})

	test('unknown actions, inherited keys, and admin-only actions are refused', async () => {
		const { context } = setup()
		const run = (actionName: string, isAdmin = false) =>
			executeExtensionAction({ actions: extension.actions, actionName, rawInput: {}, caller: testCaller(SELLER, isAdmin), context })
		expect(await run('missing')).toMatchObject({ ok: false, error: { reason: 'not_found' } })
		expect(await run('toString')).toMatchObject({ ok: false, error: { reason: 'not_found' } })
		expect(await run('purge')).toMatchObject({ ok: false, error: { reason: 'forbidden' } })
		expect(await run('purge', true)).toEqual({ ok: true, value: { purged: true } })
	})

	test('invalid input is rejected before the handler and does not echo the body', async () => {
		const { http, context } = setup()
		const result = await executeExtensionAction({
			actions: extension.actions,
			actionName: 'suggest',
			rawInput: { title: 'x'.repeat(500) },
			caller: testCaller(SELLER),
			context,
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.reason).toBe('invalid_input')
			expect(result.error.cause).toBeUndefined()
		}
		expect(http.requests).toHaveLength(0)
	})

	test('provider 402 maps to extension_unavailable (503), never a payment status', async () => {
		const { context } = setup(402, { error: 'insufficient balance for sk-test' })
		const result = await executeExtensionAction({
			actions: extension.actions,
			actionName: 'suggest',
			rawInput: { title: 'Oak table' },
			caller: testCaller(SELLER),
			context,
		})
		expect(result).toMatchObject({ ok: false, error: { reason: 'extension_unavailable' } })
		const response = toExtensionActionErrorResponse(!result.ok && result.error)
		expect(response.status).toBe(503)
		expect(JSON.stringify(response.body)).not.toContain('sk-test')
	})

	test('provider 401 is misconfigured internally but reported as unavailable', async () => {
		const { context } = setup(401)
		const result = await executeExtensionAction({
			actions: extension.actions,
			actionName: 'suggest',
			rawInput: { title: 'Oak table' },
			caller: testCaller(SELLER),
			context,
		})
		expect(result).toMatchObject({ ok: false, error: { reason: 'extension_misconfigured' } })
		expect(toExtensionActionErrorResponse(!result.ok && result.error)).toMatchObject({
			status: 503,
			body: { error: { code: 'extension_unavailable' } },
		})
	})

	test('handler output that fails the output schema is invalid_output', async () => {
		const { context } = setup()
		const actions = {
			bad: action({
				input: z.object({}),
				output: z.object({ description: z.string() }),
				auth: 'user',
				rateLimit: { perPubkey: 1, windowSeconds: 1 },
				handler: async () => success({ description: 42 } as never),
			}),
		}
		const result = await executeExtensionAction({ actions, actionName: 'bad', rawInput: {}, caller: testCaller(), context })
		expect(result).toMatchObject({ ok: false, error: { reason: 'invalid_output' } })
	})

	test('thrown errors become extension_failed; aborted requests become upstream_timeout', async () => {
		const controller = new AbortController()
		const context = createTestActionContext({ publicConfig: {}, signal: controller.signal })
		const actions = {
			boom: action({
				input: z.object({}),
				output: z.object({}),
				auth: 'user',
				rateLimit: { perPubkey: 1, windowSeconds: 1 },
				handler: async () => {
					throw new Error('secret provider body')
				},
			}),
		}
		const failed = await executeExtensionAction({ actions, actionName: 'boom', rawInput: {}, caller: testCaller(), context })
		expect(failed).toMatchObject({ ok: false, error: { reason: 'extension_failed' } })
		expect(JSON.stringify(toExtensionActionErrorResponse(!failed.ok && failed.error).body)).not.toContain('secret')

		controller.abort()
		const aborted = await executeExtensionAction({ actions, actionName: 'boom', rawInput: {}, caller: testCaller(), context })
		expect(aborted).toMatchObject({ ok: false, error: { reason: 'upstream_timeout', retryable: true } })
	})
})

describe('action descriptors and error mapping', () => {
	test('describes actions without handlers or schemas', () => {
		expect(describeExtensionActions(extension.actions)).toEqual([
			{
				name: 'suggest',
				description: 'Suggest a product description',
				auth: 'user',
				rateLimit: { perPubkey: 10, windowSeconds: 3600 },
			},
			{ name: 'purge', auth: 'admin', rateLimit: { perPubkey: 1, windowSeconds: 60 } },
		])
	})

	test('maps provider statuses', () => {
		expect(providerStatusToActionError(200)).toBeUndefined()
		expect(providerStatusToActionError(403)?.reason).toBe('extension_misconfigured')
		expect(providerStatusToActionError(402)?.reason).toBe('extension_unavailable')
		expect(providerStatusToActionError(504)?.reason).toBe('upstream_timeout')
		expect(providerStatusToActionError(500)?.reason).toBe('extension_unavailable')
		expect(providerStatusToActionError(400)?.reason).toBe('extension_failed')
	})

	test('unknown errors map to a generic 500 body', () => {
		expect(toExtensionActionErrorResponse(new Error('leak'))).toEqual({
			status: 500,
			body: { ok: false, error: { code: 'extension_failed', message: 'Extension failed', retryable: false } },
		})
	})
})
