/**
 * Bounded pending-event buffer.
 *
 * The subscriber buffers events that arrive before the state they
 * depend on (a bid before its auction, a path release before its bid,
 * a settlement before its auction) and replays them when that state
 * lands. Those buffers are fed straight from the relay, so the events
 * are attacker-chosen: their keys are attacker-chosen ids that may
 * never resolve.
 *
 * A per-key cap alone does not bound the footprint — an attacker who
 * invents a new unknown auction id per bid gets a fresh per-key budget
 * every time (review 5645059400, finding 1), and the release/settlement
 * buffers previously had no caps at all (finding 3). Three bounds are
 * enforced here, on top of the per-key cap:
 *
 *   - `maxPendingKeys`    — distinct keys retained across the buffer.
 *   - `maxPendingEvents`  — buffered items retained across the buffer.
 *   - `pendingTtlSec`     — a key whose state never arrives is evicted
 *                           outright, measured from FIRST sight of the
 *                           key so a slow trickle of items cannot pin
 *                           it forever.
 *
 * Eviction is fail-closed: a dropped buffered event is simply never
 * replayed, so the validator issues no verdict for it (it never
 * condemns a bid it failed to observe).
 */

export interface PendingBufferLimits {
	/** Maximum number of distinct keys retained in one buffer. */
	maxPendingKeys: number
	/** Maximum number of items retained per key. */
	maxPendingEventsPerKey: number
	/** Maximum number of items retained across the shared pending budget. */
	maxPendingEvents: number
	/** Seconds after which a key that never resolved is evicted. */
	pendingTtlSec: number
}

export type PendingAdmission = 'buffered' | 'key_cap_reached' | 'key_full' | 'event_cap_reached'

export interface PendingBuffer<T> {
	/**
	 * Buffer `item` under `key`. `now` is the caller's clock and is the
	 * reference point for TTL eviction — for an event's first sighting
	 * this is the validator's observation time, never replay time.
	 */
	add: (key: string, item: T, now: number) => PendingAdmission
	/** Remove and return everything buffered under `key` (TTL-swept). */
	take: (key: string, now: number) => T[]
	/** Keys with at least one buffered item, after TTL eviction. */
	keys: (now: number) => string[]
	/**
	 * Number of buffered items across all keys. Keys past the TTL are
	 * only reclaimed on the next `add`/`take`/`keys` call, so this
	 * reflects the most recent sweep.
	 */
	size: () => number
	/** Number of distinct keys currently retained. */
	keyCount: () => number
}

interface PendingBucket<T> {
	items: T[]
	/** First sighting of this key — TTL is measured from here. */
	firstAddedAt: number
}

export interface PendingBufferBudget {
	tryReserve: (count: number) => boolean
	release: (count: number) => void
	size: () => number
	capacity: () => number
}

export const createPendingBufferBudget = (maxPendingEvents: number): PendingBufferBudget => {
	let reserved = 0
	return {
		tryReserve: (count: number) => {
			if (reserved + count > maxPendingEvents) return false
			reserved += count
			return true
		},
		release: (count: number) => {
			reserved = Math.max(0, reserved - count)
		},
		size: () => reserved,
		capacity: () => maxPendingEvents,
	}
}

export const createPendingBuffer = <T>(limits: PendingBufferLimits, budget = createPendingBufferBudget(limits.maxPendingEvents)): PendingBuffer<T> => {
	const buckets = new Map<string, PendingBucket<T>>()
	let itemCount = 0

	/** Drop every bucket whose first sighting is older than the TTL. */
	const sweep = (now: number): void => {
		for (const [key, bucket] of Array.from(buckets.entries())) {
			if (now - bucket.firstAddedAt <= limits.pendingTtlSec) continue
			itemCount -= bucket.items.length
			budget.release(bucket.items.length)
			buckets.delete(key)
		}
	}

	const add = (key: string, item: T, now: number): PendingAdmission => {
		sweep(now)

		const existing = buckets.get(key)
		if (existing) {
			if (existing.items.length >= limits.maxPendingEventsPerKey) return 'key_full'
			if (!budget.tryReserve(1)) return 'event_cap_reached'
			existing.items.push(item)
			itemCount += 1
			return 'buffered'
		}

		if (buckets.size >= limits.maxPendingKeys) return 'key_cap_reached'
		if (!budget.tryReserve(1)) return 'event_cap_reached'
		buckets.set(key, { items: [item], firstAddedAt: now })
		itemCount += 1
		return 'buffered'
	}

	const take = (key: string, now: number): T[] => {
		sweep(now)
		const bucket = buckets.get(key)
		if (!bucket) return []
		itemCount -= bucket.items.length
		budget.release(bucket.items.length)
		buckets.delete(key)
		return bucket.items
	}

	const keys = (now: number): string[] => {
		sweep(now)
		return Array.from(buckets.keys())
	}

	return { add, take, keys, size: () => itemCount, keyCount: () => buckets.size }
}
