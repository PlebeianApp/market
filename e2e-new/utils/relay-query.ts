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

function compareRelayEventsDesc(a: RelayEvent, b: RelayEvent): number {
	const byCreatedAt = (b.created_at || 0) - (a.created_at || 0)
	if (byCreatedAt !== 0) return byCreatedAt
	if (a.id < b.id) return 1
	if (a.id > b.id) return -1
	return 0
}

export async function waitForLatestCartSnapshotToBeEmpty(opts: {
	pubkey: string
	timeoutMs?: number
	pollMs?: number
}): Promise<RelayEvent> {
	const { pubkey, timeoutMs = 10_000, pollMs = 200 } = opts
	const startedAt = Date.now()

	while (Date.now() - startedAt < timeoutMs) {
		const events = await queryRelayEvents({
			authors: [pubkey],
			kinds: [30078],
			'#d': ['plebeian-market-cart'],
			limit: 20,
		})

		const latest = [...events].sort(compareRelayEventsDesc)[0]
		if (latest) {
			try {
				const parsed = JSON.parse(latest.content) as { items?: unknown }
				if (Array.isArray(parsed.items) && parsed.items.length === 0) {
					return latest
				}
			} catch {
				// Ignore malformed events and keep polling until timeout.
			}
		}

		await new Promise((resolve) => setTimeout(resolve, pollMs))
	}

	throw new Error(`Timed out waiting for empty remote cart snapshot for pubkey ${pubkey}`)
}
