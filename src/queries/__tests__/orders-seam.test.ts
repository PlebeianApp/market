import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools/pure'

import { applesauceIo } from '@/lib/nostr/io-applesauce'
import { ndkActions } from '@/lib/stores/ndk'
import { fetchSellerPrivateOrderGiftWraps, subscribeToOrderUpdates } from '../orders'

const GIFT_WRAP_KIND = 1059
const ORDER_PROCESS_KIND = 16
const ORDER_GENERAL_KIND = 14
const PAYMENT_RECEIPT_KIND = 17
const SELLER_PUBKEY = '1'.repeat(64)
const BUYER_PUBKEY = '2'.repeat(64)

const realFetchEvents = applesauceIo.fetchEvents
const realSubscribe = applesauceIo.subscribe
const realGetNDK = ndkActions.getNDK

function rawEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
	return {
		id: '0'.repeat(64),
		pubkey: BUYER_PUBKEY,
		created_at: 1_700_000_000,
		kind: ORDER_PROCESS_KIND,
		tags: [],
		content: '',
		sig: '3'.repeat(128),
		...overrides,
	}
}

function stubNdk() {
	return {
		subscribe: mock(() => ({ stop: mock(() => {}) })),
	}
}

afterEach(() => {
	applesauceIo.fetchEvents = realFetchEvents
	applesauceIo.subscribe = realSubscribe
	;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
})

describe('orders relay reads use the Wave A1b seam flip', () => {
	test('fetchSellerPrivateOrderGiftWraps routes through applesauceIo.fetchEvents and rehydrates NDKEvents', async () => {
		const giftWrap = rawEvent({
			id: 'a'.repeat(64),
			kind: GIFT_WRAP_KIND,
			tags: [['p', SELLER_PUBKEY]],
			content: 'encrypted-private-order-details',
		})
		const fetchEvents = mock(async () => [giftWrap])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		const result = await fetchSellerPrivateOrderGiftWraps(SELLER_PUBKEY)

		expect(fetchEvents).toHaveBeenCalledTimes(1)
		expect(fetchEvents.mock.calls[0][0]).toEqual({
			kinds: [GIFT_WRAP_KIND],
			'#p': [SELLER_PUBKEY],
			limit: 500,
		})
		expect(result).toHaveLength(1)
		expect(typeof result[0].rawEvent).toBe('function')
		expect(result[0].rawEvent()).toEqual(giftWrap)
	})

	test('NDK initialization guard short-circuits before touching the seam', async () => {
		const fetchEvents = mock(async () => [rawEvent({ kind: GIFT_WRAP_KIND })])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => null

		await expect(fetchSellerPrivateOrderGiftWraps(SELLER_PUBKEY)).rejects.toThrow('NDK not initialized')
		expect(fetchEvents).not.toHaveBeenCalled()
	})

	test('live order subscription uses applesauceIo.subscribe and cleans up with its stop function', () => {
		let onEvent: ((event: NostrEvent) => void) | undefined
		const stop = mock(() => {})
		const subscribe = mock((filter, handler, opts) => {
			onEvent = handler as (event: NostrEvent) => void
			return stop
		})
		applesauceIo.subscribe = subscribe as typeof applesauceIo.subscribe
		const ndk = stubNdk()
		const onMatchedEvent = mock(() => {})

		const cleanup = subscribeToOrderUpdates({
			ndk: ndk as never,
			orderId: 'route-order-id',
			logicalOrderId: 'logical-order-id',
			fetchedOrderEventId: 'order-event-id',
			onMatchedEvent,
		})

		expect(subscribe).toHaveBeenCalledTimes(1)
		expect(ndk.subscribe).not.toHaveBeenCalled()
		expect(subscribe.mock.calls[0][0]).toEqual({
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
		})
		expect(subscribe.mock.calls[0][2]).toEqual({ closeOnEose: false })

		onEvent?.(
			rawEvent({
				id: 'b'.repeat(64),
				tags: [['order', 'logical-order-id']],
			}),
		)
		expect(onMatchedEvent).toHaveBeenCalledTimes(1)

		onEvent?.(rawEvent({ id: 'c'.repeat(64), tags: [['order', 'unrelated-order']] }))
		expect(onMatchedEvent).toHaveBeenCalledTimes(1)

		cleanup()
		expect(stop).toHaveBeenCalledTimes(1)
	})
})
