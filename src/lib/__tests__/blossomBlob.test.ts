import { describe, expect, test } from 'bun:test'
import { fetchBlossomBlob } from '@/lib/blossom'

/**
 * Blob fetching is tested against a local fake, per ADR-0005: no test may reach
 * an external service. The digest below is SHA-256("hello"), a fixed outside
 * constant rather than one computed here, so a test cannot pass by computing
 * the same wrong thing twice.
 */
const HELLO = new TextEncoder().encode('hello')
const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

function fakeFetch(routes: Record<string, { status?: number; body?: Uint8Array; contentType?: string }>): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input)
		const route = routes[url]
		if (!route) return new Response('not found', { status: 404 })
		return new Response((route.body ?? new Uint8Array()) as unknown as BodyInit, {
			status: route.status ?? 200,
			headers: route.contentType ? { 'content-type': route.contentType } : undefined,
		})
	}) as typeof fetch
}

describe('fetchBlossomBlob', () => {
	test('returns the bytes when they match the requested digest', async () => {
		const fetchImpl = fakeFetch({
			[`https://blossom.example/${HELLO_SHA}`]: { body: HELLO, contentType: 'text/html' },
		})
		const { blob, error } = await fetchBlossomBlob(HELLO_SHA, ['https://blossom.example'], { fetchImpl })
		expect(error).toBeNull()
		expect(blob?.server).toBe('https://blossom.example')
		expect(blob?.contentType).toBe('text/html')
		expect(new TextDecoder().decode(blob?.bytes)).toBe('hello')
	})

	test('discards bytes that do not match the digest — a lying server yields nothing', async () => {
		const fetchImpl = fakeFetch({
			[`https://liar.example/${HELLO_SHA}`]: { body: new TextEncoder().encode('<script>alert(1)</script>') },
		})
		const { blob, error } = await fetchBlossomBlob(HELLO_SHA, ['https://liar.example'], { fetchImpl })
		expect(blob).toBeNull()
		expect(error).toContain('does not match')
	})

	test('falls through to the next server when the first lies or fails', async () => {
		const fetchImpl = fakeFetch({
			[`https://liar.example/${HELLO_SHA}`]: { body: new TextEncoder().encode('wrong') },
			[`https://down.example/${HELLO_SHA}`]: { status: 500 },
			[`https://honest.example/${HELLO_SHA}`]: { body: HELLO },
		})
		const { blob, error } = await fetchBlossomBlob(HELLO_SHA, ['https://liar.example', 'https://down.example', 'https://honest.example'], {
			fetchImpl,
		})
		expect(error).toBeNull()
		expect(blob?.server).toBe('https://honest.example')
	})

	test('refuses to fetch without a well-formed digest', async () => {
		const { blob, error } = await fetchBlossomBlob('not-a-digest', ['https://blossom.example'], {
			fetchImpl: fakeFetch({}),
		})
		expect(blob).toBeNull()
		expect(error).toContain('well-formed sha256')
	})

	test('enforces the size cap the caller sets', async () => {
		const fetchImpl = fakeFetch({ [`https://big.example/${HELLO_SHA}`]: { body: HELLO } })
		const { blob, error } = await fetchBlossomBlob(HELLO_SHA, ['https://big.example'], { fetchImpl, maxBytes: 2 })
		expect(blob).toBeNull()
		expect(error).toContain('exceeds')
	})

	test('reports every failure when no server serves a matching blob', async () => {
		const fetchImpl = fakeFetch({})
		const { blob, error } = await fetchBlossomBlob(HELLO_SHA, ['https://a.example', 'https://b.example'], { fetchImpl })
		expect(blob).toBeNull()
		expect(error).toContain('https://a.example')
		expect(error).toContain('https://b.example')
	})
})
