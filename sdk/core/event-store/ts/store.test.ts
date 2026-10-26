/**
 * store.test.ts — the endpoint's members through the contract.
 *
 * These are the operational cases: what a caller observes from `read`, `count`,
 * `write`, `remove` and `changes`. Every read is typed against the contract's own
 * types, so a caller-facing library type would fail the module's typecheck rather
 * than this suite.
 */
import { describe, expect, test } from 'bun:test'
import { mapEventsToStore } from 'applesauce-core/observable'
import type { Filter } from 'nostr-tools'
import { firstValueFrom, from, toArray, timeout, type Observable } from 'rxjs'

import { StoreError, createEventStore } from './index'
import type { CountResult, EndpointWriteOutcome, Event } from './index'
import { OTHER_KEY, PUBKEY, manualClock, signedEvent, take, version } from './harness'

const ADDRESSABLE = 30402

describe('read', () => {
	test('read · descending created_at, id-unique', async () => {
		const store = createEventStore()
		const older = signedEvent({ kind: 1, content: 'older', created_at: 1000 })
		const middle = signedEvent({ kind: 1, content: 'middle', created_at: 2000 })
		const newer = signedEvent({ kind: 1, content: 'newer', created_at: 3000 })
		for (const event of [older, newer, middle]) await store.write([event])

		// the same filter twice, plus a subset: the union is still one of each
		const result: Event[] = await store.read([{ kinds: [1] }, { kinds: [1] }, { ids: [middle.id] }])
		expect(result.map((candidate) => candidate.id)).toEqual([newer.id, middle.id, older.id])
		expect(new Set(result.map((candidate) => candidate.id)).size).toBe(3)
	})

	test("read · several filters are OR-ed and a per-filter limit slices each filter's own newest N", async () => {
		const store = createEventStore()
		const a1 = signedEvent({ kind: 1, content: 'a1', created_at: 1000 })
		const a2 = signedEvent({ kind: 1, content: 'a2', created_at: 2000 })
		const a3 = signedEvent({ kind: 1, content: 'a3', created_at: 3000 })
		const b1 = signedEvent({ kind: 7, content: 'b1', created_at: 500 })
		const b2 = signedEvent({ kind: 7, content: 'b2', created_at: 1500 })
		for (const event of [a1, a2, a3, b1, b2]) await store.write([event])

		const result: Event[] = await store.read([
			{ kinds: [1], limit: 2 },
			{ kinds: [7], limit: 1 },
		])
		// kind 1's newest two (a3, a2) ∪ kind 7's newest one (b2), in the read's own order
		expect(result.map((candidate) => candidate.id)).toEqual([a3.id, a2.id, b2.id])
	})

	test('read · an older version is returned when the newer one is outside the since/until window', async () => {
		const store = createEventStore()
		const old = version({ kind: ADDRESSABLE, d: 'listing', created_at: 1000, content: 'old' })
		const recent = version({ kind: ADDRESSABLE, d: 'listing', created_at: 5000, content: 'recent' })
		await store.write([old])
		await store.write([recent])

		// the window is the store's to honour: collapsing before filtering would answer nothing at all
		const window: Event[] = await store.read({ kinds: [ADDRESSABLE], until: 2000 })
		expect(window.map((candidate) => candidate.id)).toEqual([old.id])
		const both: Event[] = await store.read({ kinds: [ADDRESSABLE] })
		expect(both.map((candidate) => candidate.id)).toEqual([recent.id])
	})

	test('read · keepOldVersions returns every version', async () => {
		const store = createEventStore()
		const old = version({ kind: ADDRESSABLE, d: 'listing', created_at: 1000, content: 'old' })
		const newer = version({ kind: ADDRESSABLE, d: 'listing', created_at: 5000, content: 'newer' })
		await store.write([old])
		await store.write([newer])

		const every: Event[] = await store.read({ kinds: [ADDRESSABLE] }, { keepOldVersions: true })
		expect(every.map((candidate) => candidate.id)).toEqual([newer.id, old.id])
		const head: Event[] = await store.read({ kinds: [ADDRESSABLE] })
		expect(head.map((candidate) => candidate.id)).toEqual([newer.id])

		// the store-level default is the same three names, and one read may override it
		const keeping = createEventStore({ keepOldVersions: true })
		await keeping.write([old])
		await keeping.write([newer])
		expect(await keeping.read({ kinds: [ADDRESSABLE] })).toHaveLength(2)
		expect(await keeping.read({ kinds: [ADDRESSABLE] }, { keepOldVersions: false })).toHaveLength(1)
	})
})

describe('count', () => {
	test('count · equals the size of the set read would return at the same instant', async () => {
		const clock = manualClock(5000)
		const store = createEventStore({ clock })
		const live = signedEvent({ kind: 1, content: 'live', created_at: 1000 })
		const other = signedEvent({ kind: 1, content: 'other', created_at: 2000 }, OTHER_KEY)
		const expired = signedEvent({ kind: 1, content: 'expired', created_at: 1000, tags: [['expiration', '4000']] })
		for (const event of [live, other, expired]) await store.write([event])

		const filters = [{ kinds: [1] }, { authors: [PUBKEY] }]
		const counted: CountResult = await store.count(filters)
		const read: Event[] = await store.read(filters)
		expect(counted.count).toBe(read.length)
		expect(counted.approximate).toBe(false)

		// the expired event is excluded by default, and the two live ones are not
		expect((await store.count({ kinds: [1] })).count).toBe(2)
		// a per-read override changes the read, and never the count: the count takes no options
		expect(await store.read({ kinds: [1] }, { keepExpired: true })).toHaveLength(3)
		expect((await store.count({ kinds: [1] })).count).toBe(2)
	})
})

