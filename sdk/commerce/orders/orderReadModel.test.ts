import { describe, expect, test } from 'bun:test'
import { getOrderAmountSats, getOrderRecipientPubkey, getOrderReference } from './orderReadModel'

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
})
