/**
 * cartState.test.ts — the browser's cart, read through the SDK's cart surface,
 * with no browser and no storage of its own.
 *
 * The storage port is the injection point, so every case runs against a
 * two-line fake that hands back a string. Nothing here touches `window` and
 * nothing reaches a service (ADR-0005); the SDK's parser is what decides whether
 * a record is a cart at all, which is the property these cases hold.
 *
 * The mutations that turn these cases red:
 * - calling `JSON.parse` instead of `parseCartPersistenceContent`: a record the
 *   SDK refuses (a wrong version, a malformed ref) stops being dropped.
 * - deleting the `stored === null` branch: an empty storage throws where a
 *   `Cart` is required.
 * - returning `cart.lines.length` from `cartCount`: a line of quantity 3 counts
 *   as 1.
 * - taking the `d` as everything after the FIRST colon in `splitProductRef`: the
 *   seller pubkey and the id swap places, so the line's id becomes the pubkey.
 * - dropping the `if (!parts) continue` guard: a ref the SDK's format cannot be
 *   split by yields a line with an empty id instead of being dropped.
 */

import { describe, expect, test } from 'bun:test'

import { CART_PERSISTENCE_VERSION, type PersistedCartContent } from '@sdk/commerce/cart'

import { CART_STORAGE_KEY, cartCount, EMPTY_CART, readCart, splitProductRef, type CartStorage } from './cartState'
import { DEMO_SELLER_PUBKEY } from './catalog'

/** The whole storage port, in two lines. */
function storageWith(value: string | null): CartStorage {
	return { read: () => value }
}

const ref = (id: string) => `30402:${DEMO_SELLER_PUBKEY}:${id}`

function payload(items: PersistedCartContent['items']): string {
	return JSON.stringify({ version: CART_PERSISTENCE_VERSION, updatedAt: 1_760_000_000, items })
}

describe('the storage key follows the SDK’s persistence version', () => {
	test('a record written for one version is never read by another', () => {
		expect(CART_STORAGE_KEY).toBe(`demo-shop.cart.v${CART_PERSISTENCE_VERSION}`)
		expect(CART_STORAGE_KEY).toBe('demo-shop.cart.v1')
	})
})

describe('reading the cart', () => {
	test('nothing stored yet is the empty cart, not an error', () => {
		expect(readCart(storageWith(null))).toEqual(EMPTY_CART)
		expect(cartCount(readCart(storageWith(null)))).toBe(0)
	})

	test('a record the SDK’s parser accepts comes back as its lines', () => {
		const stored = payload([
			{ productRef: ref('wool-coat'), quantity: 3, shippingRef: undefined },
			{ productRef: ref('field-notebook'), quantity: 1, shippingRef: undefined },
		])

		const cart = readCart(storageWith(stored))

		expect(cart.lines.map((line) => line.id)).toEqual(['wool-coat', 'field-notebook'])
		expect(cart.lines.map((line) => line.sellerPubkey)).toEqual([DEMO_SELLER_PUBKEY, DEMO_SELLER_PUBKEY])
		expect(cart.lines.map((line) => line.productRef)).toEqual([ref('wool-coat'), ref('field-notebook')])
		expect(cartCount(cart)).toBe(4)
	})

	test('a record the SDK refuses is dropped whole, never repaired', () => {
		const wrongVersion = JSON.stringify({ version: 99, updatedAt: 1, items: [{ productRef: ref('wool-coat'), quantity: 1 }] })
		const badRef = payload([{ productRef: 'wool-coat', quantity: 1, shippingRef: undefined }])
		const notJson = 'not json at all'

		expect(readCart(storageWith(wrongVersion))).toEqual(EMPTY_CART)
		expect(readCart(storageWith(badRef))).toEqual(EMPTY_CART)
		expect(readCart(storageWith(notJson))).toEqual(EMPTY_CART)
	})

	test('a line the format cannot be split by is dropped, not rendered half-built', () => {
		// The parser accepts any `30402:<64 hex>:<no spaces>`; a ref with no second
		// colon is the one shape the split cannot answer for.
		expect(splitProductRef('30402:only-two-parts')).toBeNull()
		expect(splitProductRef('wool-coat')).toBeNull()
	})

	test('the split reads the SDK’s own format, and keeps colons inside the d', () => {
		expect(splitProductRef(ref('wool-coat'))).toEqual({ sellerPubkey: DEMO_SELLER_PUBKEY, id: 'wool-coat' })
		expect(splitProductRef(`30402:${DEMO_SELLER_PUBKEY}:a:b`)).toEqual({ sellerPubkey: DEMO_SELLER_PUBKEY, id: 'a:b' })
	})
})
