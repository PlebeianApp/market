import { describe, expect, test } from 'bun:test'
import { buildPublishedShippingOption } from '@/publish/shipping'

describe('published shipping option identity', () => {
	test('derives canonical shippingRef from mutation result identity', () => {
		expect(buildPublishedShippingOption('event-123', 'merchant-pubkey', 'shipping_abc')).toEqual({
			eventId: 'event-123',
			shippingDTag: 'shipping_abc',
			shippingRef: '30406:merchant-pubkey:shipping_abc',
		})
	})
})
