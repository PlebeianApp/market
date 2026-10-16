import { describe, expect, test } from 'bun:test'
import { buildCartSnapshotFilter, parseCartSnapshotEvent } from './cartRead'
import { createCartIntent } from './cartIntent'
import { CART_PERSISTENCE_D_TAG, CART_PERSISTENCE_KIND } from './cartSnapshotPublish'

describe('cartRead', () => {
	test('builds the replaceable cart snapshot filter', () => {
		expect(buildCartSnapshotFilter('pk')).toEqual({
			kinds: [CART_PERSISTENCE_KIND],
			authors: ['pk'],
			'#d': [CART_PERSISTENCE_D_TAG],
			limit: 20,
		})
	})

	test('returns null for invalid snapshot content', () => {
		expect(parseCartSnapshotEvent({ content: 'nope' })).toBeNull()
		expect(parseCartSnapshotEvent({ content: '{}' })).toBeNull()
	})

	test('round-trips a cart intent', () => {
		const intent = createCartIntent([])
		expect(parseCartSnapshotEvent({ content: JSON.stringify(intent) })).toEqual(intent)
	})
})
