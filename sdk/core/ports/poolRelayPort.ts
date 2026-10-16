import { createNostrIo } from '../nostr-io/ts'
import type { Event, FilterIn, PoolPort } from '../nostr-io/ts/types'
import type { NostrRelayPort } from './nostrRelay'

/**
 * `NostrRelayPort` over the nostr-io seam: each call gets a policy that answers with exactly the
 * relays the caller named, so the port never widens egress. The pool is shared and never closed here.
 */
export function createPoolRelayPort(pool: PoolPort, options: { deadlineMs?: number } = {}): NostrRelayPort<Event> {
	const seamFor = (relayUrls: readonly string[]) => createNostrIo({ pool, policy: () => relayUrls })
	const asFilters = (filters: unknown) => (Array.isArray(filters) ? filters : [filters]) as FilterIn[]

	return {
		fetchEvents: async (filters, relayUrls) => {
			if (relayUrls.length === 0) return []
			const result = await seamFor(relayUrls).query(asFilters(filters), { deadlineMs: options.deadlineMs })
			return result.events
		},
		subscribe: (filters, onEvent, relayUrls) => {
			if (relayUrls.length === 0) return () => {}
			const subscription = seamFor(relayUrls).subscribe(asFilters(filters))
			const listener = subscription.events.subscribe(onEvent)
			return () => {
				listener.unsubscribe()
				subscription.unsubscribe()
			}
		},
		publish: async (event, relayUrls) => {
			if (relayUrls.length === 0) return { acceptedRelays: [] }
			const outcome = await seamFor(relayUrls).publish(event)
			return { acceptedRelays: outcome.acks.filter((ack) => ack.accepted).map((ack) => ack.url) }
		},
	}
}
