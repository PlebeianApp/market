import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ndkActions } from '@/lib/stores/ndk'
import { testLabelActions } from '@/lib/stores/testLabels'
import type { NDKEvent, NDKFilter } from '@/lib/nostr/ndk-events'
import { invalidateTestLabelCache, setCachedTestLabel } from '../testLabels'
import { fetchProductsBySearchWithSellers } from '../products'

/**
 * ADR-0009 regression: the seller-name half of product search is a browsing
 * surface too.
 *
 * `fetchProductsBySearchWithSellers` merges two reads:
 *   1. NIP-50 product hits, gated by `fetchProductsBySearch`;
 *   2. the matching sellers' catalogues, fetched through `fetchProductsByPubkey`
 *      — which is deliberately UNGATED, because the same read serves the seller
 *      profile and the owner dashboard, where a labeled item must stay visible.
 *
 * Before the merged-set gate, a test-labeled product whose *seller name* matched
 * the query came back in search results, contradicting the ADR's "hidden from
 * browsing, search and collections" promise and the copy the mark/unmark
 * dialogs show the labeler.
 *
 * Stub boundary: `ndkActions` (getNDK + fetchEventsWithTimeout) plus a rejecting
 * global fetch so NIP-11 relay discovery stays offline (ADR-0005). Label truth is
 * seeded through `setCachedTestLabel` for EVERY coordinate the search can return:
 * with all coordinates cache-fresh, `fetchTestLabels` resolves from cache and
 * never reaches the relay or the admin/editor settings reads.
 */

const SELLER_PUBKEY = 'a'.repeat(64)
const OTHER_SELLER_PUBKEY = 'b'.repeat(64)
const LABELER_PUBKEY = 'c'.repeat(64)

const DIRECT_HIT_D = 'direct-hit'
const SELLER_TEST_D = 'seller-test-item'
const SELLER_REAL_D = 'seller-real-item'

const DIRECT_HIT_COORD = `30402:${OTHER_SELLER_PUBKEY}:${DIRECT_HIT_D}`
const SELLER_TEST_COORD = `30402:${SELLER_PUBKEY}:${SELLER_TEST_D}`
const SELLER_REAL_COORD = `30402:${SELLER_PUBKEY}:${SELLER_REAL_D}`

const SEARCH_QUERY = 'alice'

const makeProduct = (params: { id: string; pubkey: string; dTag: string; title?: string }): NDKEvent => {
	const tags: string[][] = [
		['d', params.dTag],
		['title', params.title ?? params.dTag],
		// `isProductInStock` treats a missing or non-positive stock as out of stock.
		['stock', '5'],
	]
	return {
		id: params.id,
		kind: 30402,
		pubkey: params.pubkey,
		created_at: 1_700_000_000,
		content: '',
		tags,
		tagValue: (name: string) => tags.find((tag) => tag[0] === name)?.[1],
	} as unknown as NDKEvent
}

const makeProfile = (pubkey: string): NDKEvent =>
	({
		id: 'profile-' + pubkey.slice(0, 8),
		kind: 0,
		pubkey,
		created_at: 1_700_000_000,
		content: '',
		tags: [],
		tagValue: () => undefined,
	}) as unknown as NDKEvent

const DIRECT_HIT = makeProduct({ id: '1'.repeat(64), pubkey: OTHER_SELLER_PUBKEY, dTag: DIRECT_HIT_D })
const SELLER_TEST_ITEM = makeProduct({ id: '2'.repeat(64), pubkey: SELLER_PUBKEY, dTag: SELLER_TEST_D })
const SELLER_REAL_ITEM = makeProduct({ id: '3'.repeat(64), pubkey: SELLER_PUBKEY, dTag: SELLER_REAL_D })

/** The exact result set every case in this file operates on. */
const ALL_COORDINATES = [DIRECT_HIT_COORD, SELLER_TEST_COORD, SELLER_REAL_COORD]
const UNGATED_IDS = [DIRECT_HIT.id, SELLER_TEST_ITEM.id, SELLER_REAL_ITEM.id]

/** NIP-50 product hits plus a seller whose profile name matches the query. */
const makeStubNdk = (directHits: NDKEvent[] = [DIRECT_HIT]) => ({
	addExplicitRelay: () => {},
	fetchEvents: async (filter: NDKFilter) => {
		if (filter.kinds?.includes(0)) return [makeProfile(SELLER_PUBKEY)]
		if (filter.kinds?.includes(30402)) return directHits
		return []
	},
})

// --- stub plumbing ---

const realGetNDK = ndkActions.getNDK
const realFetchEventsWithTimeout = ndkActions.fetchEventsWithTimeout
const realFetch = globalThis.fetch

/** Catalogue returned for the by-author read the seller expansion performs. */
let sellerCatalogue: NDKEvent[] = []
let byAuthorFilters: NDKFilter[] = []

const stubNdk = (directHits?: NDKEvent[]) => {
	;(ndkActions as { getNDK: () => unknown }).getNDK = () => makeStubNdk(directHits)
}

/**
 * Seed label truth for the whole coordinate set. `setCachedTestLabel(coord, null)`
 * is the "known unlabeled" answer — it keeps every coordinate cache-fresh so the
 * resolution path stays offline, and it is what makes `isLoaded` true.
 */
