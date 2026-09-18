import { describe, expect, test } from 'bun:test'
import {
	PRODUCT_KIND,
	getProductNotificationScope,
	getSellerProductNotificationScope,
	registerSellerProductNotificationScope,
	type ProductScopeTag,
	type SellerProductScopeRegistry,
} from '../productNotificationScopes'

const createRegistry = (): SellerProductScopeRegistry => ({
	productKeyByEventId: new Map(),
	productKeyByCoordinate: new Map(),
	subscribedEventIds: new Set(),
	subscribedCoordinates: new Set(),
})

describe('seller product notification scopes', () => {
	test('registers coordinate and event scopes once, then adds only the replacement event id', () => {
		const registry = createRegistry()
		const subscriptions: Array<[ProductScopeTag, string]> = []
		const subscribe = (tagName: ProductScopeTag, value: string) => subscriptions.push([tagName, value])
		const coordinate = `${PRODUCT_KIND}:seller:product-a`

		const original = {
			id: 'event-1',
			kind: PRODUCT_KIND,
			pubkey: 'seller',
			tags: [['d', 'product-a']],
		}
		const replacement = {
			...original,
			id: 'event-2',
		}

		expect(registerSellerProductNotificationScope(original, 'seller', registry, subscribe)).toBe(coordinate)
		expect(registerSellerProductNotificationScope(original, 'seller', registry, subscribe)).toBe(coordinate)
		expect(registerSellerProductNotificationScope(replacement, 'seller', registry, subscribe)).toBe(coordinate)

		expect(registry.productKeyByEventId).toEqual(
			new Map([
				['event-1', coordinate],
				['event-2', coordinate],
			]),
		)
		expect(registry.productKeyByCoordinate).toEqual(new Map([[coordinate, coordinate]]))
		expect(subscriptions).toEqual([
			['#E', 'event-1'],
			['#a', coordinate],
			['#A', coordinate],
			['#E', 'event-2'],
		])
	})

	test('preserves an empty d value as the canonical trailing-colon coordinate', () => {
		const registry = createRegistry()
		const subscriptions: Array<[ProductScopeTag, string]> = []
		const event = {
			id: 'event-empty-d',
			kind: PRODUCT_KIND,
			pubkey: 'seller',
			tags: [['d', '']],
		}
		const coordinate = `${PRODUCT_KIND}:seller:`

		expect(getProductNotificationScope(event)).toEqual({
			eventId: 'event-empty-d',
			coordinate,
			productKey: coordinate,
		})
		expect(
			registerSellerProductNotificationScope(event, 'seller', registry, (tagName, value) => subscriptions.push([tagName, value])),
		).toBe(coordinate)
		expect(subscriptions).toEqual([
			['#E', 'event-empty-d'],
			['#a', coordinate],
			['#A', coordinate],
		])
	})

	test('rejects a product event without a d tag', () => {
		const registry = createRegistry()
		const subscriptions: Array<[ProductScopeTag, string]> = []
		const event = {
			id: 'event-without-d',
			kind: PRODUCT_KIND,
			pubkey: 'seller',
			tags: [['title', 'Product']],
		}

		expect(getProductNotificationScope(event)).toBeNull()
		expect(
			registerSellerProductNotificationScope(event, 'seller', registry, (tagName, value) => subscriptions.push([tagName, value])),
		).toBe('')
		expect(subscriptions).toEqual([])
		expect(registry.productKeyByEventId.size).toBe(0)
		expect(registry.productKeyByCoordinate.size).toBe(0)
	})

	test('rejects events outside the seller-authored kind-30402 boundary', () => {
		const registry = createRegistry()
		const subscriptions: Array<[ProductScopeTag, string]> = []
		const subscribe = (tagName: ProductScopeTag, value: string) => subscriptions.push([tagName, value])
		const event = {
			id: 'event-1',
			kind: PRODUCT_KIND,
			pubkey: 'seller',
			tags: [['d', 'product-a']],
		}

		expect(getSellerProductNotificationScope({ ...event, pubkey: 'other' }, 'seller')).toBeNull()
		expect(getSellerProductNotificationScope({ ...event, kind: 30408 }, 'seller')).toBeNull()
		expect(registerSellerProductNotificationScope({ ...event, pubkey: 'other' }, 'seller', registry, subscribe)).toBe('')
		expect(registerSellerProductNotificationScope({ ...event, kind: 30408 }, 'seller', registry, subscribe)).toBe('')
		expect(subscriptions).toEqual([])
		expect(registry.productKeyByEventId.size).toBe(0)
	})
})
