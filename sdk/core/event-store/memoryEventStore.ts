import type { NostrEventLike } from '../nostr/eventLike'
import { matchesFilter, selectMatching, type EventFilter } from './filter'
import {
	DELETION_REQUEST_KIND,
	getReplaceableKey,
	isDeletedBy,
	isNewerVersion,
	readDeletionTargets,
	type DeletionTargets,
} from './mergeRules'
import type { EventAdmission, EventStoreAddResult, EventStorePort } from './port'

export interface MemoryEventStoreOptions<E extends NostrEventLike> {
	/** Per-kind parsers; kinds without an entry are admitted as-is. */
	admission?: Partial<Record<number, EventAdmission<E>>>
}

/** Reference `EventStorePort`: no I/O, no persistence, no shared state between instances. */
export function createMemoryEventStore<E extends NostrEventLike = NostrEventLike>(
	options: MemoryEventStoreOptions<E> = {},
): EventStorePort<E> {
	const byId = new Map<string, E>()
	const latestByKey = new Map<string, E>()
	const deletions: DeletionTargets[] = []
	const listeners = new Set<{ filters: readonly EventFilter[]; listener: (event: E) => void }>()

	const isDeleted = (event: E) => deletions.some((deletion) => isDeletedBy(event, deletion))

	const removeDeleted = (deletion: DeletionTargets) => {
		for (const [id, event] of byId) {
			if (!isDeletedBy(event, deletion)) continue
			byId.delete(id)
			const key = getReplaceableKey(event)
			if (key && latestByKey.get(key)?.id === id) latestByKey.delete(key)
		}
	}

	const notify = (event: E) => {
		for (const { filters, listener } of listeners) {
			if (filters.some((filter) => matchesFilter(event, filter))) listener(event)
		}
	}

	const add = (event: E): EventStoreAddResult => {
		if (byId.has(event.id)) return { status: 'duplicate' }

		const admit = options.admission?.[event.kind]
		const verdict = admit ? admit(event) : true
		if (verdict !== true) return { status: 'rejected', reason: verdict }

		if (event.kind === DELETION_REQUEST_KIND) {
			const deletion = readDeletionTargets(event)
			deletions.push(deletion)
			removeDeleted(deletion)
		} else if (isDeleted(event)) {
			return { status: 'deleted' }
		}

		const key = getReplaceableKey(event)
		if (key) {
			const current = latestByKey.get(key)
			if (current && !isNewerVersion(event, current)) return { status: 'superseded' }
			if (current) byId.delete(current.id)
			latestByKey.set(key, event)
		}

		byId.set(event.id, event)
		notify(event)
		return { status: 'added' }
	}

	return {
		add,
		get: (id) => byId.get(id),
		getReplaceable: (kind, pubkey, d) => latestByKey.get(d === undefined ? `${kind}:${pubkey}` : `${kind}:${pubkey}:${d}`),
		query: (filters) => selectMatching(byId.values(), filters),
		subscribe: (filters, listener) => {
			const entry = { filters: Array.isArray(filters) ? filters : [filters as EventFilter], listener }
			listeners.add(entry)
			return () => listeners.delete(entry)
		},
		isDeleted,
	}
}
