import { describe, expect, test } from 'bun:test'
import {
	actionNameProblem,
	CAPABILITY_FORMAT_HINT,
	capabilityProblem,
	parseRemoteBindingRequest,
	parseRemoteBindingViews,
	parseRemoteExtensionId,
	remoteExtensionId,
	RemoteActionOutputSchema,
	toRemoteActionOutput,
	MAX_REMOTE_TEXT,
} from './bindings'
import { canonicalJson, hashInputSchema } from './repository'

const server = 'a'.repeat(64)
const request = {
	serverPubkey: server,
	toolName: 'quote',
	actionName: 'get-quote',
	capability: 'shipping.quote',
	auth: 'user',
	acknowledgedDataFlow: true,
}

describe('remote binding contract', () => {
	test('remote extension ids round-trip and reject non-pubkeys', () => {
		expect(remoteExtensionId(server)).toBe(`remote.${server}`)
		expect(parseRemoteExtensionId(`remote.${server}`)).toBe(server)
		expect(parseRemoteExtensionId('remote.abc')).toBeUndefined()
		expect(parseRemoteExtensionId('product-image-describer')).toBeUndefined()
	})

	test('bind requests need valid names, a known role, sane limits, and data-flow consent', () => {
		expect(parseRemoteBindingRequest(request)).toEqual({
			ok: true,
			value: { ...request, auth: 'user', rateLimit: { perPubkey: 30, windowSeconds: 3600 }, acknowledgedDataFlow: true },
		})
		const bad = (change: Record<string, unknown>) => parseRemoteBindingRequest({ ...request, ...change }).ok
		expect(bad({ actionName: 'Get Quote' })).toBe(false)
		expect(bad({ capability: 'Shipping Quote' })).toBe(false)
		expect(bad({ auth: 'anyone' })).toBe(false)
		expect(bad({ rateLimit: { perPubkey: 0, windowSeconds: 60 } })).toBe(false)
		expect(bad({ rateLimit: { perPubkey: 5, windowSeconds: 999_999 } })).toBe(false)
		expect(bad({ acknowledgedDataFlow: false })).toBe(false)
		expect(bad({ serverPubkey: 'npub1x' })).toBe(false)
	})

	test('capability and action name checks explain what is wrong', () => {
		for (const ok of ['product.image.describe', 'shipping.quote', 'dev:echo', 'a1-b2']) expect(capabilityProblem(ok)).toBeUndefined()
		for (const bad of ['Product.Image', 'product image', 'product_image.describe', '.leading', 'trailing.', 'a..b']) {
			expect(capabilityProblem(bad)).toBe(CAPABILITY_FORMAT_HINT)
		}
		expect(capabilityProblem('')).toBe('Enter a capability')
		expect(capabilityProblem('a'.repeat(101))).toContain('at most 100')
		expect(actionNameProblem('get-quote')).toBeUndefined()
		expect(actionNameProblem('Get Quote')).toContain('e.g. get-quote')
		expect(parseRemoteBindingRequest({ ...request, capability: 'Product Image' })).toMatchObject({
			ok: false,
			error: { message: CAPABILITY_FORMAT_HINT },
		})
	})

	test('pin hash ignores key order but notices real changes', () => {
		const schema = { type: 'object', properties: { weight: { type: 'number' }, country: { type: 'string' } } }
		const reordered = { properties: { country: { type: 'string' }, weight: { type: 'number' } }, type: 'object' }
		expect(canonicalJson(schema)).toBe(canonicalJson(reordered))
		expect(hashInputSchema(schema)).toBe(hashInputSchema(reordered))
		expect(hashInputSchema({ ...schema, required: ['weight'] })).not.toBe(hashInputSchema(schema))
		expect(hashInputSchema(undefined)).toBe(hashInputSchema({}))
	})

	test('remote results become capped plain text plus small structured data', () => {
		expect(
			toRemoteActionOutput({
				content: [
					{ type: 'text', text: 'Rate:\u0007 1200 sats' },
					{ type: 'image', data: 'xx' },
					{ type: 'text', text: 'line two' },
				],
				structuredContent: { sats: 1200 },
			}),
		).toEqual({ ok: true, value: { text: 'Rate: 1200 sats\nline two', data: { sats: 1200 } } })

		const long = toRemoteActionOutput({
			content: [{ type: 'text', text: 'x'.repeat(MAX_REMOTE_TEXT + 50) }],
			structuredContent: { big: 'y'.repeat(20_000) },
		})
		expect(long.ok && long.value.text.length).toBe(MAX_REMOTE_TEXT)
		expect(long.ok && long.value.data).toBeUndefined()
	})

	test('remote errors and empty results never pass remote text to clients', () => {
		const failed = toRemoteActionOutput({ isError: true, content: [{ type: 'text', text: 'stack trace with secrets' }] })
		expect(failed).toMatchObject({ ok: false, error: { reason: 'extension_failed' } })
		expect(JSON.stringify(!failed.ok && failed.error.message)).not.toContain('secrets')
		expect(toRemoteActionOutput({ content: [] })).toMatchObject({ ok: false, error: { reason: 'invalid_output' } })
		expect(toRemoteActionOutput('nope')).toMatchObject({ ok: false, error: { reason: 'invalid_output' } })
	})

	test('output schema and binding views parse untrusted wire data', () => {
		expect(RemoteActionOutputSchema.parse({ text: 'hi', data: { a: 1 } })).toEqual({ text: 'hi', data: { a: 1 } })
		expect(() => RemoteActionOutputSchema.parse({ data: {} })).toThrow()
		const views = parseRemoteBindingViews([
			{
				...request,
				rateLimit: { perPubkey: 5, windowSeconds: 60 },
				serverName: 'Rates',
				enabled: true,
				state: 'misconfigured',
				problem: 'changed',
			},
			{ ...request, state: 'hacked' },
		])
		expect(views).toEqual([
			{
				serverPubkey: server,
				toolName: 'quote',
				actionName: 'get-quote',
				capability: 'shipping.quote',
				auth: 'user',
				rateLimit: { perPubkey: 5, windowSeconds: 60 },
				serverName: 'Rates',
				enabled: true,
				state: 'misconfigured',
				problem: 'changed',
			},
		])
	})
})
