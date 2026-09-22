/**
 * Environment-contract tests.
 *
 * The contract these pin is the one the application breaks today: a read that failed and a read that
 * found nothing must be distinguishable, and neither may be reported as an exception.
 */
import { describe, expect, test } from 'bun:test'

import type { RawEvent } from '../index'
import { CONFIG_KEYS } from '../index'
import { createNappletEnvironment, type NappletRuntimeLike } from '../nappletEnvironment'
import { createStaticEnvironment } from '../staticEnvironment'

const PUBKEY = 'a'.repeat(64)
const event = (over: Partial<RawEvent> = {}): RawEvent => ({
	kind: 30402,
	id: 'c'.repeat(64),
	pubkey: PUBKEY,
	created_at: 1_700_000_000,
	content: '',
	tags: [
		['d', 'widget'],
		['title', 'Widget'],
		['price', '40000', 'SATS'],
	],
	...over,
})

describe('static environment', () => {
	test('a successful read reports empty as a fact, not as a failure', async () => {
		const env = createStaticEnvironment({ events: [] })
		const result = await env.nostr.read([{ kinds: [30402], limit: 10 }])
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.empty).toBe(true)
	})

	test('a failure is a value with a reason, and carries no events', async () => {
		const env = createStaticEnvironment({ events: [event()], failWith: { ok: false, reason: 'timeout', detail: 'no answer' } })
		const result = await env.nostr.read([{ kinds: [30402] }])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.reason).toBe('timeout')
			expect(result.detail).toBe('no answer')
		}
	})

	test('filters by #d and by author, so a component can resolve one listing', async () => {
		const env = createStaticEnvironment({
			events: [
				event(),
				event({
					id: 'd'.repeat(64),
					tags: [
						['d', 'other'],
						['title', 'Other'],
						['price', '1', 'USD'],
					],
				}),
			],
		})
		const byD = await env.nostr.read([{ kinds: [30402], authors: [PUBKEY], '#d': ['widget'] }])
		expect(byD.ok && byD.events).toHaveLength(1)
	})

	test('the viewer config is readable through the environment', () => {
		const env = createStaticEnvironment({ events: [], config: { [CONFIG_KEYS.showNSFW]: 'true' } })
		expect(env.config.get(CONFIG_KEYS.showNSFW)).toBe('true')
		expect(env.config.get('missing.key')).toBeUndefined()
	})
})

describe('napplet environment — the third binding of the same interface', () => {
	const runtime = (over: Partial<NappletRuntimeLike> = {}): NappletRuntimeLike => ({
		outbox: { query: async () => [event()] },
		resource: { bytesAsObjectURL: async (url) => `blob:stub/${url.split('/').pop()}` },
		...over,
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

	test('KNOWN GAP (O1): config is synchronous in the interface and async in the sandbox, so it reads undefined', () => {
		// Recorded rather than hidden: a sandboxed surface must resolve the NSFW preference once at boot
		// and hold it, because it cannot ask the shell mid-render. See docs/DECISIONS.md O1.
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
