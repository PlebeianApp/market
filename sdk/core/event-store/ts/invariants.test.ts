/**
 * invariants.test.ts — M1–M14 as named cases, one where the module can prove one
 * on its own.
 *
 * Every read below is typed against the **contract's own types** (`Event[]`,
 * `CountResult`, `EndpointWriteOutcome`) rather than against an inferred shape:
 * that is what makes the module's `tsc --noEmit` the case for M1/E1 — an
 * `Observable`, or a library type, in a caller-facing signature fails the
 * typecheck rather than this file.
 *
 * Each case names the careless implementation it fails on; the increment's
 * falsification run breaks one of them per invariant and proves they can fail.
 */
import { describe, expect, test } from 'bun:test'

import { StoreError, assertIdentityFilters, collapseToHeads, createEventStore, isFromCache } from './index'
import type { CountResult, EndpointWriteOutcome, Event, FilterIn, StoreEndpoint } from './index'
import { NOT_A_RELAY_EDGE, OTHER_KEY, OTHER_PUBKEY, PUBKEY, manualClock, signedEvent, version } from './harness'

const ADDRESSABLE = 30402

describe('M1–M2', () => {
	test('M1 · a read returns raw nostr-tools events', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'm1', created_at: 1000 })
		await store.write([event])

		const result: Event[] = await store.read({ kinds: [1] })
		expect(result).toHaveLength(1)
		const read: Event = result[0]
		// a wrapper, a proxy or a class instance would fail all three:
		expect(Object.getPrototypeOf(read)).toBe(Object.prototype)
		expect(Object.keys(read).sort()).toEqual(['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'])
		expect(read.id).toBe(event.id)
	})

	test('M2 · an event matched by two filters is returned once', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'm2', created_at: 1000 })
		await store.write([event])

		const result: Event[] = await store.read([{ ids: [event.id] }, { kinds: [1] }])
		expect(result.map((candidate) => candidate.id)).toEqual([event.id])
	})
})

describe('M3', () => {
	test('M3 · one head per address, ties broken by the lexicographically lower id', async () => {
		const store = createEventStore()
		const a = version({ kind: ADDRESSABLE, d: 'listing', created_at: 2000, content: 'a' })
		const b = version({ kind: ADDRESSABLE, d: 'listing', created_at: 2000, content: 'b' })
		const lower = a.id < b.id ? a : b
		const higher = a.id < b.id ? b : a

		// the later arrival is the higher id, so an implementation that keeps what arrived last fails
		await store.write([lower])
		await store.write([higher])
		expect((await store.read({ kinds: [ADDRESSABLE] })).map((candidate) => candidate.id)).toEqual([lower.id])

		// and a newer created_at wins outright
		const newer = version({ kind: ADDRESSABLE, d: 'listing', created_at: 3000, content: 'newer' })
		await store.write([newer])
		expect((await store.read({ kinds: [ADDRESSABLE] })).map((candidate) => candidate.id)).toEqual([newer.id])
	})

	test('M3 · the collapse does not depend on the input order', () => {
		const a = version({ kind: 30000, d: 'x', created_at: 5000, content: 'a' })
		const b = version({ kind: 30000, d: 'x', created_at: 5000, content: 'b' })

		const forward = collapseToHeads([a, b])
		const backward = collapseToHeads([b, a])
		expect(forward).toHaveLength(1)
		expect(forward.map((candidate) => candidate.id)).toEqual(backward.map((candidate) => candidate.id))
	})
})

