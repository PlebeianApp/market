/**
 * The napplet implementation's mapping tests.
 *
 * These live beside the implementation rather than with the contract, because the mapping is this
 * implementation's business — a module may not know which implementation it is running under, and these
 * tests are the only place that assumption is checked.
 */
import { describe, expect, test } from 'bun:test'

import { CONFIG_KEYS } from '@plebeian/contract'
import type { RawEvent } from '@plebeian/contract'

import { createNappletEnvironment, type NappletRuntimeLike } from '../index'

const event = (): RawEvent => ({
	kind: 30402,
	id: 'c'.repeat(64),
	pubkey: 'a'.repeat(64),
	created_at: 1_700_000_000,
	content: '',
	tags: [
		['d', 'widget'],
		['title', 'Widget'],
	],
})

const runtime = (over: Partial<NappletRuntimeLike> = {}): NappletRuntimeLike => ({
	outbox: { query: async () => [event()] },
	resource: { bytesAsObjectURL: async (url) => `blob:stub/${url.split('/').pop()}` },
	...over,
})

describe('the sandboxed implementation', () => {
	test('states the lower trust boundary', () => {
		const env = createNappletEnvironment({ runtime: runtime() })
		expect(env.descriptor.boundary).toBe('napplet')
	})

	test('maps outbox.query onto a read that reports empty honestly', async () => {
		const env = createNappletEnvironment({ runtime: runtime({ outbox: { query: async () => [] } }) })
		const result = await env.nostr.read([{ kinds: [30402] }])
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.empty).toBe(true)
	})

	test('a sandbox read failure becomes a reason, not an exception', async () => {
		const env = createNappletEnvironment({
			runtime: runtime({
				outbox: {
					query: async () => {
						throw new Error('shell: query timed out')
					},
				},
			}),
		})
		const result = await env.nostr.read([{ kinds: [30402] }])
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('timeout')
	})

	test('media resolves through resource, because the sandbox blocks direct image URLs', async () => {
		const env = createNappletEnvironment({ runtime: runtime() })
		expect(await env.resource('https://example.com/a.png')).toBe('blob:stub/a.png')
	})

	test('KNOWN GAP (O1): config is synchronous in the contract and async in the sandbox, so it reads undefined', () => {
		// Recorded rather than hidden: a sandboxed surface must resolve the NSFW preference once at boot
		// and hold it, because it cannot ask the shell mid-render.
		const env = createNappletEnvironment({ runtime: runtime({ config: { get: () => 'true' } }) })
		expect(env.config.get(CONFIG_KEYS.showNSFW)).toBeUndefined()
	})

	test('a missing optional capability degrades instead of throwing', async () => {
		const env = createNappletEnvironment({ runtime: { outbox: { query: async () => [] }, resource: {} } })
		expect(env.nostr.stream([], () => {})).toBeFunction()
		expect(env.theme.onChanged(() => {})).toBeFunction()
		expect(env.config.onChanged(() => {})).toBeFunction()
		await expect(env.resource('https://example.com/a.png')).resolves.toBe('https://example.com/a.png')
	})
})
