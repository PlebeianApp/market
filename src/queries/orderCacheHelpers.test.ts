import { describe, expect, test } from 'bun:test'

import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

import type { OrderWithRelatedEvents } from './orders'
import { injectOrderEventIntoCache } from './orderCacheHelpers'

// --- Test fixtures ---

function makeEvent(overrides: Partial<NDKEvent> = {}): NDKEvent {
	return {
		id: 'evt-1',
		kind: ORDER_PROCESS_KIND,
		created_at: 100,
		content: '',
		tags: [],
		pubkey: 'buyer-pubkey',
		...overrides,
	} as NDKEvent
}

function makeOrder(orderId: string, overrides: Partial<OrderWithRelatedEvents> = {}): OrderWithRelatedEvents {
	return {
		order: makeEvent({
			id: 'order-event-1',
			tags: [
				['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
				['order', orderId],
				['p', 'seller-pubkey'],
			],
		}),
		paymentRequests: [],
		statusUpdates: [],
		shippingUpdates: [],
		generalMessages: [],
		paymentReceipts: [],
		...overrides,
	}
}

// --- Tests ---

describe('injectOrderEventIntoCache', () => {
	test('returns null/undefined unchanged', () => {
		expect(injectOrderEventIntoCache(null, makeEvent())).toBeNull()
		expect(injectOrderEventIntoCache(undefined, makeEvent())).toBeUndefined()
	})

	test('injects a status update event into a single order and updates latestStatus', () => {
		const order = makeOrder('order-uuid-1')
		const statusUpdate = makeEvent({
			id: 'status-evt-1',
			kind: ORDER_PROCESS_KIND,
			created_at: 200,
			tags: [
				['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
				['order', 'order-uuid-1'],
				['status', 'completed'],
			],
		})

		const result = injectOrderEventIntoCache(order, statusUpdate) as OrderWithRelatedEvents

		expect(result.statusUpdates).toHaveLength(1)
		expect(result.statusUpdates[0].id).toBe('status-evt-1')
		expect(result.latestStatus?.id).toBe('status-evt-1')
	})

	test('injects a shipping update event and updates latestShipping', () => {
		const order = makeOrder('order-uuid-1')
		const shippingUpdate = makeEvent({
			id: 'ship-evt-1',
			kind: ORDER_PROCESS_KIND,
			created_at: 200,
			tags: [
				['type', ORDER_MESSAGE_TYPE.SHIPPING_UPDATE],
				['order', 'order-uuid-1'],
				['status', 'shipped'],
			],
		})

		const result = injectOrderEventIntoCache(order, shippingUpdate) as OrderWithRelatedEvents

		expect(result.shippingUpdates).toHaveLength(1)
		expect(result.shippingUpdates[0].id).toBe('ship-evt-1')
		expect(result.latestShipping?.id).toBe('ship-evt-1')
	})

	test('injects a payment receipt event (kind 17) and updates latestPaymentReceipt', () => {
		const order = makeOrder('order-uuid-1')
		const receipt = makeEvent({
			id: 'receipt-evt-1',
			kind: PAYMENT_RECEIPT_KIND,
			created_at: 200,
			tags: [
				['order', 'order-uuid-1'],
				['payment', 'lightning', 'lnbc...', 'preimage'],
			],
		})

		const result = injectOrderEventIntoCache(order, receipt) as OrderWithRelatedEvents

		expect(result.paymentReceipts).toHaveLength(1)
		expect(result.paymentReceipts[0].id).toBe('receipt-evt-1')
		expect(result.latestPaymentReceipt?.id).toBe('receipt-evt-1')
	})

	test('injects into the correct order in an array (list query)', () => {
		const orderA = makeOrder('order-uuid-a')
		const orderB = makeOrder('order-uuid-b')
		const statusUpdate = makeEvent({
			id: 'status-evt-1',
			kind: ORDER_PROCESS_KIND,
			tags: [
				['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
				['order', 'order-uuid-b'],
				['status', 'completed'],
			],
		})

		const result = injectOrderEventIntoCache([orderA, orderB], statusUpdate) as OrderWithRelatedEvents[]

		expect(result).toHaveLength(2)
		expect(result[0].statusUpdates).toHaveLength(0) // orderA unchanged
		expect(result[1].statusUpdates).toHaveLength(1) // orderB updated
		expect(result[1].latestStatus?.id).toBe('status-evt-1')
	})

	test('does not duplicate events already present (idempotent)', () => {
		const existingEvent = makeEvent({
			id: 'status-evt-1',
			kind: ORDER_PROCESS_KIND,
			tags: [
				['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
				['order', 'order-uuid-1'],
				['status', 'completed'],
			],
		})
		const order = makeOrder('order-uuid-1', { statusUpdates: [existingEvent], latestStatus: existingEvent })

		const result = injectOrderEventIntoCache(order, existingEvent) as OrderWithRelatedEvents

		expect(result.statusUpdates).toHaveLength(1)
	})

	test('preserves existing events when prepending new one', () => {
		const oldEvent = makeEvent({
			id: 'old-status',
			kind: ORDER_PROCESS_KIND,
			created_at: 100,
			tags: [
				['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
				['order', 'order-uuid-1'],
				['status', 'processing'],
			],
		})
		const order = makeOrder('order-uuid-1', { statusUpdates: [oldEvent], latestStatus: oldEvent })
		const newEvent = makeEvent({
			id: 'new-status',
			kind: ORDER_PROCESS_KIND,
			created_at: 200,
			tags: [
				['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
				['order', 'order-uuid-1'],
				['status', 'completed'],
			],
		})

		const result = injectOrderEventIntoCache(order, newEvent) as OrderWithRelatedEvents

		expect(result.statusUpdates).toHaveLength(2)
		expect(result.statusUpdates[0].id).toBe('new-status') // new event prepended
		expect(result.statusUpdates[1].id).toBe('old-status')
		expect(result.latestStatus?.id).toBe('new-status')
	})

	test('matches order by event id when order tag differs', () => {
		// Some events reference the order by event id rather than UUID
		const order = makeOrder('order-uuid-1')
		order.order.id = 'abc123'
		const statusUpdate = makeEvent({
			id: 'status-evt-1',
			kind: ORDER_PROCESS_KIND,
			tags: [
				['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
				['order', 'abc123'], // references by event id
				['status', 'completed'],
			],
		})

		const result = injectOrderEventIntoCache(order, statusUpdate) as OrderWithRelatedEvents

		expect(result.statusUpdates).toHaveLength(1)
	})

	test('does not modify non-matching orders', () => {
		const order = makeOrder('order-uuid-1')
		const statusUpdate = makeEvent({
			id: 'status-evt-1',
			kind: ORDER_PROCESS_KIND,
			tags: [
				['type', ORDER_MESSAGE_TYPE.STATUS_UPDATE],
				['order', 'different-order-uuid'],
				['status', 'completed'],
			],
		})

		const result = injectOrderEventIntoCache(order, statusUpdate) as OrderWithRelatedEvents

		expect(result.statusUpdates).toHaveLength(0)
		expect(result).toBe(order) // same reference, unchanged
	})
})