describe('M7', () => {
	test("M7 · a malformed identity value rejects with reason 'rejected'", async () => {
		const store = createEventStore()
		await store.write([signedEvent({ kind: 1, content: 'm7', created_at: 1000 })])

		for (const authors of [['alice'], [''], ['ABCDEF'], ['ab'.repeat(33)]]) {
			const failed = await store.read({ authors }).catch((error: unknown) => error)
			expect(failed).toBeInstanceOf(StoreError)
			expect((failed as StoreError).reason).toBe('rejected')
			// nothing was repaired and nothing was returned in its place
			expect(failed as unknown).not.toBeInstanceOf(Array)
		}

		// the predicate itself is exported (D-O18) and rejects a malformed filter
		// synchronously: no repair, no empty list in its place.
		expect(() => assertIdentityFilters([{ authors: ['alice'] }])).toThrow(StoreError)

		// and a string that is not an id is a rejection, never a silent `{removed: 0}`
		const removed = await store.remove(['not-an-event-id']).catch((error: unknown) => error)
		expect(removed).toBeInstanceOf(StoreError)
		expect((removed as StoreError).reason).toBe('rejected')
	})

	test('M7 · an empty identity list matches nothing and is not broadened', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'm7-empty', created_at: 1000 })
		await store.write([event])

		const all: Event[] = await store.read({ kinds: [1] })
		expect(all.map((candidate) => candidate.id)).toEqual([event.id])

		// NIP-01: an empty list matches nothing. Dropping the key would return the whole store.
		const none: Event[] = await store.read({ kinds: [1], authors: [] })
		expect(none).toEqual([])
		const counted: CountResult = await store.count({ kinds: [1], authors: [] })
		expect(counted.count).toBe(0)
	})

	test('M7 · an empty identity list is answered as nothing on every surface', async () => {
		const store = createEventStore()
		const tagged = signedEvent({ kind: 1, content: 'tags bob', created_at: 1000, tags: [['p', OTHER_PUBKEY]] })
		await store.write([tagged])

		// the populated form is the control: the key filters when it names someone
		expect((await store.read({ kinds: [1], '#p': [OTHER_PUBKEY] })).map((candidate) => candidate.id)).toEqual([tagged.id])
		// ...and it matches nothing when it names nobody, so the empty form below is not
		// "the same as not filtering" either
		expect(await store.read({ kinds: [1], '#p': [PUBKEY] })).toEqual([])

		// the empty form on every identity tag key, on both readers of the same predicate
		const emptyE: FilterIn = { kinds: [1], '#e': [] }
		const emptyP: FilterIn = { kinds: [1], '#p': [] }
		const emptyUpperP: FilterIn = { kinds: [1], '#P': [] }
		for (const empty of [emptyE, emptyP, emptyUpperP]) {
			expect(await store.read(empty)).toEqual([])
			expect((await store.count(empty)).count).toBe(0)
		}

		// the empty list alone must not be NIP-01's empty filter, which matches everything
		expect(await store.read({ '#p': [] })).toEqual([])
		expect((await store.read({})).map((candidate) => candidate.id)).toEqual([tagged.id])

		// a filter that matches nothing contributes nothing to an OR union either
		expect((await store.read([{ kinds: [1] }, { '#p': [] }])).map((candidate) => candidate.id)).toEqual([tagged.id])

		// and a removal scoped by the same filter removes nothing and takes nothing with it
		expect((await store.remove([{ '#p': [] }])).removed).toBe(0)
		expect((await store.read({ kinds: [1] })).map((candidate) => candidate.id)).toEqual([tagged.id])
	})
})

describe('M9', () => {
	test('M9 · a local removal is temporary, and re-writing the same event restores it', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'removable', created_at: 1000 })
		await store.write([event])

		expect((await store.remove([event.id])).removed).toBe(1)
		expect(await store.read({ kinds: [1] })).toEqual([])

		await store.write([event])
		expect((await store.read({ kinds: [1] })).map((candidate) => candidate.id)).toEqual([event.id])
	})

	test("M9 · a kind-5 deletion is honoured for its own author's event only", async () => {
		const store = createEventStore()
		const target = signedEvent({ kind: 1, content: 'target', created_at: 1000 })
		const stranger = signedEvent({ kind: 1, content: 'stranger', created_at: 1000 }, OTHER_KEY)
		await store.write([target])
		await store.write([stranger])

		// a kind-5 naming the target, signed by ANOTHER author: it deletes nothing of the target's
		const foreign = signedEvent({ kind: 5, content: '', created_at: 1500, tags: [['e', target.id]] }, OTHER_KEY)
		await store.write([foreign])
		const afterForeign = (await store.read({ kinds: [1] })).map((candidate) => candidate.id)
		expect(afterForeign).toContain(target.id)
		expect(afterForeign).toContain(stranger.id)

		// the same reference, signed by the target's own author: it binds
		const own = signedEvent({ kind: 5, content: '', created_at: 1500, tags: [['e', target.id]] })
		await store.write([own])
		const afterOwn = (await store.read({ kinds: [1] })).map((candidate) => candidate.id)
		expect(afterOwn).not.toContain(target.id)
		expect(afterOwn).toContain(stranger.id)
	})

	test('M9 · a kind-5 deletion is stored, and does not remove a newer version of the address', async () => {
		const store = createEventStore()
		const old = version({ kind: ADDRESSABLE, d: 'listing', created_at: 1000, content: 'old' })
		await store.write([old])

		const deletion = signedEvent({
			kind: 5,
			content: '',
			created_at: 1500,
			tags: [['a', `${ADDRESSABLE}:${PUBKEY}:listing`]],
		})
		await store.write([deletion])

		// the deletion is durable and readable — it is stored, not swallowed
		expect((await store.read({ kinds: [5] })).map((candidate) => candidate.id)).toEqual([deletion.id])
		expect(await store.read({ kinds: [ADDRESSABLE] })).toEqual([])

		// and it does not delete the address forever: a version newer than the deletion is the head
		const newer = version({ kind: ADDRESSABLE, d: 'listing', created_at: 2000, content: 'newer' })
		await store.write([newer])
		expect((await store.read({ kinds: [ADDRESSABLE] })).map((candidate) => candidate.id)).toEqual([newer.id])
		// the deleted version stays excluded, even when every version is asked for
		const every = await store.read({ kinds: [ADDRESSABLE] }, { keepOldVersions: true })
		expect(every.map((candidate) => candidate.id)).toEqual([newer.id])
	})

	test('M9 · an expired event is excluded on read unless keepExpired, at the boundary expiration === now', async () => {
		const clock = manualClock(5000)
		const store = createEventStore({ clock })
		const expiring = signedEvent({ kind: 1, content: 'expiring', created_at: 1000, tags: [['expiration', '5000']] })
		await store.write([expiring])

		// NIP-40's boundary is `>=`: at exactly `now` the event is expired
		expect(await store.read({ kinds: [1] })).toEqual([])
		expect((await store.read({ kinds: [1] }, { keepExpired: true })).map((candidate) => candidate.id)).toEqual([expiring.id])

		// one second earlier it is still live
		clock.set(4999)
		expect((await store.read({ kinds: [1] })).map((candidate) => candidate.id)).toEqual([expiring.id])

		// a value that is not base-10 seconds is not an expiry at all
		const malformed = signedEvent({ kind: 1, content: 'malformed', created_at: 1000, tags: [['expiration', 'later']] })
		await store.write([malformed])
		clock.set(100_000)
		expect((await store.read({ kinds: [1] })).map((candidate) => candidate.id)).toEqual([malformed.id])
	})
})

