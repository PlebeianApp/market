/**
 * routes.test.ts — the address contract: what a page emits and what the router
 * parses are one string.
 *
 * A link builder and a path parser can each be individually plausible and still
 * disagree, and the failure reads as "the link goes nowhere" — or worse, as
 * "the detail page shows the list", which is what a prefix-alone match produces.
 *
 * The mutations that turn these cases red:
 * - matching the prefix alone (`coordinatesFromProductPath` returning the whole
 *   path): the round trip still passes but the `/products/` case stops returning
 *   `null`, so the route would answer the list for it.
 * - dropping `decodeURIComponent`: a coordinate carrying a percent-encoded `:`
 *   comes back re-encoded and no longer equals the address that was emitted.
 * - `productPath` emitting `/product/<coords>` (singular): the round trip fails.
 * - `apiCoordinatesFromProductPath` matching `/api/products` itself rather than its
 *   children: the exact list endpoint would be answered as one listing's JSON.
 */

import { describe, expect, test } from 'bun:test'

import { DEMO_SELLER_PUBKEY } from './catalog'
import {
	API_PRODUCTS_PATH,
	PRODUCTS_PATH,
	apiCoordinatesFromProductPath,
	coordinatesFromProductPath,
	productPath,
} from './routes'

const coordinates = `30402:${DEMO_SELLER_PUBKEY}:wool-coat`

describe('a listing’s address round-trips', () => {
	test('the path the app emits is the path the router parses', () => {
		expect(productPath(coordinates)).toBe(`/products/${coordinates}`)
		expect(coordinatesFromProductPath(productPath(coordinates))).toBe(coordinates)
	})

	test('a coordinate whose d contains a colon survives the trip', () => {
		const odd = `30402:${DEMO_SELLER_PUBKEY}:a:b`
		expect(coordinatesFromProductPath(productPath(odd))).toBe(odd)
	})

	test('a percent-encoded address is decoded back to the coordinates', () => {
		expect(coordinatesFromProductPath(`/products/${encodeURIComponent(coordinates)}`)).toBe(coordinates)
	})
})

describe('the router matches exactly or not at all', () => {
	test('the list path is not a product path', () => {
		expect(coordinatesFromProductPath(PRODUCTS_PATH)).toBeNull()
	})

	test('the bare prefix is not a listing: a parent route must not swallow its child', () => {
		expect(coordinatesFromProductPath('/products/')).toBeNull()
		expect(coordinatesFromProductPath('/products')).toBeNull()
	})

	test('an unrelated path is not a product path', () => {
		expect(coordinatesFromProductPath('/cart')).toBeNull()
		expect(coordinatesFromProductPath('/products-elsewhere/x')).toBeNull()
	})
})

describe('the JSON twin takes the same coordinates', () => {
	test('one listing is answered under the API prefix', () => {
		expect(apiCoordinatesFromProductPath(`${API_PRODUCTS_PATH}/${coordinates}`)).toBe(coordinates)
	})

	test('the list endpoint itself is left to the list handler', () => {
		expect(apiCoordinatesFromProductPath(API_PRODUCTS_PATH)).toBeNull()
		expect(apiCoordinatesFromProductPath(`${API_PRODUCTS_PATH}/`)).toBeNull()
		expect(apiCoordinatesFromProductPath('/api/config')).toBeNull()
	})
})
