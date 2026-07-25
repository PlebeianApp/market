import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

class MemoryStorage {
	private store = new Map<string, string>()

	getItem(key: string) {
		return this.store.has(key) ? this.store.get(key)! : null
	}

	setItem(key: string, value: string) {
		this.store.set(key, value)
	}

	removeItem(key: string) {
		this.store.delete(key)
	}

	clear() {
		this.store.clear()
	}
}

const installLocalStoragePolyfill = (): MemoryStorage => {
	const storage = new MemoryStorage()
	Object.defineProperty(globalThis, 'localStorage', {
		value: storage,
		writable: true,
		configurable: true,
	})
	return storage
}

installLocalStoragePolyfill()

const { notificationActions, notificationStore } = await import('@/lib/stores/notifications')

const STORAGE_KEY = 'nostr-market:notifications'
const realDateNow = Date.now
const fakeNowMs = 1_725_000_000_000
const fakeNowSeconds = Math.floor(fakeNowMs / 1000)

describe('notification store scoped last-seen behavior', () => {
	let storage: MemoryStorage

	beforeEach(() => {
		storage = installLocalStoragePolyfill()
		Date.now = () => fakeNowMs
		notificationActions.reset()
	})

	afterEach(() => {
		Date.now = realDateNow
		storage.clear()
		notificationActions.reset()
	})

	test('scoped mark-as-seen only clears the targeted auction and preserves global baselines', () => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionBids: 5,
			unseenAuctionBidsByAuction: {
				'auction-a': 2,
				'auction-b': 3,
			},
			unseenAuctionComments: 4,
			unseenAuctionCommentsByAuction: {
				'auction-a': 1,
				'auction-b': 3,
			},
			unseenAuctionEventComments: 3,
			unseenAuctionEventCommentsByAuction: {
				'auction-a': 1,
				'auction-b': 2,
			},
			unseenAuctionLive: 2,
			unseenAuctionLiveByAuction: {
				'auction-a': 1,
				'auction-b': 1,
			},
			unseenAuctionSettlementBegins: 2,
			unseenAuctionSettlementBeginsByAuction: {
				'auction-a': 1,
				'auction-b': 1,
			},
			lastSeenTimestamps: {
				...state.lastSeenTimestamps,
				auctionBids: 100,
				auctionBidsByAuction: { 'auction-b': 220 },
				auctionComments: 101,
				auctionCommentsByAuction: { 'auction-b': 221 },
				auctionEventComments: 102,
				auctionEventCommentsByAuction: { 'auction-b': 222 },
				auctionLive: 103,
				auctionLiveByAuction: { 'auction-b': 223 },
				auctionSettlementBegins: 104,
				auctionSettlementBeginsByAuction: { 'auction-b': 224 },
			},
		}))

		notificationActions.markAuctionBidsSeen('auction-a')
		notificationActions.markAuctionCommentsSeen('auction-a')
		notificationActions.markAuctionEventCommentsSeen('auction-a')
		notificationActions.markAuctionLiveSeen('auction-a')
		notificationActions.markAuctionSettlementBeginsSeen('auction-a')

		expect(notificationStore.state.unseenAuctionBids).toBe(3)
		expect(notificationStore.state.unseenAuctionBidsByAuction).toEqual({
			'auction-a': 0,
			'auction-b': 3,
		})
		expect(notificationStore.state.unseenAuctionComments).toBe(3)
		expect(notificationStore.state.unseenAuctionCommentsByAuction).toEqual({
			'auction-a': 0,
			'auction-b': 3,
		})
		expect(notificationStore.state.unseenAuctionEventComments).toBe(2)
		expect(notificationStore.state.unseenAuctionEventCommentsByAuction).toEqual({
			'auction-a': 0,
			'auction-b': 2,
		})
		expect(notificationStore.state.unseenAuctionLive).toBe(1)
		expect(notificationStore.state.unseenAuctionLiveByAuction).toEqual({
			'auction-a': 0,
			'auction-b': 1,
		})
		expect(notificationStore.state.unseenAuctionSettlementBegins).toBe(1)
		expect(notificationStore.state.unseenAuctionSettlementBeginsByAuction).toEqual({
			'auction-a': 0,
			'auction-b': 1,
		})

		expect(notificationStore.state.lastSeenTimestamps.auctionBids).toBe(100)
		expect(notificationStore.state.lastSeenTimestamps.auctionComments).toBe(101)
		expect(notificationStore.state.lastSeenTimestamps.auctionEventComments).toBe(102)
		expect(notificationStore.state.lastSeenTimestamps.auctionLive).toBe(103)
		expect(notificationStore.state.lastSeenTimestamps.auctionSettlementBegins).toBe(104)

		expect(notificationStore.state.lastSeenTimestamps.auctionBidsByAuction).toEqual({
			'auction-a': fakeNowSeconds,
			'auction-b': 220,
		})
		expect(notificationStore.state.lastSeenTimestamps.auctionCommentsByAuction).toEqual({
			'auction-a': fakeNowSeconds,
			'auction-b': 221,
		})
		expect(notificationStore.state.lastSeenTimestamps.auctionEventCommentsByAuction).toEqual({
			'auction-a': fakeNowSeconds,
			'auction-b': 222,
		})
		expect(notificationStore.state.lastSeenTimestamps.auctionLiveByAuction).toEqual({
			'auction-a': fakeNowSeconds,
			'auction-b': 223,
		})
		expect(notificationStore.state.lastSeenTimestamps.auctionSettlementBeginsByAuction).toEqual({
			'auction-a': fakeNowSeconds,
			'auction-b': 224,
		})

		expect(notificationActions.getLastSeenAuctionBids('auction-a')).toBe(fakeNowSeconds)
		expect(notificationActions.getLastSeenAuctionBids('auction-b')).toBe(220)
		expect(notificationActions.getLastSeenAuctionComments('auction-a')).toBe(fakeNowSeconds)
		expect(notificationActions.getLastSeenAuctionEventComments('auction-b')).toBe(222)
		expect(notificationActions.getLastSeenAuctionLive('auction-a')).toBe(fakeNowSeconds)
		expect(notificationActions.getLastSeenAuctionSettlementBegins('auction-b')).toBe(224)

		const persisted = JSON.parse(storage.getItem(STORAGE_KEY) || '{}')
		expect(persisted.lastSeenTimestamps.auctionBidsByAuction['auction-a']).toBe(fakeNowSeconds)
		expect(persisted.lastSeenTimestamps.auctionBidsByAuction['auction-b']).toBe(220)
	})

	test('global mark-as-seen resets aggregate count and becomes the fallback for all auctions', () => {
		notificationStore.setState((state) => ({
			...state,
			unseenAuctionBids: 4,
			unseenAuctionBidsByAuction: {
				'auction-a': 1,
				'auction-b': 3,
			},
			lastSeenTimestamps: {
				...state.lastSeenTimestamps,
				auctionBids: 10,
				auctionBidsByAuction: {
					'auction-a': 20,
				},
			},
		}))

		notificationActions.markAuctionBidsSeen()

		expect(notificationStore.state.unseenAuctionBids).toBe(0)
		expect(notificationStore.state.unseenAuctionBidsByAuction).toEqual({})
		expect(notificationStore.state.lastSeenTimestamps.auctionBids).toBe(fakeNowSeconds)
		expect(notificationStore.state.lastSeenTimestamps.auctionBidsByAuction).toEqual({
			'auction-a': 20,
		})
		expect(notificationActions.getLastSeenAuctionBids('auction-a')).toBe(fakeNowSeconds)
		expect(notificationActions.getLastSeenAuctionBids('auction-missing')).toBe(fakeNowSeconds)
	})

	test('product comment scoped mark-as-seen only affects the targeted product', () => {
		notificationStore.setState((state) => ({
			...state,
			unseenProductComments: 3,
			unseenProductCommentsByProduct: {
				'product-a': 2,
				'product-b': 1,
			},
			lastSeenTimestamps: {
				...state.lastSeenTimestamps,
				productComments: 50,
				productCommentsByProduct: {
					'product-b': 70,
				},
			},
		}))

		notificationActions.markProductCommentsSeen('product-a')

		expect(notificationStore.state.unseenProductComments).toBe(1)
		expect(notificationStore.state.unseenProductCommentsByProduct).toEqual({
			'product-a': 0,
			'product-b': 1,
		})
		expect(notificationStore.state.lastSeenTimestamps.productComments).toBe(50)
		expect(notificationStore.state.lastSeenTimestamps.productCommentsByProduct).toEqual({
			'product-a': fakeNowSeconds,
			'product-b': 70,
		})
		expect(notificationActions.getLastSeenProductComments('product-a')).toBe(fakeNowSeconds)
		expect(notificationActions.getLastSeenProductComments('product-b')).toBe(70)
	})

	test('reset loads legacy global-only persisted timestamps with empty scoped maps', () => {
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				lastSeenTimestamps: {
					orders: 1,
					purchases: 2,
					auctionBids: 3,
					auctionComments: 4,
					auctionEventComments: 5,
					productComments: 6,
					auctionLive: 7,
					auctionSettlementBegins: 8,
					bidUpdates: 9,
					messages: { alice: 10 },
				},
			}),
		)

		notificationActions.reset()

		expect(notificationStore.state.lastSeenTimestamps.auctionBids).toBe(3)
		expect(notificationStore.state.lastSeenTimestamps.auctionComments).toBe(4)
		expect(notificationStore.state.lastSeenTimestamps.auctionEventComments).toBe(5)
		expect(notificationStore.state.lastSeenTimestamps.productComments).toBe(6)
		expect(notificationStore.state.lastSeenTimestamps.auctionLive).toBe(7)
		expect(notificationStore.state.lastSeenTimestamps.auctionSettlementBegins).toBe(8)
		expect(notificationStore.state.lastSeenTimestamps.messages).toEqual({ alice: 10 })
		expect(notificationStore.state.lastSeenTimestamps.auctionBidsByAuction).toEqual({})
		expect(notificationStore.state.lastSeenTimestamps.auctionCommentsByAuction).toEqual({})
		expect(notificationStore.state.lastSeenTimestamps.auctionEventCommentsByAuction).toEqual({})
		expect(notificationStore.state.lastSeenTimestamps.productCommentsByProduct).toEqual({})
		expect(notificationStore.state.lastSeenTimestamps.auctionLiveByAuction).toEqual({})
		expect(notificationStore.state.lastSeenTimestamps.auctionSettlementBeginsByAuction).toEqual({})
	})

	test('scoped getters prefer the larger of global and scoped timestamps', () => {
		notificationStore.setState((state) => ({
			...state,
			lastSeenTimestamps: {
				...state.lastSeenTimestamps,
				auctionBids: 200,
				auctionBidsByAuction: {
					'auction-a': 150,
					'auction-b': 250,
				},
				productComments: 300,
				productCommentsByProduct: {
					'product-a': 275,
					'product-b': 325,
				},
			},
		}))

		expect(notificationActions.getLastSeenAuctionBids('auction-a')).toBe(200)
		expect(notificationActions.getLastSeenAuctionBids('auction-b')).toBe(250)
		expect(notificationActions.getLastSeenAuctionBids()).toBe(200)
		expect(notificationActions.getLastSeenProductComments('product-a')).toBe(300)
		expect(notificationActions.getLastSeenProductComments('product-b')).toBe(325)
		expect(notificationActions.getLastSeenProductComments()).toBe(300)
	})

	test('recalculate derives unseen auction bid aggregate from canonical scoped auction counts', () => {
		notificationActions.recalculateFromEvents({
			orderCount: 0,
			messageCount: 0,
			purchaseCount: 0,
			conversationCounts: {},
			auctionBidCount: 99,
			auctionBidCountsByAuction: {
				'auction-a': 1,
				'auction-b': 2,
			},
		})

		expect(notificationStore.state.unseenAuctionBidsByAuction).toEqual({
			'auction-a': 1,
			'auction-b': 2,
		})
		expect(notificationStore.state.unseenAuctionBids).toBe(3)
	})

	test('recalculate derives every unseen aggregate from its canonical scoped counts map', () => {
		notificationActions.recalculateFromEvents({
			orderCount: 0,
			messageCount: 0,
			purchaseCount: 0,
			conversationCounts: {},
			auctionBidCountsByAuction: { 'auction-a': 1 },
			auctionCommentCountsByAuction: { 'auction-a': 2, 'auction-b': 1 },
			auctionEventCommentCountsByAuction: { 'auction-a': 3 },
			productCommentCountsByProduct: { 'product-a': 1, 'product-b': 4 },
			auctionLiveCountsByAuction: { 'auction-a': 1, 'auction-b': 1, 'auction-c': 1 },
			auctionSettlementBeginsCountsByAuction: { 'auction-a': 2 },
		})

		expect(notificationStore.state.unseenAuctionBidsByAuction).toEqual({ 'auction-a': 1 })
		expect(notificationStore.state.unseenAuctionBids).toBe(1)

		expect(notificationStore.state.unseenAuctionCommentsByAuction).toEqual({
			'auction-a': 2,
			'auction-b': 1,
		})
		expect(notificationStore.state.unseenAuctionComments).toBe(3)

		expect(notificationStore.state.unseenAuctionEventCommentsByAuction).toEqual({ 'auction-a': 3 })
		expect(notificationStore.state.unseenAuctionEventComments).toBe(3)

		expect(notificationStore.state.unseenProductCommentsByProduct).toEqual({
			'product-a': 1,
			'product-b': 4,
		})
		expect(notificationStore.state.unseenProductComments).toBe(5)

		expect(notificationStore.state.unseenAuctionLiveByAuction).toEqual({
			'auction-a': 1,
			'auction-b': 1,
			'auction-c': 1,
		})
		expect(notificationStore.state.unseenAuctionLive).toBe(3)

		expect(notificationStore.state.unseenAuctionSettlementBeginsByAuction).toEqual({ 'auction-a': 2 })
		expect(notificationStore.state.unseenAuctionSettlementBegins).toBe(2)
	})

	test('scoped increment records the per-key count and keeps the global as the sum of scoped counts', () => {
		notificationActions.incrementUnseenAuctionComments('auction-a')
		notificationActions.incrementUnseenAuctionComments('auction-a')
		notificationActions.incrementUnseenAuctionComments('auction-b')

		expect(notificationStore.state.unseenAuctionCommentsByAuction).toEqual({
			'auction-a': 2,
			'auction-b': 1,
		})
		expect(notificationStore.state.unseenAuctionComments).toBe(3)

		notificationActions.incrementUnseenProductComments('product-a')
		notificationActions.incrementUnseenProductComments('product-b')
		notificationActions.incrementUnseenProductComments('product-b')

		expect(notificationStore.state.unseenProductCommentsByProduct).toEqual({
			'product-a': 1,
			'product-b': 2,
		})
		expect(notificationStore.state.unseenProductComments).toBe(3)

		notificationActions.incrementUnseenAuctionEventComments('auction-a')
		expect(notificationStore.state.unseenAuctionEventCommentsByAuction).toEqual({ 'auction-a': 1 })
		expect(notificationStore.state.unseenAuctionEventComments).toBe(1)

		notificationActions.incrementUnseenAuctionLive('auction-a')
		expect(notificationStore.state.unseenAuctionLiveByAuction).toEqual({ 'auction-a': 1 })
		expect(notificationStore.state.unseenAuctionLive).toBe(1)

		notificationActions.incrementUnseenAuctionSettlementBegins('auction-a')
		expect(notificationStore.state.unseenAuctionSettlementBeginsByAuction).toEqual({ 'auction-a': 1 })
		expect(notificationStore.state.unseenAuctionSettlementBegins).toBe(1)
	})

	test('marking one auction seen zeroes only its scoped entry and leaves siblings untouched', () => {
		notificationActions.incrementUnseenAuctionComments('auction-a')
		notificationActions.incrementUnseenAuctionComments('auction-a')
		notificationActions.incrementUnseenAuctionComments('auction-b')

		notificationActions.markAuctionCommentsSeen('auction-a')

		expect(notificationStore.state.unseenAuctionCommentsByAuction).toEqual({
			'auction-a': 0,
			'auction-b': 1,
		})
		expect(notificationStore.state.unseenAuctionComments).toBe(1)

		// Sibling entry is still incrementable after the targeted clear.
		notificationActions.incrementUnseenAuctionComments('auction-b')
		expect(notificationStore.state.unseenAuctionCommentsByAuction).toEqual({
			'auction-a': 0,
			'auction-b': 2,
		})
		expect(notificationStore.state.unseenAuctionComments).toBe(2)
	})

	test('marking one product seen zeroes only its scoped entry and leaves siblings untouched', () => {
		notificationActions.incrementUnseenProductComments('product-a')
		notificationActions.incrementUnseenProductComments('product-a')
		notificationActions.incrementUnseenProductComments('product-b')

		notificationActions.markProductCommentsSeen('product-a')

		expect(notificationStore.state.unseenProductCommentsByProduct).toEqual({
			'product-a': 0,
			'product-b': 1,
		})
		expect(notificationStore.state.unseenProductComments).toBe(1)
	})
})
