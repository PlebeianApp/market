import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { AUCTION_PATH_RELEASE_KIND } from '@/lib/auction/constants'
import type { NostrEvent, NostrFilter } from '@/lib/nostr/io'

type RelayEvent = NostrEvent

let fetchedFilters: NostrFilter[] = []
let relayEvents = new Set<RelayEvent>()

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
		fetchEventsWithTimeout: mock(async (filter: NostrFilter) => {
			fetchedFilters.push(filter)
			return relayEvents
		}),
	},
}))

const { buildAuctionPathReleaseFilter, fetchAuctionPathReleases } = await import('@/queries/auctions')

const AUCTION_ROOT_EVENT_ID = '1'.repeat(64)
const SELLER_PUBKEY = 'a'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-1`
const OTHER_AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-2`

function pathReleaseEvent(id: string, coordinate: string, createdAt: number): RelayEvent {
	return {
		id,
		kind: AUCTION_PATH_RELEASE_KIND as unknown as number,
		pubkey: 'b'.repeat(64),
		created_at: createdAt,
		content: '',
		tags: [
			['e', '2'.repeat(64)],
			['a', coordinate],
		],
	} as RelayEvent
}

describe('auction path-release queries', () => {
	beforeEach(() => {
		fetchedFilters = []
		relayEvents = new Set()
	})

	test('does not build a kind-1025 filter without an auction coordinate', () => {
		expect(buildAuctionPathReleaseFilter(undefined)).toBeNull()
		expect(buildAuctionPathReleaseFilter('')).toBeNull()
		expect(buildAuctionPathReleaseFilter('   ')).toBeNull()
	})

	test('no coordinate means no relay query and an empty passive result', async () => {
		const releases = await fetchAuctionPathReleases(AUCTION_ROOT_EVENT_ID, 200)

		expect(releases).toEqual([])
		expect(fetchedFilters).toEqual([])
	})

	test('coordinate present means the relay filter includes #a', async () => {
		await fetchAuctionPathReleases(AUCTION_ROOT_EVENT_ID, 123, AUCTION_COORDINATE)

		expect(fetchedFilters).toEqual([
			{
				kinds: [AUCTION_PATH_RELEASE_KIND as unknown as number],
				'#a': [AUCTION_COORDINATE],
				limit: 123,
			},
		])
		expect(fetchedFilters[0]).not.toHaveProperty('#e')
	})

	test('ignores unrelated kind-1025 events for another auction coordinate', async () => {
		const unrelated = pathReleaseEvent('unrelated', OTHER_AUCTION_COORDINATE, 2)
		const related = pathReleaseEvent('related', AUCTION_COORDINATE, 1)
		relayEvents = new Set([unrelated, related])

		const releases = await fetchAuctionPathReleases(AUCTION_ROOT_EVENT_ID, 200, AUCTION_COORDINATE)

		expect(releases.map((event) => event.id)).toEqual(['related'])
	})
})
