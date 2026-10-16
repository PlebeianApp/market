import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '../core/nostr/eventLike'
import { matchesFilter, type EventFilter } from '../core/event-store/filter'
import { createMemoryEventStore } from '../core/event-store/memoryEventStore'
import type { EventReadContext } from '../core/event-store/read'
import { readCollectionsWorkflow } from './collections/collectionRead'
import { readPaymentDetailEventsWorkflow } from './payments/paymentDetailRead'
import { readShippingOptionsWorkflow } from './shipping/shippingRead'

let counter = 0
const event = (kind: number, dTag: string, overrides: Partial<NostrEventLike> = {}): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: 'seller',
	kind,
	created_at: 100,
	content: '',
	tags: [['d', dTag]],
	...overrides,
})

function createContext(relayEvents: NostrEventLike[]): EventReadContext & { requests: EventFilter[][] } {
	const requests: EventFilter[][] = []
	return {
		requests,
		store: createMemoryEventStore(),
		fetch: async (filters) => {
			requests.push([...filters])
			return relayEvents.filter((candidate) => filters.some((filter) => matchesFilter(candidate, filter)))
		},
	}
}

const deletionOf = (coordinate: string) => event(5, '', { created_at: 200, tags: [['a', coordinate]] })

describe('commerce read workflows', () => {
	test('shipping options drop author-deleted options', async () => {
		const context = createContext([event(30406, 'post'), event(30406, 'courier'), deletionOf('30406:seller:post')])
		const result = await readShippingOptionsWorkflow(context, { author: 'seller' })

		expect(result.map((e) => e.tags[0][1])).toEqual(['courier'])
	})

	test('collections exclude the featured-products curation list and deleted collections', async () => {
		const context = createContext([
			event(30405, 'summer'),
			event(30405, 'featured_products'),
			event(30405, 'old'),
			deletionOf('30405:seller:old'),
		])
		const result = await readCollectionsWorkflow(context, { limit: 50 })

		expect(result.map((e) => e.tags[0][1])).toEqual(['summer'])
	})

	test('payment details keep the latest labelled version per d-tag', async () => {
		const label = ['l', 'payment_detail']
		const context = createContext([
			event(30078, 'ln', { tags: [['d', 'ln'], label], created_at: 100 }),
			event(30078, 'ln', { tags: [['d', 'ln'], label], created_at: 150 }),
			event(30078, 'cart', { tags: [['d', 'cart']] }),
		])
		const result = await readPaymentDetailEventsWorkflow(context, { author: 'seller' })

		expect(result).toHaveLength(1)
		expect(result[0].created_at).toBe(150)
		expect(context.requests[0]).toEqual([{ kinds: [30078], '#l': ['payment_detail'], authors: ['seller'] }])
	})
})
