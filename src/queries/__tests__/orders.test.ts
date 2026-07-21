import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { getAuctionCoordinatesFromOrder, isAuctionOrder } from '@/queries/orders'

// Mock NDKEvent for testing
const createMockOrderEvent = (tags: string[][]): NDKEvent => {
	return {
		tags,
		pubkey: 'test-pubkey',
		created_at: Math.floor(Date.now() / 1000),
		kind: 16,
		content: '',
	} as NDKEvent
}

describe('auctionOrders utilities', () => {
	describe('getAuctionCoordinatesFromOrder', () => {
		test('returns null for non-auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['item', '30402:seller-pubkey:product-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBeNull()
		})

		test('returns auction coordinates for valid auction orders', () => {
			const auctionCoords = '30408:seller-pubkey:auction-id'
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', auctionCoords],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBe(auctionCoords)
		})

		test('returns null for malformed auction coordinates', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', 'invalid-coords'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBeNull()
		})

		test('works with OrderWithRelatedEvents object', () => {
			const auctionCoords = '30408:seller-pubkey:auction-id'
			const orderEvent = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', auctionCoords],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			const orderWithRelatedEvents = {
				order: orderEvent,
				paymentRequests: [],
				paymentReceipts: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
			}

			expect(getAuctionCoordinatesFromOrder(orderWithRelatedEvents)).toBe(auctionCoords)
		})

		test('returns null for malformed auction coordinates with wrong kind', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', '304080:seller-pubkey:not-an-auction'], // Wrong kind
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(getAuctionCoordinatesFromOrder(order)).toBeNull()
		})
	})

	describe('isAuctionOrder', () => {
		test('returns false for non-auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['item', '30402:seller-pubkey:product-id', '1'],
			])

			expect(isAuctionOrder(order)).toBe(false)
		})

		test('returns true for valid auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', '30408:seller-pubkey:auction-id'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(isAuctionOrder(order)).toBe(true)
		})

		test('returns false for malformed auction orders', () => {
			const order = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', 'invalid-coords'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			expect(isAuctionOrder(order)).toBe(false)
		})

		test('works with OrderWithRelatedEvents object', () => {
			const orderEvent = createMockOrderEvent([
				['p', 'seller-pubkey'],
				['type', '1'],
				['order', 'order-id'],
				['amount', '1000'],
				['a', '30408:seller-pubkey:auction-id'],
				['item', '30408:seller-pubkey:auction-id', '1'],
			])

			const orderWithRelatedEvents = {
				order: orderEvent,
				paymentRequests: [],
				paymentReceipts: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
			}

			expect(isAuctionOrder(orderWithRelatedEvents)).toBe(true)
		})
	})
})
