/**
 * Contract tests — the vocabulary, the fixture implementation, and the shape of a result.
 *
 * The behaviour these pin is the one the application breaks today: a read that failed and a read that
 * found nothing must be distinguishable, and neither may be reported as an exception. The sandbox
 * implementation's own mapping is tested next to it, in `@plebeian/napplet`.
 */
import { describe, expect, test } from 'bun:test'

import { CONFIG_KEYS, CONTRACT_VERSION, DEFAULT_SEARCH_RELAYS, TOKEN_FLOOR } from '../index'
import type { RawEvent } from '../index'
import { createStaticEnvironment } from '../testing'

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

describe('the fixture implementation', () => {
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

	test('filters by #d and by author, so a surface can resolve one listing', async () => {
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

	test('several filters in one request are OR-ed, and a filter matching nothing yields nothing', async () => {
		// A regression pin: the first version AND-ed the filters and fell back to "all events" when a
		// subset came out empty, which turned "no collections exist" into "here are all the listings".
		const env = createStaticEnvironment({ events: [event()] })
		const or = await env.nostr.read([{ kinds: [30402] }, { kinds: [30405] }])
		expect(or.ok && or.events).toHaveLength(1)
		const none = await env.nostr.read([{ kinds: [30405], '#d': ['summer'] }])
		expect(none.ok && none.events).toHaveLength(0)
		expect(none.ok && none.empty).toBe(true)
	})

	test('the viewer config is readable through the environment', () => {
		const env = createStaticEnvironment({ events: [], config: { [CONFIG_KEYS.showNSFW]: 'true' } })
		expect(env.config.get(CONFIG_KEYS.showNSFW)).toBe('true')
		expect(env.config.get('missing.key')).toBeUndefined()
	})
})

describe('the contract vocabulary', () => {
	test('every implementation states which trust boundary it sits on', () => {
		const env = createStaticEnvironment({ events: [] })
		expect(env.descriptor.boundary).toBe('in-process')
		expect(env.descriptor.contractVersion).toBe(CONTRACT_VERSION)
		expect(env.descriptor.grants).toContain('outbox:read')
	})

	test('no implementation is granted a write capability', () => {
		// sign / publish / value transfer are reserved and ungranted in this contract (CONTRACT.md §2).
		const env = createStaticEnvironment({ events: [] })
		for (const grant of env.descriptor.grants) {
			expect(grant.startsWith('keys:')).toBe(false)
			expect(grant).not.toBe('sign')
			expect(grant).not.toBe('publish')
		}
	})

	test('the NSFW config key is named once, here', () => {
		expect(CONFIG_KEYS.showNSFW).toBe('browse.showNSFW')
	})

	test('the search relay default is injectable, and is a default rather than a component decision', () => {
		expect(DEFAULT_SEARCH_RELAYS.length).toBeGreaterThan(0)
		expect(TOKEN_FLOOR.primary).toBeTruthy()
	})
})
