/**
 * filters.test.ts — M7 and E3.
 *
 * The two halves of M7 pull in opposite directions and both are here: a
 * malformed identity value is rejected (no trimming, no dropping, no repair),
 * and an empty identity list is kept (NIP-01 makes it match nothing; dropping
 * the key would broaden the filter to everything).
 */
import { describe, expect, test } from 'bun:test'

import { FILTER_SUPPORT, StoreError, createEventStore } from './index'
import type { FilterIn } from './index'
import { assertIdentityFilters, toFilterArray } from './filters'
import { PUBKEY, signedEvent } from './harness'

describe('toFilterArray', () => {
	test('toFilterArray accepts one filter and an array', () => {
		const one: FilterIn = { kinds: [1] }
		expect(toFilterArray(one)).toEqual([one])
		expect(toFilterArray(one)).toHaveLength(1)

		const many: FilterIn[] = [{ kinds: [1] }, { authors: [PUBKEY] }]
		expect(toFilterArray(many)).toEqual(many)
		// a copy: the caller's array is never the store's to mutate
		expect(toFilterArray(many)).not.toBe(many)

		// anything that is not an object is a typed rejection, not a TypeError from deeper in
		expect(() => toFilterArray('kinds=1' as unknown as FilterIn)).toThrow(StoreError)
	})
})

describe('an empty authors list is kept', () => {
	test('an empty authors list is kept', () => {
		const filters: FilterIn[] = toFilterArray({ authors: [] })
		expect(filters).toHaveLength(1)
		expect(Object.keys(filters[0])).toEqual(['authors'])
		expect(filters[0].authors).toEqual([])
		// and it is accepted, not rejected as malformed
		expect(() => assertIdentityFilters(filters)).not.toThrow()
	})
})

describe('identity validation', () => {
	test('a non-hex or empty identity value rejects', () => {
		for (const authors of [['alice'], [''], ['AB'], [PUBKEY.toUpperCase()], ['ab'.repeat(33)]]) {
			expect(() => assertIdentityFilters([{ authors }])).toThrow(StoreError)
		}
		// each identity key is guarded, and the rejection names it
		for (const key of ['ids', 'authors', '#e', '#p', '#P'] as const) {
			const error = ((): StoreError => {
				try {
					assertIdentityFilters([{ [key]: ['nope'] }])
				} catch (thrown: unknown) {
					return thrown as StoreError
				}
				throw new Error(`expected ${key} to reject`)
			})()
			expect(error).toBeInstanceOf(StoreError)
			expect(error.reason).toBe('rejected')
			expect(error.message).toContain(key)
		}
	})

	test('a hex prefix and a full 64-hex value are accepted', () => {
		expect(() => assertIdentityFilters([{ authors: ['ab', PUBKEY] }])).not.toThrow()
		expect(() => assertIdentityFilters([{ ids: ['0'.repeat(64)] }])).not.toThrow()
		expect(() => assertIdentityFilters([{ '#e': [PUBKEY.slice(0, 8)] }])).not.toThrow()
		// an absent key is simply absent
		expect(() => assertIdentityFilters([{ kinds: [1] }])).not.toThrow()
	})
})

describe('D-O6 · the general empty-#-key rule', () => {
	test('an empty #-key list matches nothing, for every #-key and not only the identity keys', async () => {
		// Careless implementation it fails on: the narrower identity-only reading, which answers a
		// present-but-empty `#t`, `#d` or `#a` list as if the key were absent — and so hands back the whole
		// store for a filter that matches nothing (`#2e71c3`, the statement the code reaches at I3a).
		const store = createEventStore()
		const tagged = signedEvent({ kind: 1, created_at: 1000, tags: [['t', 'a']] })
		const addressed = signedEvent({ kind: 30402, created_at: 1000, tags: [['d', 'x']] })
		await store.write([tagged, addressed])

		for (const filter of [{ '#t': [] }, { '#d': [] }, { '#a': [] }, { '#p': [] }, { ids: [], authors: [] }]) {
			expect(await store.read(filter)).toEqual([]) // answered as nothing...
			expect((await store.count(filter)).count).toBe(0) // ...and counted as nothing
		}

		// The companion: a non-empty `#`-key list still filters, so the rule narrows and never widens —
		// the same fail-open shape would show up from the other side if the key were dropped.
		const kept = await store.read({ '#t': ['a'] })
		expect(kept.map((event) => event.id)).toEqual([tagged.id])

		// And the rule is load-bearing exactly where the dependency does **not** cover it. The library's
		// own per-filter predicate already excludes an empty `#`-key on the read path, so the read
		// assertions above cannot see this module's rule on their own (measured: the I3a mutation left them
		// green). `remove` hands its filters to the library's invalidation primitive, which answers a filter
		// carrying no condition with the **whole store** — so a filter that matches nothing must remove
		// nothing, or a caller deletes their store by asking for an empty tag list.
		const doomed = await store.remove([{ '#t': [] }])
		expect(doomed.removed).toBe(0)
		expect((await store.count({ kinds: [1, 30402] })).count).toBe(2) // both events are still there

		expect(FILTER_SUPPORT).toEqual({ nip91: true, nip50: false })
	})
})

describe('E3, declared', () => {
	test('a &-key filter filters AND-wise and a search filter is accepted unhonoured', async () => {
		const store = createEventStore()
		const both = signedEvent({
			kind: 1,
			content: 'both',
			created_at: 1000,
			tags: [
				['t', 'a'],
				['t', 'b'],
			],
		})
		const half = signedEvent({ kind: 1, content: 'half', created_at: 1000, tags: [['t', 'a']] })
		await store.write([both])
		await store.write([half])

		// NIP-91: an `&`-key requires every value, so only the event carrying both survives
		const and = await store.read({ kinds: [1], '&t': ['a', 'b'] })
		expect(and.map((candidate) => candidate.content)).toEqual(['both'])

		// NIP-50 is declared unsupported, so `search` does not filter: the answer is the same
		// one the same filter without `search` gets. (The library's index would answer *nothing*
		// for a `search` filter, which would silently make "declared" mean "matches nothing".)
		const searched = await store.read({ kinds: [1], search: 'nothing matches this' })
		const unsearched = await store.read({ kinds: [1] })
		expect(searched.map((candidate) => candidate.id)).toEqual(unsearched.map((candidate) => candidate.id))
		expect(searched).toHaveLength(2)

		expect(FILTER_SUPPORT).toEqual({ nip91: true, nip50: false })
	})
})
