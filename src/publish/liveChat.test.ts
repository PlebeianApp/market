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

import { publishLiveChatMessage } from '@/publish/liveChat'
import { LIVE_ACTIVITY_KIND, LIVE_CHAT_KIND } from '@/lib/nip53'

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
