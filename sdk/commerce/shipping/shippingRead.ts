import type { NostrEventLike } from '../../core/nostr/eventLike'
import { readThroughStore, type EventReadContext } from '../../core/event-store/read'
import { SHIPPING_OPTION_KIND } from './shippingWorkflow'

export interface ShippingOptionListQuery {
	author?: string
	limit?: number
}

/** Current, non-deleted kind-30406 options, newest first. */
export function readShippingOptionsWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	query: ShippingOptionListQuery,
): Promise<E[]> {
	return readThroughStore(context, [
		{
			kinds: [SHIPPING_OPTION_KIND],
			...(query.author && { authors: [query.author] }),
			...(query.limit !== undefined && { limit: query.limit }),
		},
	])
}
