/**
 * Deterministic latest-wins tests for the seam's event helpers (PR #1262
 * review Finding 1): replaceable/parameterized events can arrive as multiple
 * conflicting created_at versions — one per relay, each that relay's current
 * "latest" — and NDK's deduplication kept the newest copy on conflict. The
 * seam helpers must resolve to the highest created_at, never relay-arrival
 * order.
 *
 * Events are real finalizeEvent-signed kind-30078 events; the seam fetch is
 * stubbed (no network); the ndk context follows the profilesFetch.test.ts
 * stub pattern (NDKEvent rehydration only stores it). No NDK package import
 * here — the footprint guard counts the literal NDK package path in src/.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'

import { applesauceIo, type NostrFilter } from '@/lib/nostr/io'
import { fetchNdkEvent, fetchLatestNdkEvent } from '@/lib/nostr/ndk-events'

const realFetchEvents = applesauceIo.fetchEvents

afterEach(() => {
	applesauceIo.fetchEvents = realFetchEvents
})

const TEST_SECRET_KEY = new Uint8Array(32).fill(2)

/** A validly-signed kind-30078 replaceable-settings event at the given created_at. */
function rawSettingsEvent(content: string, created_at: number): NostrEvent {
	return finalizeEvent(
		{
			created_at,
			kind: 30078,
			tags: [['d', 'relay-preferences']],
			content,
		},
		TEST_SECRET_KEY,
	)
}

// The ndk context argument: NDKEvent rehydration only stores the reference
// (see profilesFetch.test.ts's stubNdk), so a minimal object is enough and
// keeps this file free of a literal NDK import (footprint guard).
const stubNdk = {
	fetchEvent: async () => null,
	queuesNip05: { add: async (item: { func: () => Promise<unknown> }) => item.func() },
} as unknown as Parameters<typeof fetchNdkEvent>[1]

describe('seam helpers resolve conflicting replaceable versions deterministically (latest-wins)', () => {
	test('fetchNdkEvent returns the highest created_at copy regardless of arrival order', async () => {
		const stale = rawSettingsEvent('{"v":1}', 1_700_000_000)
		const fresh = rawSettingsEvent('{"v":2}', 1_700_000_100)

		// Stale-first arrival: relay A answered first with an older copy.
		applesauceIo.fetchEvents = (async (_filter: NostrFilter) => [stale, fresh]) as typeof applesauceIo.fetchEvents
		const first = await fetchNdkEvent(applesauceIo, stubNdk, { kinds: [30078] })
		expect(first?.created_at).toBe(1_700_000_100)
		expect(first?.content).toBe('{"v":2}')

		// Fresh-first arrival: same event, same fields — arrival order must
		// not decide which conflicting copy wins.
		applesauceIo.fetchEvents = (async (_filter: NostrFilter) => [fresh, stale]) as typeof applesauceIo.fetchEvents
		const second = await fetchNdkEvent(applesauceIo, stubNdk, { kinds: [30078] })
		expect(second?.id).toBe(first?.id)
		expect(second?.created_at).toBe(first?.created_at)
		expect(second?.content).toBe(first?.content)
	})

	test('fetchLatestNdkEvent is latest-wins and stable across reversed arrival order', async () => {
		const stale = rawSettingsEvent('{"v":1}', 1_700_000_000)
		const fresh = rawSettingsEvent('{"v":2}', 1_700_000_100)

		applesauceIo.fetchEvents = (async (_filter: NostrFilter) => [stale, fresh]) as typeof applesauceIo.fetchEvents
		const first = await fetchLatestNdkEvent(applesauceIo, stubNdk, { kinds: [30078] })

		applesauceIo.fetchEvents = (async (_filter: NostrFilter) => [fresh, stale]) as typeof applesauceIo.fetchEvents
		const second = await fetchLatestNdkEvent(applesauceIo, stubNdk, { kinds: [30078] })

		expect(first?.created_at).toBe(1_700_000_100)
		expect(second?.id).toBe(first?.id)
		expect(second?.created_at).toBe(first?.created_at)
		expect(second?.content).toBe(first?.content)
	})
})
