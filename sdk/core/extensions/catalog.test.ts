import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { success } from '../result'
import { describeCatalogEntry, parseExtensionCatalog } from './catalog'
import { defineExtension, validateExtensionManifest } from './extension'

const extension = defineExtension({
	manifest: {
		id: 'ai-helper',
		version: '1.2.0',
		displayName: 'AI helper',
		icon: '/images/ai.svg',
		description: 'Helps sellers write listings.',
		capabilities: ['product.description.suggest'],
		runtimes: ['server'],
		hostPorts: ['http', 'relays:read'],
		egress: ['https://api.example'],
		publicConfig: z.object({}),
		privateConfig: z.object({ apiKey: z.string() }),
	},
	actions: {
		suggest: {
			input: z.object({}),
			output: z.object({}),
			auth: 'user',
			rateLimit: { perPubkey: 5, windowSeconds: 60 },
			handler: async () => success({}),
		},
	},
})

describe('extension catalog', () => {
	test('entries carry metadata, permissions, and state but never config values', () => {
		const entry = describeCatalogEntry(extension, { state: 'available', envPrefix: 'EXTENSION_AI_HELPER_' })
		expect(entry).toEqual({
			id: 'ai-helper',
			version: '1.2.0',
			displayName: 'AI helper',
			icon: '/images/ai.svg',
			description: 'Helps sellers write listings.',
			capabilities: ['product.description.suggest'],
			runtimes: ['server'],
			hostPorts: ['http', 'relays:read'],
			egress: ['https://api.example'],
			actions: [{ name: 'suggest', auth: 'user', rateLimit: { perPubkey: 5, windowSeconds: 60 }, transports: ['http'] }],
			hasPrivateConfig: true,
			state: 'available',
			managedBy: 'environment',
			envPrefix: 'EXTENSION_AI_HELPER_',
			canEnable: false,
		})
	})

	test('parses round-tripped entries and drops malformed ones', () => {
		const good = describeCatalogEntry(extension, {
			state: 'misconfigured',
			envPrefix: 'EXTENSION_AI_HELPER_',
			problem: 'invalid private config',
		})
		const result = parseExtensionCatalog({
			entries: [
				good,
				{ ...good, id: 'other', state: 'hacked' },
				{ ...good, id: 'other2', envPrefix: 'PATH' },
				{ ...good, id: 'other3', hostPorts: ['signer'] },
				{ ...good, id: 'other4', egress: ['http://evil.example'] },
				{ ...good, id: 'other5', icon: 'javascript:alert(1)' },
			],
		})
		expect(result.ok && result.value.map((entry) => [entry.id, entry.icon])).toEqual([
			['ai-helper', '/images/ai.svg'],
			['other5', undefined],
		])
		expect(result.ok && result.value[0].problem).toBe('invalid private config')
		expect(parseExtensionCatalog([]).ok).toBe(false)
	})

	test('manifest description is optional and capped at 120 characters', () => {
		expect(validateExtensionManifest({ ...extension.manifest, description: 'x'.repeat(120) }).ok).toBe(true)
		expect(validateExtensionManifest({ ...extension.manifest, description: 'x'.repeat(121) }).ok).toBe(false)
		expect(validateExtensionManifest({ ...extension.manifest, description: '  ' }).ok).toBe(false)
	})
})
