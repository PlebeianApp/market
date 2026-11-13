import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { success } from '../result'
import { describeExtension, findExtensionAction, parsePublicExtensionDescriptors } from './descriptors'
import { defineExtension } from './extension'

const action = {
	input: z.object({}),
	output: z.object({}),
	auth: 'user' as const,
	rateLimit: { perPubkey: 5, windowSeconds: 60 },
	handler: async () => success({}),
}

const extension = defineExtension({
	manifest: {
		id: 'ai-product-description',
		version: '0.1.0',
		displayName: 'AI product description',
		capabilities: ['product.description.suggest'],
		runtimes: ['server'],
		publicConfig: z.object({ maxChars: z.number() }),
		privateConfig: z.object({ apiKey: z.string() }),
	},
	actions: {
		suggest: { ...action, description: 'Suggest', transports: ['http', 'contextvm'] },
		internal: { ...action, transports: ['contextvm'] },
	},
})

describe('extension descriptors', () => {
	test('describeExtension carries public config and actions, never handlers or private config', () => {
		const descriptor = describeExtension(extension, { maxChars: 1200 })
		expect(descriptor).toEqual({
			id: 'ai-product-description',
			version: '0.1.0',
			displayName: 'AI product description',
			capabilities: ['product.description.suggest'],
			config: { maxChars: 1200 },
			actions: [
				{
					name: 'suggest',
					description: 'Suggest',
					auth: 'user',
					rateLimit: { perPubkey: 5, windowSeconds: 60 },
					transports: ['http', 'contextvm'],
				},
				{ name: 'internal', auth: 'user', rateLimit: { perPubkey: 5, windowSeconds: 60 }, transports: ['contextvm'] },
			],
		})
		expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor)
	})

	test('parses a round-tripped descriptor list and drops malformed or duplicate entries', () => {
		const good = describeExtension(extension, { maxChars: 1200 })
		const result = parsePublicExtensionDescriptors([
			good,
			{ ...good },
			{ ...good, id: 'Bad Id' },
			{ ...good, id: 'other', actions: [{ name: 'x', auth: 'root', rateLimit: { perPubkey: 1, windowSeconds: 1 } }] },
			'nope',
		])
		expect(result).toEqual({ ok: true, value: [JSON.parse(JSON.stringify(good))] })
		expect(parsePublicExtensionDescriptors(undefined)).toEqual({ ok: true, value: [] })
		expect(parsePublicExtensionDescriptors({}).ok).toBe(false)
	})

	test('carries the manifest description and caps it', () => {
		const good = describeExtension(extension, {})
		const result = parsePublicExtensionDescriptors([
			{ ...good, description: '  Does a thing  ' },
			{ ...good, id: 'long', description: 'x'.repeat(500) },
		])
		expect(result.ok && result.value.map((descriptor) => descriptor.description?.length)).toEqual([12, 120])
	})

	test('keeps valid icons and drops unsafe ones without dropping the descriptor', () => {
		const good = describeExtension(extension, {})
		const [withIcon, unsafeIcon] = [
			{ ...good, icon: '/images/logo.svg' },
			{ ...good, id: 'other', icon: 'javascript:alert(1)' },
		]
		const result = parsePublicExtensionDescriptors([withIcon, unsafeIcon])
		expect(result.ok && result.value.map((descriptor) => descriptor.icon)).toEqual(['/images/logo.svg', undefined])
	})

	test('finds actions by capability and transport, not by extension id', () => {
		const descriptors = [describeExtension(extension, {})]
		expect(findExtensionAction(descriptors, 'product.description.suggest')).toMatchObject({
			extensionId: 'ai-product-description',
			action: { name: 'suggest' },
		})
		expect(findExtensionAction(descriptors, 'product.description.suggest', { transport: 'contextvm' })).toBeUndefined()
		expect(
			findExtensionAction(descriptors, 'product.description.suggest', { transport: 'contextvm', actionName: 'internal' }),
		).toMatchObject({
			action: { name: 'internal' },
		})
		expect(findExtensionAction(descriptors, 'missing.capability')).toBeUndefined()
	})
})
