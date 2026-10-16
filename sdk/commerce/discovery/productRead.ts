import type { NostrEventLike } from '../../core/nostr/eventLike'
import type { EventFilter } from '../../core/event-store/filter'
import { excludeDeleted, readThroughStore, type EventReadContext } from '../../core/event-store/read'
import { isProductInStock } from './productAvailability'

const PRODUCT_LISTING_KIND = 30402

export interface ProductListQuery {
	limit: number
	tag?: string
	until?: number
	author?: string
}

export function buildProductListFilter(query: ProductListQuery): EventFilter {
	return {
		kinds: [PRODUCT_LISTING_KIND],
		limit: query.limit,
		...(query.author && { authors: [query.author] }),
		...(query.until && { until: query.until }),
		...(query.tag && { '#t': [query.tag] }),
	}
}

export type ProductListingVisibility = 'all' | 'not-hidden' | 'purchasable'

/** `not-hidden` drops `visibility=hidden`; `purchasable` also drops out-of-stock (pre-orders stay). */
export function isProductListed(event: Pick<NostrEventLike, 'tags'>, visibility: ProductListingVisibility): boolean {
	if (visibility === 'all') return true
	const tag = event.tags.find((t) => t[0] === 'visibility')?.[1] || 'on-sale'
	if (tag === 'hidden') return false
	return visibility === 'not-hidden' || isProductInStock(event)
}

/** Current, non-deleted listings for a discovery surface, newest first. */
export async function readProductListWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	query: ProductListQuery,
): Promise<E[]> {
	return readThroughStore(context, [buildProductListFilter(query)])
}

/** Listings resolved one by one (e.g. collection members), minus the ones their authors deleted. */
export function excludeDeletedProducts<E extends NostrEventLike>(context: EventReadContext<E>, products: readonly E[]): Promise<E[]> {
	return excludeDeleted(context, products)
}
