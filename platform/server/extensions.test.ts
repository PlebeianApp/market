import { describe, expect, test } from 'bun:test'
import { resolveAcceptedOrigins } from './extensions'

describe('extension action NIP-98 origins', () => {
	const spoofed = new Request('http://market-b.example/api/extensions/x/actions/y', { method: 'POST' })

	test('outside development, the Host-derived request origin is never trusted', () => {
		expect(resolveAcceptedOrigins(spoofed, 'production', undefined)).toEqual([])
		expect(resolveAcceptedOrigins(spoofed, 'staging', undefined)).toEqual([])
		expect(resolveAcceptedOrigins(spoofed, 'production', 'https://market-a.example/shop')).toEqual(['https://market-a.example'])
	})

	test('development also accepts the request origin for local hosts', () => {
		expect(resolveAcceptedOrigins(spoofed, 'development', undefined)).toEqual(['http://market-b.example'])
		expect(resolveAcceptedOrigins(spoofed, 'development', 'https://market-a.example')).toEqual([
			'https://market-a.example',
			'http://market-b.example',
		])
	})
})
