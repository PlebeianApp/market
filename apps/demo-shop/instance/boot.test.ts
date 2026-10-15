/**
 * boot.test.ts — the instance boots, with every edge supplied.
 *
 * "Boots" here means the four things `bootInstance` does and nothing else:
 * resolve this instance's config, choose a product edge, read it, compose the
 * view. Each of the four is asserted on its own, and the two cases that could
 * reach a network (a configured relay set) are driven with an injected transport.
 *
 * The mutations that turn these red:
 * - `resolveProductSource` ignoring `options.source`: the injected source's kind
 *   and its empty result stop coming back.
 * - moving the `config.relayUrls.length === 0` branch: with no relays configured
 *   the boot tries a live read, `captured` stays empty and the case fails.
 * - dropping `now` from `resolveInstanceConfig`'s result: the id/name/currency
 *   assertions fail.
 */

import { describe, expect, test } from 'bun:test'
import { of } from 'rxjs'

import type { Event as NostrEvent } from '@sdk/core/nostr-io/ts/index'
import type { ProductReadEvent } from '@sdk/commerce/discovery'

import { bootInstance, resolveProductSource } from './boot'
import { resolveInstanceConfig } from './config'
import { type InjectedPool, type ProductSource } from './productSource'

const captured: { relays: string[] }[] = []

/** A transport with no socket behind it. Empty event stream is enough for boot. */
function emptyPool(): InjectedPool {
	return {
		request(relays) {
			captured.push({ relays })
			return of(...([] as unknown as NostrEvent[]))
		},
		subscribe() {
			throw new Error('boot must not subscribe')
		},
		async publish() {
			return []
		},
		async count() {
			return { count: 0, approximate: true }
		},
		status() {
			return []
		},
		close() {
			// nothing is open
		},
	}
}

describe('instance config resolves from an injected environment', () => {
	test('defaults are this instance’s own, and relays default to none', () => {
		expect(resolveInstanceConfig({})).toEqual({
			instanceId: 'demo-shop',
			displayName: 'Demo Shop',
			displayCurrency: 'BTC',
			relayUrls: [],
		})
	})

	test('an operator can name the instance and its relays; blanks are dropped', () => {
		const config = resolveInstanceConfig({
			DEMO_SHOP_INSTANCE_ID: ' shop-two ',
			DEMO_SHOP_NAME: 'Shop Two',
			DEMO_SHOP_CURRENCY: 'USD',
			DEMO_SHOP_RELAYS: 'wss://a.test, ,wss://b.test',
		})

		expect(config).toEqual({ instanceId: 'shop-two', displayName: 'Shop Two', displayCurrency: 'USD', relayUrls: ['wss://a.test', 'wss://b.test'] })
	})
})

describe('the instance boots', () => {
	test('with no relays configured it serves its own catalog, and reaches nothing', async () => {
		const runtime = await bootInstance({ env: {}, now: () => 1_760_000_000_000 })

		expect(runtime.sourceKind).toBe('fixture')
		expect(runtime.loadedAtMs).toBe(1_760_000_000_000)
		expect(runtime.view.items).toHaveLength(5)
		expect(runtime.view.summaryLine).toBe('5 listings · 1 not on sale')
	})

	test('an injected source wins, and its kind is reported', async () => {
		const injected: ProductSource = { kind: 'relay', async listProducts() { return [] } }
		const runtime = await bootInstance({ source: injected })

		expect(runtime.sourceKind).toBe('relay')
		expect(runtime.view.items).toEqual([])
		expect(runtime.view.summaryLine).toBe('0 listings')
	})

	test('a configured relay set composes the SDK seam over the injected transport', async () => {
		captured.length = 0
		const runtime = await bootInstance({ env: { DEMO_SHOP_RELAYS: 'wss://relay.boot.test' }, pool: emptyPool() })

		expect(runtime.sourceKind).toBe('relay')
		expect(runtime.config.relayUrls).toEqual(['wss://relay.boot.test'])
		expect(captured).toHaveLength(1)
		expect(captured[0]?.relays[0]).toContain('relay.boot.test')
		expect(runtime.view.items).toEqual([])
	})

	test('view options reach the read model', async () => {
		const runtime = await bootInstance({ env: {}, view: { exclude: 'mug' } })

		expect(runtime.view.items.map((item) => item.id)).not.toContain('ceramic-mug')
	})
})

describe('edge selection', () => {
	test('an injected source always wins over the configured relay set', () => {
		const injected: ProductSource = { kind: 'fixture', async listProducts() { return [] } }
		const config = resolveInstanceConfig({ DEMO_SHOP_RELAYS: 'wss://relay.boot.test' })

		expect(resolveProductSource(config, { source: injected })).toBe(injected)
	})

	test('a source built from an empty relay set never reads a relay', async () => {
		const source = resolveProductSource(resolveInstanceConfig({}))
		const items: ProductReadEvent[] = await source.listProducts()

		expect(source.kind).toBe('fixture')
		expect(items).toHaveLength(6)
	})
})