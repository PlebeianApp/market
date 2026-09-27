/**
 * Viewer-filter tests.
 *
 * Two things are being pinned here: that the viewer's choices behave as the application's streaming
 * path already did, and that this package stays out of the *gating* business.
 */
import { describe, expect, test } from 'bun:test'

import type { ProductListing } from '@plebeian/product'

import { applyFilterState, defaultProductFilters, describeFilterState, hasActiveFilters } from '../index'

const listing = (over: Partial<ProductListing>): ProductListing =>
	({
		kind: 30402,
		id: 'c'.repeat(64),
		pubkey: 'a'.repeat(64),
		createdAt: 1,
		coordinate: `30402:${'a'.repeat(64)}:d`,
		dTag: 'd',
		content: '',
		title: 'Untitled',
		price: { amount: '1', currency: 'USD' },
		type: 'simple',
		format: 'digital',
		visibility: 'on-sale',
		inStock: true,
		images: [],
		specs: [],
		categories: [],
		references: { collections: [] },
		shippingOptions: [],
		nsfw: false,
		...over,
	}) as ProductListing

describe('defaults', () => {
	test('match the application', () => {
		expect(defaultProductFilters).toEqual({ showOutOfStock: false, hidePreorder: false, sort: 'newest', country: '' })
	})

	test('hasActiveFilters only reports a change from the defaults', () => {
		expect(hasActiveFilters(defaultProductFilters)).toBe(false)
		expect(hasActiveFilters({ ...defaultProductFilters, sort: 'a-z' })).toBe(true)
		expect(hasActiveFilters({ ...defaultProductFilters, country: 'DE' })).toBe(true)
	})

	test('describeFilterState is honest about what is hidden', () => {
		expect(describeFilterState(defaultProductFilters)).toBe('no filters')
		expect(describeFilterState({ ...defaultProductFilters, hidePreorder: true })).toContain('pre-orders hidden')
	})
})

describe('visibility filtering — the viewer’s choices only', () => {
	test('out-of-stock is hidden by default and shown on request', () => {
		const listings = [listing({ inStock: true, title: 'A' }), listing({ inStock: false, title: 'B' })]
		expect(applyFilterState(listings, defaultProductFilters).map((l) => l.title)).toEqual(['A'])
		expect(applyFilterState(listings, { ...defaultProductFilters, showOutOfStock: true })).toHaveLength(2)
	})

	test('pre-orders are kept by default and hidden on request', () => {
		const listings = [listing({ visibility: 'pre-order', inStock: true, title: 'P' }), listing({ title: 'N' })]
		expect(applyFilterState(listings, defaultProductFilters)).toHaveLength(2)
		expect(applyFilterState(listings, { ...defaultProductFilters, hidePreorder: true }).map((l) => l.title)).toEqual(['N'])
	})

	test('country is a case-insensitive substring of location, and an absent location never matches', () => {
		const listings = [
			listing({ title: 'Berlin', location: 'Berlin, DE' }),
			listing({ title: 'Lisbon', location: 'Lisbon, PT' }),
			listing({ title: 'Nowhere' }),
		]
		expect(applyFilterState(listings, { ...defaultProductFilters, country: 'de' }).map((l) => l.title)).toEqual(['Berlin'])
		expect(applyFilterState(listings, { ...defaultProductFilters, country: '  ' })).toHaveLength(3)
	})
})

describe('sorting', () => {
	const listings = [
		listing({ title: 'Banana', createdAt: 3 }),
		listing({ title: 'apple', createdAt: 1 }),
		listing({ title: 'Cherry', createdAt: 2 }),
	]

	test('newest first by default', () => {
		expect(applyFilterState(listings, defaultProductFilters).map((l) => l.title)).toEqual(['Banana', 'Cherry', 'apple'])
	})

	test('oldest first', () => {
		expect(applyFilterState(listings, { ...defaultProductFilters, sort: 'oldest' }).map((l) => l.title)).toEqual([
			'apple',
			'Cherry',
			'Banana',
		])
	})

	test('alphabetical, both directions', () => {
		expect(applyFilterState(listings, { ...defaultProductFilters, sort: 'a-z' }).map((l) => l.title)).toEqual(['apple', 'Banana', 'Cherry'])
		expect(applyFilterState(listings, { ...defaultProductFilters, sort: 'z-a' }).map((l) => l.title)).toEqual(['Cherry', 'Banana', 'apple'])
	})

	test('equal keys keep input order, so two adapters cannot disagree', () => {
		const tied = [
			listing({ title: 'First', createdAt: 5 }),
			listing({ title: 'Second', createdAt: 5 }),
			listing({ title: 'Third', createdAt: 5 }),
		]
		expect(applyFilterState(tied, defaultProductFilters).map((l) => l.title)).toEqual(['First', 'Second', 'Third'])
	})

	test('the input array is not mutated', () => {
		const input = [listing({ title: 'B', createdAt: 1 }), listing({ title: 'A', createdAt: 2 })]
		const copy = [...input]
		applyFilterState(input, { ...defaultProductFilters, sort: 'a-z' })
		expect(input).toEqual(copy)
	})
})

describe('separation from gating', () => {
	test('an NSFW listing is NOT filtered here — that is the surface gate’s decision, not a viewer filter', () => {
		const listings = [listing({ nsfw: true, title: 'Adult' }), listing({ title: 'Normal' })]
		expect(applyFilterState(listings, defaultProductFilters)).toHaveLength(2)
	})

	test('a hidden listing is NOT filtered here either — hidden is withholding, not a preference', () => {
		const listings = [listing({ visibility: 'hidden', title: 'Hidden' })]
		expect(applyFilterState(listings, defaultProductFilters)).toHaveLength(1)
	})
})
