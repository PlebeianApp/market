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

describe('extension store catalog states', () => {
	test('lists every built-in with enabled, available, and misconfigured states', async () => {
		const { z } = await import('zod')
		const { defineExtension } = await import('@sdk/core/extensions')
		const { startExtensions, stopExtensions, getExtensionCatalog } = await import('./extensions')
		const make = (id: string, privateConfig?: boolean) =>
			defineExtension({
				manifest: {
					id,
					version: '1.0.0',
					displayName: id,
					capabilities: [],
					runtimes: ['server'],
					publicConfig: z.object({}),
					...(privateConfig ? { privateConfig: z.object({ apiKey: z.string().startsWith('sk-') }) } : {}),
				},
			})
		await startExtensions([make('on'), make('off'), make('broken', true)], {
			EXTENSION_ON_ENABLED: 'true',
			EXTENSION_BROKEN_ENABLED: 'true',
			EXTENSION_BROKEN_API_KEY: 'not-a-key-secret',
		})
		const entries = getExtensionCatalog().entries
		expect(entries.map((entry) => [entry.id, entry.state])).toEqual([
			['on', 'installed_enabled'],
			['off', 'available'],
			['broken', 'misconfigured'],
		])
		expect(JSON.stringify(entries)).not.toContain('not-a-key-secret')
		await stopExtensions()
		expect(getExtensionCatalog().entries).toEqual([])
	})
})
