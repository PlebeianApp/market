import { describe, expect, test } from 'bun:test'
import { Observable, of } from 'rxjs'
import type { Event, FilterIn, PoolPort, RelayAck } from '../nostr-io/ts/types'
import { createPoolRelayPort } from './poolRelayPort'

const event = (id: string): Event => ({ id, pubkey: 'p', kind: 1, created_at: 1, content: '', tags: [], sig: 's' })

function createPool() {
	const calls: { op: string; relays: string[]; filters?: FilterIn[] }[] = []
	let subscriberCount = 0
	const pool: PoolPort = {
		request: (relays, filters) => {
			calls.push({ op: 'request', relays, filters })
			return of(event('a'), event('b'))
		},
		subscribe: (relays, filters) => {
			calls.push({ op: 'subscribe', relays, filters })
			return {
				events: new Observable<Event>((observer) => {
					subscriberCount++
					observer.next(event('live'))
					return () => subscriberCount--
				}),
				failures: new Observable(),
				eose: new Observable(),
				unsubscribe: () => {},
			}
		},
		publish: async (relays) => {
			calls.push({ op: 'publish', relays })
			return relays.map((url, index): RelayAck => ({ url, accepted: index === 0, reason: index === 0 ? undefined : 'rejected' }))
		},
		count: async () => ({ count: 0, approximate: false }),
		status: () => [],
		close: () => {
			throw new Error('the shared pool must never be closed by the port')
		},
	}
	return { pool, calls, live: () => subscriberCount }
}

describe('createPoolRelayPort', () => {
	test('reads from exactly the relays the caller names', async () => {
		const { pool, calls } = createPool()
		const events = await createPoolRelayPort(pool).fetchEvents({ kinds: [1] }, ['wss://a', 'wss://a', 'wss://b'])

		expect(events.map((e) => e.id)).toEqual(['a', 'b'])
		expect(calls[0]).toMatchObject({ op: 'request', relays: ['wss://a', 'wss://b'] })
	})

	test('makes no network call when no relays are named', async () => {
		const { pool, calls } = createPool()
		expect(await createPoolRelayPort(pool).fetchEvents({ kinds: [1] }, [])).toEqual([])
		expect(calls).toHaveLength(0)
	})

	test('reports only acknowledging relays as accepted', async () => {
		const { pool } = createPool()
		const result = await createPoolRelayPort(pool).publish(event('x'), ['wss://a', 'wss://b'])
		expect(result.acceptedRelays).toEqual(['wss://a'])
	})

	test('subscribe delivers events and its unsubscribe releases the stream', () => {
		const { pool, live } = createPool()
		const received: string[] = []
		const unsubscribe = createPoolRelayPort(pool).subscribe({ kinds: [1] }, (e) => received.push(e.id), ['wss://a'])

		expect(received).toEqual(['live'])
		expect(live()).toBe(1)
		unsubscribe()
		expect(live()).toBe(0)
	})
})
