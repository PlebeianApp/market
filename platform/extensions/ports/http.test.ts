import { describe, expect, test } from 'bun:test'
import { createScopedHttpPort, resolveEffectiveEgress, type HttpFetch } from './http'

function recordingFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
	const calls: { url: string; init: RequestInit }[] = []
	const fetch: HttpFetch = async (url, init) => {
		calls.push({ url, init })
		return respond(url, init)
	}
	return { fetch, calls }
}

describe('scoped http port', () => {
	test('effective egress is manifest ∩ operator, without loopback in production', () => {
		const egress = ['https://api.routstr.com', 'https://other.example', 'http://localhost:8787']
		expect(resolveEffectiveEgress({ egress, allowLocalhost: true })).toEqual(egress)
		expect(resolveEffectiveEgress({ egress, allowLocalhost: false })).toEqual(['https://api.routstr.com', 'https://other.example'])
		expect(
			resolveEffectiveEgress({
				egress,
				operatorEgress: ['https://api.routstr.com/', 'https://not-declared.example'],
				allowLocalhost: true,
			}),
		).toEqual(['https://api.routstr.com'])
	})

	test('denies undeclared origins without calling fetch', async () => {
		const { fetch, calls } = recordingFetch(() => new Response('ok'))
		const port = createScopedHttpPort({ egress: ['https://api.routstr.com'], allowLocalhost: false, fetch })
		expect(await port.request({ url: 'https://evil.example/' })).toMatchObject({ ok: false, error: { reason: 'egress_denied' } })
		expect(await port.request({ url: 'http://localhost:1/' })).toMatchObject({ ok: false, error: { reason: 'egress_denied' } })
		expect(calls).toHaveLength(0)
	})

	test('does not follow redirects and returns the response as data', async () => {
		const { fetch, calls } = recordingFetch(() => new Response('', { status: 302, headers: { location: 'https://evil.example/' } }))
		const port = createScopedHttpPort({ egress: ['https://api.routstr.com'], allowLocalhost: false, fetch })
		const result = await port.request({
			url: 'https://api.routstr.com/v1/x',
			method: 'POST',
			body: '{}',
			headers: { authorization: 'Bearer sk' },
		})
		expect(result).toMatchObject({ ok: true, value: { status: 302, body: '' } })
		expect(calls[0].init.redirect).toBe('manual')
		expect(calls[0].init.method).toBe('POST')
	})

	test('caps response size by header and by streamed bytes', async () => {
		const declared = createScopedHttpPort({
			egress: ['https://a.example'],
			allowLocalhost: false,
			maxResponseBytes: 10,
			fetch: async () => new Response('x'.repeat(5), { headers: { 'content-length': '999' } }),
		})
		expect(await declared.request({ url: 'https://a.example/' })).toMatchObject({ ok: false, error: { reason: 'response_too_large' } })

		const streamed = createScopedHttpPort({
			egress: ['https://a.example'],
			allowLocalhost: false,
			maxResponseBytes: 10,
			fetch: async () => new Response('x'.repeat(50)),
		})
		expect(await streamed.request({ url: 'https://a.example/' })).toMatchObject({ ok: false, error: { reason: 'response_too_large' } })
	})

	test('times out, honours aborts, and hides transport error detail', async () => {
		const hang: HttpFetch = (_url, init) =>
			new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted https://user:pw@a.example'))))
		const port = createScopedHttpPort({ egress: ['https://a.example'], allowLocalhost: false, fetch: hang, timeoutMs: 20 })
		expect(await port.request({ url: 'https://a.example/' })).toMatchObject({ ok: false, error: { reason: 'timeout' } })

		const controller = new AbortController()
		const pending = port.request({ url: 'https://a.example/', signal: controller.signal })
		controller.abort()
		expect(await pending).toMatchObject({ ok: false, error: { reason: 'aborted' } })

		const failing = createScopedHttpPort({
			egress: ['https://a.example'],
			allowLocalhost: false,
			fetch: async () => {
				throw new Error('connect ECONNREFUSED https://user:pw@a.example')
			},
		})
		const result = await failing.request({ url: 'https://a.example/' })
		expect(result).toMatchObject({ ok: false, error: { reason: 'network' } })
		expect(JSON.stringify(!result.ok && result.error.message)).not.toContain('pw')
	})

	test('rejects oversize request bodies and strips set-cookie', async () => {
		const port = createScopedHttpPort({
			egress: ['https://a.example'],
			allowLocalhost: false,
			maxRequestBytes: 4,
			fetch: async () => new Response('ok', { headers: { 'set-cookie': 'a=b', 'x-request-id': '1' } }),
		})
		expect(await port.request({ url: 'https://a.example/', method: 'POST', body: '12345' })).toMatchObject({ ok: false })
		expect(await port.request({ url: 'https://a.example/' })).toMatchObject({ ok: true, value: { headers: { 'x-request-id': '1' } } })
		const ok = await port.request({ url: 'https://a.example/' })
		expect(ok.ok && ok.value.headers['set-cookie']).toBeFalsy()
	})
})
