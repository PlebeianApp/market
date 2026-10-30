import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { z } from 'zod'
import { HTTP_AUTH_KIND, sha256Hex } from '../nostr/nip98'
import { invokeExtensionAction, parseExtensionActionResponse, type ExtensionActionFetch } from './client'

const secretKey = generateSecretKey()
const signer = { sign: async (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, secretKey) }

function fakeFetch(status: number, body: unknown) {
	const calls: { url: string; init: Parameters<ExtensionActionFetch>[1] }[] = []
	const fetch: ExtensionActionFetch = async (url, init) => {
		calls.push({ url, init })
		return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }
	}
	return { fetch, calls }
}

function decodeAuthHeader(header: string) {
	expect(header.startsWith('Nostr ')).toBe(true)
	const bytes = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0))
	return JSON.parse(new TextDecoder().decode(bytes))
}

describe('invokeExtensionAction', () => {
	test('sends a NIP-98 signed POST and validates the response value', async () => {
		const { fetch, calls } = fakeFetch(200, { ok: true, value: { description: 'Oak table' } })
		const result = await invokeExtensionAction('ai-product-description', 'suggest', { title: 'Oak — table' }, signer, {
			baseUrl: 'https://market.example',
			fetch,
			output: z.object({ description: z.string() }),
			now: () => 1_700_000_000_000,
		})

		expect(result).toEqual({ ok: true, value: { description: 'Oak table' } })
		const [{ url, init }] = calls
		expect(url).toBe('https://market.example/api/extensions/ai-product-description/actions/suggest')
		expect(init.method).toBe('POST')

		const event = decodeAuthHeader(init.headers.authorization)
		expect(verifyEvent(event)).toBe(true)
		expect(event.kind).toBe(HTTP_AUTH_KIND)
		expect(event.pubkey).toBe(getPublicKey(secretKey))
		expect(event.created_at).toBe(1_700_000_000)
		expect(event.tags).toEqual([
			['u', url],
			['method', 'POST'],
			['payload', sha256Hex(init.body)],
		])
	})

	test('decodes server error envelopes', async () => {
		const { fetch } = fakeFetch(503, {
			ok: false,
			error: { code: 'extension_unavailable', message: 'Extension is temporarily unavailable' },
		})
		const result = await invokeExtensionAction('x', 'y', {}, signer, { baseUrl: 'https://market.example', fetch })
		expect(result).toMatchObject({ ok: false, error: { reason: 'extension_unavailable', retryable: false } })
	})

	test('treats schema-invalid success values as invalid_output', async () => {
		const { fetch } = fakeFetch(200, { ok: true, value: { description: 1 } })
		const result = await invokeExtensionAction('x', 'y', {}, signer, {
			baseUrl: 'https://market.example',
			fetch,
			output: z.object({ description: z.string() }),
		})
		expect(result).toMatchObject({ ok: false, error: { reason: 'invalid_output' } })
	})

	test('reports network and signing failures without throwing', async () => {
		const failingFetch: ExtensionActionFetch = async () => {
			throw new Error('offline')
		}
		expect(await invokeExtensionAction('x', 'y', {}, signer, { baseUrl: 'https://m.example', fetch: failingFetch })).toMatchObject({
			ok: false,
			error: { reason: 'network_error', retryable: true },
		})

		const rejectingSigner = {
			sign: async () => {
				throw new Error('user rejected')
			},
		}
		const { fetch, calls } = fakeFetch(200, {})
		expect(await invokeExtensionAction('x', 'y', {}, rejectingSigner, { baseUrl: 'https://m.example', fetch })).toMatchObject({
			ok: false,
			error: { reason: 'unauthorized' },
		})
		expect(calls).toHaveLength(0)
	})
})

describe('parseExtensionActionResponse', () => {
	test('falls back to the HTTP status for non-envelope bodies', () => {
		expect(parseExtensionActionResponse(429, 'Too Many Requests')).toMatchObject({ ok: false, error: { reason: 'rate_limited' } })
		expect(parseExtensionActionResponse(404, '<html>')).toMatchObject({ ok: false, error: { reason: 'not_found' } })
		expect(parseExtensionActionResponse(418, '{}')).toMatchObject({ ok: false, error: { reason: 'extension_failed' } })
	})

	test('ignores unknown error codes and an ok flag on non-2xx responses', () => {
		expect(parseExtensionActionResponse(500, JSON.stringify({ ok: false, error: { code: 'payment_failed' } }))).toMatchObject({
			ok: false,
			error: { reason: 'extension_failed' },
		})
		expect(parseExtensionActionResponse(503, JSON.stringify({ ok: true, value: 1 }))).toMatchObject({
			ok: false,
			error: { reason: 'extension_unavailable' },
		})
	})
})
