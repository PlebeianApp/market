import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'
import { AUCTION_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '@/lib/auction/constants'
import { applesauceIo, type NostrFilter } from '@/lib/nostr/io'
import { NDKEvent } from '@/lib/nostr/ndk-events'

type AuctionEventLike = {
	id: string
	pubkey: string
	created_at?: number
	tags: string[][]
	content: string
}

let fetchedRequests: Array<NostrFilter | NostrFilter[]> = []

const realFetchEvents = applesauceIo.fetchEvents

if (!('localStorage' in globalThis)) {
	const items = new Map<string, string>()
	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => items.set(key, value),
			removeItem: (key: string) => items.delete(key),
			clear: () => items.clear(),
		},
		configurable: true,
	})
}

mock.module('@/lib/stores/blacklist', () => ({
	blacklistActions: {
		isBlacklistLoaded: () => false,
		isPubkeyBlacklisted: () => false,
		isProductBlacklisted: () => false,
		isCollectionBlacklisted: () => false,
	},
}))

mock.module('@/lib/stores/ndk', () => ({
	getWriteRelays: () => [],
	ndkStore: {
		state: {
			ndk: null,
			zapNdk: null,
			explicitRelayUrls: [],
			writeRelayUrls: [],
			signer: undefined,
		},
	},
	ndkActions: {
		getNDK: () => ({}),
	},
}))

const { fetchAuctionSettlementsForList, fetchAuctionPathReleasesForList, getAuctionTopBidFromBids } = await import('@/queries/auctions')

const TEST_SECRET_KEY = new Uint8Array(32).fill(7)

function signEvent(kind: number, createdAt: number, tags: string[][]): NostrEvent {
	return finalizeEvent({ kind, created_at: createdAt, content: '', tags }, TEST_SECRET_KEY)
}

afterEach(() => {
	fetchedRequests = []
	applesauceIo.fetchEvents = realFetchEvents
})

function makeAuctionEvent(params: {
	id: string
	pubkey: string
	dTag: string
	rootId: string
	startAt: number
	endAt: number
}): AuctionEventLike {
	return {
		id: params.id,
		pubkey: params.pubkey,
		created_at: params.startAt - 10,
		content: '',
		tags: [
			['d', params.dTag],
			['auction_root_event_id', params.rootId],
			['start_at', String(params.startAt)],
			['end_at', String(params.endAt)],
		],
	}
}

function makeBidEvent(params: {
	id: string
	pubkey: string
	rootId: string
	amount: number
	createdAt: number
	status?: string
}): AuctionEventLike {
	return {
		id: params.id,
		pubkey: params.pubkey,
		created_at: params.createdAt,
		content: '',
		tags: [
			['e', params.rootId],
			['amount', String(params.amount)],
			['status', params.status ?? 'active'],
		],
	}
}

describe('fetchAuctionSettlementsForList', () => {
	beforeEach(() => {
		fetchedRequests = []
	})

	test('returns empty map and does not hit relay without ids or coordinates', async () => {
		applesauceIo.fetchEvents = mock(async () => []) as typeof applesauceIo.fetchEvents
		const result = await fetchAuctionSettlementsForList([], [])
		expect(result.size).toBe(0)
		expect(fetchedRequests).toEqual([])
	})

	test('groups settlements by root id and coordinate with de-duplication and recency ordering', async () => {
		const rootId = 'root-auction-1'
		const coordinate = `30408:${'a'.repeat(64)}:auction-1`
		const newestRootOnly = signEvent(AUCTION_SETTLEMENT_KIND, 300, [['e', rootId]])
		const bothRefs = signEvent(AUCTION_SETTLEMENT_KIND, 200, [
			['e', rootId],
			['a', coordinate],
		])
		const coordinateOnly = signEvent(AUCTION_SETTLEMENT_KIND, 100, [['a', coordinate]])
		const duplicateNewestRootOnly = { ...newestRootOnly }

		applesauceIo.fetchEvents = mock(async () => [
			newestRootOnly,
			bothRefs,
			coordinateOnly,
			duplicateNewestRootOnly,
		]) as typeof applesauceIo.fetchEvents

		const grouped = await fetchAuctionSettlementsForList([rootId], [coordinate])

		expect(grouped.get(rootId)?.map((event) => event.id)).toEqual([newestRootOnly.id, bothRefs.id])
		expect(grouped.get(coordinate)?.map((event) => event.id)).toEqual([bothRefs.id, coordinateOnly.id])
	})

	test('chunks large root-id and coordinate lists into multiple filters', async () => {
		const ids = Array.from({ length: 81 }, (_, index) => `root-${index}`)
		const coordinates = Array.from({ length: 81 }, (_, index) => `30408:${'a'.repeat(64)}:auction-${index}`)

		applesauceIo.fetchEvents = mock(async () => []) as typeof applesauceIo.fetchEvents

		await fetchAuctionSettlementsForList(ids, coordinates, 77)

		expect(applesauceIo.fetchEvents).toHaveBeenCalledTimes(1)
		const filterBatch = (applesauceIo.fetchEvents as ReturnType<typeof mock>).mock.calls[0][0] as NostrFilter[]
		expect(Array.isArray(filterBatch)).toBe(true)
		expect(filterBatch).toHaveLength(4)
		expect(filterBatch.every((filter) => filter.kinds?.includes(AUCTION_SETTLEMENT_KIND as never))).toBe(true)
		expect(filterBatch.every((filter) => filter.limit === 77)).toBe(true)
	})
})

