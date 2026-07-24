import { describe, expect, test } from 'bun:test'
import { buildPublishedShippingOption } from '@/publish/shipping'
import { parseShippingReference } from '@/queries/shipping'

describe('published shipping option identity', () => {
	test('derives canonical shippingRef from mutation result identity', () => {
		expect(buildPublishedShippingOption('event-123', 'merchant-pubkey', 'shipping_abc')).toEqual({
			eventId: 'event-123',
			shippingDTag: 'shipping_abc',
			shippingRef: '30406:merchant-pubkey:shipping_abc',
		})
	})
})

describe('shared shipping reference parsing', () => {
	test('parses canonical coordinates by splitting only the first two separators and preserving the full remainder as the d-tag', () => {
		const parsed = parseShippingReference(`30406:${'a'.repeat(64)}:shipping:with:colons`)
		expect(parsed).toEqual({
			kind: 30406,
			pubkey: 'a'.repeat(64),
			dTag: 'shipping:with:colons',
		})
	})

	test('accepts a legacy direct event-id path only when it is a validated 64-hex identifier', () => {
		expect(parseShippingReference('a'.repeat(64))).toEqual({
			kind: undefined,
			pubkey: undefined,
			dTag: undefined,
			id: 'a'.repeat(64),
		})
	})
})
