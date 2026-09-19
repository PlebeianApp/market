/**
 * Unit coverage for the bounded pending-event buffer used by the
 * validator subscriber for events that arrive before the state they
 * depend on (bid → auction, release → bid, settlement → auction).
 *
 * Review 5645059400 finding 1: the per-key cap alone left the total
 * footprint unbounded (attacker-chosen unknown auction ids each get
 * their own budget). Finding 3: the release/settlement buffers had no
 * caps at all. This pins the global key cap, the global event cap and
 * the TTL eviction that close both.
 */

import { describe, expect, test } from 'bun:test'
import { createPendingBuffer, createPendingBufferBudget, type PendingBufferLimits } from '../../server/auction-validator/pendingBuffer'

const limits = (overrides: Partial<PendingBufferLimits> = {}): PendingBufferLimits => ({
	maxPendingKeys: 100,
	maxPendingEventsPerKey: 100,
	maxPendingEvents: 100,
	pendingTtlSec: 100,
	...overrides,
})

describe('pending event buffer', () => {
	test('retains items per key up to the per-key limit', () => {
		const buffer = createPendingBuffer<string>(limits({ maxPendingEventsPerKey: 2 }))

		expect(buffer.add('key-a', 'first', 1_000)).toBe('buffered')
		expect(buffer.add('key-a', 'second', 1_000)).toBe('buffered')
		expect(buffer.add('key-a', 'third', 1_000)).toBe('key_full')

		expect(buffer.take('key-a', 1_000)).toEqual(['first', 'second'])
		expect(buffer.size()).toBe(0)
	})

	test('stops growing once the global distinct-key cap is reached', () => {
		const buffer = createPendingBuffer<string>(limits({ maxPendingKeys: 2 }))

		expect(buffer.add('key-a', 'a', 1_000)).toBe('buffered')
		expect(buffer.add('key-b', 'b', 1_000)).toBe('buffered')
		// Every fresh attacker-chosen id would previously add a key.
		expect(buffer.add('key-c', 'c', 1_000)).toBe('key_cap_reached')
		expect(buffer.add('key-d', 'd', 1_000)).toBe('key_cap_reached')

		expect(buffer.keyCount()).toBe(2)
		expect(buffer.size()).toBe(2)
	})

	test('still accepts more items for an already-tracked key at the key cap', () => {
		const buffer = createPendingBuffer<string>(limits({ maxPendingKeys: 1, maxPendingEventsPerKey: 2 }))

		expect(buffer.add('key-a', 'a', 1_000)).toBe('buffered')
		expect(buffer.add('key-b', 'b', 1_000)).toBe('key_cap_reached')
		expect(buffer.add('key-a', 'a2', 1_000)).toBe('buffered')

		expect(buffer.take('key-a', 1_000)).toEqual(['a', 'a2'])
	})

	test('stops growing once the global event cap is reached across keys', () => {
		const buffer = createPendingBuffer<string>(limits({ maxPendingKeys: 10, maxPendingEventsPerKey: 10, maxPendingEvents: 3 }))

		expect(buffer.add('key-a', 'a1', 1_000)).toBe('buffered')
		expect(buffer.add('key-a', 'a2', 1_000)).toBe('buffered')
		expect(buffer.add('key-b', 'b1', 1_000)).toBe('buffered')
		expect(buffer.add('key-b', 'b2', 1_000)).toBe('event_cap_reached')

		expect(buffer.size()).toBe(3)
	})

	test('evicts a key whose state never arrived within the TTL', () => {
		const buffer = createPendingBuffer<string>(limits({ pendingTtlSec: 100 }))

		expect(buffer.add('key-a', 'a', 1_000)).toBe('buffered')
		expect(buffer.keys(1_050)).toEqual(['key-a'])

		// Past the TTL the whole bucket is dropped, not just ignored.
		expect(buffer.keys(1_101)).toEqual([])
		expect(buffer.size()).toBe(0)
		expect(buffer.take('key-a', 1_101)).toEqual([])
		// The freed slot is reusable.
		expect(buffer.add('key-b', 'b', 1_101)).toBe('buffered')
	})

	test('measures the TTL from first sight of the key, not the latest item', () => {
		const buffer = createPendingBuffer<string>(limits({ pendingTtlSec: 100 }))

		expect(buffer.add('key-a', 'a', 1_000)).toBe('buffered')
		expect(buffer.add('key-a', 'late', 1_090)).toBe('buffered')

		// A late item must not extend the lifetime of the bucket — an
		// attacker could otherwise pin a key forever one item at a time.
		expect(buffer.keys(1_101)).toEqual([])
		expect(buffer.size()).toBe(0)
	})

	test('take() only drains the requested key', () => {
		const buffer = createPendingBuffer<string>(limits())

		buffer.add('key-a', 'a', 1_000)
		buffer.add('key-b', 'b', 1_000)

		expect(buffer.take('key-a', 1_000)).toEqual(['a'])
		expect(buffer.keys(1_000)).toEqual(['key-b'])
		expect(buffer.size()).toBe(1)
	})

	test('can share one global event budget across multiple buffers', () => {
		const budget = createPendingBufferBudget(3)
		const bids = createPendingBuffer<string>(limits({ maxPendingKeys: 10, maxPendingEventsPerKey: 10, maxPendingEvents: 3 }), budget)
		const releases = createPendingBuffer<string>(limits({ maxPendingKeys: 10, maxPendingEventsPerKey: 10, maxPendingEvents: 3 }), budget)

		expect(bids.add('auction-a', 'bid-a', 1_000)).toBe('buffered')
		expect(releases.add('bid-a', 'release-a', 1_000)).toBe('buffered')
		expect(releases.add('bid-b', 'release-b', 1_000)).toBe('buffered')
		expect(bids.add('auction-b', 'bid-b', 1_000)).toBe('event_cap_reached')
		expect(budget.size()).toBe(3)

		expect(releases.take('bid-a', 1_000)).toEqual(['release-a'])
		expect(bids.add('auction-b', 'bid-b', 1_000)).toBe('buffered')
		expect(budget.size()).toBe(3)
	})
})
