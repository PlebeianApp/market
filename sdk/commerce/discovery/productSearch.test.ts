import { describe, expect, test } from 'bun:test'
import { filterAndSortProductSearchResults } from './productSearch'

const event = (title: string, content: string, created_at: number) => ({ tags: [['title', title]], content, created_at })

describe('filterAndSortProductSearchResults', () => {
	test('excludes matching title/content terms and sorts newest by default', () => {
		const results = filterAndSortProductSearchResults(
			[event('Old coat', 'wool', 1), event('New coat', 'linen', 3), event('Hat', 'coat details', 2)],
			{ exclude: 'wool details' },
		)
		expect(results.map((item) => item.tags[0]?.[1])).toEqual(['New coat'])
	})

	test('supports oldest-first ordering', () => {
		const results = filterAndSortProductSearchResults([event('New', '', 3), event('Old', '', 1)], { sort: 'oldest' })
		expect(results.map((item) => item.tags[0]?.[1])).toEqual(['Old', 'New'])
	})
})
