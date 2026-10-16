/**
 * productSource.test.ts — the injected edge, with nothing on the wire.
 *
 * ADR-0005 binds these cases: no external service is reached. The relay case is
 * possible to write at all because `sdk/core/nostr-io` takes its **transport as
 * an injected `PoolPort`** (`NostrIoOptions.pool`), so the app can compose the
 * real seam — real policy, real query, real admission, real head rule — against
 * a hand-written pool and open no socket. A global `fetch` spy that throws is
 * installed for the duration, so "no network" is asserted rather than assumed.
 *
 * The mutations that turn these red (each applied and reverted; the red run is
 * recorded in the slice's report):
 * - `createInstanceNostrIo` dropping `options.pool` (falling back to the vendor
 *   adapter): the recording pool is never called, `captured` stays empty, and the
 *   fetch spy is no longer the only thing between the test and a socket.
 * - deleting `latestRevisionPerAddress(admitted)` from the **relay** read: the
 *   stale revision stops being collapsed and both revisions come back. (Note the
 *   fixture read needs no such case — its catalog is one address per listing, so
 *   the collapse is a no-op there and only the unit cases below hold it.)
 * - inverting the head rule's comparison: the oldest revision wins instead of the
 *   newest, which breaks both the relay case and the unit case.
 * - passing `admit: null` into `createFixtureProductSource`: the malformed
 *   listing comes back as a row.
 *
 * The kind-30406 read has its own mutations, named beside its cases below: the relay
 * adapter not asking for kind 30406 at all (the pre-fix state), and the source reporting
 * "not read" (`null`) for an answer that was read and empty.
 */

import { describe, expect, test } from 'bun:test'
import { of } from 'rxjs'

import type { Event as NostrEvent } from '@sdk/core/nostr-io/ts/index'
import type { ProductReadEvent } from '@sdk/commerce/discovery'
import { readShippingOptions } from '@sdk/commerce/shipping/shippingRead'
import { SHIPPING_OPTION_KIND } from '@sdk/commerce/shipping/shippingWorkflow'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY, DEMO_SHIPPING_REF } from './catalog'
import {
	createFixtureProductSource,
	createInstanceNostrIo,
	createRelayProductSource,
	latestRevisionPerAddress,
	type InjectedPool,
} from './productSource'

const catalog = buildCatalogEvents()

interface CapturedRequest {
	relays: string[]
	filters: unknown[]
}

/** A hand-written transport. It has the wire's verbs and no socket. */
function recordingPool(events: readonly unknown[], captured: CapturedRequest[]): InjectedPool {
	return {
		request(relays, filters) {
			captured.push({ relays, filters })
			return of(...(events as NostrEvent[]))
		},
		subscribe() {
			throw new Error('the relay product source must not subscribe in this test')
		},
		async publish() {
			return []
		},
		async count() {
			return { count: 0, approximate: true }
		},
		status() {
			return []
		},
		close() {
			// nothing is open
		},
	}
}

async function withoutNetwork<T>(run: () => Promise<T>): Promise<{ result: T; fetchCalls: number }> {
	const originalFetch = globalThis.fetch
	let fetchCalls = 0
	globalThis.fetch = ((...args: unknown[]) => {
		fetchCalls += 1
		throw new Error(`network access in a test: ${String(args[0])}`)
	}) as unknown as typeof fetch
	try {
		return { result: await run(), fetchCalls }
	} finally {
		globalThis.fetch = originalFetch
	}
}