describe('write', () => {
	test('write · a kind-5 event is stored and its target stops being returned', async () => {
		const store = createEventStore()
		const target = signedEvent({ kind: 1, content: 'target', created_at: 1000 })
		await store.write([target])

		const deletion = signedEvent({ kind: 5, content: '', created_at: 2000, tags: [['e', target.id]] })
		const outcome: EndpointWriteOutcome = await store.write([deletion])
		expect(outcome).toEqual({ stored: 1, refused: 0 })

		// the deletion itself is an event, and it is readable
		expect((await store.read({ kinds: [5] })).map((candidate) => candidate.id)).toEqual([deletion.id])
		expect(await store.read({ kinds: [1] })).toEqual([])
		// unless the caller asks for deleted events
		expect((await store.read({ kinds: [1] }, { keepDeleted: true })).map((candidate) => candidate.id)).toEqual([target.id])
	})
})

describe('remove', () => {
	test('remove · by id and by filter return the number removed, and a malformed ref rejects', async () => {
		const store = createEventStore()
		const first = signedEvent({ kind: 1, content: 'first', created_at: 1000 })
		const second = signedEvent({ kind: 1, content: 'second', created_at: 2000 })
		await store.write([first])
		await store.write([second])

		expect((await store.remove([first.id])).removed).toBe(1)
		expect((await store.remove([first.id])).removed).toBe(0)
		expect((await store.remove([{ authors: [PUBKEY] }])).removed).toBe(1)

		const malformedId = await store.remove(['zz']).catch((error: unknown) => error)
		expect(malformedId).toBeInstanceOf(StoreError)
		expect((malformedId as StoreError).reason).toBe('rejected')
		const malformedFilter = await store.remove([{ authors: ['not-hex'] }]).catch((error: unknown) => error)
		expect(malformedFilter).toBeInstanceOf(StoreError)
		expect((malformedFilter as StoreError).reason).toBe('rejected')
	})
})

describe('changes', () => {
	test('changes · a local write arrives in order, and exactly once', async () => {
		const store = createEventStore()
		const first = signedEvent({ kind: 1, content: 'first', created_at: 1000 })
		const second = signedEvent({ kind: 1, content: 'second', created_at: 2000 })

		const stream = store.changes
		const collecting = take(stream, 2)
		await store.write([first, second])
		const arrived = await collecting
		expect(arrived.map((candidate) => candidate.id)).toEqual([first.id, second.id])

		// exactly once: a second copy would arrive, and `take` would resolve instead of timing out
		const extra = await take(stream, 1, 100).catch((error: unknown) => error)
		expect(extra).toBeInstanceOf(Error)
		expect(extra as unknown).not.toBeInstanceOf(Array)
	})

	test('changes · a consumer that never iterates subscribes to nothing', async () => {
		const store = createEventStore()
		const early = signedEvent({ kind: 1, content: 'early', created_at: 1000 })
		const late = signedEvent({ kind: 1, content: 'late', created_at: 2000 })

		// the stream is held but never read, and then written to: the write before the
		// first iteration is not captured, and the one after it is
		const stream = store.changes
		await store.write([early])

		const collecting = take(stream, 1)
		await store.write([late])
		const arrived = await collecting
		expect(arrived.map((candidate) => candidate.id)).toEqual([late.id])
	})
})

/**
 * The vendor's `CacheRequest`, spelled here because that loader package is not this module's dependency. It is
 * the type the vendor loaders expect (`applesauce-loaders` `dist/types.d.ts:5`): an `Observable`, a `Promise`, a
 * single event, or an array — verbatim, with no adapter and no widening. The assignment below is the check.
 */
type CacheRequest = (filters: Filter[]) => Observable<Event> | Promise<Event | Event[]> | Event | Event[]

describe('modelStore', () => {
	test('modelStore · a vendor timeline subscription sees the event the module already stored', async () => {
		const store = createEventStore()
		// Seed through the module's own write path, then read through the accessor: if `modelStore()` handed
		// out a second, freshly-constructed store the seeded event would not be in it.
		const gift = signedEvent({ kind: 1059, content: 'sealed', created_at: 1000, tags: [['p', PUBKEY]] })
		await store.write([gift])

		// `timeout` turns "the accessor is a different store" into a failing case rather than a hanging one.
		const timeline = await firstValueFrom(
			store
				.modelStore()
				.timeline({ kinds: [1059], '#p': [PUBKEY] })
				.pipe(timeout(500)),
		)
		expect(timeline.map((candidate) => candidate.id)).toEqual([gift.id])
	})

	test('modelStore · a loader writes into the store, and read answers what it wrote', async () => {
		const store = createEventStore()
		const first = signedEvent({ kind: 1, content: 'first', created_at: 1000 })
		const second = signedEvent({ kind: 1, content: 'second', created_at: 2000 })

		// The write direction the loaders need, through the accessor and no adapter.
		await firstValueFrom(from([first, second]).pipe(mapEventsToStore(store.modelStore()), toArray()))

		const read: Event[] = await store.read({ kinds: [1] })
		expect(read.map((candidate) => candidate.id).sort()).toEqual([first.id, second.id].sort())
	})

	test('modelStore · read satisfies the vendor CacheRequest with no adapter', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'cached', created_at: 1000 })
		await store.write([event])

		// The assignment is the structural match: a shape drift fails the typecheck, not a review.
		const cache: CacheRequest = store.read
		const answer = await cache([{ kinds: [1] }])

		expect(Array.isArray(answer)).toBe(true)
		expect((answer as Event[]).map((candidate) => candidate.id)).toEqual([event.id])
	})
})
