/**
 * view.test.ts — §4.8, the pure view.
 *
 * No store and no clock: every case is a function over one event the test built.
 * `getEventUID` and `createReplaceableAddress` are the library's, re-exported
 * verbatim, and the case states the exact strings — the trailing colon included,
 * because `kind:pubkey:` and `kind:pubkey` are both real in this ecosystem and
 * the module has to be unambiguous about which one it means.
 */
import { describe, expect, test } from 'bun:test'

import {
	createReplaceableAddress,
	createEventStore,
	getEventUID,
	getMatchingTags,
	isAddressable,
	isFromCache,
	isReplaceable,
	tagValue,
} from './index'
import type { Event } from './index'
import { PUBKEY, signedEvent, version } from './harness'

describe('identity and coordinate', () => {
	test('getEventUID · id for a regular event, kind:pubkey: for a replaceable, kind:pubkey:d for an addressable', () => {
		const regular = signedEvent({ kind: 1, content: 'regular', created_at: 1000 })
		expect(getEventUID(regular)).toBe(regular.id)

		const replaceable = version({ kind: 10002, created_at: 1000, content: 'replaceable' })
		expect(getEventUID(replaceable)).toBe(`10002:${PUBKEY}:`)

		const addressable = version({ kind: 30402, d: 'listing', created_at: 1000, content: 'addressable' })
		expect(getEventUID(addressable)).toBe(`30402:${PUBKEY}:listing`)
	})

	test('createReplaceableAddress · the exact strings, trailing colon included', () => {
		// a replaceable kind with no `d` still ends in a colon: `kind:pubkey:`
		expect(createReplaceableAddress(10002, PUBKEY)).toBe(`10002:${PUBKEY}:`)
		expect(createReplaceableAddress(10002, PUBKEY, '')).toBe(`10002:${PUBKEY}:`)
		expect(createReplaceableAddress(30402, PUBKEY, 'listing')).toBe(`30402:${PUBKEY}:listing`)
	})
})

describe('classification', () => {
	test('isReplaceable is 0/3/10000–19999 and isAddressable is 30000–39999, and neither implies the other', () => {
		for (const kind of [0, 3, 10000, 10002, 19999]) expect(isReplaceable(kind)).toBe(true)
		for (const kind of [1, 5, 9999, 20000, 30000, 30402, 39999]) expect(isReplaceable(kind)).toBe(false)

		for (const kind of [30000, 30402, 39999]) expect(isAddressable(kind)).toBe(true)
		for (const kind of [0, 1, 5, 10002, 19999, 29999, 40000]) expect(isAddressable(kind)).toBe(false)

		// the same pair, over an event
		expect(isReplaceable(version({ kind: 3, created_at: 1, content: '' }))).toBe(true)
		expect(isReplaceable(version({ kind: 30402, d: 'x', created_at: 1, content: '' }))).toBe(false)
		expect(isAddressable(version({ kind: 30402, d: 'x', created_at: 1, content: '' }))).toBe(true)
		expect(isAddressable(version({ kind: 10002, created_at: 1, content: '' }))).toBe(false)
	})
})

describe('tag accessors', () => {
	const event = signedEvent({
		kind: 1,
		content: 'tags',
		created_at: 1000,
		tags: [['t', 'first'], ['t', 'second'], ['d']],
	})

	test("tagValue · the first matching tag's value, and undefined when no tag matches", () => {
		expect(tagValue(event, 't')).toBe('first')
		expect(tagValue(event, 'missing')).toBeUndefined()
		// a tag with no value is not a value
		expect(tagValue(event, 'd')).toBeUndefined()
	})

	test('getMatchingTags · every matching tag, and an empty list when none matches', () => {
		expect(getMatchingTags(event, 't')).toEqual([
			['t', 'first'],
			['t', 'second'],
		])
		expect(getMatchingTags(event, 'd')).toEqual([['d']])
		expect(getMatchingTags(event, 'missing')).toEqual([])
	})
})

describe('provenance', () => {
	test('isFromCache · false for a fresh event, true for an event a read answered', async () => {
		const store = createEventStore()
		const fresh = signedEvent({ kind: 1, content: 'fresh', created_at: 1000 })
		expect(isFromCache(fresh)).toBe(false)

		await store.write([fresh])
		const result: Event[] = await store.read({ kinds: [1] })
		expect(result).toHaveLength(1)
		expect(isFromCache(result[0])).toBe(true)
	})
})
