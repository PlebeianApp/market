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
 * The mutations that turn these red:
 * - `createInstanceNostrIo` dropping `options.pool` (falling back to the vendor
 *   adapter): the recording pool is never called, `captured` stays empty, and the
 *   fetch spy is no longer the only thing between the test and a socket.
 * - deleting `latestRevisionPerAddress`: the stale revision stops being collapsed
 *   and both revisions come back.
 * - passing `admit: null` into `createFixtureProductSource`: the malformed
 *   listing comes back as a row.
 */

import { describe, expect, test } from 'bun:test'
import { of } from 'rxjs'

import type { Event as NostrEvent } from '@sdk/core/nostr-io/ts/index'
import type { ProductReadEvent } from '@sdk/commerce/discovery'

import { buildCatalogEvents, DEMO_SELLER_PUBKEY } from './catalog'
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