describe('M11–M14', () => {
	test('M11 · a store with no database is fully functional', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'memory only', created_at: 1000 })
		const outcome: EndpointWriteOutcome = await store.write([event])
		expect(outcome).toEqual({ stored: 1, refused: 0 })

		const result: Event[] = await store.read({ kinds: [1] })
		expect(result.map((candidate) => candidate.id)).toEqual([event.id])
		expect((await store.count({ kinds: [1] })).count).toBe(1)
	})

	test("M12 · a read's events satisfy isFromCache; a never-stored event does not", async () => {
		const store = createEventStore()
		const fresh = signedEvent({ kind: 1, content: 'fresh', created_at: 1000 })
		expect(isFromCache(fresh)).toBe(false)

		await store.write([fresh])
		const result: Event[] = await store.read({ kinds: [1] })
		expect(result).toHaveLength(1)
		expect(isFromCache(result[0])).toBe(true)

		// an event that has never been through a read is not claimed as locally answered
		expect(isFromCache(signedEvent({ kind: 1, content: 'other', created_at: 1000 }))).toBe(false)
	})

	test('M5 + M14 · no socket is required: the handle is exactly the endpoint, and the count is local', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'local', created_at: 1000 })
		await store.write([event])

		const result: Event[] = await store.read({ kinds: [1] })
		expect(result.map((candidate) => candidate.id)).toEqual([event.id])

		// M14 · the count is the read's own set at the same instant, answered locally
		const counted: CountResult = await store.count({ kinds: [1] })
		expect(counted.count).toBe(result.length)

		// M5, structurally: the handle's own enumerable members are exactly the endpoint's
		// members, the declared eviction policy, and the one deliberate store accessor
		// `modelStore` — so no second surface and no relay edge can appear silently. The
		// names `NOT_A_RELAY_EDGE` forbids must all be absent.
		expect(Object.keys(store).sort()).toEqual(['changes', 'count', 'eviction', 'modelStore', 'read', 'remove', 'tier', 'write'])
		for (const name of NOT_A_RELAY_EDGE) expect(Object.keys(store)).not.toContain(name)

		// And the declared shape is satisfied **structurally**, with no adapter: this assignment is a
		// compile-time fact — `tsc --noEmit` is one of the twelve checks — so a drift breaks the build
		// rather than a review. `tier` is declared by the endpoint, not guessed by its consumer.
		const asEndpoint: StoreEndpoint = store
		expect(asEndpoint.tier).toBe('local')
	})

	test('M14 · write counts a verification failure in refused, and stores nothing', async () => {
		const store = createEventStore()
		const event = signedEvent({ kind: 1, content: 'honest', created_at: 1000 })
		// Written out field by field on purpose: `nostr-tools` caches its verification on the event
		// under a symbol, and an object spread copies own symbols — so `{ ...event, content }` would
		// still claim to be verified and the case would prove nothing.
		const tampered: Event = {
			id: event.id,
			pubkey: event.pubkey,
			created_at: event.created_at,
			kind: event.kind,
			tags: event.tags,
			content: 'tampered',
			sig: event.sig,
		}

		const refused: EndpointWriteOutcome = await store.write([tampered])
		expect(refused).toEqual({ stored: 0, refused: 1 })
		expect(await store.read({ kinds: [1] })).toEqual([])

		const accepted: EndpointWriteOutcome = await store.write([event])
		expect(accepted).toEqual({ stored: 1, refused: 0 })
	})

	test('M13 · stopping the change stream is idempotent and ends it', async () => {
		const store = createEventStore()
		const stream = store.changes
		const iterator = stream[Symbol.asyncIterator]()
		const pending = iterator.next()

		await iterator.return?.()
		await iterator.return?.()

		const result = await pending
		expect(result.done).toBe(true)

		// a later write emits nothing, and the iterator stays ended
		await store.write([signedEvent({ kind: 1, content: 'after', created_at: 1000 })])
		expect((await iterator.next()).done).toBe(true)
	})
})
