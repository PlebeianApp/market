import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineExtension } from '@sdk/core/extensions'
import { resolveBuiltinSettings } from './builtinSettings'
import { readExtensionEnvConfig } from './envConfig'
import { SqliteExtensionStateStore } from './stateStore'

const open = defineExtension({
	manifest: {
		id: 'open',
		version: '1.0.0',
		displayName: 'Open',
		capabilities: [],
		runtimes: ['server'],
		publicConfig: z.object({ n: z.coerce.number().default(3) }),
	},
})
const secret = defineExtension({
	manifest: {
		id: 'secret',
		version: '1.0.0',
		displayName: 'Secret',
		capabilities: [],
		runtimes: ['server'],
		publicConfig: z.object({}),
		privateConfig: z.object({ apiKey: z.string() }),
	},
})
const definitions = [open, secret]

describe('built-in settings with admin overrides', () => {
	test('environment alone decides when there are no overrides', () => {
		const env = readExtensionEnvConfig(definitions, { EXTENSION_SECRET_ENABLED: 'true', EXTENSION_SECRET_API_KEY: 'k' })
		const result = resolveBuiltinSettings(definitions, env, new Map())
		expect(result.settings.map((setting) => setting.id)).toEqual(['secret'])
		expect([...result.enableable]).toEqual(['open', 'secret'])
	})

	test('admins can disable env-enabled extensions and enable ones without private config', () => {
		const env = readExtensionEnvConfig(definitions, { EXTENSION_SECRET_ENABLED: 'true', EXTENSION_SECRET_API_KEY: 'k' })
		const result = resolveBuiltinSettings(
			definitions,
			env,
			new Map([
				['secret', false],
				['open', true],
			]),
		)
		expect(result.settings).toEqual([{ id: 'open', enabled: true, publicConfig: {} }])
		expect([...result.disabledByAdmin]).toEqual(['secret'])
	})

	test('enabling an extension that needs secrets the environment lacks is reported, not started', () => {
		const result = resolveBuiltinSettings(definitions, readExtensionEnvConfig(definitions, {}), new Map([['secret', true]]))
		expect(result.settings).toEqual([])
		expect(result.enableable.has('secret')).toBe(false)
		expect(result.problems.get('secret')).toBe('Needs private settings in the server environment')
	})

	test('overrides persist in the state store', () => {
		const store = new SqliteExtensionStateStore(':memory:')
		store.setBuiltinOverride('open', true, 'a'.repeat(64), 1)
		store.setBuiltinOverride('open', false, 'a'.repeat(64), 2)
		expect(store.listBuiltinOverrides()).toEqual(new Map([['open', false]]))
	})
})
