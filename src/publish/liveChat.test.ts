import { beforeEach, describe, expect, mock, test } from 'bun:test'

const sellerPubkey = 'a'.repeat(64)
const dTag = 'auction_1700000000_abc12'
const publishedEvents: Array<{ kind?: number; tags: string[][]; content: string; pubkey?: string }> = []

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		getNDK: () => ({
			activeUser: { pubkey: sellerPubkey },
			pool: {
				connectedRelays: () => [{ url: 'wss://relay1.test' }, { url: 'wss://relay2.test' }],
			},
			signer: {
				user: mock(async () => ({ pubkey: sellerPubkey })),
				sign: mock(async () => {}),
			},
		}),
		publishEvent: mock(async (event: { kind?: number; tags: string[][]; content: string; pubkey?: string }) => {
			publishedEvents.push(event)
		}),
		fetchEventsWithTimeout: mock(async () => new Set()),
	},
}))

mock.module('@nostr-dev-kit/ndk', () => ({
	NDKEvent: class {
		kind?: number
		created_at?: number
		content = ''
		tags: string[][] = []
		id = ''
		pubkey = ''

		constructor(_ndk?: unknown) {}

		async sign(signer: any) {
			this.id = `event-${publishedEvents.length + 1}`
			if (signer && signer.user) {
				const u = await signer.user()
				this.pubkey = u?.pubkey ?? ''
			}
		}
	},
}))

mock.module('@/queries/auctions', () => ({
	getAuctionId: (event: any) => event?.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '',
	getAuctionTitle: (event: any) => event?.tags?.find((t: string[]) => t[0] === 'title')?.[1] ?? 'Untitled Auction',
	getAuctionSummary: (event: any) => event?.tags?.find((t: string[]) => t[0] === 'summary')?.[1] ?? '',
	getAuctionImages: (event: any) => {
		const images: string[][] = []
		for (const t of event?.tags ?? []) {
			if (t[0] === 'image') images.push(t)
		}
		return images
	},
	getAuctionCategories: (event: any) => {
		const cats: string[] = []
		for (const t of event?.tags ?? []) {
			if (t[0] === 't') cats.push(t[1])
		}
		return cats
	},
}))

mock.module('@/lib/auctionSettlement', () => ({
	getAuctionStartAt: (event: any) => {
		const tag = event?.tags?.find((t: string[]) => t[0] === 'start_at')
		return tag ? parseInt(tag[1], 10) || 0 : 0
	},
	getAuctionMaxEndAt: (event: any) => {
		const tag = event?.tags?.find((t: string[]) => t[0] === 'max_end_at')
		return tag ? parseInt(tag[1], 10) || 0 : 0
	},
}))

import { publishLiveActivity, publishLiveChatMessage, updateLiveActivityStatus } from '@/publish/liveChat'
import { LIVE_ACTIVITY_KIND, LIVE_CHAT_KIND, AUCTION_KIND } from '@/lib/nip53'

function makeAuctionEvent(overrides: Record<string, any> = {}) {
	return {
		pubkey: sellerPubkey,
		tags: [
			['d', dTag],
			['title', 'Test Auction'],
			['summary', 'A great auction'],
			['image', 'https://example.com/auction.png'],
			['start_at', '1000'],
			['max_end_at', '2000'],
			['t', 'art'],
		],
		...overrides,
	} as any
}

