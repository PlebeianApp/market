import { describe, expect, test } from 'bun:test'
import { LISTING_DRAFT_LIMITS, parseProductListingDraft } from './listingDraft'

const CATEGORIES = ['Art', 'Clothing', 'Other'] as const

describe('parseProductListingDraft', () => {
	test('accepts a well-formed draft and maps the category case-insensitively', () => {
		const result = parseProductListingDraft(
			{ title: ' Mug ', summary: 'A mug', description: 'A nice mug', tags: ['Ceramic', 'mug'], category: 'art', model: 'm1' },
			CATEGORIES,
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value).toEqual({
			title: 'Mug',
			summary: 'A mug',
			description: 'A nice mug',
			tags: ['ceramic', 'mug'],
			category: 'Art',
			model: 'm1',
		})
	})

	test('rejects non-objects and drafts without title or description', () => {
		expect(parseProductListingDraft(null, CATEGORIES).ok).toBe(false)
		expect(parseProductListingDraft([], CATEGORIES).ok).toBe(false)
		expect(parseProductListingDraft({ description: 'x' }, CATEGORIES).ok).toBe(false)
		expect(parseProductListingDraft({ title: 'x', description: '   ' }, CATEGORIES).ok).toBe(false)
	})

	test('falls back to the last category and derives a summary', () => {
		const result = parseProductListingDraft({ title: 't', description: 'd'.repeat(500), category: 'Weapons' }, CATEGORIES)
		expect(result.ok && result.value.category).toBe('Other')
		expect(result.ok && result.value.summary.length).toBe(LISTING_DRAFT_LIMITS.summary)
		expect(result.ok && result.value.tags).toEqual([])
	})

	test('caps text, strips control characters, and filters bad or duplicate tags', () => {
		const tags = ['ok', 'OK', '#bad', 'a\u0000b', '-x', ...Array.from({ length: 20 }, (_, i) => `tag${i}`)]
		const result = parseProductListingDraft({ title: 'x'.repeat(500), description: 'd\u0007e', tags }, CATEGORIES)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.title.length).toBe(LISTING_DRAFT_LIMITS.title)
		expect(result.value.description).toBe('de')
		expect(result.value.tags.length).toBe(LISTING_DRAFT_LIMITS.tags)
		expect(result.value.tags.slice(0, 2)).toEqual(['ok', 'ab'])
		expect(result.value).not.toHaveProperty('model')
	})
})
