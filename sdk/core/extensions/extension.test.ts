import { describe, expect, test } from 'bun:test'
import { defineExtension, parseExtensionConfig, validateExtensionManifest, type ExtensionManifest } from './extension'

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