describe('publishLiveActivity', () => {
	beforeEach(() => {
		publishedEvents.length = 0
	})

	test('publishes a 30311 event with correct tags from auction event', async () => {
		const auctionEvent = makeAuctionEvent()

		await publishLiveActivity({ auctionEvent })

		expect(publishedEvents).toHaveLength(1)
		const event = publishedEvents[0]
		expect(event.kind).toBe(LIVE_ACTIVITY_KIND)

		expect(event.tags.find((t: string[]) => t[0] === 'd')?.[1]).toBe(dTag)
		expect(event.tags.find((t: string[]) => t[0] === 'a')?.[1]).toBe(`${AUCTION_KIND}:${sellerPubkey}:${dTag}`)
		expect(event.tags.find((t: string[]) => t[0] === 'title')?.[1]).toBe('Test Auction')
		expect(event.tags.find((t: string[]) => t[0] === 'status')?.[1]).toBe('ended')
		expect(event.tags.find((t: string[]) => t[0] === 'marketplace')?.[1]).toBe('plebeian')
		expect(event.tags.find((t: string[]) => t[0] === 'image')?.[1]).toBe('https://example.com/auction.png')
		expect(event.tags.find((t: string[]) => t[0] === 'starts')?.[1]).toBe('1000')
		expect(event.tags.find((t: string[]) => t[0] === 'ends')?.[1]).toBe('2000')
	})

	test('includes relay tags from connected relays', async () => {
		const auctionEvent = makeAuctionEvent()

		await publishLiveActivity({ auctionEvent })

		const relaysTag = publishedEvents[0].tags.find((t: string[]) => t[0] === 'relays')
		expect(relaysTag?.slice(1)).toEqual(['wss://relay1.test', 'wss://relay2.test'])
	})

	test('includes category tags from auction', async () => {
		const auctionEvent = makeAuctionEvent()

		await publishLiveActivity({ auctionEvent })

		const catTags = publishedEvents[0].tags.filter((t: string[]) => t[0] === 't')
		expect(catTags.map((t: string[]) => t[1])).toEqual(['art'])
	})

	test('omits image tag when auction has no images', async () => {
		const auctionEvent = makeAuctionEvent({
			tags: [
				['d', dTag],
				['title', 'No Image'],
			],
		})

		await publishLiveActivity({ auctionEvent })

		expect(publishedEvents[0].tags.find((t: string[]) => t[0] === 'image')).toBeUndefined()
	})

	test('sets Host p tag with seller pubkey', async () => {
		const auctionEvent = makeAuctionEvent()

		await publishLiveActivity({ auctionEvent })

		const pTag = publishedEvents[0].tags.find((t: string[]) => t[0] === 'p')
		expect(pTag?.[1]).toBe(sellerPubkey)
		expect(pTag?.[3]).toBe('Host')
	})
})

describe('publishLiveChatMessage', () => {
	beforeEach(() => {
		publishedEvents.length = 0
	})

	test('publishes a 1311 event with correct a tag root', async () => {
		const coord = `${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`

		await publishLiveChatMessage({ liveActivityCoord: coord, content: 'Hello auction!' })

		expect(publishedEvents).toHaveLength(1)
		const event = publishedEvents[0]
		expect(event.kind).toBe(LIVE_CHAT_KIND)
		expect(event.content).toBe('Hello auction!')

		const aTag = event.tags.find((t: string[]) => t[0] === 'a')
		expect(aTag?.[1]).toBe(coord)
		expect(aTag?.[3]).toBe('root')
	})

	test('includes relay hint from connected relays', async () => {
		const coord = `${LIVE_ACTIVITY_KIND}:${sellerPubkey}:${dTag}`

		await publishLiveChatMessage({ liveActivityCoord: coord, content: 'Test' })

		const aTag = publishedEvents[0].tags.find((t: string[]) => t[0] === 'a')
		expect(aTag?.[2]).toBe('wss://relay1.test')
	})
})

describe('updateLiveActivityStatus', () => {
	beforeEach(() => {
		publishedEvents.length = 0
	})

	test('updates status tag while preserving other tags', async () => {
		const existingEvent = {
			kind: LIVE_ACTIVITY_KIND,
			tags: [
				['d', dTag],
				['status', 'planned'],
				['title', 'My Auction'],
				['marketplace', 'plebeian'],
			],
		} as any

		await updateLiveActivityStatus({
			dTag,
			sellerPubkey,
			existingEvent,
			newStatus: 'live',
		})

		expect(publishedEvents).toHaveLength(1)
		const event = publishedEvents[0]
		expect(event.kind).toBe(LIVE_ACTIVITY_KIND)

		expect(event.tags.find((t: string[]) => t[0] === 'status')?.[1]).toBe('live')
		expect(event.tags.find((t: string[]) => t[0] === 'd')?.[1]).toBe(dTag)
		expect(event.tags.find((t: string[]) => t[0] === 'title')?.[1]).toBe('My Auction')
		expect(event.tags.find((t: string[]) => t[0] === 'marketplace')?.[1]).toBe('plebeian')
	})

	test('replaces only status tag when multiple status tags exist', async () => {
		const existingEvent = {
			kind: LIVE_ACTIVITY_KIND,
			tags: [
				['d', dTag],
				['status', 'planned'],
			],
		} as any

		await updateLiveActivityStatus({
			dTag,
			sellerPubkey,
			existingEvent,
			newStatus: 'ended',
		})

		const statusTags = publishedEvents[0].tags.filter((t: string[]) => t[0] === 'status')
		expect(statusTags).toHaveLength(1)
		expect(statusTags[0][1]).toBe('ended')
	})
})
