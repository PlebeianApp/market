import { describe, expect, test } from 'bun:test'
import {
	defineExtension,
	parseExtensionConfig,
	validateExtensionDefinition,
	validateExtensionManifest,
	type ExtensionManifest,
} from './extension'

const stringRecord = (field: string) => ({
	parse(input: unknown) {
		const value = (input as Record<string, unknown>)?.[field]
		if (typeof value !== 'string' || !value) throw new Error(`${field} is required`)
		return { [field]: value }
	},
})

const manifest: ExtensionManifest<{ region: string }, { token: string }> = {
	id: 'example.notifications',
	version: '1.0.0',
	displayName: 'Example notifications',
	capabilities: ['notifications:send'],
	runtimes: ['server'],
	publicConfig: stringRecord('region') as never,
	privateConfig: stringRecord('token') as never,
}

describe('extension manifest', () => {
	test('accepts a well-formed manifest', () => {
		expect(validateExtensionManifest(manifest).ok).toBe(true)
		expect(defineExtension({ manifest }).manifest.id).toBe('example.notifications')
	})

	test('rejects invalid identity, version, runtimes, and duplicate capabilities', () => {
		expect(validateExtensionManifest({ ...manifest, id: 'Bad Id' }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, version: '1' }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, runtimes: [] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, runtimes: ['mobile' as never] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, capabilities: ['a', 'a'] }).ok).toBe(false)
		expect(() => defineExtension({ manifest: { ...manifest, id: '' } })).toThrow()
	})
})

describe('extension icon', () => {
	test('accepts bundled image paths and https URLs only', () => {
		for (const icon of ['/images/x.svg', '/images/extensions/logo-2.png', 'https://cdn.example/logo.webp']) {
			expect(validateExtensionManifest({ ...manifest, icon }).ok).toBe(true)
		}
		for (const icon of [
			'',
			'images/x.svg',
			'/images/../secret.svg',
			'//evil.example/x.svg',
			'/x.svg?v=1',
			'/x.html',
			'http://cdn.example/x.svg',
			'javascript:alert(1)',
		]) {
			expect(validateExtensionManifest({ ...manifest, icon }).ok).toBe(false)
		}
	})
})

describe('extension host ports and egress', () => {
	test('accepts http with declared https/localhost egress', () => {
		const result = validateExtensionManifest({
			...manifest,
			hostPorts: ['relays:read', 'http', 'storage'],
			egress: ['https://api.routstr.com', 'http://localhost:8787'],
		})
		expect(result.ok).toBe(true)
	})

	test('rejects unknown/duplicate ports and inconsistent egress', () => {
		expect(validateExtensionManifest({ ...manifest, hostPorts: ['signer' as never] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, hostPorts: ['http', 'http'], egress: ['https://a.example'] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, hostPorts: ['http'] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, egress: ['https://a.example'] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, hostPorts: ['http'], egress: ['http://a.example'] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, hostPorts: ['http'], egress: ['https://a.example/v1'] }).ok).toBe(false)
		expect(validateExtensionManifest({ ...manifest, hostPorts: ['http'], egress: ['https://a.example', 'https://A.example/'] }).ok).toBe(
			false,
		)
	})
})

describe('extension actions', () => {
	const schema = { parse: (input: unknown) => input }
	const action = {
		input: schema,
		output: schema,
		auth: 'user' as const,
		rateLimit: { perPubkey: 5, windowSeconds: 60 },
		handler: async () => ({ ok: true as const, value: {} }),
	}

	test('accepts well-formed server actions', () => {
		expect(validateExtensionDefinition({ manifest, actions: { suggest: action, 'bulk-import': action } }).ok).toBe(true)
	})

	test('rejects actions on non-server extensions and malformed action declarations', () => {
		const clientOnly = { ...manifest, runtimes: ['client'] as const }
		expect(validateExtensionDefinition({ manifest: clientOnly, actions: { suggest: action } }).ok).toBe(false)
		expect(validateExtensionDefinition({ manifest, actions: { Suggest: action } }).ok).toBe(false)
		expect(validateExtensionDefinition({ manifest, actions: { suggest: { ...action, auth: 'anyone' as never } } }).ok).toBe(false)
		expect(
			validateExtensionDefinition({ manifest, actions: { suggest: { ...action, rateLimit: { perPubkey: 0, windowSeconds: 60 } } } }).ok,
		).toBe(false)
		expect(validateExtensionDefinition({ manifest, actions: { suggest: { ...action, output: undefined as never } } }).ok).toBe(false)
		expect(() => defineExtension({ manifest, actions: { 'Bad Name': action } })).toThrow()
	})
})

describe('extension config parsing', () => {
	test('parses public and private config through the declared schemas', () => {
		const result = parseExtensionConfig(manifest, { publicConfig: { region: 'eu' }, privateConfig: { token: 'secret' } })
		expect(result).toEqual({ ok: true, value: { publicConfig: { region: 'eu' }, privateConfig: { token: 'secret' } } })
	})

	test('does not echo private values in errors', () => {
		const result = parseExtensionConfig(
			{
				...manifest,
				privateConfig: {
					parse: () => {
						throw new Error('bad token: secret-value')
					},
				},
			},
			{ publicConfig: { region: 'eu' }, privateConfig: { token: 'secret-value' } },
		)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.message).not.toContain('secret-value')
			expect(result.error.cause).toBeUndefined()
		}
	})

	test('rejects private values for extensions without a private schema', () => {
		const { privateConfig: _, ...publicOnly } = manifest
		expect(parseExtensionConfig(publicOnly, { publicConfig: { region: 'eu' }, privateConfig: { token: 'x' } }).ok).toBe(false)
	})
})
