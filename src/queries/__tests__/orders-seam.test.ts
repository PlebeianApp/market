/**
 * Wave A1b orders-seam test: proves orders relay reads route through the
 * applesauce-backed I/O seam (`applesauceIo`), not the NDK default. The flip is
 * a single import swap (see orders.tsx), so this pins the routing decision and
 * the raw-event -> NDKEvent rehydration so a silent revert is caught.
 *
 * Note on mocking: we spy by replacing methods on the real singletons
 * (applesauceIo.fetchEvents, ndkActions.getNDK) and restore them in `finally`,
 * rather than `mock.module`. This keeps the test coexistence-safe: bun shares
 * `mock.module` registrations across test files in one run, and mocking
 * `@/lib/nostr/io` here would strip exports (e.g. setNostrIo) that io.test.ts
 * imports. Object-mutation spies are local to this file.
 */
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { NIP59_GIFT_WRAP_KIND } from '@/lib/nostr/nip59'

const stubRawEvent = {
	id: 'evt-gift-wrap-1',
	pubkey: 'pk-buyer',
	created_at: 1_700_000_000,
	kind: NIP59_GIFT_WRAP_KIND,
	tags: [['p', 'pk-seller']],
	content: 'encrypted-blob',
	sig: 'sig-1',
}

// Minimal NDK stub: fetchNdkEventSet only needs a truthy ndk to rehydrate events.
const stubNdk = {} as never

// Real singletons (same object references orders.tsx uses), imported for spying.
const { applesauceIo } = await import('@/lib/nostr/io')
const { ndkActions } = await import('@/lib/stores/ndk')
const { fetchSellerPrivateOrderGiftWraps } = await import('../orders')

const realFetchEvents = applesauceIo.fetchEvents
const realGetNDK = ndkActions.getNDK

afterEach(() => {
	applesauceIo.fetchEvents = realFetchEvents
	;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
})

describe('orders relay reads (Wave A1b seam flip)', () => {
	test('gift-wrap reads resolve through applesauceIo (the I/O seam), not NDK', async () => {
		const fetchEventsSpy = mock(async () => [stubRawEvent])
		applesauceIo.fetchEvents = fetchEventsSpy as never
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk

		const result = await fetchSellerPrivateOrderGiftWraps('pk-seller')

		// The read was routed through the seam with the expected gift-wrap filter.
		expect(fetchEventsSpy).toHaveBeenCalledTimes(1)
		expect(fetchEventsSpy.mock.calls[0][0]).toEqual({
			kinds: [NIP59_GIFT_WRAP_KIND],
			'#p': ['pk-seller'],
			limit: 500,
		})

		// Raw events returned by the seam are rehydrated as NDKEvents, preserving
		// the existing orders domain types without changing event shape.
		expect(result).toHaveLength(1)
		expect(result[0]).toBeInstanceOf(NDKEvent)
		expect(result[0].id).toBe(stubRawEvent.id)
	})

	test('throws "NDK not initialized" before reaching the seam when NDK is absent', async () => {
		const fetchEventsSpy = mock(async () => [stubRawEvent])
		applesauceIo.fetchEvents = fetchEventsSpy as never
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => null

		await expect(fetchSellerPrivateOrderGiftWraps('pk-seller')).rejects.toThrow('NDK not initialized')
		// The seam must not be touched when the NDK guard short-circuits.
		expect(fetchEventsSpy).not.toHaveBeenCalled()
	})
})