const seedLabels = (labeled: string[] = []) => {
	for (const coordinate of ALL_COORDINATES) {
		setCachedTestLabel(coordinate, labeled.includes(coordinate) ? { eventId: `label-${coordinate}`, labelerPubkey: LABELER_PUBKEY } : null)
	}
}

beforeEach(() => {
	sellerCatalogue = [SELLER_TEST_ITEM, SELLER_REAL_ITEM]
	byAuthorFilters = []

	// NIP-11 discovery probes relays over HTTP; the unit suite must stay offline.
	globalThis.fetch = (() => Promise.reject(new Error('ADR-0005: unit tests make no network calls'))) as unknown as typeof fetch

	stubNdk()
	;(ndkActions as { fetchEventsWithTimeout: unknown }).fetchEventsWithTimeout = (async (filter: NDKFilter) => {
		// Only the by-author product read is stubbed; label/deletion reads yield nothing.
		if (filter.kinds?.includes(30402) && filter.authors?.length) {
			byAuthorFilters.push(filter)
			return sellerCatalogue
		}
		return []
	}) as unknown as typeof ndkActions.fetchEventsWithTimeout

	testLabelActions.clearLabels()
	invalidateTestLabelCache()
})

afterEach(() => {
	;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
	;(ndkActions as { fetchEventsWithTimeout: unknown }).fetchEventsWithTimeout = realFetchEventsWithTimeout
	globalThis.fetch = realFetch
	testLabelActions.clearLabels()
	invalidateTestLabelCache()
})

const ids = (events: NDKEvent[]) => events.map((event) => event.id)

describe('fetchProductsBySearchWithSellers — the seller-name half is gated (ADR-0009)', () => {
	test('excludes a test-labeled product reached through the seller match', async () => {
		seedLabels([SELLER_TEST_COORD])

		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		// The regression: this item used to come back via fetchProductsByPubkey.
		expect(ids(results)).not.toContain(SELLER_TEST_ITEM.id)
		expect(testLabelActions.isTestLabeled(SELLER_TEST_COORD)).toBe(true)
	})

	test('keeps the seller’s unlabeled products and the direct NIP-50 hit', async () => {
		seedLabels([SELLER_TEST_COORD])

		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		expect(ids(results)).toContain(DIRECT_HIT.id)
		expect(ids(results)).toContain(SELLER_REAL_ITEM.id)
		expect(ids(results)).toHaveLength(2)
	})

	test('the by-author read itself stays ungated — the profile path still sees labeled items', async () => {
		seedLabels([SELLER_TEST_COORD])

		await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		// The gate is re-applied on the merged search set; the source read must
		// keep handing the labeled item back so profile/dashboard still show it.
		expect(byAuthorFilters.some((filter) => filter.authors?.includes(SELLER_PUBKEY))).toBe(true)
		expect(sellerCatalogue.map((event) => event.id)).toContain(SELLER_TEST_ITEM.id)
	})

	test('the show-test-listings toggle still reveals the labeled seller product', async () => {
		seedLabels([SELLER_TEST_COORD])
		testLabelActions.setShowTestListings(true)

		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		expect(ids(results)).toContain(SELLER_TEST_ITEM.id)
		expect(ids(results)).toHaveLength(3)
	})

	test('an unlabeled search returns every merged result (no over-filtering)', async () => {
		seedLabels()

		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		expect(ids(results)).toEqual(UNGATED_IDS)
	})

	test('the limit applies after gating, so gated items never consume slots', async () => {
		seedLabels([SELLER_TEST_COORD])

		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 2)

		// Two results survive the gate; a pre-gate slice would have kept a slot
		// for the excluded item and returned only the direct hit.
		expect(ids(results)).toEqual([DIRECT_HIT.id, SELLER_REAL_ITEM.id])
	})

	test('an empty query short-circuits without touching the relay', async () => {
		seedLabels()

		const results = await fetchProductsBySearchWithSellers('   ', 20)

		expect(results).toEqual([])
		expect(byAuthorFilters).toHaveLength(0)
	})
})

describe('fetchProductsBySearchWithSellers — gate fidelity vs the direct half', () => {
	test('a test-labeled direct NIP-50 hit is excluded as well', async () => {
		seedLabels([DIRECT_HIT_COORD])

		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		expect(ids(results)).not.toContain(DIRECT_HIT.id)
		expect(ids(results)).toEqual([SELLER_TEST_ITEM.id, SELLER_REAL_ITEM.id])
	})

	test('a coordinate returned by both halves is deduplicated, then dropped once', async () => {
		seedLabels([SELLER_TEST_COORD])
		// The direct NIP-50 half also returns the seller's labeled item.
		stubNdk([SELLER_TEST_ITEM, DIRECT_HIT])

		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		expect(ids(results)).not.toContain(SELLER_TEST_ITEM.id)
		expect(ids(results)).toEqual([DIRECT_HIT.id, SELLER_REAL_ITEM.id])
	})

	test('a labeled item is still returned when the label is not applied (fail open)', async () => {
		// No seeded label state at all: the store is "not loaded", so the filter
		// must be a no-op rather than hiding items on missing data.
		const results = await fetchProductsBySearchWithSellers(SEARCH_QUERY, 20)

		expect(ids(results)).toEqual(UNGATED_IDS)
	})
})
