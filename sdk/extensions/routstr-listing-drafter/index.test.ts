import { describe, expect, test } from 'bun:test'
import { ExtensionHttpError, executeExtensionAction, parseExtensionConfig, validateExtensionDefinition } from '../../core/extensions'
import {
	createFakeHttpPort,
	createRecordingLogger,
	createTestActionContext,
	jsonResponse,
	testCaller,
} from '../../core/testing/extensionHost'
import {
	CHAT_COMPLETIONS_PATH,
	ROUTSTRD_ORIGIN,
	buildChatRequest,
	extractJsonObject,
	routstrListingDrafter,
	routstrListingDrafterManifest,
	type RoutstrListingDrafterConfig,
} from '.'

const config: RoutstrListingDrafterConfig = { model: 'qwen2.5-vl-72b', maxTokens: 700 }
const draftJson = {
	title: 'Hand-thrown Ceramic Mug',
	summary: 'A glazed stoneware mug.',
	description: 'A blue stoneware mug with a wide handle.',
	tags: ['Mug', 'ceramic'],
	category: 'home & technology',
}
const completion = (content: string) => jsonResponse(200, { choices: [{ message: { role: 'assistant', content } }], usage: {} })

function run(
	handler: Parameters<typeof createFakeHttpPort>[0],
	options: { config?: RoutstrListingDrafterConfig; input?: unknown; withHttp?: boolean } = {},
) {
	const http = createFakeHttpPort(handler, { egress: [ROUTSTRD_ORIGIN] })
	const log = createRecordingLogger()
	const context = createTestActionContext({
		publicConfig: options.config ?? config,
		host: { log, ...(options.withHttp === false ? {} : { http: http.port }) },
	})
	const result = executeExtensionAction({
		actions: routstrListingDrafter.actions,
		actionName: 'draft-listing',
		rawInput: options.input ?? { imageUrl: 'https://blossom.example/abc.jpg', notes: 'blue glaze' },
		caller: testCaller(),
		context,
	})
	return { result, requests: http.requests, log }
}

describe('routstr-listing-drafter', () => {
	test('is a valid definition with loopback-only egress and no private config', () => {
		expect(validateExtensionDefinition(routstrListingDrafter).ok).toBe(true)
		expect(routstrListingDrafterManifest.egress).toEqual([ROUTSTRD_ORIGIN])
		expect('privateConfig' in routstrListingDrafterManifest).toBe(false)
	})

	test('requires a model and accepts only an https provider pin', () => {
		expect(parseExtensionConfig(routstrListingDrafterManifest, {}).ok).toBe(false)
		expect(parseExtensionConfig(routstrListingDrafterManifest, { publicConfig: { model: 'm' } })).toMatchObject({
			ok: true,
			value: { publicConfig: { model: 'm', maxTokens: 700 } },
		})
		expect(parseExtensionConfig(routstrListingDrafterManifest, { publicConfig: { model: 'm', provider: 'http://node.example' } }).ok).toBe(
			false,
		)
	})

	test('calls only the chat-completions path with the image and notes, and returns a parsed draft', async () => {
		const { result, requests } = run(() => completion('```json\n' + JSON.stringify(draftJson) + '\n```'))
		const outcome = await result
		expect(outcome).toMatchObject({
			ok: true,
			value: {
				title: 'Hand-thrown Ceramic Mug',
				category: 'Home & Technology',
				tags: ['mug', 'ceramic'],
				model: 'routstr · qwen2.5-vl-72b',
			},
		})
		expect(requests).toHaveLength(1)
		expect(requests[0].url).toBe(`${ROUTSTRD_ORIGIN}${CHAT_COMPLETIONS_PATH}`)
		expect(requests[0].method).toBe('POST')
		expect(requests[0].headers).not.toHaveProperty('authorization')
		const body = JSON.parse(requests[0].body ?? '{}')
		expect(body.model).toBe('qwen2.5-vl-72b')
		expect(body.stream).toBe(false)
		expect(JSON.stringify(body.messages[1].content)).toContain('https://blossom.example/abc.jpg')
		expect(JSON.stringify(body.messages[1].content)).toContain('blue glaze')
		expect(body.messages[0].content).not.toContain('blue glaze')
	})

	test('sends the provider pin header when configured', async () => {
		const { result, requests } = run(() => completion(JSON.stringify(draftJson)), {
			config: { ...config, provider: 'https://node.example' },
		})
		expect((await result).ok).toBe(true)
		expect(requests[0].headers?.['x-routstr-provider']).toBe('https://node.example')
	})

	test('maps daemon failures to private-safe action errors', async () => {
		const reason = async (handler: Parameters<typeof createFakeHttpPort>[0]) => {
			const outcome = await run(handler).result
			return outcome.ok ? 'ok' : (outcome.error as { reason: string }).reason
		}
		expect(await reason(() => jsonResponse(402, { error: { type: 'insufficient_balance' } }))).toBe('extension_unavailable')
		expect(await reason(() => jsonResponse(429, {}))).toBe('extension_unavailable')
		expect(await reason(() => jsonResponse(504, {}))).toBe('upstream_timeout')
		expect(await reason(() => new ExtensionHttpError('network', 'ECONNREFUSED'))).toBe('extension_unavailable')
		expect(await reason(() => new ExtensionHttpError('timeout', 't'))).toBe('upstream_timeout')
		expect(await reason(() => ({ status: 200, headers: {}, body: 'not json' }))).toBe('invalid_output')
		expect(await reason(() => completion('I cannot help with that.'))).toBe('invalid_output')
		expect(await reason(() => completion(JSON.stringify({ title: 'x' })))).toBe('invalid_output')
	})

	test('logs a top-up hint on 402 without the response body', async () => {
		const { result, log } = run(() => jsonResponse(402, { error: { message: 'secret provider detail' } }))
		await result
		expect(log.entries.some((entry) => entry.fields?.hint)).toBe(true)
		expect(JSON.stringify(log.entries)).not.toContain('secret provider detail')
	})

	test('is misconfigured without the http port and rejects non-http image URLs before any request', async () => {
		const missing = await run(() => completion('{}'), { withHttp: false }).result
		expect(missing.ok).toBe(false)
		const bad = run(() => completion('{}'), { input: { imageUrl: 'file:///etc/passwd' } })
		expect((await bad.result).ok).toBe(false)
		expect(bad.requests).toHaveLength(0)
	})
})

describe('routstr helpers', () => {
	test('extractJsonObject tolerates fences and prose but not garbage', () => {
		expect(extractJsonObject('Sure! {"a":1} done')).toEqual({ a: 1 })
		expect(extractJsonObject('no json')).toBeUndefined()
		expect(extractJsonObject('{broken')).toBeUndefined()
	})

	test('buildChatRequest omits notes when absent', () => {
		const body = buildChatRequest({ imageUrl: 'https://x.example/a.jpg' }, config)
		expect(JSON.stringify(body.messages[1])).not.toContain('Seller notes')
		expect(body.max_tokens).toBe(700)
	})
})
