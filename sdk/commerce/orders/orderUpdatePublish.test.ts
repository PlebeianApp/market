import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../../core/testing/publishContext'
import { publishOrderStatusUpdateWorkflow, publishShippingStatusUpdateWorkflow, resolveOrderCounterparty } from './orderUpdatePublish'

const order = {
	id: 'order-event',
	pubkey: 'buyer',
	tags: [
		['p', 'seller'],
		['order', 'order-123'],
	],
}

function contextFor(actor: string, found = true) {
	const { context, published } = createTestPublishContext(actor)
	return { context: { ...context, loadOrder: async () => (found ? order : null) }, published }
}

describe('order update workflows', () => {
	test('the counterparty is the seller for the buyer and the buyer for anyone else', () => {
		expect(resolveOrderCounterparty(order, 'buyer')).toBe('seller')
		expect(resolveOrderCounterparty(order, 'seller')).toBe('buyer')
	})

	test('status updates go to the counterparty with the original order id and optional tracking', async () => {
		const { context, published } = contextFor('seller')
		await publishOrderStatusUpdateWorkflow(context, { orderEventId: 'order-event', status: 'confirmed', tracking: 'TRK1' })
		expect(published[0].content).toBe('Order status updated to confirmed')
		expect(published[0].tags).toEqual([
			['p', 'buyer'],
			['subject', 'order-info'],
			['type', '3'],
			['order', 'order-123'],
			['status', 'confirmed'],
			['tracking', 'TRK1'],
		])
	})

	test('shipping updates keep shipping status separate and include carrier details', async () => {
		const { context, published } = contextFor('seller')
		await publishShippingStatusUpdateWorkflow(context, { orderEventId: 'order-event', status: 'shipped', carrier: 'DHL', eta: 1700 })
		expect(published[0].content).toBe('Shipping status updated to shipped')
		expect(published[0].tags).toContainEqual(['subject', 'shipping-info'])
		expect(published[0].tags).toContainEqual(['carrier', 'DHL'])
		expect(published[0].tags).toContainEqual(['eta', '1700'])
	})

	test('nothing is published when the original order cannot be loaded', async () => {
		const { context, published } = contextFor('seller', false)
		await expect(publishOrderStatusUpdateWorkflow(context, { orderEventId: 'x', status: 'cancelled' })).rejects.toThrow(
			'Original order not found',
		)
		expect(published).toHaveLength(0)
	})
})
