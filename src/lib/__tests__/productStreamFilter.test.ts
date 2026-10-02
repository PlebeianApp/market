import { describe, expect, test } from 'bun:test'
import { allRelaysAnswered, buildProductStreamFilter, isConclusiveEnd } from '@/lib/utils/productStreamFilter'

/** Narrow the nullable filter for assertions. */
function requireFilter(f: ReturnType<typeof buildProductStreamFilter>) {
	if (!f) throw new Error('expected a filter')
	return f
}

const VALID = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

describe('buildProductStreamFilter', () => {
	test('always asks for kind 30402', () => {
		expect(requireFilter(buildProductStreamFilter({})).kinds).toEqual([30402])
	})

	test('streams one author when the profile resolves', () => {
		const filter = requireFilter(buildProductStreamFilter({ authors: [VALID], limit: 50 }))

		expect(filter.authors).toEqual([VALID])
		expect(filter.limit).toBe(50)
	})

	test('drops malformed authors instead of sending them to relays', () => {
		const filter = requireFilter(buildProductStreamFilter({ authors: [VALID, 'not-a-key', ''] }))

		expect(filter.authors).toEqual([VALID])
	})

	// Inherited from isValidHexKey, the same validator productsByPubkeyQueryOptions
	// uses to disable a query: hex is matched case-insensitively. Pinned here so a
	// later "tighten the filter" change is a deliberate decision, not a surprise.
	test('accepts uppercase hex, matching isValidHexKey', () => {
		const filter = requireFilter(buildProductStreamFilter({ authors: ['A'.repeat(64)] }))

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
		const filter = requireFilter(buildProductStreamFilter({ limit: 10 }))

		expect(filter).not.toBeNull()
		expect(filter && 'authors' in filter).toBe(false)
		expect(filter?.limit).toBe(10)
	})

	test('keeps several valid authors', () => {
		const filter = requireFilter(buildProductStreamFilter({ authors: [VALID, OTHER] }))

		expect(filter.authors).toEqual([VALID, OTHER])
	})

	test('tag narrows the stream when present', () => {
		expect(requireFilter(buildProductStreamFilter({ tag: 'Food' }))['#t']).toEqual(['Food'])
		expect('#t' in requireFilter(buildProductStreamFilter({}))).toBe(false)
	})

	test('defaults the limit so a caller cannot request an unbounded stream', () => {
		expect(requireFilter(buildProductStreamFilter({})).limit).toBe(500)
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

describe('allRelaysAnswered', () => {
	test('only a full set of answers makes the stream conclusive', () => {
		expect(allRelaysAnswered(4, 4)).toBe(true)
		expect(allRelaysAnswered(4, 5)).toBe(true)
	})

	test('the library reporting eose from a subset is not a conclusion', () => {
		// @nostr-dev-kit/ndk emits eose once 2 relays answer and half have answered,
		// while the relays holding the data may still be answering.
		expect(allRelaysAnswered(4, 2)).toBe(false)
		expect(allRelaysAnswered(9, 5)).toBe(false)
		expect(allRelaysAnswered(3, 0)).toBe(false)
	})

	test('no relays asked is never a conclusion', () => {
		expect(allRelaysAnswered(0, 0)).toBe(false)
	})
})