describe('the fixture edge', () => {
	test('admits the catalog, collapses nothing away, and reports its kind', async () => {
		const source = createFixtureProductSource(catalog)
		const items = await source.listProducts()

		expect(source.kind).toBe('fixture')
		expect(items.map((item) => item.tags.find((tag) => tag[0] === 'd')?.[1])).toEqual([
			'wool-coat',
			'cast-iron-pan',
			'linen-shirt',
			'ceramic-mug',
			'field-notebook',
			'hidden-draft',
		])
	})

	test('drops a listing admission rejects rather than passing it through', async () => {
		const malformed: ProductReadEvent = { pubkey: DEMO_SELLER_PUBKEY, created_at: 1, content: 'no price', tags: [['d', 'x'], ['title', 'X']] }
		const source = createFixtureProductSource([...catalog, malformed])

		expect((await source.listProducts()).map((item) => item.tags.find((tag) => tag[0] === 'd')?.[1])).not.toContain('x')
	})

	test('returns copies, so one caller cannot corrupt the next read', async () => {
		const source = createFixtureProductSource(catalog)
		const first = await source.listProducts()
		first[0]?.tags.push(['t', 'tampered'])

		const second = await source.listProducts()
		expect(second[0]?.tags.some((tag) => tag[1] === 'tampered')).toBe(false)
		expect(catalog[0]?.tags.some((tag) => tag[1] === 'tampered')).toBe(false)
	})
})

describe('the relay edge, with the transport injected and no socket opened', () => {
	test('reads through the SDK seam, admits, and collapses a stale revision', async () => {
		const captured: CapturedRequest[] = []
		const fresh = catalog[0] as ProductReadEvent
		const stale: ProductReadEvent = { ...fresh, created_at: (fresh.created_at ?? 0) - 1_000, tags: [...fresh.tags, ['summary', 'an older revision']] }
		const garbage = { kind: 1, pubkey: DEMO_SELLER_PUBKEY, created_at: 1, content: 'not a listing', tags: [], id: 'x', sig: 'y' }
		// Deliberately: the stale revision arrives LAST, so arrival order cannot decide.
		const wireEvents = [fresh, garbage, stale]

		const io = createInstanceNostrIo({ relayUrls: ['wss://relay.one.test'], pool: recordingPool(wireEvents, captured) })
		const source = createRelayProductSource({ io })

		const { result: items, fetchCalls } = await withoutNetwork(() => source.listProducts())

		expect(fetchCalls).toBe(0)
		expect(source.kind).toBe('relay')
		expect(items).toHaveLength(1)
		expect(items[0]?.created_at).toBe(fresh.created_at)
		expect(items[0]?.tags.some((tag) => tag[1] === 'an older revision')).toBe(false)

		// The instance config's relay set is what the seam handed the wire.
		expect(captured).toHaveLength(1)
		expect(captured[0]?.relays[0]).toContain('relay.one.test')
		expect((captured[0]?.filters[0] as { kinds?: number[] } | undefined)?.kinds).toEqual([30402])
	})

	test('an injected admission predicate decides, so a drop can be driven', async () => {
		const captured: CapturedRequest[] = []
		const io = createInstanceNostrIo({ relayUrls: ['wss://relay.one.test'], pool: recordingPool(catalog, captured) })
		const source = createRelayProductSource({ io, admit: () => null })

		await withoutNetwork(async () => {
			expect(await source.listProducts()).toEqual([])
		})
		expect(captured).toHaveLength(1)
	})
})

describe('one head per addressable address', () => {
	test('keeps the greater created_at whatever the arrival order', () => {
		const fresh = catalog[0] as ProductReadEvent
		const stale: ProductReadEvent = { ...fresh, created_at: (fresh.created_at ?? 0) - 1_000 }
		const older: ProductReadEvent = { ...fresh, created_at: (fresh.created_at ?? 0) - 2_000 }

		expect(latestRevisionPerAddress([fresh, stale, older])).toHaveLength(1)
		expect(latestRevisionPerAddress([fresh, stale, older])[0]?.created_at).toBe(fresh.created_at)
		expect(latestRevisionPerAddress([stale, older, fresh])[0]?.created_at).toBe(fresh.created_at)
	})

	test('two different addresses are two rows', () => {
		expect(latestRevisionPerAddress(catalog)).toHaveLength(catalog.length)
	})
})

