import { isValidHexKey } from '@/lib/utils'

export interface ProductStreamFilterInput {
	/** Maximum number of products to request. */
	limit?: number
	/** Optional `t` tag to narrow the stream. */
	tag?: string
	/**
	 * Optional authors to narrow the stream (e.g. one seller's profile).
	 *
	 * Passing this field means *author scoping is required*: if no entry is a
	 * valid pubkey the result is `null` and the caller must not subscribe.
	 * Omitting the field means the caller wants an unscoped stream (the feed).
	 */
	authors?: string[]
}

/**
 * Filter for the streaming product subscription, or `null` when the caller asked
 * for author scoping that cannot be satisfied.
 *
 * What an omitted `authors` key means on the wire is the whole reason this
 * function distinguishes the cases: a filter with no author constraint matches
 * *every* author the relay holds. So
 *
 *   - `authors: undefined` → unscoped stream (the feed, deliberate),
 *   - `authors: [validPubkey]` → that seller's products only,
 *   - `authors: []`, `['nope']` → `null`: never a marketplace-wide filter.
 *
 * Without the third case, a profile page that renders before its pubkey has
 * resolved asks for one seller and receives every seller's products — which is
 * worse than showing nothing, because the products are labelled as hers.
 */
export function buildProductStreamFilter({ limit = 500, tag, authors }: ProductStreamFilterInput = {}): {
	kinds: number[]
	limit: number
	'#t'?: string[]
	authors?: string[]
} | null {
	const scope = tag ? { '#t': [tag] } : {}

	if (authors === undefined) {
		return { kinds: [30402], limit, ...scope }
	}

	const validAuthors = authors.filter((author) => isValidHexKey(author))
	if (validAuthors.length === 0) return null

	return { kinds: [30402], limit, ...scope, authors: validAuthors }
}

/**
 * Whether every relay the subscription was sent to has reported end-of-stored-events.
 *
 * The library's own `eose` event is NOT this: it fires early by design when at
 * least two relays have answered and half of them have (`eoseReceived` in
 * @nostr-dev-kit/ndk, `hasSeenAllEoses` vs its 2-relay/50% fallback), so a
 * subset that holds none of the requested data can produce an `eose` while the
 * relays that do hold it are still answering. Counting the relays we asked
 * against the relays that have answered is the only way to know.
 */
export function allRelaysAnswered(asked: number, seen: number): boolean {
	return asked > 0 && seen >= asked
}

/**
 * How a product stream ended. `eose` means every relay we asked has reported
 * what it holds; the others are not answers about the seller.
 */
export type ProductStreamEnd = 'eose' | 'close' | 'timeout'

/**
 * Whether a stream that ended this way is conclusive about the seller.
 *
 * The same rule the one-shot read enforces via `requireEose`: a relay dropping
 * the subscription, or our own deadline expiring, tells us nothing about
 * whether products exist. Rendering "No products found" on those ends is how a
 * slow relay produces a false statement about a merchant.
 */
export function isConclusiveEnd(end: ProductStreamEnd, sawEose: boolean): boolean {
	return end === 'eose' || sawEose
}
