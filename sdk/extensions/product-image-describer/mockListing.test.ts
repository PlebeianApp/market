import { describe, expect, test } from 'bun:test'
import { parseProductListingDraft } from '../../commerce/products/listingDraft'
import { mockListingDraft } from './mockListing'

const CATEGORIES = ['Bitcoin', 'Art', 'Clothing', 'Food & Drink', 'Home & Technology', 'Other']

describe('mockListingDraft', () => {
	test('is deterministic per image URL and weaves in seller notes', () => {
		const a = mockListingDraft({ imageUrl: 'https://blossom.example/abc.jpg' })
		expect(mockListingDraft({ imageUrl: 'https://blossom.example/abc.jpg' })).toEqual(a)
		expect(mockListingDraft({ imageUrl: 'https://blossom.example/abc.jpg', notes: 'blue glaze' }).description).toContain(
			'Seller notes: blue glaze',
		)
		expect(a.model).toContain('mock')
	})

	test('always produces a draft the host parser accepts with a known category', () => {
		for (let i = 0; i < 25; i++) {
			const result = parseProductListingDraft(mockListingDraft({ imageUrl: `https://blossom.example/${i}.png` }), CATEGORIES)
			expect(result.ok).toBe(true)
			if (result.ok) expect(CATEGORIES.slice(0, -1)).toContain(result.value.category)
		}
	})
})
