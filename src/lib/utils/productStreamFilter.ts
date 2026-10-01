import { isValidHexKey } from '@/lib/utils'

export interface ProductStreamFilterInput {
	/** Maximum number of products to request. */
	limit?: number
	/** Optional `t` tag to narrow the stream. */
	tag?: string
	/** Optional authors to narrow the stream (e.g. one seller's profile). */
	authors?: string[]
}

/**
 * Filter for the streaming product subscription.
 *
 * `authors` is validated, not trusted: a malformed pubkey would otherwise be
 * sent to every relay, and — worse — an empty array would be *omitted* by some
 * serialisers and a filter with no author constraint matches every author on the
 * relay. Filtering here means an unresolved seller streams nothing rather than
 * streaming the whole marketplace.
 */
export function buildProductStreamFilter({ limit = 500, tag, authors }: ProductStreamFilterInput = {}) {
	const validAuthors = (authors ?? []).filter((author) => isValidHexKey(author))

	return {
		kinds: [30402],
		limit,
		...(tag ? { '#t': [tag] } : {}),
		...(validAuthors.length > 0 ? { authors: validAuthors } : {}),
	}
}
