/**
 * Set-level regression tests for `fetchNdkEventSet`.
 *
 * Relays routinely serve conflicting `created_at` versions of the same
 * addressable event: replaceable (kind 0/3/1e4-2e4, coordinate `kind:pubkey`)
 * and parameterized replaceable (kind 3e4-4e4, coordinate `kind:pubkey:d`).
 * Before this fix the seam deduped raw events by `event.id`, so every
 * conflicting version survived and consumers that index the set (`[0]`) or
 * iterate it saw stale copies in relay-arrival order. These tests pin the
 * coordinate-level `deduplicationKey()` + created_at latest-wins contract.
 *
 * Each event is a real `finalizeEvent`-signed event; the seam fetch is stubbed
 * (no network). No NDK package import here — NDKEvent rehydration only stores
 * the ndk reference, so a minimal stub context is enough and the NDK footprint
 * guard is not perturbed.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'

import type { NostrIo } from '@/lib/nostr/io'
import { fetchNdkEventSet } from '@/lib/nostr/ndk-events'

const TEST_SECRET_KEY = new Uint8Array(32).fill(7)
const OTHER_SECRET_KEY = new Uint8Array(32).fill(8)

interface EventTemplate {
	kind: number
	created_at: number
	tags: string[][]
	content: string
}

/** A validly-signed event; `secretKey` selects the author pubkey. */
function signedEvent(template: EventTemplate, secretKey: Uint8Array = TEST_SECRET_KEY): NostrEvent {
	return finalizeEvent(template, secretKey)
}

/** Stub seam port returning a fixed relay result, in the given arrival order. */
function ioReturning(events: NostrEvent[]): Pick<NostrIo, 'fetchEvents'> {
	return { fetchEvents: async () => events } as unknown as Pick<NostrIo, 'fetchEvents'>
}

// NDKEvent rehydration only stores the reference (see NDKEvent's constructor);
// a minimal object is enough and keeps the package import out of this file.
const stubNdk = {
	fetchEvent: async () => null,
	queuesNip05: { add: async (item: { func: () => Promise<unknown> }) => item.func() },
} as unknown as Parameters<typeof fetchNdkEventSet>[1]

async function winnerIds(events: NostrEvent[]): Promise<string[]> {
	const set = await fetchNdkEventSet(ioReturning(events), stubNdk, { kinds: [events[0]!.kind] })
	return Array.from(set).map((event) => event.id)
}

describe('fetchNdkEventSet dedupes on coordinate + created_at latest-wins', () => {
	test('parameterized replaceable (30405 collection) collapses same d-tag to latest, either arrival order', async () => {
		const stale = signedEvent({ kind: 30405, created_at: 1_700_000_000, tags: [['d', 'summer']], content: '{"n":1}' })
		const fresh = signedEvent({ kind: 30405, created_at: 1_700_000_100, tags: [['d', 'summer']], content: '{"n":2}' })

		const staleFirst = await winnerIds([stale, fresh])
		expect(staleFirst).toEqual([fresh.id])

		const freshFirst = await winnerIds([fresh, stale])
		expect(freshFirst).toEqual([fresh.id])
	})

	test('parameterized replaceable (30402 product) latest-wins and keeps distinct d-tags separate', async () => {
		const productOld = signedEvent({ kind: 30402, created_at: 1_700_000_000, tags: [['d', 'sku-1']], content: '{"title":"old"}' })
		const productNew = signedEvent({ kind: 30402, created_at: 1_700_000_100, tags: [['d', 'sku-1']], content: '{"title":"new"}' })
		const otherProduct = signedEvent({ kind: 30402, created_at: 1_700_000_050, tags: [['d', 'sku-2']], content: '{"title":"other"}' })

		const winners = await winnerIds([productOld, productNew, otherProduct])
		expect(winners).toHaveLength(2)
		expect(winners).toContain(productNew.id)
		expect(winners).toContain(otherProduct.id)
		expect(winners).not.toContain(productOld.id)
	})

	test('replaceable kind 0 collapses same pubkey to latest created_at', async () => {
		const stale = signedEvent({ kind: 0, created_at: 1_700_000_000, tags: [], content: '{"name":"old"}' })
		const fresh = signedEvent({ kind: 0, created_at: 1_700_000_100, tags: [], content: '{"name":"new"}' })

		expect(await winnerIds([stale, fresh])).toEqual([fresh.id])
		expect(await winnerIds([fresh, stale])).toEqual([fresh.id])
	})

	test('replaceable kind 10000 collapses same pubkey to latest created_at', async () => {
		const stale = signedEvent({ kind: 10000, created_at: 1_700_000_000, tags: [['p', 'a']], content: '' })
		const fresh = signedEvent({
			kind: 10000,
			created_at: 1_700_000_100,
			tags: [
				['p', 'a'],
				['p', 'b'],
			],
			content: '',
		})

		expect(await winnerIds([stale, fresh])).toEqual([fresh.id])
	})

	test('same replaceable kind from different authors stays separate', async () => {
		const mine = signedEvent({ kind: 0, created_at: 1_700_000_000, tags: [], content: '{"name":"mine"}' })
		const theirs = signedEvent({ kind: 0, created_at: 1_700_000_100, tags: [], content: '{"name":"theirs"}' }, OTHER_SECRET_KEY)

		expect(await winnerIds([mine, theirs])).toHaveLength(2)
	})

	test('immutable non-replaceable events with distinct ids stay separate', async () => {
		const first = signedEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: 'one' })
		const second = signedEvent({ kind: 1, created_at: 1_700_000_001, tags: [], content: 'two' })

		expect(await winnerIds([first, second])).toHaveLength(2)
	})

	test('equal created_at keeps the lexicographically lowest id, arrival-order independent', async () => {
		const a = signedEvent({ kind: 30402, created_at: 1_700_000_000, tags: [['d', 'sku-1']], content: '{"v":"a"}' })
		const b = signedEvent({ kind: 30402, created_at: 1_700_000_000, tags: [['d', 'sku-1']], content: '{"v":"b"}' })
		const [lowerId, higherId] = [a.id, b.id].sort()
		const lower = a.id === lowerId ? a : b
		const higher = a.id === lowerId ? b : a

		expect(lowerId).not.toBe(higherId)
		expect(await winnerIds([higher, lower])).toEqual([lowerId])
		expect(await winnerIds([lower, higher])).toEqual([lowerId])
	})
})
