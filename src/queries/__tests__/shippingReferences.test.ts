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
	test('round-trips canonical coordinates with colons in the d-tag', () => {
		const reference = `30406:${'a'.repeat(64)}:zone:europe:express`
		const parsed = parseShippingReference(reference)
		expect(parsed).toEqual({
			kind: 30406,
			pubkey: 'a'.repeat(64),
			dTag: 'zone:europe:express',
		})
		expect(`30406:${parsed.pubkey}:${parsed.dTag}`).toBe(reference)
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
