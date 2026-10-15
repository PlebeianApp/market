/**
 * heads.ts — M3, the module's single head rule.
 *
 * Replaceable and addressable kinds resolve to **one head per address**: the
 * greater `created_at`, ties broken by the lexicographically **lower** `id`, and
 * arrival order never decides. Owning this once is the store's job; the market
 * re-implements it by hand today (`src/lib/nostr/ndk-events.ts:26-31`, at the
 * pin) and a duplicated bid is read as proof reuse.
 *
 * The group key is `getEventUID`, so the rule covers every event: a regular
 * event's UID is its id, which makes it a group of one.
 */
import { getEventUID } from './view'
import type { Event } from './types'

/**
 * #76a7a3 — compareVersions: the module's ordering, negative when `a` is the winner of the two.
 *
 * The module's ordering, and the only one it has: negative when `a` is the
 * winner of the two. It is used twice — to pick a head, and to order a read
 * (descending `created_at`, ties by ascending `id`) — so the two can never
 * disagree.
 */
export function compareVersions(a: Event, b: Event): number {
	if (a.created_at !== b.created_at) return b.created_at - a.created_at
	if (a.id === b.id) return 0
	return a.id < b.id ? -1 : 1
}

/**
 * #76a7a3 — collapseToHeads: one event per `getEventUID`, the winner by `compareVersions`.
 *
 * One event per `getEventUID`, the winner by `compareVersions`. A single pass
 * whose whole decision is the guard below: the input's order therefore cannot
 * decide, which is the property the increment's second M3 case falsifies.
 */
export function collapseToHeads(events: Event[]): Event[] {
	const groups = new Map<string, Event>()
	for (const event of events) {
		const uid = getEventUID(event)
		const existing = groups.get(uid)
		if (!existing || compareVersions(event, existing) < 0) groups.set(uid, event)
	}
	return [...groups.values()]
}
