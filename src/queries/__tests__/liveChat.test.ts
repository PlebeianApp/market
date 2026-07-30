import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { parseLiveActivity, deriveLiveActivityStatus, LIVE_ACTIVITY_KIND } from '@/lib/nip53'
import { configStore } from '@/lib/stores/config'

const CVM_PUBKEY = 'c'.repeat(64)
const SELLER_PUBKEY = 'a'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-1`

let fetchedFilters: Record<string, unknown>[] = []
let relayEvents: Set<Record<string, unknown>> = new Set()

mock.module('@/lib/stores/ndk', () => ({
	ndkStore: {
		state: { ndk: null, explicitRelayUrls: [], writeRelayUrls: [], health: 'unknown', connectedRelayCount: 0 },
	},
	getWriteRelays: () => [],
	ndkActions: {
		getNDK: () => ({}),
		fetchEventsWithTimeout: mock(async (filters: Record<string, unknown>[]) => {
			fetchedFilters = Array.isArray(filters) ? filters : [filters]
			return relayEvents
		}),
	},
}))

const { fetchLiveActivity } = await import('@/queries/liveChat')

function liveActivityEvent(overrides: { pubkey?: string; dTag?: string; kind?: number; tags?: string[][] } = {}) {
	return {
		id: 'event-id',
		kind: overrides.kind ?? LIVE_ACTIVITY_KIND,
		pubkey: overrides.pubkey ?? CVM_PUBKEY,
		created_at: Math.floor(Date.now() / 1000) - 10,
		content: '',
		tags: overrides.tags ?? [
			['d', overrides.dTag ?? `auction:${SELLER_PUBKEY.slice(0, 16)}:auction-1`],
			['a', AUCTION_COORDINATE],
			['status', 'live'],
			['title', 'Test Auction'],
			['p', SELLER_PUBKEY, '', 'Host'],
		],
	}
}

function auctionEvent(pubkey: string = SELLER_PUBKEY, dTag: string = 'auction-1') {
	return {
		pubkey,
		tags: [['d', dTag]],
	} as unknown as import('@nostr-dev-kit/ndk').NDKEvent
}

describe('liveChat queries', () => {
	describe('deriveLiveActivityStatus (preliminary)', () => {
		test('uses biddingCutoffAt for end boundary (not maxEndAt)', () => {
			// This test documents that deriveLiveActivityStatus is still called
			// with biddingCutoffAt, which may differ from maxEndAt when
			// settlement grace exists - this is used for polling frequency only
			expect(deriveLiveActivityStatus(1000, 3000, 4000)).toBe('ended')
			expect(deriveLiveActivityStatus(1000, 3000, 2000)).toBe('live')
			expect(deriveLiveActivityStatus(2000, 3000, 1000)).toBe('planned')
		})
	})

	describe('status passthrough', () => {
		test('live event status is preserved regardless of event age', () => {
			// The staleness check is a UI warning only (via React Query dataUpdatedAt
			// in LiveChatPanel) - it does NOT override the CVM status tag.
			const oldEvent = {
				pubkey: 'c'.repeat(64),
				created_at: Math.floor(Date.now() / 1000) - 7200, // 2 hours old
				tags: [
					['d', 'auction:abcd:old'],
					['status', 'live'],
					['title', 'Old Live Auction'],
				],
			}

			const result = parseLiveActivity(oldEvent)
			expect(result.status).toBe('live')
		})

		test('missing created_at does NOT force ended status', () => {
			// Missing timestamps must not be treated as "very old" (which would
			// flip live→ended). The staleness warning may appear but status is preserved.
			const noTimestampEvent = {
				pubkey: 'd'.repeat(64),
				// created_at intentionally omitted
				tags: [
					['d', 'auction:abcd:notime'],
					['status', 'live'],
					['title', 'No Timestamp'],
				],
			}

			const result = parseLiveActivity(noTimestampEvent)
			expect(result.status).toBe('live')
		})

		test('ended status is preserved as-is', () => {
			const endedEvent = {
				pubkey: 'e'.repeat(64),
				created_at: Math.floor(Date.now() / 1000) - 100,
				tags: [
					['d', 'auction:abcd:ended'],
					['status', 'ended'],
					['title', 'Ended Auction'],
				],
			}

			const result = parseLiveActivity(endedEvent)
			expect(result.status).toBe('ended')
		})
	})

	describe('fetchLiveActivity anti-spoofing', () => {
		beforeEach(() => {
			fetchedFilters = []
			relayEvents = new Set()
			configStore.setState((s) => ({ ...s, config: { ...s.config, cvmServerPubkey: CVM_PUBKEY }, isLoaded: true }))
		})

		test('returns null when cvmServerPubkey is absent (not configured)', async () => {
			configStore.setState((s) => ({ ...s, config: { ...s.config, cvmServerPubkey: undefined } }))
			relayEvents.add(liveActivityEvent())
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
			expect(fetchedFilters).toHaveLength(0)
		})

		test('returns null when cvmServerPubkey is empty string (falsy edge case)', async () => {
			configStore.setState((s) => ({ ...s, config: { ...s.config, cvmServerPubkey: '' } }))
			relayEvents.add(liveActivityEvent())
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
			expect(fetchedFilters).toHaveLength(0)
		})

		test('sets authors filter to [cvmServerPubkey] when present', async () => {
			relayEvents.add(liveActivityEvent())
			await fetchLiveActivity(auctionEvent())
			expect(fetchedFilters).toHaveLength(1)
			expect(fetchedFilters[0].authors).toEqual([CVM_PUBKEY])
		})

		test('accepts events ONLY from cvmServerPubkey (rejects spoofed events from random pubkey)', async () => {
			const attackerPriv = crypto.getRandomValues(new Uint8Array(32))
			const attackerPub = getPublicKey(attackerPriv)
			const spoofedEvent = liveActivityEvent({ pubkey: attackerPub })
			relayEvents.add(spoofedEvent)
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('returns null when no events found (normal empty result)', async () => {
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('handles malformed events gracefully (missing tags, wrong kind)', async () => {
			const malformedEvents = [liveActivityEvent({ tags: [] }), liveActivityEvent({ kind: 1 })]
			for (const event of malformedEvents) {
				relayEvents.add(event)
			}
			// Should not throw and should not return a valid live activity
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})
	})

	describe('parseLiveActivity identity', () => {
		test('parseLiveActivity uses CVM-authored event correctly', () => {
			const cvmPriv = crypto.getRandomValues(new Uint8Array(32))
			const cvmPub = getPublicKey(cvmPriv)
			const sellerPriv = crypto.getRandomValues(new Uint8Array(32))
			const sellerPub = getPublicKey(sellerPriv)

			const event = {
				pubkey: cvmPub,
				tags: [
					['d', 'auction:abcd:test'],
					['status', 'live'],
					['title', 'Test'],
					['p', sellerPub, '', 'Host'],
				],
			}

			const result = parseLiveActivity(event)
			expect(result.activityOwnerPubkey).toBe(cvmPub)
			expect(result.sellerPubkey).toBe(sellerPub)
			expect(result.coord).toContain(cvmPub)
			expect(result.coord).not.toContain(sellerPub)
		})

		test('spoofed event from non-CVM author would have different activityOwnerPubkey', () => {
			const attackerPriv = crypto.getRandomValues(new Uint8Array(32))
			const attackerPub = getPublicKey(attackerPriv)
			const sellerPriv = crypto.getRandomValues(new Uint8Array(32))
			const sellerPub = getPublicKey(sellerPriv)

			const spoofedEvent = {
				pubkey: attackerPub,
				tags: [
					['d', 'auction:abcd:test'],
					['status', 'live'],
					['title', 'Fake'],
					['p', sellerPub, '', 'Host'],
				],
			}

			const result = parseLiveActivity(spoofedEvent)
			expect(result.activityOwnerPubkey).toBe(attackerPub)
			expect(result.activityOwnerPubkey).not.toBe(sellerPub)
		})
	})
})
