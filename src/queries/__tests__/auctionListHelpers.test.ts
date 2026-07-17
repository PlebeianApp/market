import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { AUCTION_KIND, AUCTION_PATH_RELEASE_KIND, AUCTION_SETTLEMENT_KIND } from '@/lib/auction/constants'

let fetchedRequests: Array<NDKFilter | NDKFilter[]> = []
let relayEvents = new Set<NDKEvent>()

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
	ndkActions: {
		getNDK: () => ({}),
		fetchEventsWithTimeout: mock(async (filter: NDKFilter | NDKFilter[]) => {
			fetchedRequests.push(filter)
			return relayEvents
		}),
	},
}))

const { fetchAuctionSettlementsForList, fetchAuctionPathReleasesForList, getAuctionTopBidFromBids } = await import('@/queries/auctions')

function makeAuctionEvent(params: { id: string; pubkey: string; dTag: string; rootId: string; startAt: number; endAt: number }): NDKEvent {
	return {
		id: params.id,
		kind: AUCTION_KIND,
		pubkey: params.pubkey,
		created_at: params.startAt - 10,
		content: '',
		tags: [
			['d', params.dTag],
			['auction_root_event_id', params.rootId],
			['start_at', String(params.startAt)],
			['end_at', String(params.endAt)],
		],
	} as unknown as NDKEvent
}

function makeBidEvent(params: {
	id: string
	pubkey: string
	rootId: string
	amount: number
	createdAt: number
	status?: string
}): NDKEvent {
	return {
		id: params.id,
		kind: 1023,
		pubkey: params.pubkey,
		created_at: params.createdAt,
		content: '',
		tags: [
			['e', params.rootId],
			['amount', String(params.amount)],
			['status', params.status ?? 'active'],
		],
	} as unknown as NDKEvent
}

function makeSettlementEvent(params: { id: string; createdAt: number; rootIds?: string[]; coordinates?: string[] }): NDKEvent {
	const tags: string[][] = []
	for (const rootId of params.rootIds ?? []) tags.push(['e', rootId])
	for (const coordinate of params.coordinates ?? []) tags.push(['a', coordinate])

	return {
		id: params.id,
		kind: AUCTION_SETTLEMENT_KIND,
		pubkey: 's'.repeat(64),
		created_at: params.createdAt,
		content: '',
		tags,
	} as unknown as NDKEvent
}

function makePathReleaseEvent(params: { id: string; createdAt: number; coordinates: string[] }): NDKEvent {
	return {
		id: params.id,
		kind: AUCTION_PATH_RELEASE_KIND as unknown as number,
		pubkey: 'p'.repeat(64),
		created_at: params.createdAt,
		content: '',
		tags: params.coordinates.map((coordinate) => ['a', coordinate]),
	} as unknown as NDKEvent
}

