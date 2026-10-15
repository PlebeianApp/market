import { describe, expect, test } from 'bun:test'
import { filterAndSortOrderListings } from './orderListing'

const entries = [
	{ id: 'a', order: { created_at: 10 }, latestStatus: { created_at: 50, tags: [['status', 'confirmed']] } },
	{ id: 'b', order: { created_at: 30 } },
	{ id: 'c', order: { created_at: 20 }, latestMessage: { created_at: 40 } },
]

const ids = (list: typeof entries) => list.map((entry) => entry.id)

describe('order listing', () => {
	test('sorts by order creation time', () => {
		expect(ids(filterAndSortOrderListings(entries, 'any', 'newest'))).toEqual(['b', 'c', 'a'])
		expect(ids(filterAndSortOrderListings(entries, 'any', 'oldest'))).toEqual(['a', 'c', 'b'])
	})

	test('sorts by latest related activity', () => {
		expect(ids(filterAndSortOrderListings(entries, 'any', 'recently-updated'))).toEqual(['a', 'c', 'b'])
		expect(ids(filterAndSortOrderListings(entries, 'any', 'least-updated'))).toEqual(['b', 'c', 'a'])
	})

	test('filters by resolved status, treating missing status as pending', () => {
		expect(ids(filterAndSortOrderListings(entries, 'confirmed'))).toEqual(['a'])
		expect(ids(filterAndSortOrderListings(entries, 'Pending'))).toEqual(['b', 'c'])
	})

	test('does not mutate the input', () => {
		const input = [...entries]
		filterAndSortOrderListings(input, 'any', 'oldest')
		expect(ids(input)).toEqual(['a', 'b', 'c'])
	})
})
