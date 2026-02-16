/**
 * Utility for querying Nostr events directly from the relay.
 * Used in e2e tests to verify that order events, payment receipts,
 * and other protocol events were published correctly.
 */

import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import type { Filter } from 'nostr-tools/filter'
import WebSocket from 'ws'
import { RELAY_URL } from '../test-config'

useWebSocketImplementation(WebSocket)

export interface RelayEvent {
	id: string
	pubkey: string
	kind: number
	tags: string[][]
	content: string
	created_at: number
	sig: string
}

/**
 * Query events from the local relay matching the given filter.
 * Connects, subscribes until EOSE, and disconnects for each call.
 */
export async function queryRelayEvents(filter: Filter): Promise<RelayEvent[]> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		return await new Promise<RelayEvent[]>((resolve) => {
			const events: RelayEvent[] = []
			const sub = relay.subscribe([filter], {
				onevent(event) {
					events.push(event as unknown as RelayEvent)
				},
				oneose() {
					sub.close()
					resolve(events)
				},
			})
			// Timeout safety — resolve with whatever we have after 10s
			setTimeout(() => {
				sub.close()
				resolve(events)
			}, 10_000)
		})
	} finally {
		relay.close()
	}
}

/** Helper: find a tag value by name in an event's tags */
export function getTagValue(event: RelayEvent, tagName: string): string | undefined {
	const tag = event.tags.find((t) => t[0] === tagName)
	return tag?.[1]
}

/** Helper: filter events by a specific tag name and value */
export function filterByTag(events: RelayEvent[], tagName: string, tagValue: string): RelayEvent[] {
	return events.filter((e) => e.tags.some((t) => t[0] === tagName && t[1] === tagValue))
}
