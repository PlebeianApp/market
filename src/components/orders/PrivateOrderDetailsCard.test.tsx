import type { PrivateOrderDeliveryDetails } from '@/lib/orders/privateOrderMessage'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { describe, expect, test } from 'bun:test'
import { canViewPrivateOrderDetails, getPrivateOrderDetailsRows } from './PrivateOrderDetailsCard'

const SELLER_PUBKEY = 'a'.repeat(64)
const BUYER_PUBKEY = 'b'.repeat(64)
const OTHER_PUBKEY = 'c'.repeat(64)

function orderWithSeller(sellerPubkey = SELLER_PUBKEY): OrderWithRelatedEvents {
	return {
		order: {
			id: 'order-event',
			pubkey: BUYER_PUBKEY,
			tags: [
				['p', sellerPubkey],
				['order', 'order-123'],
				['address', '123 Main Street'],
				['email', 'public-leak@example.com'],
				['phone', '+15550000000'],
				['name', 'Public Name'],
			],
		} as NDKEvent,
		paymentRequests: [],
		statusUpdates: [],
		shippingUpdates: [],
		generalMessages: [],
		paymentReceipts: [],
	}
}

function privateDetails(overrides: Partial<PrivateOrderDeliveryDetails> = {}): PrivateOrderDeliveryDetails {
	return {
		orderId: 'order-123',
		buyerPubkey: BUYER_PUBKEY,
		sellerPubkey: SELLER_PUBKEY,
		totalAmountSats: 1000,
		items: [{ productRef: `30402:${SELLER_PUBKEY}:product`, quantity: 1 }],
		delivery: {},
		...overrides,
	}
}

describe('PrivateOrderDetailsCard helpers', () => {
	test('only allows the public order seller to view private details', () => {
		const order = orderWithSeller()

		expect(canViewPrivateOrderDetails(order, SELLER_PUBKEY)).toBe(true)
		expect(canViewPrivateOrderDetails(order, BUYER_PUBKEY)).toBe(false)
		expect(canViewPrivateOrderDetails(order, OTHER_PUBKEY)).toBe(false)
		expect(canViewPrivateOrderDetails(order, undefined)).toBe(false)
	})

	test('uses correlated private details instead of public order PII tags', () => {
		const rows = getPrivateOrderDetailsRows(
			privateDetails({
				delivery: {
					email: 'buyer@example.com',
				},
			}),
		)

		const serializedRows = JSON.stringify(rows)
		expect(serializedRows).toContain('buyer@example.com')
		expect(serializedRows).not.toContain('123 Main Street')
		expect(serializedRows).not.toContain('Public Name')
		expect(serializedRows).not.toContain('+15550000000')
		expect(serializedRows).not.toContain('public-leak@example.com')
	})

	test('digital delivery rows include email contact without phone, name, or address', () => {
		const rows = getPrivateOrderDetailsRows(
			privateDetails({
				delivery: {
					email: 'buyer@example.com',
				},
			}),
		)

		expect(rows).toEqual([{ label: 'Digital contact', value: 'buyer@example.com' }])
	})

	test('physical delivery rows include recipient, address, phone, and notes when present', () => {
		const rows = getPrivateOrderDetailsRows(
			privateDetails({
				delivery: {
					name: 'Satoshi Nakamoto',
					email: 'buyer@example.com',
					phone: '+15551234567',
					address: {
						firstLineOfAddress: '123 Main Street',
						additionalInformation: 'Apt Secret Notes',
						city: 'Los Angeles',
						zipPostcode: '90210',
						country: 'United States',
					},
				},
				orderNotes: 'Apt Secret Notes',
			}),
		)

		expect(rows).toContainEqual({ label: 'Digital contact', value: 'buyer@example.com' })
		expect(rows).toContainEqual({ label: 'Recipient', value: 'Satoshi Nakamoto' })
		expect(rows).toContainEqual({
			label: 'Address',
			value: '123 Main Street\nApt Secret Notes\nLos Angeles 90210\nUnited States',
		})
		expect(rows).toContainEqual({ label: 'Phone', value: '+15551234567' })
		expect(rows).toContainEqual({ label: 'Order notes', value: 'Apt Secret Notes' })
	})
})
