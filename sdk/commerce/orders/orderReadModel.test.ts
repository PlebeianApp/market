import { describe, expect, test } from 'bun:test'
import { getOrderRecipientPubkey } from './orderReadModel'

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
})
