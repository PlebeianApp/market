import { describe, expect, test } from 'bun:test'
import { defineExtension, type ExtensionContext } from '@sdk/core/extensions'
import { ExtensionRegistry } from './registry'

const record = {
	parse(input: unknown) {
		if (typeof input !== 'object' || input === null) throw new Error('expected object')
		return input as Record<string, string>
	},
}

function createExtension(id: string, runtimes: ('client' | 'server')[], log: string[], options: { failStart?: boolean } = {}) {
	return defineExtension({
		manifest: {
			id,
			version: '1.0.0',
			displayName: id,
			capabilities: [`${id}:use`],
			runtimes,
			publicConfig: record,
			privateConfig: record,
		},
		lifecycle: {
			start(context: ExtensionContext<Record<string, string>, Record<string, string>>) {
				if (options.failStart) throw new Error(`${id} failed`)
				log.push(`start ${id} ${context.runtime} private=${JSON.stringify(context.privateConfig ?? null)}`)
				return context
			},
			stop(handle) {
				log.push(`stop ${id} aborted=${handle.signal.aborted}`)
			},
		},
	})
}

describe('ExtensionRegistry', () => {
	test('exposes only enabled extensions and never private config', () => {
		const registry = new ExtensionRegistry('market-a')
			.register(createExtension('maps', ['client'], []))
			.register(createExtension('mailer', ['server'], []))

		const result = registry.configure([
			{ id: 'maps', enabled: true, publicConfig: { tiles: 'osm' }, privateConfig: { apiKey: 'secret' } },
			{ id: 'mailer', enabled: false },
		])

		expect(result.ok).toBe(true)
		expect(registry.isEnabled('maps')).toBe(true)
		expect(registry.hasCapability('mailer:use')).toBe(false)
		expect(registry.getPublicDescriptors()).toEqual([
			{ id: 'maps', version: '1.0.0', capabilities: ['maps:use'], config: { tiles: 'osm' } },
		])
		expect(JSON.stringify(registry.getPublicDescriptors())).not.toContain('secret')
	})

	test('rejects unknown, duplicate, and invalid settings without changing the enabled set', () => {
		const registry = new ExtensionRegistry('market-a').register(createExtension('maps', ['client'], []))
		registry.configure([{ id: 'maps', enabled: true, publicConfig: {} }])

		const result = registry.configure([
			{ id: 'nope', enabled: true },
			{ id: 'maps', enabled: true, publicConfig: 'bad' },
			{ id: 'maps', enabled: false },
		])

		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error.map((error) => error.message)).toHaveLength(3)
		expect(registry.isEnabled('maps')).toBe(true)
	})

	test('withholds private config from the client runtime and stops in reverse order', async () => {
		const log: string[] = []
		const registry = new ExtensionRegistry('market-a')
			.register(createExtension('a', ['client', 'server'], log))
			.register(createExtension('b', ['server'], log))
		registry.configure([
			{ id: 'a', enabled: true, publicConfig: {}, privateConfig: { key: 'k' } },
			{ id: 'b', enabled: true, publicConfig: {}, privateConfig: { key: 'k2' } },
		])

		await registry.start('client')
		await registry.stop()
		await registry.start('server')
		await registry.stop()

		expect(log).toEqual([
			'start a client private=null',
			'stop a aborted=true',
			'start a server private={"key":"k"}',
			'start b server private={"key":"k2"}',
			'stop b aborted=true',
			'stop a aborted=true',
		])
	})

	test('rolls back extensions started before a failure', async () => {
		const log: string[] = []
		const registry = new ExtensionRegistry('market-a')
			.register(createExtension('a', ['server'], log))
			.register(createExtension('b', ['server'], log, { failStart: true }))
		registry.configure([
			{ id: 'a', enabled: true, publicConfig: {}, privateConfig: {} },
			{ id: 'b', enabled: true, publicConfig: {}, privateConfig: {} },
		])

		await expect(registry.start('server')).rejects.toThrow('b failed')
		expect(log).toEqual(['start a server private={}', 'stop a aborted=true'])
		expect(registry.configure([]).ok).toBe(true)
	})

	test('keeps instances isolated', () => {
		const a = new ExtensionRegistry('market-a').register(createExtension('maps', ['client'], []))
		const b = new ExtensionRegistry('market-b').register(createExtension('maps', ['client'], []))
		a.configure([{ id: 'maps', enabled: true, publicConfig: {} }])
		expect(b.isEnabled('maps')).toBe(false)
	})
})