describe('fetchAuctionPathReleasesForList', () => {
	beforeEach(() => {
		fetchedRequests = []
	})

	test('returns empty map and does not hit relay without coordinates', async () => {
		applesauceIo.fetchEvents = mock(async () => []) as typeof applesauceIo.fetchEvents
		const result = await fetchAuctionPathReleasesForList([])
		expect(result.size).toBe(0)
	})

	test('groups path releases by coordinate, filters exact coordinate matches, and sorts by recency', async () => {
		const coordinateA = `30408:${'a'.repeat(64)}:auction-a`
		const coordinateB = `30408:${'a'.repeat(64)}:auction-b`

		const eventAOld = signEvent(AUCTION_PATH_RELEASE_KIND as number, 100, [['a', coordinateA]])
		const eventANew = signEvent(AUCTION_PATH_RELEASE_KIND as number, 300, [['a', coordinateA]])
		const eventShared = signEvent(AUCTION_PATH_RELEASE_KIND as number, 200, [
			['a', coordinateA],
			['a', coordinateB],
		])
		const eventBOnly = signEvent(AUCTION_PATH_RELEASE_KIND as number, 250, [['a', coordinateB]])
		const eventOther = signEvent(AUCTION_PATH_RELEASE_KIND as number, 999, [['a', `30408:${'b'.repeat(64)}:other`]])

		applesauceIo.fetchEvents = mock(async () => [
			eventAOld,
			eventANew,
			eventShared,
			eventBOnly,
			eventOther,
		]) as typeof applesauceIo.fetchEvents

		const grouped = await fetchAuctionPathReleasesForList([coordinateA, coordinateB])

		expect(grouped.get(coordinateA)?.map((event) => event.id)).toEqual([eventANew.id, eventShared.id, eventAOld.id])
		expect(grouped.get(coordinateB)?.map((event) => event.id)).toEqual([eventBOnly.id, eventShared.id])
	})
})

describe('getAuctionTopBidFromBids', () => {
	test('returns null when no bids are available', () => {
		expect(getAuctionTopBidFromBids(null, [])).toBeNull()
	})

	test('returns highest amount when auction context is unavailable', () => {
		const bids = [
			makeBidEvent({ id: 'b-low', pubkey: 'x'.repeat(64), rootId: 'ignored', amount: 100, createdAt: 1 }),
			makeBidEvent({ id: 'b-high', pubkey: 'y'.repeat(64), rootId: 'ignored', amount: 250, createdAt: 2 }),
		] as unknown as NDKEvent[]

		const topBid = getAuctionTopBidFromBids(null, bids)

		expect(topBid?.id).toBe('b-high')
	})

	test('uses auction-window-valid bids only (root id + start/end window)', () => {
		const auction = makeAuctionEvent({
			id: 'auction-event-id',
			pubkey: 'a'.repeat(64),
			dTag: 'auction-1',
			rootId: 'root-auction-1',
			startAt: 100,
			endAt: 200,
		}) as unknown as NDKEvent

		const bids = [
			makeBidEvent({ id: 'before-start', pubkey: 'b'.repeat(64), rootId: 'root-auction-1', amount: 1000, createdAt: 99 }),
			makeBidEvent({ id: 'wrong-root', pubkey: 'c'.repeat(64), rootId: 'other-root', amount: 1200, createdAt: 150 }),
			makeBidEvent({ id: 'after-end', pubkey: 'd'.repeat(64), rootId: 'root-auction-1', amount: 900, createdAt: 201 }),
			makeBidEvent({ id: 'valid-low', pubkey: 'e'.repeat(64), rootId: 'root-auction-1', amount: 400, createdAt: 110 }),
			makeBidEvent({ id: 'valid-top', pubkey: 'f'.repeat(64), rootId: 'root-auction-1', amount: 700, createdAt: 150 }),
		] as unknown as NDKEvent[]

		const topBid = getAuctionTopBidFromBids(auction, bids)

		expect(topBid?.id).toBe('valid-top')
	})
})
