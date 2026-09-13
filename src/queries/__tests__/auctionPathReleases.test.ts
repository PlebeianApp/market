import { afterEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'
import { AUCTION_PATH_RELEASE_KIND } from '@/lib/auction/constants'
import { applesauceIo } from '@/lib/nostr/io'

const AUCTION_ROOT_EVENT_ID = '1'.repeat(64)
const SELLER_PUBKEY = 'a'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-1`
const OTHER_AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-2`

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

const { buildAuctionPathReleaseFilter, fetchAuctionPathReleases } = await import('@/queries/auctions')

const TEST_SECRET_KEY = new Uint8Array(32).fill(3)

function pathReleaseEvent(coordinate: string, createdAt: number): NostrEvent {
	return finalizeEvent(
		{
			kind: AUCTION_PATH_RELEASE_KIND as unknown as number,
			created_at: createdAt,
			content: '',
			tags: [
				['e', '2'.repeat(64)],
				['a', coordinate],
			],
		},
		TEST_SECRET_KEY,
	)
}

afterEach(() => {
	applesauceIo.fetchEvents = realFetchEvents
})

describe('auction path-release queries', () => {
	test('does not build a kind-1025 filter without an auction coordinate', () => {
		expect(buildAuctionPathReleaseFilter(undefined)).toBeNull()
		expect(buildAuctionPathReleaseFilter('')).toBeNull()
		expect(buildAuctionPathReleaseFilter('   ')).toBeNull()
	})

	test('no coordinate means no relay query and an empty passive result', async () => {
		applesauceIo.fetchEvents = mock(async () => []) as typeof applesauceIo.fetchEvents

		const releases = await fetchAuctionPathReleases(AUCTION_ROOT_EVENT_ID, 200)

		expect(releases).toEqual([])
		expect(applesauceIo.fetchEvents).not.toHaveBeenCalled()
	})

	test('coordinate present means the relay filter includes #a', async () => {
		applesauceIo.fetchEvents = mock(async () => []) as typeof applesauceIo.fetchEvents

		await fetchAuctionPathReleases(AUCTION_ROOT_EVENT_ID, 123, AUCTION_COORDINATE)

		const fetchFn = applesauceIo.fetchEvents as ReturnType<typeof mock>
		expect(fetchFn.mock.calls).toHaveLength(1)
		expect(fetchFn.mock.calls[0][0]).toEqual({
			kinds: [AUCTION_PATH_RELEASE_KIND as unknown as number],
			'#a': [AUCTION_COORDINATE],
			limit: 123,
		})
		expect(fetchFn.mock.calls[0][0]).not.toHaveProperty('#e')
	})

	test('ignores unrelated kind-1025 events for another auction coordinate', async () => {
		const unrelated = pathReleaseEvent(OTHER_AUCTION_COORDINATE, 2)
		const related = pathReleaseEvent(AUCTION_COORDINATE, 1)
		applesauceIo.fetchEvents = mock(async () => [unrelated, related]) as typeof applesauceIo.fetchEvents

		const releases = await fetchAuctionPathReleases(AUCTION_ROOT_EVENT_ID, 200, AUCTION_COORDINATE)

		expect(releases.map((event) => event.id)).toEqual([related.id])
	})
})
