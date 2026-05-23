import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { LIVE_ACTIVITY_KIND, LIVE_CHAT_KIND } from '@/lib/nip53'

const sellerPubkey = 'b'.repeat(64)
const dTag = 'auction_query_test_123'

const fetchedEvents: Set<any> = new Set()

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		getNDK: () => ({
			pool: { connectedRelays: () => [] },
		}),
		publishEvent: mock(async () => {}),
		fetchEventsWithTimeout: mock(async (filters: any[], _opts: any) => {
			return new Set(fetchedEvents)
		}),
	},
}))

mock.module('@/queries/auctions', () => ({
	getAuctionId: (event: any) => event?.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '',
}))

import { fetchLiveActivity, fetchLiveChatMessages } from '@/queries/liveChat'

describe('fetchLiveActivity', () => {
	beforeEach(() => {
		fetchedEvents.clear()
	})

	test('returns null if event has no d tag', async () => {
		const event = { pubkey: sellerPubkey, tags: [] }
		const result = await fetchLiveActivity(event as any)
		expect(result).toBeNull()
	})

	test('returns null if no events found on relay', async () => {
		fetchedEvents.clear()
		const event = { pubkey: sellerPubkey, tags: [['d', dTag]] }
		const result = await fetchLiveActivity(event as any)
		expect(result).toBeNull()
	})

	test('parses live activity event from relay', async () => {
		const mockLiveEvent = {
			pubkey: sellerPubkey,
			tags: [
				['d', dTag],
				['a', `30408:${sellerPubkey}:${dTag}`],
				['title', 'Live Auction'],
				['status', 'live'],
				['starts', '1000'],
				['ends', '2000'],
				['relays', 'wss://relay.test'],
			],
		}
		fetchedEvents.clear()
		fetchedEvents.add(mockLiveEvent)

		const auctionEvent = { pubkey: sellerPubkey, tags: [['d', dTag]] }
		const result = await fetchLiveActivity(auctionEvent as any)

		expect(result).not.toBeNull()
		expect(result!.coord).toBe(`${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`)
		expect(result!.dTag).toBe(dTag)
		expect(result!.sellerPubkey).toBe(sellerPubkey)
		expect(result!.title).toBe('Live Auction')
		expect(result!.status).toBe('live')
		expect(result!.starts).toBe(1000)
		expect(result!.ends).toBe(2000)
		expect(result!.relays).toEqual(['wss://relay.test'])
	})

	test('returns null when NDK returns empty set', async () => {
		fetchedEvents.clear()
		const event = { pubkey: sellerPubkey, tags: [['d', dTag]] }
		const result = await fetchLiveActivity(event as any)
		expect(result).toBeNull()
	})
})

describe('fetchLiveChatMessages', () => {
	beforeEach(() => {
		fetchedEvents.clear()
	})

	test('returns empty array when no events found', async () => {
		fetchedEvents.clear()
		const coord = `${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`
		const result = await fetchLiveChatMessages(coord)
		expect(result).toEqual([])
	})

	test('parses and sorts chat messages by createdAt ascending', async () => {
		fetchedEvents.clear()
		fetchedEvents.add({
			id: 'msg3',
			pubkey: 'c'.repeat(64),
			content: 'Third message',
			created_at: 3000,
		})
		fetchedEvents.add({
			id: 'msg1',
			pubkey: sellerPubkey,
			content: 'First message',
			created_at: 1000,
		})
		fetchedEvents.add({
			id: 'msg2',
			pubkey: 'd'.repeat(64),
			content: 'Second message',
			created_at: 2000,
		})

		const coord = `${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`
		const result = await fetchLiveChatMessages(coord)

		expect(result).toHaveLength(3)
		expect(result[0].id).toBe('msg1')
		expect(result[0].content).toBe('First message')
		expect(result[1].id).toBe('msg2')
		expect(result[2].id).toBe('msg3')
	})

	test('handles messages with missing content gracefully', async () => {
		fetchedEvents.clear()
		fetchedEvents.add({
			id: 'msg_empty',
			pubkey: sellerPubkey,
			created_at: 1500,
		})

		const coord = `${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`
		const result = await fetchLiveChatMessages(coord)

		expect(result).toHaveLength(1)
		expect(result[0].content).toBe('')
		expect(result[0].id).toBe('msg_empty')
	})

	test('uses current timestamp when created_at is missing', async () => {
		fetchedEvents.clear()
		fetchedEvents.add({
			id: 'msg_no_ts',
			pubkey: sellerPubkey,
			content: 'Hello',
		})

		const coord = `${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`
		const result = await fetchLiveChatMessages(coord)

		expect(result).toHaveLength(1)
		expect(result[0].createdAt).toBeGreaterThan(0)
	})
})
