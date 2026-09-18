import { describe, test, expect } from 'bun:test'
import {
	LIVE_ACTIVITY_KIND,
	AUCTION_KIND,
	deriveLiveActivityStatus,
	parseAuctionCoordFromATag,
	buildLiveActivityDTag,
	buildLiveActivityCoord,
	buildLiveActivityTags,
	parseLiveActivity,
	parseLiveChatMessage,
} from '../nip53'

const SELLER_PUBKEY = 'a'.repeat(64)
const CVM_PUBKEY = 'b'.repeat(64)
const AUCTION_DTAG = 'my-auction-123'
const AUCTION_COORD = `${AUCTION_KIND}:${SELLER_PUBKEY}:${AUCTION_DTAG}`

describe('nip53', () => {
	describe('deriveLiveActivityStatus', () => {
		test('returns planned when now < startsAt', () => {
			expect(deriveLiveActivityStatus(1000, 2000, 500)).toBe('planned')
		})

		test('returns ended when now >= maxEndAt', () => {
			expect(deriveLiveActivityStatus(1000, 2000, 2500)).toBe('ended')
		})

		test('returns live when startsAt <= now < maxEndAt', () => {
			expect(deriveLiveActivityStatus(1000, 2000, 1500)).toBe('live')
		})

		test('returns live when startsAt is 0 (no start constraint)', () => {
			expect(deriveLiveActivityStatus(0, 2000, 1000)).toBe('live')
		})

		test('returns live when both are 0 (no constraints)', () => {
			expect(deriveLiveActivityStatus(0, 0, 1000)).toBe('live')
		})

		test('uses current time when now is not provided', () => {
			const now = Math.floor(Date.now() / 1000)
			expect(deriveLiveActivityStatus(0, 0)).toBe('live')
			expect(deriveLiveActivityStatus(now + 100, now + 200)).toBe('planned')
		})
	})

	describe('parseAuctionCoordFromATag', () => {
		test('extracts auction coordinate from a tag', () => {
			const event = {
				tags: [['a', AUCTION_COORD]],
			}
			expect(parseAuctionCoordFromATag(event)).toBe(AUCTION_COORD)
		})

		test('returns null when no a tag', () => {
			const event = { tags: [] }
			expect(parseAuctionCoordFromATag(event)).toBeNull()
		})

		test('returns null when a tag does not start with auction kind', () => {
			const event = {
				tags: [['a', `99999:${SELLER_PUBKEY}:something`]],
			}
			expect(parseAuctionCoordFromATag(event)).toBeNull()
		})

		test('returns null when tags are undefined', () => {
			expect(parseAuctionCoordFromATag({})).toBeNull()
		})
	})

	describe('buildLiveActivityDTag', () => {
		test('derives safe d tag from full auction coordinate', () => {
			const dTag = buildLiveActivityDTag(AUCTION_COORD)
			expect(dTag).toBe(`auction:${SELLER_PUBKEY.slice(0, 16)}:${AUCTION_DTAG}`)
		})

		test('includes truncated seller pubkey to prevent collisions', () => {
			const dTag = buildLiveActivityDTag(AUCTION_COORD)
			expect(dTag).toContain(SELLER_PUBKEY.slice(0, 16))
		})

		test('handles auction d tags with colons', () => {
			const coord = `${AUCTION_KIND}:${SELLER_PUBKEY}:my:complex:tag`
			const dTag = buildLiveActivityDTag(coord)
			expect(dTag).toBe(`auction:${SELLER_PUBKEY.slice(0, 16)}:my:complex:tag`)
		})
	})

	describe('buildLiveActivityCoord', () => {
		test('builds coordinate with activity owner pubkey (not seller)', () => {
			const coord = buildLiveActivityCoord(CVM_PUBKEY, AUCTION_COORD)
			expect(coord).toContain(CVM_PUBKEY)
			expect(coord).not.toContain(SELLER_PUBKEY)
		})

		test('uses safe d tag derived from auction coordinate', () => {
			const coord = buildLiveActivityCoord(CVM_PUBKEY, AUCTION_COORD)
			const expectedDTag = buildLiveActivityDTag(AUCTION_COORD)
			expect(coord).toBe(`${LIVE_ACTIVITY_KIND}:${CVM_PUBKEY}:${expectedDTag}`)
		})
	})

	describe('buildLiveActivityTags', () => {
		test('includes required tags', () => {
			const tags = buildLiveActivityTags({
				dTag: buildLiveActivityDTag(AUCTION_COORD),
				sellerPubkey: SELLER_PUBKEY,
				title: 'Test Auction',
				summary: 'A test auction',
				image: 'https://example.com/img.png',
				startsAt: 1000,
				maxEndAt: 2000,
				status: 'live',
				relays: ['wss://relay.example.com'],
				categories: ['bitcoin'],
			})

			const tagNames = tags.map((t) => t[0])
			expect(tagNames).toContain('d')
			expect(tagNames).toContain('a')
			expect(tagNames).toContain('title')
			expect(tagNames).toContain('status')
			expect(tagNames).toContain('client')
			expect(tagNames).toContain('p')
			expect(tagNames).toContain('summary')
			expect(tagNames).toContain('image')
			expect(tagNames).toContain('starts')
			expect(tagNames).toContain('ends')
			expect(tagNames).toContain('relays')
			expect(tagNames).toContain('t')
		})

		test('a tag links to auction coordinate with seller pubkey', () => {
			const tags = buildLiveActivityTags({
				dTag: buildLiveActivityDTag(AUCTION_COORD),
				sellerPubkey: SELLER_PUBKEY,
				title: 'Test',
				summary: '',
				image: undefined,
				startsAt: 0,
				maxEndAt: 0,
				status: 'planned',
				relays: [],
				categories: [],
			})

			const aTag = tags.find((t) => t[0] === 'a')
			expect(aTag).toBeDefined()
			expect(aTag![1]).toContain(SELLER_PUBKEY)
		})

		test('p tag marks seller as Host', () => {
			const tags = buildLiveActivityTags({
				dTag: buildLiveActivityDTag(AUCTION_COORD),
				sellerPubkey: SELLER_PUBKEY,
				title: 'Test',
				summary: '',
				image: undefined,
				startsAt: 0,
				maxEndAt: 0,
				status: 'planned',
				relays: [],
				categories: [],
			})

			const pTag = tags.find((t) => t[0] === 'p')
			expect(pTag).toBeDefined()
			expect(pTag![1]).toBe(SELLER_PUBKEY)
			expect(pTag![3]).toBe('Host')
		})

		test('omits optional tags when not provided', () => {
			const tags = buildLiveActivityTags({
				dTag: 'test',
				sellerPubkey: SELLER_PUBKEY,
				title: 'Test',
				summary: '',
				image: undefined,
				startsAt: 0,
				maxEndAt: 0,
				status: 'planned',
				relays: [],
				categories: [],
			})

			const tagNames = tags.map((t) => t[0])
			expect(tagNames).not.toContain('summary')
			expect(tagNames).not.toContain('image')
			expect(tagNames).not.toContain('starts')
			expect(tagNames).not.toContain('ends')
			expect(tagNames).not.toContain('relays')
		})
	})

	describe('parseLiveActivity', () => {
		test('separates activityOwnerPubkey from sellerPubkey', () => {
			const event = {
				pubkey: CVM_PUBKEY,
				tags: [
					['d', buildLiveActivityDTag(AUCTION_COORD)],
					['status', 'live'],
					['title', 'Test Auction'],
					['p', SELLER_PUBKEY, '', 'Host'],
				],
			}

			const result = parseLiveActivity(event)
			expect(result.activityOwnerPubkey).toBe(CVM_PUBKEY)
			expect(result.sellerPubkey).toBe(SELLER_PUBKEY)
		})

		test('falls back to event.pubkey for sellerPubkey when no Host tag', () => {
			const event = {
				pubkey: SELLER_PUBKEY,
				tags: [
					['d', 'test-d'],
					['status', 'live'],
					['title', 'Self-hosted'],
				],
			}

			const result = parseLiveActivity(event)
			expect(result.sellerPubkey).toBe(SELLER_PUBKEY)
			expect(result.activityOwnerPubkey).toBe(SELLER_PUBKEY)
		})

		test('builds coord from activityOwnerPubkey (not seller)', () => {
			const dTag = buildLiveActivityDTag(AUCTION_COORD)
			const event = {
				pubkey: CVM_PUBKEY,
				tags: [
					['d', dTag],
					['status', 'live'],
					['title', 'Test'],
					['p', SELLER_PUBKEY, '', 'Host'],
				],
			}

			const result = parseLiveActivity(event)
			expect(result.coord).toBe(`${LIVE_ACTIVITY_KIND}:${CVM_PUBKEY}:${dTag}`)
		})

		test('parses all optional fields', () => {
			const event = {
				pubkey: CVM_PUBKEY,
				tags: [
					['d', 'test'],
					['status', 'ended'],
					['title', 'Finished Auction'],
					['summary', 'It is over'],
					['image', 'https://example.com/pic.png'],
					['starts', '1000'],
					['ends', '2000'],
					['relays', 'wss://relay1.com', 'wss://relay2.com'],
					['p', SELLER_PUBKEY, '', 'Host'],
				],
			}

			const result = parseLiveActivity(event)
			expect(result.summary).toBe('It is over')
			expect(result.image).toBe('https://example.com/pic.png')
			expect(result.starts).toBe(1000)
			expect(result.ends).toBe(2000)
			expect(result.relays).toEqual(['wss://relay1.com', 'wss://relay2.com'])
		})
	})

	describe('parseLiveChatMessage', () => {
		test('extracts message fields', () => {
			const event = {
				id: 'abc123',
				pubkey: SELLER_PUBKEY,
				content: 'Hello world!',
				created_at: 1700000000,
			}

			const msg = parseLiveChatMessage(event)
			expect(msg.id).toBe('abc123')
			expect(msg.authorPubkey).toBe(SELLER_PUBKEY)
			expect(msg.content).toBe('Hello world!')
			expect(msg.createdAt).toBe(1700000000)
		})

		test('handles missing content gracefully', () => {
			const event = {
				id: 'abc',
				pubkey: SELLER_PUBKEY,
				created_at: 1700000000,
			}

			const msg = parseLiveChatMessage(event)
			expect(msg.content).toBe('')
		})

		test('handles missing created_at by using current time', () => {
			const before = Math.floor(Date.now() / 1000)
			const event = { id: 'abc', pubkey: SELLER_PUBKEY, content: 'test' }
			const msg = parseLiveChatMessage(event)
			const after = Math.floor(Date.now() / 1000)
			expect(msg.createdAt).toBeGreaterThanOrEqual(before)
			expect(msg.createdAt).toBeLessThanOrEqual(after)
		})
	})
})
