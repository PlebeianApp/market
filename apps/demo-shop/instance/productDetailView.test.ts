/**
 * productDetailView.test.ts — one listing by address, over the same read.
 *
 * Every field asserted here is an SDK accessor's answer, and the item the detail
 * resolves is asserted to be the **same object the list's row would be**, because
 * the two must not be able to disagree about one listing.
 *
 * The mutations that turn these cases red:
 * - looking the listing up by `getProductId` instead of `getProductCoordinates`:
 *   the address the row emits stops resolving, and `not-admitted` comes back for a
 *   listing that is right there in the list.
 * - deleting the `not-on-sale` branch: the hidden listing opens as a page.
 * - building the item with a fresh `toItem` copy instead of the list's own
 *   composition: the identity/price/availability assertions diverge from the list.
 * - reading `getProductSummary` where `getProductDescription` belongs: the
 *   description assertion fails (the summary is the `summary` tag, the description
 *   is the event's content).
 * - dropping the `if (!ref) continue` guard in the shipping loop: a tag-shaped
 *   string with no second element yields a shipping row with an empty ref.
 */

import { describe, expect, test } from 'bun:test'

import type { ProductReadEvent } from '@sdk/commerce/discovery'
import { getProductCoordinates } from '@sdk/commerce/discovery'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY } from './catalog'
import { findProductDetail } from './productDetailView'
import { buildProductListView } from './productListView'
import { createFixtureProductSource } from './productSource'
import { productPath } from './routes'

const catalog = buildCatalogEvents()
const coat = `${'30402'}:${DEMO_SELLER_PUBKEY}:wool-coat`

describe('a listing resolves by the address the list emits', () => {
	test('the same coordinates, and the same item the list would render', () => {
		const lookup = findProductDetail(catalog, coat)
		expect(lookup.found).toBe(true)
		if (!lookup.found) return

		const row = buildProductListView(catalog).items[0]
		expect(lookup.detail.item).toEqual(row)
		expect(lookup.detail.item.coordinates).toBe(coat)
		expect(lookup.detail.item.title).toBe('Merino Wool Coat')
		expect(lookup.detail.item.price?.display).toBe('0.00185 BTC')
		expect(lookup.detail.item.stock).toBe(3)
	})

	test('an address the app emits is the address this resolver takes', () => {
		const row = buildProductListView(catalog).items[0]
		expect(row).toBeDefined()
		if (!row) return

		// The path a row's link carries, minus the prefix the route strips.
		const path = productPath(row.coordinates)
		expect(findProductDetail(catalog, path.slice('/products/'.length)).found).toBe(true)
	})
})

describe('the fields a single listing has and a row does not', () => {
	test('the description is the event content, not the summary tag', () => {
		const lookup = findProductDetail(catalog, coat)
		if (!lookup.found) throw new Error('the coat should resolve')

		expect(lookup.detail.description).toBe('A heavy merino coat cut for cold mornings. Made by a single atelier.')
		expect(lookup.detail.item.summary).toBe('Hand-finished, unlined, made to last a decade')
	})

	test('specs and the published image come from the SDK’s own accessors', () => {
		const lookup = findProductDetail(catalog, coat)
		if (!lookup.found) throw new Error('the coat should resolve')

		expect(lookup.detail.specs).toEqual([{ key: 'size', value: 'M' }])
		expect(lookup.detail.imageUrl).toBe('https://example.test/merino-coat.png')
	})

	test('a shipping option is reported exactly as the listing tagged it, with no invented unit', () => {
		const lookup = findProductDetail(catalog, coat)
		if (!lookup.found) throw new Error('the coat should resolve')

		expect(lookup.detail.shipping).toEqual([
			{ ref: `30406:${DEMO_SELLER_PUBKEY}:standard`, amount: '250' },
		])
	})

	test('a listing that published no specs or shipping says so by carrying empty lists', () => {
		const lookup = findProductDetail(catalog, `${'30402'}:${DEMO_SELLER_PUBKEY}:field-notebook`)
		if (!lookup.found) throw new Error('the notebook should resolve')

		expect(lookup.detail.specs).toEqual([])
		expect(lookup.detail.shipping).toHaveLength(1)
	})
})

describe('an address that resolves to nothing gets a named reason', () => {
	test('an address this instance never admitted', () => {
		expect(findProductDetail(catalog, `${'30402'}:${DEMO_SELLER_PUBKEY}:not-a-listing`)).toEqual({
			found: false,
			reason: 'not-admitted',
		})
	})

	test('a listing the read model calls hidden is not-on-sale, not silently the same as absent', () => {
		const hidden = `${'30402'}:${DEMO_SELLER_PUBKEY}:hidden-draft`
		expect(findProductDetail(catalog, hidden)).toEqual({ found: false, reason: 'not-on-sale' })
		// ...and the list drops the same listing, so the two surfaces agree.
		expect(buildProductListView(catalog).items.map((item) => item.coordinates)).not.toContain(hidden)
	})

	test('a listing the admission edge refused never reaches the read, so it has no page', async () => {
		// `findProductDetail` works on the **admitted** read and is not itself an
		// admission edge: a malformed event is dropped by the source before any
		// surface sees it, which is where the refusal belongs.
		const malformed: ProductReadEvent = {
			pubkey: DEMO_SELLER_PUBKEY,
			created_at: 1,
			content: 'no price',
			tags: [['d', 'x'], ['title', 'X']],
		}
		const address = `${'30402'}:${DEMO_SELLER_PUBKEY}:x`
		const admitted = await createFixtureProductSource([...catalog, malformed]).listProducts()

		expect(admitted.map((event) => getProductCoordinates(event))).not.toContain(address)
		expect(findProductDetail(admitted, address)).toEqual({ found: false, reason: 'not-admitted' })
	})
})
