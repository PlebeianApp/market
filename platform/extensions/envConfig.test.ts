import { routstrListingDrafter } from '@sdk/extensions/routstr-listing-drafter'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineExtension } from '@sdk/core/extensions'
import { extensionEnvPrefix, readExtensionEnvConfig } from './envConfig'

const ai = defineExtension({
	manifest: {
		id: 'ai-product-description',
		version: '0.1.0',
		displayName: 'AI',
		capabilities: ['product.description.suggest'],
		runtimes: ['server'],
		hostPorts: ['http'],
		egress: ['https://api.routstr.com'],
		publicConfig: z.object({ maxChars: z.coerce.number().int().default(1200) }),
		privateConfig: z.object({ apiKey: z.string().startsWith('sk-'), model: z.string().min(1) }),
	},
})
const short = defineExtension({
	manifest: { id: 'ai', version: '0.1.0', displayName: 'Short', capabilities: [], runtimes: ['server'], publicConfig: z.object({}) },
})

describe('extension env config', () => {
	test('maps EXTENSION_<ID>_* to public (PUBLIC_ prefix) and private (default) config', () => {
		const config = readExtensionEnvConfig([ai], {
			EXTENSION_AI_PRODUCT_DESCRIPTION_ENABLED: 'true',
			EXTENSION_AI_PRODUCT_DESCRIPTION_API_KEY: 'sk-test',
			EXTENSION_AI_PRODUCT_DESCRIPTION_MODEL: 'm1',
			EXTENSION_AI_PRODUCT_DESCRIPTION_PUBLIC_MAX_CHARS: '800',
			EXTENSION_AI_PRODUCT_DESCRIPTION_EGRESS: 'https://api.routstr.com, http://localhost:8787',
			EXTENSION_AI_PRODUCT_DESCRIPTION_HOST_PORTS: 'http',
		})
		expect(config.errors).toEqual([])
		expect(config.settings).toEqual([
			{ id: 'ai-product-description', enabled: true, publicConfig: { maxChars: '800' }, privateConfig: { apiKey: 'sk-test', model: 'm1' } },
		])
		expect(config.policies.get('ai-product-description')).toEqual({
			egress: ['https://api.routstr.com', 'http://localhost:8787'],
			hostPorts: ['http'],
		})
	})

	test('leaves extensions disabled unless ENABLED is truthy', () => {
		expect(readExtensionEnvConfig([ai], { EXTENSION_AI_PRODUCT_DESCRIPTION_API_KEY: 'sk-x' }).settings).toEqual([])
		expect(readExtensionEnvConfig([ai], { EXTENSION_AI_PRODUCT_DESCRIPTION_ENABLED: 'false' }).settings).toEqual([])
	})

	test('reports invalid config per extension without echoing private values', () => {
		const config = readExtensionEnvConfig([ai, short], {
			EXTENSION_AI_PRODUCT_DESCRIPTION_ENABLED: 'true',
			EXTENSION_AI_PRODUCT_DESCRIPTION_API_KEY: 'not-a-key-secret',
			EXTENSION_AI_ENABLED: '1',
		})
		expect(config.settings.map((setting) => setting.id)).toEqual(['ai'])
		expect(config.errors).toHaveLength(1)
		expect(config.errors[0].id).toBe('ai-product-description')
		expect(config.errors[0].message).not.toContain('not-a-key-secret')
	})

	test('longest prefix wins and colliding prefixes are refused', () => {
		const config = readExtensionEnvConfig([short, ai], {
			EXTENSION_AI_ENABLED: 'true',
			EXTENSION_AI_PRODUCT_DESCRIPTION_ENABLED: 'true',
			EXTENSION_AI_PRODUCT_DESCRIPTION_API_KEY: 'sk-1',
			EXTENSION_AI_PRODUCT_DESCRIPTION_MODEL: 'm',
		})
		expect(config.errors).toEqual([])
		expect(config.settings.find((setting) => setting.id === 'ai')).toEqual({ id: 'ai', enabled: true, publicConfig: {} })

		const dotted = defineExtension({ manifest: { ...short.manifest, id: 'a.b' } })
		const dashed = defineExtension({ manifest: { ...short.manifest, id: 'a-b' } })
		expect(extensionEnvPrefix('a.b')).toBe(extensionEnvPrefix('a-b'))
		expect(readExtensionEnvConfig([dotted, dashed], {}).errors).toEqual([
			{ id: 'a-b', message: 'Environment prefix EXTENSION_A_B_ is shared with a.b' },
		])
	})

	test('rejects private values for extensions without a private schema and unknown host ports', () => {
		expect(readExtensionEnvConfig([short], { EXTENSION_AI_ENABLED: 'true', EXTENSION_AI_TOKEN: 'x' }).errors).toHaveLength(1)
		expect(readExtensionEnvConfig([short], { EXTENSION_AI_ENABLED: 'true', EXTENSION_AI_HOST_PORTS: 'signer' }).errors).toHaveLength(1)
	})

	test('ALLOW_LOCALHOST is an explicit operator opt-in and never becomes extension config', () => {
		const on = readExtensionEnvConfig([short], { EXTENSION_AI_ENABLED: 'true', EXTENSION_AI_ALLOW_LOCALHOST: 'true' })
		expect(on.errors).toEqual([])
		expect(on.policies.get('ai')).toEqual({ allowLocalhost: true })
		expect(on.settings[0]).not.toHaveProperty('privateConfig')
		const off = readExtensionEnvConfig([short], { EXTENSION_AI_ENABLED: 'true', EXTENSION_AI_ALLOW_LOCALHOST: 'no' })
		expect(off.policies.get('ai')).toEqual({})
	})

	test('the documented routstr-listing-drafter variables parse into public config and policy', () => {
		const config = readExtensionEnvConfig([routstrListingDrafter], {
			EXTENSION_ROUTSTR_LISTING_DRAFTER_ENABLED: 'true',
			EXTENSION_ROUTSTR_LISTING_DRAFTER_PUBLIC_MODEL: 'qwen2.5-vl-72b',
			EXTENSION_ROUTSTR_LISTING_DRAFTER_PUBLIC_MAX_TOKENS: '600',
			EXTENSION_ROUTSTR_LISTING_DRAFTER_ALLOW_LOCALHOST: 'true',
		})
		expect(config.errors).toEqual([])
		expect(config.settings[0]).toEqual({
			id: 'routstr-listing-drafter',
			enabled: true,
			publicConfig: { model: 'qwen2.5-vl-72b', maxTokens: '600' },
		})
		expect(config.policies.get('routstr-listing-drafter')).toEqual({ allowLocalhost: true })
	})
})
