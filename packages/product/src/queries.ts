/**
 * `@plebeian/product` (`src/queries.ts`) — filter construction for NIP-99 listings.
 *
 * What this package is: pure code that describes **what to ask for**. It builds a filter — a plain
 * data object — and stops. It never executes a query, never touches a relay, never imports a relay
 * client, and has no notion of a host.
 *
 * Why that split matters: the same filter description is executed by the application (through the
 * port), by the CMS, and by a sandboxed napplet (through its runtime). If the filter builder
 * executed anything, the three targets could not share it.
 *
 * Filters are plain arrays/objects rather than a client-specific type, so this package has no
 * dependency beyond the product contract.
 */
import { PRODUCT_KIND } from './parse'

/**
 * The filter shape is owned by the **contract**, not by this module: it is how a module asks its host for
 * anything, so it must be one shape in every module and every implementation. Re-exported because a
 * consumer of these query builders needs it.
 */
export type { QueryFilter } from '@plebeian/contract'

/** The collection kind (Gamma). */
export const COLLECTION_KIND = 30405 as const

export interface Coordinate {
	kind: number
	pubkey: string
	dTag: string
}

/**
 * Parse `kind:pubkey:d` into its parts.
 *
 * Returns `null` rather than throwing: a reference read off a relay is untrusted, and the caller is
 * expected to record the problem rather than crash (browsing spec §3.4, "valid but unresolvable").
 * `d` may itself contain colons, so the tail is rejoined.
 */
export const parseCoordinate = (coordinate: string): Coordinate | null => {
	const parts = coordinate.split(':')
	if (parts.length < 3) return null
	const [kindRaw, pubkey, ...rest] = parts
	const kind = Number.parseInt(kindRaw ?? '', 10)
	const dTag = rest.join(':')
	if (!Number.isInteger(kind) || !/^[0-9a-f]{64}$/.test(pubkey ?? '') || dTag.length === 0) return null
	return { kind, pubkey, dTag }
}

// --- listing filters -------------------------------------------------------------------------

export interface FeedFilterOptions {
	limit?: number
	/** A `#t` category filter. */
	tag?: string
	/** Page backwards from this timestamp (pagination). */
	until?: number
}

/** The feed: newest listings first, optionally by category, optionally paginated. */
export const feedFilter = ({ limit = 500, tag, until }: FeedFilterOptions = {}): QueryFilter => ({
	kinds: [PRODUCT_KIND],
	limit,
	...(tag ? { '#t': [tag] } : {}),
	...(until !== undefined ? { until } : {}),
})

/** A single listing by event id. */
export const listingByIdFilter = (id: string): QueryFilter => ({
	kinds: [PRODUCT_KIND],
	ids: [id],
	limit: 1,
})

/**
 * A single listing by its addressable coordinate.
 *
 * This is the correct Nostr way to resolve a reference: an addressable event is identified by
 * `(kind, pubkey, d)`, so the filter is `authors` + `#d` rather than a fan-out of event ids. The
 * application currently resolves collection membership by fetching each reference separately
 * (`src/queries/products.tsx:420-459`); this expresses the same intent in one filter.
 */
export const listingByCoordinateFilter = (coordinate: string): QueryFilter | null => {
	const parsed = parseCoordinate(coordinate)
	if (!parsed || parsed.kind !== PRODUCT_KIND) return null
	return { kinds: [PRODUCT_KIND], authors: [parsed.pubkey], '#d': [parsed.dTag], limit: 1 }
}

/** Every listing by one author (a seller's catalogue). */
export const listingsByPubkeyFilter = (pubkey: string, limit = 50): QueryFilter => ({
	kinds: [PRODUCT_KIND],
	authors: [pubkey],
	limit,
})

/** NIP-50 text search over listings. The relay set is the host's decision, never this package's. */
export const listingSearchFilter = (query: string, limit = 40): QueryFilter => ({
	kinds: [PRODUCT_KIND],
	search: query,
	limit,
})

/** NIP-50 text search over profiles, used to expand a seller's name into their catalogue. */
export const profileSearchFilter = (query: string, limit = 5): QueryFilter => ({
	kinds: [0],
	search: query,
	limit,
})

/**
 * Listings referenced by a collection, as filters.
 *
 * Gamma's membership is bidirectional by `a` tag, and a collection that references nothing yields no
 * filters — which the caller must render as "empty", not as "loading" (browsing spec §3.4). Invalid
 * or non-listing references are returned in `skipped` so the surface can name them.
 */
export const listingFiltersForReferences = (references: readonly string[]): { filters: QueryFilter[]; skipped: string[] } => {
	const filters: QueryFilter[] = []
	const skipped: string[] = []
	for (const reference of references) {
		const filter = listingByCoordinateFilter(reference)
		if (filter) filters.push(filter)
		else skipped.push(reference)
	}
	return { filters, skipped }
}

// --- collection filters ----------------------------------------------------------------------

/** The collections index. */
export const collectionsIndexFilter = (limit = 50): QueryFilter => ({
	kinds: [COLLECTION_KIND],
	limit,
})

/** A single collection by its `d` tag — the only `#d` filter the read path needs. */
export const collectionByDTagFilter = (dTag: string): QueryFilter => ({
	kinds: [COLLECTION_KIND],
	'#d': [dTag],
	limit: 1,
})

/**
 * The filters needed to resolve one listing's data needs, in one place.
 *
 * This is what a component's manifest declares and the host executes; keeping it here means the CMS,
 * the app and a napplet agree on what "a product card's data" means without any of them constructing
 * a filter by hand.
 */
export const detailFiltersForListing = (
	listing: { pubkey: string; references: { collections: readonly string[] } },
	options: { sellerCatalogueLimit?: number } = {},
): { seller: QueryFilter; collections: QueryFilter[] } => ({
	seller: listingsByPubkeyFilter(listing.pubkey, options.sellerCatalogueLimit ?? 50),
	collections: listing.references.collections
		.map((reference) => {
			const parsed = parseCoordinate(reference)
			return parsed ? collectionByDTagFilter(parsed.dTag) : null
		})
		.filter((f): f is QueryFilter => f !== null),
})
