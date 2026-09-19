import { describe, test, expect } from 'bun:test'
import {
	LIVE_ACTIVITY_KIND,
	LIVE_ACTIVITY_DTAG_MAX_LENGTH,
	LIVE_ACTIVITY_DTAG_PREFIX,
	RELAY_TAG_INDEX_VALUE_MAX_LENGTH,
	AUCTION_KIND,
	deriveLiveActivityStatus,
	isWithinRelayTagIndexBudget,
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
		test('derives a short digest d tag from the auction coordinate', () => {
			const dTag = buildLiveActivityDTag(AUCTION_COORD)
			// `auction:<12 hex>` — 20 characters, inside the 29-character budget
			// that the relay tag index leaves for a live-activity `d`.
			expect(dTag).toMatch(/^auction:[0-9a-f]{12}$/)
			expect(dTag.length).toBeLessThanOrEqual(LIVE_ACTIVITY_DTAG_MAX_LENGTH)
		})

		test('is deterministic — the same auction always yields the same address', () => {
			// This is what makes auction → activity reachability work without a
			// lookup: any client with the auction event computes the activity's
			// address, and the activity's own `a` tag gives the other direction.
			expect(buildLiveActivityDTag(AUCTION_COORD)).toBe(buildLiveActivityDTag(AUCTION_COORD))
		})

		test('keeps two sellers using the same d tag apart', () => {
			// Hashing the *coordinate* rather than the bare d tag: d tags are
			// seller-chosen, so two sellers may legitimately pick the same one.
			const otherSellerCoord = `${AUCTION_KIND}:${'c'.repeat(64)}:${AUCTION_DTAG}`
			expect(buildLiveActivityDTag(AUCTION_COORD)).not.toBe(buildLiveActivityDTag(otherSellerCoord))
		})

		test('never leaks an auction d tag containing colons into the address', () => {
			// The retired format embedded the auction d tag verbatim, so a d tag
			// with colons produced a coordinate whose own d tag had colons —
			// exactly the ambiguity that made naive `<kind>:<pubkey>:<d>` parsing
			// unsafe. The digest has exactly one colon, the prefix separator.
			const coord = `${AUCTION_KIND}:${SELLER_PUBKEY}:my:complex:tag`
			const dTag = buildLiveActivityDTag(coord)

			expect(dTag.match(/:/g)).toHaveLength(1)
			expect(dTag.startsWith(`${LIVE_ACTIVITY_DTAG_PREFIX}:`)).toBe(true)
			expect(dTag).not.toContain('my:complex:tag')
		})
	})

	describe('relay tag-index budget', () => {
		/**
		 * The relay indexes a tag only when the name is one character and the
		 * value is ≤ 100 characters, and its query planner builds an `#a` lookup
		 * from that index alone (no fallback scan). Every `a` value this feature
		 * publishes therefore has to fit — that is the whole reason the activity
		 * `d` tag is a digest instead of `auction:<seller-prefix>:<auction-d>`.
		 */
		const REALISTIC_AUCTION_DTAG = 'auction_1789745290774_nuh7g'
		const REALISTIC_COORD = `${AUCTION_KIND}:${SELLER_PUBKEY}:${REALISTIC_AUCTION_DTAG}`

		test('the activity coordinate the chat messages reference fits the budget', () => {
			const coord = buildLiveActivityCoord(CVM_PUBKEY, REALISTIC_COORD)

			expect(isWithinRelayTagIndexBudget(coord)).toBe(true)
			expect(coord.length).toBeLessThanOrEqual(RELAY_TAG_INDEX_VALUE_MAX_LENGTH)
			// The retired format produced 123 characters for this exact shape and
			// was therefore unreadable through any `#a` lookup.
			expect(coord.length).toBeLessThan(123)
		})

		test('the auction reference tag the activity carries fits the budget', () => {
			expect(isWithinRelayTagIndexBudget(REALISTIC_COORD)).toBe(true)
		})

		test('the digest leaves headroom for longer auction d tags', () => {
			const longCoord = `${AUCTION_KIND}:${SELLER_PUBKEY}:${'x'.repeat(29)}`
			expect(isWithinRelayTagIndexBudget(buildLiveActivityCoord(CVM_PUBKEY, longCoord))).toBe(true)
			expect(isWithinRelayTagIndexBudget(buildLiveActivityDTag(longCoord))).toBe(true)
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
				auctionCoord: AUCTION_COORD,
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

		test('a tag is the full auction coordinate — the activity → auction direction', () => {
			const tags = buildLiveActivityTags({
				auctionCoord: AUCTION_COORD,
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
			// Exact equality, not "contains the seller": the reference tag has to
			// be the coordinate a client can resolve, and it must fit the relay
			// tag-index budget (98 chars for a realistic auction d tag).
			expect(aTag![1]).toBe(AUCTION_COORD)
			expect(aTag![1]).toContain(SELLER_PUBKEY)
			expect(isWithinRelayTagIndexBudget(aTag![1])).toBe(true)
		})

		test('d tag is derived from the auction coordinate, not passed in', () => {
			const tags = buildLiveActivityTags({
				auctionCoord: AUCTION_COORD,
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

			const dTag = tags.find((t) => t[0] === 'd')
			expect(dTag![1]).toBe(buildLiveActivityDTag(AUCTION_COORD))
		})

		test('p tag marks seller as Host', () => {
			const tags = buildLiveActivityTags({
				auctionCoord: AUCTION_COORD,
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
				auctionCoord: AUCTION_COORD,
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
