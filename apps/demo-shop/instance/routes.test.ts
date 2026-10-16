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
	ORDERS_PATH_PREFIX,
	PRODUCTS_PATH,
	apiCoordinatesFromProductPath,
	coordinatesFromProductPath,
	isPagePath,
	orderIdFromOrderPath,
	orderPath,
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

/**
 * The order address, held to the same contract as a listing's: **the id the checkout
 * mints is the id the URL carries**, and a prefix is not a child. The router is where a
 * placed order becomes addressable, so a mismatch here reads as "the order page shows
 * nothing" for an order the instance actually holds.
 *
 * The mutations that turn these red:
 * - `orderPath` emitting `/order/<id>` (singular): the round trip fails, and the ordering
 *   page the checkout redirects to is not a page route.
 * - `orderIdFromOrderPath` matching the bare prefix: `/orders/` answers a page for an
 *   order nobody named, which is the parent-route-swallows-its-child defect again.
 */
describe('a placed order’s address round-trips', () => {
	test('the path the checkout emits is the path the router parses', () => {
		expect(orderPath('order-ace933de')).toBe(`${ORDERS_PATH_PREFIX}order-ace933de`)
		expect(orderIdFromOrderPath(orderPath('order-ace933de'))).toBe('order-ace933de')
	})

	test('a bare prefix is not an order: a parent route must not swallow its child', () => {
		expect(orderIdFromOrderPath(ORDERS_PATH_PREFIX)).toBeNull()
		expect(orderIdFromOrderPath('/orders')).toBeNull()
		expect(orderIdFromOrderPath('/cart')).toBeNull()
		expect(orderIdFromOrderPath('/products/' + coordinates)).toBeNull()
		expect(isPagePath(ORDERS_PATH_PREFIX)).toBe(false)
		expect(isPagePath('/orders')).toBe(false)
	})

	test('an order address is a page route, and an id with a colon survives it', () => {
		expect(isPagePath(orderPath('order-ace933de'))).toBe(true)
		expect(orderIdFromOrderPath(orderPath('order:1/2'))).toBe('order:1/2')
	})
})
