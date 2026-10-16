import { describe, expect, test } from 'bun:test'
import { isPaymentCompleted, parseOrderAddress } from './orderDetail'

describe('parseOrderAddress', () => {
	test('reads name, street, city, state, zip and country', () => {
		expect(parseOrderAddress('Satoshi, 1 Main St, Austin, TX, 78701, USA')).toEqual({
			name: 'Satoshi',
			street: '1 Main St',
			city: 'Austin',
			state: 'TX',
			zip: '78701',
			country: 'USA',
		})
	})

	test('returns null without separators', () => {
		expect(parseOrderAddress('single line')).toBeNull()
	})
})

describe('isPaymentCompleted', () => {
	const request = { pubkey: 'seller', tags: [['amount', '1000']] }

	test('matches a receipt for the same recipient within 2 sats', () => {
		const receipt = {
			pubkey: 'buyer',
			tags: [
				['order', 'o1'],
				['amount', '998'],
				['p', 'seller'],
				['payment', 'lightning', 'lnbc'],
			],
		}
		expect(isPaymentCompleted(request, [receipt])).toBe(true)
	})

	test('ignores receipts for another recipient', () => {
		const receipt = {
			pubkey: 'buyer',
			tags: [
				['order', 'o1'],
				['amount', '1000'],
				['p', 'other'],
				['payment', 'lightning', 'lnbc'],
			],
		}
		expect(isPaymentCompleted(request, [receipt])).toBe(false)
	})
})
