/**
 * Filter-construction tests.
 *
 * These pin the *description* of a query, not its execution — which is the whole point of the
 * package. If a filter's shape changes, every host's behaviour changes, so the shapes are asserted
 * literally.
 */
import { describe, expect, test } from 'bun:test'

import {
	COLLECTION_KIND,
	collectionByDTagFilter,
	collectionsIndexFilter,
	detailFiltersForListing,
	feedFilter,
	listingByIdFilter,
	listingByCoordinateFilter,
	listingFiltersForReferences,
	listingSearchFilter,
	listingsByPubkeyFilter,
	parseCoordinate,
	profileSearchFilter,
} from '../index'

const PUBKEY = 'a'.repeat(64)

describe('feedFilter', () => {
	test('defaults to a 500-listing kind-30402 feed', () => {
		expect(feedFilter()).toEqual({ kinds: [30402], limit: 500 })
	})

	test('adds a #t category filter only when asked', () => {
		expect(feedFilter({ tag: 'tools' })).toEqual({ kinds: [30402], limit: 500, '#t': ['tools'] })
		expect(feedFilter({ tag: '' })).toEqual({ kinds: [30402], limit: 500 })
	})

	test('adds `until` for pagination', () => {
		expect(feedFilter({ limit: 20, until: 1_700_000_000 })).toEqual({ kinds: [30402], limit: 20, until: 1_700_000_000 })
	})
})

describe('single-listing filters', () => {
	test('by id', () => {
		expect(listingByIdFilter('c'.repeat(64))).toEqual({ kinds: [30402], ids: ['c'.repeat(64)], limit: 1 })
	})

	test('by coordinate uses authors + #d, which is how an addressable event is identified', () => {
		expect(listingByCoordinateFilter(`30402:${PUBKEY}:widget`)).toEqual({
			kinds: [30402],
			authors: [PUBKEY],
			'#d': ['widget'],
			limit: 1,
		})
	})

	test('a coordinate of the wrong kind, or a malformed one, yields no filter', () => {
		expect(listingByCoordinateFilter(`30405:${PUBKEY}:summer`)).toBeNull()
		expect(listingByCoordinateFilter('nonsense')).toBeNull()
		expect(listingByCoordinateFilter(`30402:${PUBKEY.toUpperCase()}:widget`)).toBeNull()
	})
})

describe('parseCoordinate', () => {
	test('splits kind, pubkey and d', () => {
		expect(parseCoordinate(`30402:${PUBKEY}:widget`)).toEqual({ kind: 30402, pubkey: PUBKEY, dTag: 'widget' })
	})

	test('a `d` containing colons is preserved whole', () => {
		expect(parseCoordinate(`30402:${PUBKEY}:a:b:c`)?.dTag).toBe('a:b:c')
	})

	test('rejects malformed input rather than throwing', () => {
		for (const bad of ['', '30402', `30402:${PUBKEY}`, `notakind:${PUBKEY}:d`, `30402:short:d`]) {
			expect(parseCoordinate(bad)).toBeNull()
		}
	})
})

describe('search filters', () => {
	test('listing search asks for kind 30402 with the NIP-50 search field', () => {
		expect(listingSearchFilter('wool socks', 40)).toEqual({ kinds: [30402], search: 'wool socks', limit: 40 })
	})

	test('profile search is a separate query, because a seller name is not a listing', () => {
		expect(profileSearchFilter('alice')).toEqual({ kinds: [0], search: 'alice', limit: 5 })
	})
})

describe('collection structure', () => {
	test('a seller catalogue filter', () => {
		expect(listingsByPubkeyFilter(PUBKEY, 50)).toEqual({ kinds: [30402], authors: [PUBKEY], limit: 50 })
	})

	test('index and by-d-tag filters', () => {
		expect(collectionsIndexFilter()).toEqual({ kinds: [COLLECTION_KIND], limit: 50 })
		expect(collectionByDTagFilter('summer')).toEqual({ kinds: [COLLECTION_KIND], '#d': ['summer'], limit: 1 })
	})

	test('references become filters, and unreadable ones are reported rather than dropped', () => {
		const { filters, skipped } = listingFiltersForReferences([
			`30402:${PUBKEY}:one`,
			`30402:${PUBKEY}:two`,
			'garbage',
			`30405:${PUBKEY}:not-a-listing`,
		])
		expect(filters).toHaveLength(2)
		expect(skipped).toEqual(['garbage', `30405:${PUBKEY}:not-a-listing`])
	})

	test('a listing with no references yields no filters — the caller must render empty, not loading', () => {
		expect(listingFiltersForReferences([])).toEqual({ filters: [], skipped: [] })
	})

	test('detailFilters bundles what a product page needs to resolve', () => {
		const result = detailFiltersForListing({
			pubkey: PUBKEY,
			references: { collections: [`30405:${PUBKEY}:summer`, 'broken'] },
		})
		expect(result.seller).toEqual({ kinds: [30402], authors: [PUBKEY], limit: 50 })
		expect(result.collections).toEqual([{ kinds: [COLLECTION_KIND], '#d': ['summer'], limit: 1 }])
	})
})
