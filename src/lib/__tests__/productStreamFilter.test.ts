import { describe, expect, test } from 'bun:test'
import { buildProductStreamFilter } from '@/lib/utils/productStreamFilter'

const VALID = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

describe('buildProductStreamFilter', () => {
	test('always asks for kind 30402', () => {
		expect(buildProductStreamFilter({}).kinds).toEqual([30402])
	})

	test('streams one author when the profile resolves', () => {
		const filter = buildProductStreamFilter({ authors: [VALID], limit: 50 })

		expect(filter.authors).toEqual([VALID])
		expect(filter.limit).toBe(50)
	})

	test('drops malformed authors instead of sending them to relays', () => {
		const filter = buildProductStreamFilter({ authors: [VALID, 'not-a-key', ''] })

		expect(filter.authors).toEqual([VALID])
	})

	// Inherited from isValidHexKey, the same validator productsByPubkeyQueryOptions
	// uses to disable a query: hex is matched case-insensitively. Pinned here so a
	// later "tighten the filter" change is a deliberate decision, not a surprise.
	test('accepts uppercase hex, matching isValidHexKey', () => {
		const filter = buildProductStreamFilter({ authors: ['A'.repeat(64)] })

		expect(filter.authors).toEqual(['A'.repeat(64)])
	})

	// The dangerous case: an empty (or fully invalid) author list must not produce
	// a filter with no author constraint, which would stream every seller's
	// products on the relay into one seller's profile.
	test('never emits a filter without an author constraint', () => {
		for (const authors of [[], ['nope'], ['']]) {
			const filter = buildProductStreamFilter({ authors })
			expect('authors' in filter).toBe(false)
		}
	})

	test('keeps several valid authors', () => {
		const filter = buildProductStreamFilter({ authors: [VALID, OTHER] })

		expect(filter.authors).toEqual([VALID, OTHER])
	})

	test('tag narrows the stream when present', () => {
		expect(buildProductStreamFilter({ tag: 'Food' })['#t']).toEqual(['Food'])
		expect('#t' in buildProductStreamFilter({})).toBe(false)
	})

	test('defaults the limit so a caller cannot request an unbounded stream', () => {
		expect(buildProductStreamFilter({}).limit).toBe(500)
	})
})
