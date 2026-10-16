import { describe, expect, test } from 'bun:test'
import { getOrderAmountSats, getOrderItems, getOrderRecipientPubkey, getOrderReference, getOrderShippingReference } from './orderReadModel'

describe('order read model', () => {
	test('reads the recipient from the first p tag', () => {
		expect(
			getOrderRecipientPubkey({
				tags: [
					['p', 'seller-pubkey'],
					['p', 'another-pubkey'],
				],
			}),
		).toBe('seller-pubkey')
	})

	test('returns null when the order has no recipient tag', () => {
		expect(getOrderRecipientPubkey({ tags: [['order', 'order-id']] })).toBeNull()
		expect(getOrderRecipientPubkey(null)).toBeNull()
	})

	test('reads order reference and amount tags', () => {
		const order = {
			tags: [
				['order', 'order-id'],
				['amount', '2100'],
			],
		}
		expect(getOrderReference(order)).toBe('order-id')
		expect(getOrderAmountSats(order)).toBe('2100')
		expect(getOrderReference({ tags: [] })).toBeNull()
		expect(getOrderAmountSats(null)).toBeNull()
	})

	test('reads items with default quantity and the shipping reference', () => {
		const order = {
			tags: [
				['item', '30402:seller:mug', '2'],
				['item', '30402:seller:cup'],
				['shipping', '30406:seller:post'],
			],
		}
		expect(getOrderItems(order)).toEqual([
			{ productRef: '30402:seller:mug', quantity: 2 },
			{ productRef: '30402:seller:cup', quantity: 1 },
		])
		expect(getOrderShippingReference(order)).toBe('30406:seller:post')
		expect(getOrderItems(null)).toEqual([])
		expect(getOrderShippingReference({ tags: [] })).toBeNull()
	})
})
