/**
 * productListView.test.ts — the composition rung, against the SDK's own rules.
 *
 * Every assertion here is about a rule the **SDK** owns: the addressable
 * identity, the newest-first ordering, the exclusion filter, the availability
 * rule, and each accessor. The app adds exactly two things of its own, and both
 * are asserted separately: the on-sale row rule and the price formatting.
 *
 * The mutations that turn these red:
 * - `buildProductListView`'s `sort: options.sort ?? 'newest'` → `'oldest'`: the
 *   ids come back reversed.
 * - deleting the `getProductVisibility(...) === 'hidden'` branch: `hiddenCount`
 *   becomes 0 and the list grows to 6 rows.
 * - deleting `groupThousands`: `'0.00185 BTC'` becomes `'0.00185 BTC'` for a
 *   small amount but `'185000 SATS'` for a large one — the formatting case.
 * - swapping `isProductInStock` for `stock > 0`: the `pre-order` mug flips to
 *   out of stock.
 */

import { describe, expect, test } from 'bun:test'

import type { ProductReadEvent } from '@sdk/commerce/discovery'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY } from './catalog'
import { buildProductListView, formatProductPrice, resolveProductPrice } from './productListView'

const catalog = buildCatalogEvents()

describe('the product list composes the SDK discovery read model', () => {
	test('orders newest first through the SDK’s search ordering', () => {
		const view = buildProductListView(catalog)

		// created_at descends: wool-coat 600, cast-iron-pan 500, linen-shirt 400, ceramic-mug 300, field-notebook 200.
		expect(view.items.map((item) => item.id)).toEqual(['wool-coat', 'cast-iron-pan', 'linen-shirt', 'ceramic-mug', 'field-notebook'])
	})

	test('drops a listing that is not on sale, and says how many it dropped', () => {
		const view = buildProductListView(catalog)

		expect(view.items.map((item) => item.id)).not.toContain('hidden-draft')
		expect(view.hiddenCount).toBe(1)
		expect(view.items).toHaveLength(catalog.length - 1)
		expect(view.summaryLine).toBe('5 listings · 1 not on sale')
	})

	test('carries the identity, price, availability and categories the SDK resolves', () => {
		const coat = buildProductListView(catalog).items[0]

		expect(coat?.coordinates).toBe(`30402:${DEMO_SELLER_PUBKEY}:wool-coat`)
		expect(coat?.title).toBe('Merino Wool Coat')
		expect(coat?.summary).toBe('Hand-finished, unlined, made to last a decade')
		expect(coat?.price).toEqual({ amount: '0.00185', currency: 'BTC', display: '0.00185 BTC' })
		expect(coat?.inStock).toBe(true)
		expect(coat?.stock).toBe(3)
		expect(coat?.visibility).toBe('on-sale')
		expect(coat?.categories).toEqual(['clothing', 'outerwear'])
		expect(coat?.sellerPubkey).toBe(DEMO_SELLER_PUBKEY)
		expect(coat?.imageUrl).toBe('https://example.test/merino-coat.png')
	})

	test('a listing with no stock is listed and marked out of stock, never hidden', () => {
		const shirt = buildProductListView(catalog).items.find((item) => item.id === 'linen-shirt')

		expect(shirt).toBeDefined()
		expect(shirt?.inStock).toBe(false)
		expect(shirt?.stock).toBe(0)
	})

	test('pre-order counts as available; a listing with no stock tag does not', () => {
		const view = buildProductListView(catalog)
		expect(view.items.find((item) => item.id === 'ceramic-mug')?.inStock).toBe(true)

		const noStockTag: ProductReadEvent = {
			pubkey: DEMO_SELLER_PUBKEY,
			created_at: 1_760_000_000,
			content: 'No stock tag',
			tags: [
				['d', 'no-stock'],
				['title', 'No Stock Tag'],
				['price', '0.00001', 'BTC'],
				['visibility', 'on-sale'],
			],
		}
		const single = buildProductListView([noStockTag])
		expect(single.items[0]?.inStock).toBe(false)
		expect(single.items[0]?.stock).toBeNull()
	})

	test('excludes by term through the SDK filter, not a local one', () => {
		const view = buildProductListView(catalog, { exclude: 'mug notebook' })

		expect(view.items.map((item) => item.id)).toEqual(['wool-coat', 'cast-iron-pan', 'linen-shirt'])
	})
})

describe('the app formats prices and never invents one', () => {
	test('groups thousands deterministically', () => {
		expect(formatProductPrice('185000', 'SATS')).toBe('185,000 SATS')
		expect(formatProductPrice('1200', 'SATS')).toBe('1,200 SATS')
		expect(formatProductPrice('999', 'SATS')).toBe('999 SATS')
		expect(formatProductPrice('0.00185', 'BTC')).toBe('0.00185 BTC')
	})

	test('leaves an amount it cannot group exactly as tagged', () => {
		expect(formatProductPrice('1e3', 'USD')).toBe('1e3 USD')
		expect(formatProductPrice('n/a', 'USD')).toBe('n/a USD')
	})

	test('a listing with no price tag resolves to null rather than a made-up price', () => {
		const noPrice: ProductReadEvent = { tags: [['d', 'x'], ['title', 'X']] }

		expect(resolveProductPrice(noPrice)).toBeNull()
		expect(resolveProductPrice({ tags: [['price', '1200', 'BTC']] })).toEqual({
			amount: '1200',
			currency: 'BTC',
			display: '1,200 BTC',
		})
	})
})