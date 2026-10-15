/**
 * deletions.ts — M9's kind-5 predicate, the module's only one.
 *
 * A NIP-09 deletion is **author-scoped and durable**: it is honoured only when
 * the kind-5 event's author is the deleted event's author, it is not restored by
 * a later fill, and it never removes a newer version of the address (the
 * boundary is the delete event's own `created_at`).
 *
 * It is deliberately the module's own predicate rather than the library's
 * `DeleteManager`: a kind-5 event is **not** routed through the library's
 * `EventStore.add` (that would register the library's own delete manager — two
 * implementations of one predicate), it is written straight to the store's
 * database. A local `delete(ref)` is something else entirely: temporary,
 * restorable, and recorded nowhere here.
 */
import type { Event } from './types'
import { createReplaceableAddress, getReplaceableIdentifier } from './view'

/** One kind-5 event, reduced to what a deletion actually decides. */
interface DeletionEntry {
	/** The kind-5 event's author: a deletion binds only its own author's events. */
	author: string
	/** The `e` tags: event ids. */
	ids: string[]
	/** The `a` tags: `kind:pubkey[:d]` coordinates. */
	addresses: string[]
	/** The kind-5 event's `created_at`: a deletion binds events at or before it. */
	until: number
}

/** #337e0c — DeletionIndex: the module's deletion index, one implementation, fed by the local write only. */
export interface DeletionIndex {
	/** Record one kind-5 event; returns how many references it carried. */
	add(kind5: Event): number
	/** Is this event deleted by any kind-5 event its own author published? */
	isDeleted(event: Event): boolean
}

/** An event id on an `e` tag: 64 lower-case hex characters. */
const EVENT_ID = /^[0-9a-f]{64}$/

/**
 * #337e0c — createDeletionIndex: the kind-5 predicate, as an index whose entries are walked per question.
 *
 * The kind-5 predicate, as an index whose entries are walked per question. The
 * index holds no timer and prunes nothing: durability is the store's, and a
 * snapshot of it is a host's concern (Q9's timer is N3's).
 */
export function createDeletionIndex(): DeletionIndex {
	const entries: DeletionEntry[] = []

	return {
		add(kind5: Event): number {
			const ids: string[] = []
			const addresses: string[] = []
			for (const tag of kind5.tags) {
				const value = tag[1]
				if (typeof value !== 'string' || value.length === 0) continue
				if (tag[0] === 'e' && EVENT_ID.test(value)) ids.push(value)
				if (tag[0] === 'a') addresses.push(value)
			}
			entries.push({ author: kind5.pubkey, ids, addresses, until: kind5.created_at })
			return ids.length + addresses.length
		},

		isDeleted(event: Event): boolean {
			// The addressable coordinate, and the legacy `kind:pubkey` form of it: the
			// library's spelling of a replaceable address with no `d` ends in a colon
			// and the market's own `deduplicationKey()` does not. Both are matched, and
			// nothing else is normalised.
			const coordinate = createReplaceableAddress(event.kind, event.pubkey, getReplaceableIdentifier(event))
			const legacy = coordinate.endsWith(':') ? coordinate.slice(0, -1) : coordinate
			for (const entry of entries) {
				if (entry.author !== event.pubkey) continue
				const byId = entry.ids.includes(event.id)
				const byAddress = entry.addresses.includes(coordinate) || entry.addresses.includes(legacy)
				if ((byId || byAddress) && event.created_at <= entry.until) return true
			}
			return false
		},
	}
}
