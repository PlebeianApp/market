import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readThroughStore, type EventReadContext } from '../../core/event-store/read'
import { CURATION_LISTS } from '../curation/curationLists'
import { COLLECTION_EVENT_KIND } from './collectionEvent'

export interface CollectionListQuery {
	author?: string
	limit: number
}

/** The featured-products list shares kind 30405 but is app curation, not a seller collection. */
export function isSellerCollection(event: Pick<NostrEventLike, 'tags'>): boolean {
	return event.tags.find((tag) => tag[0] === 'd')?.[1] !== CURATION_LISTS.featuredProducts.dTag
}

/** Current, non-deleted seller collections, newest first. */
export async function readCollectionsWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	query: CollectionListQuery,
): Promise<E[]> {
	const events = await readThroughStore(context, [
		{ kinds: [COLLECTION_EVENT_KIND], limit: query.limit, ...(query.author && { authors: [query.author] }) },
	])
	return events.filter(isSellerCollection)
}
