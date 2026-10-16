import type { NostrEventLike } from '../nostr/eventLike'
import type { EventFilter } from './filter'
import { DELETION_REQUEST_KIND, getReplaceableKey, isAddressableKind } from './mergeRules'
import type { EventStorePort } from './port'

/**
 * Host-bound read dependencies. `fetch` already carries the host's relay policy
 * (targets, timeout); the store is the instance-scoped cache every read merges into.
 */
export interface EventReadContext<E extends NostrEventLike = NostrEventLike> {
	fetch(filters: readonly EventFilter[]): Promise<E[]>
	store: EventStorePort<E>
}

/** NIP-09 lookups for the given events, scoped to their authors. */
export function buildDeletionLookupFilters(events: readonly NostrEventLike[]): EventFilter[] {
	if (events.length === 0) return []
	const authors = [...new Set(events.map((event) => event.pubkey))]
	const coordinates = [...new Set(events.filter((event) => isAddressableKind(event.kind)).map((event) => getReplaceableKey(event)!))]
	const ids = events.filter((event) => !isAddressableKind(event.kind)).map((event) => event.id)

	const filters: EventFilter[] = []
	if (coordinates.length > 0) filters.push({ kinds: [DELETION_REQUEST_KIND], authors, '#a': coordinates })
	if (ids.length > 0) filters.push({ kinds: [DELETION_REQUEST_KIND], authors, '#e': ids })
	return filters
}

async function addDeletionsFor<E extends NostrEventLike>(context: EventReadContext<E>, events: readonly E[]): Promise<void> {
	const filters = buildDeletionLookupFilters(events)
	if (filters.length === 0) return
	for (const deletion of await context.fetch(filters)) context.store.add(deletion)
}

/**
 * Discovery read: fetch, look up deletions for what came back, merge both into the store,
 * then answer from the store so superseded and deleted versions never surface.
 */
export async function readThroughStore<E extends NostrEventLike>(
	context: EventReadContext<E>,
	filters: readonly EventFilter[],
): Promise<E[]> {
	const fetched = await context.fetch(filters)
	for (const event of fetched) context.store.add(event)
	await addDeletionsFor(context, fetched)
	return context.store.query(filters)
}

/** Drops events deleted by their author; for lists assembled outside a single filter (e.g. collection members). */
export async function excludeDeleted<E extends NostrEventLike>(context: EventReadContext<E>, events: readonly E[]): Promise<E[]> {
	for (const event of events) context.store.add(event)
	await addDeletionsFor(context, events)
	return events.filter((event) => !context.store.isDeleted(event))
}
