import { describe, expect, test } from 'bun:test'
import {
	LIVE_ACTIVITY_KIND,
	AUCTION_KIND,
	MARKETPLACE_TAG,
	getLiveActivityCoord,
	getAuctionCoordFromLiveActivity,
	getLiveActivityCoordFromAuction,
	deriveLiveActivityStatus,
	buildLiveActivityTags,
	parseLiveActivity,
	parseLiveChatMessage,
	type LiveActivityStatus,
} from './nip53'

describe('nip53', () => {
	const sellerPubkey = 'a'.repeat(64)
	const dTag = 'auction_1700000000_abc12'

	test('getLiveActivityCoord produces correct coordinate', () => {
		expect(getLiveActivityCoord(sellerPubkey, dTag)).toBe(
			`30311:${sellerPubkey}:${dTag}`,
		)
	})

	test('getAuctionCoordFromLiveActivity swaps kind', () => {
		const liveCoord = `30311:${sellerPubkey}:${dTag}`
		expect(getAuctionCoordFromLiveActivity(liveCoord)).toBe(
			`30408:${sellerPubkey}:${dTag}`,
		)
	})

	test('getLiveActivityCoordFromAuction swaps kind', () => {
		const auctionCoord = `30408:${sellerPubkey}:${dTag}`
		expect(getLiveActivityCoordFromAuction(auctionCoord)).toBe(
			`30311:${sellerPubkey}:${dTag}`,
		)
	})

	test('coordinate roundtrip preserves d tag and pubkey', () => {
		const auctionCoord = `30408:${sellerPubkey}:${dTag}`
		const liveCoord = getLiveActivityCoordFromAuction(auctionCoord)
		const back = getAuctionCoordFromLiveActivity(liveCoord)
		expect(back).toBe(auctionCoord)
	})

	test('deriveLiveActivityStatus returns planned before start_at', () => {
		expect(deriveLiveActivityStatus(1000, 2000, 500)).toBe('planned')
	})

	test('deriveLiveActivityStatus returns live between start_at and max_end_at', () => {
		expect(deriveLiveActivityStatus(1000, 2000, 1500)).toBe('live')
	})

	test('deriveLiveActivityStatus returns ended after max_end_at', () => {
		expect(deriveLiveActivityStatus(1000, 2000, 2500)).toBe('ended')
	})

	test('deriveLiveActivityStatus returns live when start_at is 0', () => {
		expect(deriveLiveActivityStatus(0, 2000, 1500)).toBe('live')
	})

	test('deriveLiveActivityStatus returns live when max_end_at is 0', () => {
		expect(deriveLiveActivityStatus(1000, 0, 1500)).toBe('live')
	})

	test('buildLiveActivityTags includes required tags', () => {
		const tags = buildLiveActivityTags({
			dTag,
			sellerPubkey,
			title: 'Test Auction',
			summary: 'A test',
			image: 'https://example.com/img.png',
			startsAt: 1000,
			maxEndAt: 2000,
			status: 'planned',
			relays: ['wss://relay1.com'],
			categories: ['art', 'digital'],
		})

		expect(tags.find((t) => t[0] === 'd')?.[1]).toBe(dTag)
		expect(tags.find((t) => t[0] === 'a')?.[1]).toBe(`30408:${sellerPubkey}:${dTag}`)
		expect(tags.find((t) => t[0] === 'title')?.[1]).toBe('Test Auction')
		expect(tags.find((t) => t[0] === 'status')?.[1]).toBe('planned')
		expect(tags.find((t) => t[0] === 'marketplace')?.[1]).toBe(MARKETPLACE_TAG)
		expect(tags.find((t) => t[0] === 'p')?.[1]).toBe(sellerPubkey)
		expect(tags.find((t) => t[0] === 'p')?.[3]).toBe('Host')
		expect(tags.find((t) => t[0] === 'summary')?.[1]).toBe('A test')
		expect(tags.find((t) => t[0] === 'image')?.[1]).toBe('https://example.com/img.png')
		expect(tags.find((t) => t[0] === 'starts')?.[1]).toBe('1000')
		expect(tags.find((t) => t[0] === 'ends')?.[1]).toBe('2000')
		expect(tags.find((t) => t[0] === 'relays')?.slice(1)).toEqual(['wss://relay1.com'])
		const catTags = tags.filter((t) => t[0] === 't')
		expect(catTags.map((t) => t[1])).toEqual(['art', 'digital'])
	})

	test('buildLiveActivityTags omits optional tags when empty', () => {
		const tags = buildLiveActivityTags({
			dTag,
			sellerPubkey,
			title: 'Test',
			summary: '',
			image: undefined,
			startsAt: 0,
			maxEndAt: 0,
			status: 'live',
			relays: [],
			categories: [],
		})

		expect(tags.find((t) => t[0] === 'summary')).toBeUndefined()
		expect(tags.find((t) => t[0] === 'image')).toBeUndefined()
		expect(tags.find((t) => t[0] === 'starts')).toBeUndefined()
		expect(tags.find((t) => t[0] === 'ends')).toBeUndefined()
		expect(tags.find((t) => t[0] === 'relays')).toBeUndefined()
		expect(tags.filter((t) => t[0] === 't')).toEqual([])
	})

	test('parseLiveActivity extracts fields from event', () => {
		const mockEvent = {
			pubkey: sellerPubkey,
			tags: [
				['d', dTag],
				['a', `30408:${sellerPubkey}:${dTag}`],
				['title', 'My Auction'],
				['status', 'live'],
				['starts', '1000'],
				['ends', '2000'],
				['relays', 'wss://relay1.com', 'wss://relay2.com'],
			],
		}

		const result = parseLiveActivity(mockEvent)
		expect(result.coord).toBe(`30311:${sellerPubkey}:${dTag}`)
		expect(result.dTag).toBe(dTag)
		expect(result.sellerPubkey).toBe(sellerPubkey)
		expect(result.title).toBe('My Auction')
		expect(result.status).toBe('live')
		expect(result.starts).toBe(1000)
		expect(result.ends).toBe(2000)
		expect(result.relays).toEqual(['wss://relay1.com', 'wss://relay2.com'])
	})

	test('parseLiveChatMessage extracts fields from event', () => {
		const mockEvent = {
			id: 'event123',
			pubkey: sellerPubkey,
			content: 'Hello auction!',
			created_at: 1500,
		}

		const result = parseLiveChatMessage(mockEvent)
		expect(result.id).toBe('event123')
		expect(result.authorPubkey).toBe(sellerPubkey)
		expect(result.content).toBe('Hello auction!')
		expect(result.createdAt).toBe(1500)
	})
})
