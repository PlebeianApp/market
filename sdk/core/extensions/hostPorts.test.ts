import { describe, expect, test } from 'bun:test'
import { createFakeHttpPort, jsonResponse } from '../testing/extensionHost'
import { isEgressAllowed, parseEgressOrigin } from './hostPorts'

describe('egress policy', () => {
	test('normalizes https origins and loopback http origins', () => {
		expect(parseEgressOrigin('https://api.routstr.com')).toEqual({ ok: true, value: 'https://api.routstr.com' })
		expect(parseEgressOrigin('https://API.routstr.com:443/')).toEqual({ ok: true, value: 'https://api.routstr.com' })
		expect(parseEgressOrigin('http://localhost:8787')).toEqual({ ok: true, value: 'http://localhost:8787' })
		expect(parseEgressOrigin('http://127.0.0.1:9000').ok).toBe(true)
	})

	test('rejects non-origins, plain http, credentials, and other schemes', () => {
		for (const value of [
			'https://api.routstr.com/v1',
			'https://api.routstr.com?x=1',
			'http://api.routstr.com',
			'https://user:pw@api.routstr.com',
			'wss://relay.example',
			'not a url',
		]) {
			expect(parseEgressOrigin(value).ok).toBe(false)
		}
	})

	test('allows only exact origin matches', () => {
		const allowed = ['https://api.routstr.com']
		expect(isEgressAllowed('https://api.routstr.com/v1/chat/completions', allowed)).toBe(true)
		expect(isEgressAllowed('https://api.routstr.com.evil.example/v1', allowed)).toBe(false)
		expect(isEgressAllowed('https://evil.example/?u=https://api.routstr.com', allowed)).toBe(false)
		expect(isEgressAllowed('http://api.routstr.com/v1', allowed)).toBe(false)
		expect(isEgressAllowed('https://api.routstr.com:8443/v1', allowed)).toBe(false)
		expect(isEgressAllowed('https://x@api.routstr.com/v1', allowed)).toBe(false)
		expect(isEgressAllowed('::', allowed)).toBe(false)
	})

	test('fake http port denies undeclared origins without calling the handler', async () => {
		const { port, requests } = createFakeHttpPort(() => jsonResponse(200, {}), { egress: ['https://api.routstr.com'] })
		const denied = await port.request({ url: 'https://other.example/' })
		expect(denied).toMatchObject({ ok: false, error: { reason: 'egress_denied' } })
		expect(requests).toHaveLength(0)
	})
})