describe('the kind-30406 read, on both edges and still with nothing on the wire', () => {
	/**
	 * The mutation that turns the relay cases here red: drop the second `io.query` from
	 * `listShippingRecords` (return `[]`, the pre-fix "the relay adapter reads listings and
	 * only listings"), and the 30406 REQ never reaches the pool — `captured` holds no
	 * `kinds: [30406]` and the ref stops resolving.
	 */
	test('the fixture edge states the demo’s own shipping record, and reads it back', async () => {
		const source = createFixtureProductSource(catalog)
		const records = await source.listShippingRecords()

		expect(records).not.toBeNull()
		const { services, refusals } = readShippingOptions(records ?? [])
		expect(refusals).toEqual([])
		expect(services.map((service) => service.ref)).toEqual([DEMO_SHIPPING_REF])
		expect(services[0]?.service).toBe('standard')
	})

	test('a fixture edge can state that it reads no shipping corpus at all', async () => {
		const source = createFixtureProductSource(catalog, { shippingRecords: null })

		expect(await source.listShippingRecords()).toBeNull()
	})

	/** A pool that files events under the kind the REQ asked for, so one read cannot answer the other. */
	function kindRoutedPool(byKind: Record<number, readonly unknown[]>, captured: CapturedRequest[]): InjectedPool {
		return {
			request(relays, filters) {
				captured.push({ relays, filters })
				const kinds = (filters as { kinds?: number[] }[])[0]?.kinds ?? []
				return of(...(kinds.flatMap((kind) => byKind[kind] ?? []) as NostrEvent[]))
			},
			subscribe() {
				throw new Error('the relay product source must not subscribe in this test')
			},
			async publish() {
				return []
			},
			async count() {
				return { count: 0, approximate: true }
			},
			status() {
				return []
			},
			close() {
				// nothing is open
			},
		}
	}

	// A record the wire answers with. Its service is `express` on purpose: the ref every
	// listing publishes ends in `:standard`, so a service read out of the ref's own text
	// could never produce this value.
	const wireRecord = {
		kind: SHIPPING_OPTION_KIND,
		pubkey: DEMO_SELLER_PUBKEY,
		created_at: 1_760_000_700,
		content: '',
		tags: [['d', 'standard'], ['title', 'Express'], ['price', '250', 'SAT'], ['service', 'express'], ['country', 'FR']],
		id: 'wire-record',
		sig: 'sig',
	}

	test('the relay edge reads kind-30406 through the same injected seam as the listings', async () => {
		const captured: CapturedRequest[] = []
		const io = createInstanceNostrIo({
			relayUrls: ['wss://relay.one.test'],
			pool: kindRoutedPool({ [30402]: catalog, [SHIPPING_OPTION_KIND]: [wireRecord] }, captured),
		})
		const source = createRelayProductSource({ io })

		const { result: records, fetchCalls } = await withoutNetwork(() => source.listShippingRecords())

		expect(fetchCalls).toBe(0)
		expect(captured).toHaveLength(1)
		// The read asked the wire for kind 30406 — the seam that makes it a read, not a guess.
		expect((captured[0]?.filters[0] as { kinds?: number[] } | undefined)?.kinds).toEqual([SHIPPING_OPTION_KIND])

		const { services, refusals } = readShippingOptions(records ?? [])
		expect(refusals).toEqual([])
		expect(services.map((service) => service.ref)).toEqual([DEMO_SHIPPING_REF])
		expect(services[0]?.service).toBe('express')
	})

	/**
	 * The mutation that turns this red: `return wire.events.length === 0 ? null : wire.events`
	 * — an answer that was read and empty would then be reported as an edge that read
	 * nothing, which is the exact confusion this slice exists to remove.
	 */
	test('a relay answer that held no kind-30406 event is an empty corpus, never null', async () => {
		const captured: CapturedRequest[] = []
		const io = createInstanceNostrIo({ relayUrls: ['wss://relay.one.test'], pool: recordingPool([], captured) })
		const source = createRelayProductSource({ io })

		const records = await source.listShippingRecords()

		expect(records).not.toBeNull()
		expect(records).toEqual([])
	})
})