import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { success } from '../result'
import { createTestActionContext, testCaller } from '../testing/extensionHost'
import { executeExtensionAction } from './actions'
import {
	callerFromContextVmMeta,
	describeExtensionActionTools,
	extensionActionToolName,
	invokeExtensionActionOverContextVm,
	parseContextVmToolResult,
	parseExtensionActionToolName,
	toContextVmToolResult,
	type ContextVmCallTool,
} from './contextvm'
import { defineActionFor, defineExtension, validateExtensionDefinition, type ExtensionManifest } from './extension'

const PUBKEY = 'd'.repeat(64)

const manifest = {
	id: 'example.echo',
	version: '0.1.0',
	displayName: 'Echo',
	capabilities: ['example.echo'],
	runtimes: ['server'],
	publicConfig: z.object({}),
} satisfies ExtensionManifest<object>

const action = defineActionFor(manifest)
const base = {
	output: z.object({ echoed: z.string(), by: z.string() }),
	auth: 'user' as const,
	rateLimit: { perPubkey: 5, windowSeconds: 60 },
	handler: async (_ctx: unknown, input: { text: string }, caller: { pubkey: string }) => success({ echoed: input.text, by: caller.pubkey }),
}

const extension = defineExtension({
	manifest,
	actions: {
		echo: action({
			...base,
			description: 'Echo text back',
			input: z.object({ text: z.string().max(20) }),
			transports: ['http', 'contextvm'],
			inputJsonSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 20 } }, required: ['text'] },
		}),
		'http-only': action({ ...base, input: z.object({ text: z.string() }) }),
	},
})

describe('ContextVM tool naming', () => {
	test('round-trips extension ids containing dots and dashes', () => {
		const name = extensionActionToolName('ai-product-description', 'suggest')
		expect(name).toBe('ext.ai-product-description.suggest')
		expect(parseExtensionActionToolName(name)).toEqual({ extensionId: 'ai-product-description', actionName: 'suggest' })
		expect(parseExtensionActionToolName(extensionActionToolName('example.echo', 'bulk-import'))).toEqual({
			extensionId: 'example.echo',
			actionName: 'bulk-import',
		})
	})

	test('rejects first-party and malformed tool names', () => {
		for (const name of [
			'get_btc_price',
			'ext.',
			'ext.echo',
			'ext..echo',
			'ext.Example.echo',
			'ext.example.Echo',
			`ext.${'a'.repeat(130)}.x`,
		]) {
			expect(parseExtensionActionToolName(name)).toBeUndefined()
		}
	})

	test('lists only actions that opted into contextvm', () => {
		expect(describeExtensionActionTools(manifest.id, extension.actions)).toEqual([
			{
				name: 'ext.example.echo.echo',
				extensionId: 'example.echo',
				actionName: 'echo',
				description: 'Echo text back',
				inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 20 } }, required: ['text'] },
			},
		])
	})
})

describe('ContextVM caller and transport gating', () => {
	test('accepts only a lowercase 64-hex clientPubkey from _meta', () => {
		expect(callerFromContextVmMeta({ clientPubkey: PUBKEY }, () => false)).toEqual({
			pubkey: PUBKEY,
			isAdmin: false,
			transport: 'contextvm',
		})
		expect(callerFromContextVmMeta({ clientPubkey: PUBKEY }, (pubkey) => pubkey === PUBKEY)?.isAdmin).toBe(true)
		expect(callerFromContextVmMeta({ clientPubkey: PUBKEY.toUpperCase() }, () => false)).toBeUndefined()
		expect(callerFromContextVmMeta({}, () => false)).toBeUndefined()
		expect(callerFromContextVmMeta(undefined, () => false)).toBeUndefined()
	})

	test('http-only actions are not_found over contextvm', async () => {
		const context = createTestActionContext({ publicConfig: {} })
		const run = (actionName: string) =>
			executeExtensionAction({
				actions: extension.actions,
				actionName,
				rawInput: { text: 'hi' },
				caller: testCaller(PUBKEY, false, 'contextvm'),
				context,
			})
		expect(await run('echo')).toEqual({ ok: true, value: { echoed: 'hi', by: PUBKEY } })
		expect(await run('http-only')).toMatchObject({ ok: false, error: { reason: 'not_found' } })
	})

	test('rejects empty, unknown, or duplicate transports', () => {
		const bad = (transports: unknown) =>
			validateExtensionDefinition({ manifest, actions: { echo: { ...base, input: z.object({}), transports: transports as never } } }).ok
		expect(bad([])).toBe(false)
		expect(bad(['grpc'])).toBe(false)
		expect(bad(['http', 'http'])).toBe(false)
		expect(bad(['contextvm'])).toBe(true)
	})
})

describe('ContextVM tool results', () => {
	test('server results and client parsing share one envelope', async () => {
		const context = createTestActionContext({ publicConfig: {} })
		const callTool: ContextVmCallTool = async (request) => {
			const target = parseExtensionActionToolName(request.name)!
			const caller = callerFromContextVmMeta({ clientPubkey: PUBKEY }, () => false)!
			return toContextVmToolResult(
				await executeExtensionAction({
					actions: extension.actions,
					actionName: target.actionName,
					rawInput: request.arguments,
					caller,
					context,
				}),
			)
		}

		expect(await invokeExtensionActionOverContextVm(callTool, 'example.echo', 'echo', { text: 'hello' }, { output: base.output })).toEqual({
			ok: true,
			value: { echoed: 'hello', by: PUBKEY },
		})
		expect(await invokeExtensionActionOverContextVm(callTool, 'example.echo', 'echo', { text: 'x'.repeat(50) })).toMatchObject({
			ok: false,
			error: { reason: 'invalid_input' },
		})
		expect(await invokeExtensionActionOverContextVm(callTool, 'example.echo', 'http-only', { text: 'hi' })).toMatchObject({
			ok: false,
			error: { reason: 'not_found' },
		})
	})

	test('error results are flagged and carry no internal detail', () => {
		const result = toContextVmToolResult({ ok: false, error: new Error('sk-secret provider body') })
		expect(result.isError).toBe(true)
		expect(JSON.stringify(result)).not.toContain('sk-secret')
		expect(result.structuredContent).toMatchObject({ ok: false, error: { code: 'extension_failed' } })
	})

	test('parses untrusted tool results defensively', () => {
		expect(parseContextVmToolResult({ content: [{ type: 'text', text: '{"ok":true,"value":1}' }] })).toEqual({ ok: true, value: 1 })
		expect(parseContextVmToolResult({ isError: true, structuredContent: { ok: true, value: 1 } })).toMatchObject({
			ok: false,
			error: { reason: 'extension_failed' },
		})
		expect(parseContextVmToolResult({ content: [{ type: 'text', text: 'plain' }] })).toMatchObject({
			ok: false,
			error: { reason: 'invalid_output' },
		})
		expect(parseContextVmToolResult(null)).toMatchObject({ ok: false, error: { reason: 'extension_failed' } })
	})

	test('transport failures and non-object input are reported without throwing', async () => {
		const failing: ContextVmCallTool = async () => {
			throw new Error('relay timeout')
		}
		expect(await invokeExtensionActionOverContextVm(failing, 'example.echo', 'echo', { text: 'hi' })).toMatchObject({
			ok: false,
			error: { reason: 'network_error', retryable: true },
		})
		expect(await invokeExtensionActionOverContextVm(failing, 'example.echo', 'echo', ['x'] as never)).toMatchObject({
			ok: false,
			error: { reason: 'invalid_input' },
		})
	})
})
