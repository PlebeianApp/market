import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '../nostr/eventLike'
import { createMemoryEventStore } from './memoryEventStore'

let counter = 0
const event = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: 'seller',
	kind: 1,
	created_at: 100,
	content: '',
	tags: [],
	...overrides,
})

const product = (createdAt: number, d = 'mug', overrides: Partial<NostrEventLike> = {}) =>
	event({ kind: 30402, created_at: createdAt, tags: [['d', d]], ...overrides })

describe('createMemoryEventStore', () => {
	test('keeps only the latest version of an addressable event', () => {
		const store = createMemoryEventStore()
		const v1 = product(100)
		const v2 = product(200)

		expect(store.add(v1)).toEqual({ status: 'added' })
		expect(store.add(v2)).toEqual({ status: 'added' })
		expect(store.add(product(150))).toEqual({ status: 'superseded' })
		expect(store.getReplaceable(30402, 'seller', 'mug')?.id).toBe(v2.id)
		expect(store.get(v1.id)).toBeUndefined()
		expect(store.query({ kinds: [30402] })).toHaveLength(1)
	})

	test('rejects duplicates by id', () => {
		const store = createMemoryEventStore()
		const note = event({})
		store.add(note)
		expect(store.add(note)).toEqual({ status: 'duplicate' })
	})

	test('coordinate deletions remove older versions but allow newer republishes', () => {
		const store = createMemoryEventStore()
		const v1 = product(100)
		store.add(v1)

		store.add(event({ kind: 5, created_at: 150, tags: [['a', '30402:seller:mug']] }))
		expect(store.getReplaceable(30402, 'seller', 'mug')).toBeUndefined()
		expect(store.add(product(120))).toEqual({ status: 'deleted' })

		const republished = product(200)
		expect(store.add(republished)).toEqual({ status: 'added' })
		expect(store.getReplaceable(30402, 'seller', 'mug')?.id).toBe(republished.id)
	})

	test('ignores deletion requests from other authors', () => {
		const store = createMemoryEventStore()
		const v1 = product(100)
		store.add(v1)
		store.add(
			event({
				kind: 5,
				pubkey: 'attacker',
				created_at: 150,
				tags: [
					['e', v1.id],
					['a', '30402:seller:mug'],
				],
			}),
		)
		expect(store.get(v1.id)).toBeDefined()
	})

	test('deletes regular events by id', () => {
		const store = createMemoryEventStore()
		const note = event({ kind: 1 })
		store.add(note)
		store.add(event({ kind: 5, created_at: 200, tags: [['e', note.id]] }))
		expect(store.get(note.id)).toBeUndefined()
		expect(store.isDeleted(note)).toBe(true)
	})

	test('admission rejects events the kind parser refuses', () => {
		const store = createMemoryEventStore({
			admission: { 30402: (candidate) => (candidate.tags.some((tag) => tag[0] === 'price') ? true : 'missing price tag') },
		})
		expect(store.add(product(100))).toEqual({ status: 'rejected', reason: 'missing price tag' })
		expect(
			store.add(
				product(100, 'priced', {
					tags: [
						['d', 'priced'],
						['price', '10', 'SATS'],
					],
				}),
			),
		).toEqual({ status: 'added' })
	})

	test('queries by tag, author and limit, newest first', () => {
		const store = createMemoryEventStore()
		store.add(event({ kind: 1, created_at: 1, tags: [['t', 'bitcoin']] }))
		const newest = event({ kind: 1, created_at: 3, tags: [['t', 'bitcoin']] })
		store.add(newest)
		store.add(event({ kind: 1, created_at: 2, tags: [['t', 'nostr']] }))

		const result = store.query({ kinds: [1], '#t': ['bitcoin'], limit: 1 })
		expect(result.map((e) => e.id)).toEqual([newest.id])
	})

	test('subscribers hear events that become current', () => {
		const store = createMemoryEventStore()
		const heard: string[] = []
		const unsubscribe = store.subscribe({ kinds: [30402] }, (e) => heard.push(e.id))

		const v1 = product(100)
		store.add(v1)
		store.add(product(50))
		unsubscribe()
		store.add(product(300))

		expect(heard).toEqual([v1.id])
	})
})
