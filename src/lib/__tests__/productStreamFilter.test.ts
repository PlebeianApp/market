import { describe, expect, test } from 'bun:test'
import { buildProductStreamFilter, isConclusiveEnd } from '@/lib/utils/productStreamFilter'

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

	// The dangerous case, and the one this function exists for: a caller that
	// asked for author scoping must never receive a filter without an author
	// constraint, because that filter matches every seller on the relay and the
	// results get labelled as the one seller the page is about.
	test('refuses to build an unscoped filter when author scoping was requested', () => {
		for (const authors of [[], ['nope'], [''], ['nope', '']]) {
			expect(buildProductStreamFilter({ authors })).toBeNull()
		}
	})

	test('an absent authors field means an unscoped stream (the feed)', () => {
		const filter = buildProductStreamFilter({ limit: 10 })

		expect(filter).not.toBeNull()
		expect(filter && 'authors' in filter).toBe(false)
		expect(filter?.limit).toBe(10)
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

describe('isConclusiveEnd', () => {
	test('EOSE is conclusive whether or not events arrived', () => {
		expect(isConclusiveEnd('eose', false)).toBe(true)
		expect(isConclusiveEnd('eose', true)).toBe(true)
	})

	test('a relay dropping the subscription before EOSE is not an answer', () => {
		expect(isConclusiveEnd('close', false)).toBe(false)
	})

	test('our own deadline expiring before EOSE is not an answer', () => {
		expect(isConclusiveEnd('timeout', false)).toBe(false)
	})

	test('a close or deadline after EOSE keeps the answer EOSE established', () => {
		expect(isConclusiveEnd('close', true)).toBe(true)
		expect(isConclusiveEnd('timeout', true)).toBe(true)
	})
})