describe('fetchAuctionSettlementsForList', () => {
	beforeEach(() => {
		fetchedRequests = []
		relayEvents = new Set()
	})

	test('returns empty map and does not hit relay without ids or coordinates', async () => {
		const result = await fetchAuctionSettlementsForList([], [])
		expect(result.size).toBe(0)
		expect(fetchedRequests).toEqual([])
	})

	test('groups settlements by root id and coordinate with de-duplication and recency ordering', async () => {
		const rootId = 'root-auction-1'
		const coordinate = `30408:${'a'.repeat(64)}:auction-1`
		const newestRootOnly = makeSettlementEvent({ id: 's-new', createdAt: 300, rootIds: [rootId] })
		const bothRefs = makeSettlementEvent({ id: 's-both', createdAt: 200, rootIds: [rootId], coordinates: [coordinate] })
		const coordinateOnly = makeSettlementEvent({ id: 's-coord', createdAt: 100, coordinates: [coordinate] })
		const duplicateNewestRootOnly = makeSettlementEvent({ id: 's-new', createdAt: 300, rootIds: [rootId] })
		relayEvents = new Set([newestRootOnly, bothRefs, coordinateOnly, duplicateNewestRootOnly])

		const grouped = await fetchAuctionSettlementsForList([rootId], [coordinate])

		expect(grouped.get(rootId)?.map((event) => event.id)).toEqual(['s-new', 's-both'])
		expect(grouped.get(coordinate)?.map((event) => event.id)).toEqual(['s-both', 's-coord'])
	})

	test('chunks large root-id and coordinate lists into multiple filters', async () => {
		const ids = Array.from({ length: 81 }, (_, index) => `root-${index}`)
		const coordinates = Array.from({ length: 81 }, (_, index) => `30408:${'a'.repeat(64)}:auction-${index}`)

		await fetchAuctionSettlementsForList(ids, coordinates, 77)

		expect(fetchedRequests).toHaveLength(1)
		const filterBatch = fetchedRequests[0] as NDKFilter[]
		expect(Array.isArray(filterBatch)).toBe(true)
		expect(filterBatch).toHaveLength(4)
		expect(filterBatch.every((filter) => filter.kinds?.includes(AUCTION_SETTLEMENT_KIND as never))).toBe(true)
		expect(filterBatch.every((filter) => filter.limit === 77)).toBe(true)
	})
})

describe('fetchAuctionPathReleasesForList', () => {
	beforeEach(() => {
		fetchedRequests = []
		relayEvents = new Set()
	})

	test('returns empty map and does not hit relay without coordinates', async () => {
		const result = await fetchAuctionPathReleasesForList([])
		expect(result.size).toBe(0)
		expect(fetchedRequests).toEqual([])
	})

	test('groups path releases by coordinate, filters exact coordinate matches, and sorts by recency', async () => {
		const coordinateA = `30408:${'a'.repeat(64)}:auction-a`
		const coordinateB = `30408:${'a'.repeat(64)}:auction-b`

		const eventAOld = makePathReleaseEvent({ id: 'r-a-old', createdAt: 100, coordinates: [coordinateA] })
		const eventANew = makePathReleaseEvent({ id: 'r-a-new', createdAt: 300, coordinates: [coordinateA] })
		const eventShared = makePathReleaseEvent({ id: 'r-shared', createdAt: 200, coordinates: [coordinateA, coordinateB] })
		const eventBOnly = makePathReleaseEvent({ id: 'r-b-only', createdAt: 250, coordinates: [coordinateB] })
		const eventOther = makePathReleaseEvent({ id: 'r-other', createdAt: 999, coordinates: [`30408:${'b'.repeat(64)}:other`] })
		relayEvents = new Set([eventAOld, eventANew, eventShared, eventBOnly, eventOther])

		const grouped = await fetchAuctionPathReleasesForList([coordinateA, coordinateB])

		expect(grouped.get(coordinateA)?.map((event) => event.id)).toEqual(['r-a-new', 'r-shared', 'r-a-old'])
		expect(grouped.get(coordinateB)?.map((event) => event.id)).toEqual(['r-b-only', 'r-shared'])
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
		]

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
		})

		const bids = [
			makeBidEvent({ id: 'before-start', pubkey: 'b'.repeat(64), rootId: 'root-auction-1', amount: 1000, createdAt: 99 }),
			makeBidEvent({ id: 'wrong-root', pubkey: 'c'.repeat(64), rootId: 'other-root', amount: 1200, createdAt: 150 }),
			makeBidEvent({ id: 'after-end', pubkey: 'd'.repeat(64), rootId: 'root-auction-1', amount: 900, createdAt: 201 }),
			makeBidEvent({ id: 'valid-low', pubkey: 'e'.repeat(64), rootId: 'root-auction-1', amount: 400, createdAt: 110 }),
			makeBidEvent({ id: 'valid-top', pubkey: 'f'.repeat(64), rootId: 'root-auction-1', amount: 700, createdAt: 150 }),
		]

		const topBid = getAuctionTopBidFromBids(auction, bids)

		expect(topBid?.id).toBe('valid-top')
	})
})
