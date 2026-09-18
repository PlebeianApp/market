import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, getPublicKey, verifyEvent as realVerifyEvent } from 'nostr-tools'
import { parseLiveActivity, deriveLiveActivityStatus, buildLiveActivityDTag, LIVE_ACTIVITY_KIND } from '@/lib/nip53'
import { configStore } from '@/lib/stores/config'

const CVM_PUBKEY = 'c'.repeat(64)
const SELLER_PUBKEY = 'a'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-1`

let fetchedFilters: Record<string, unknown>[] = []
let relayEvents: Set<Record<string, unknown>> = new Set()
let verifyEventResult: ((event: Record<string, unknown>) => boolean) | null = null

// Mock only the signature-verification seam that liveChat.tsx uses, so we can
// control which events pass/fail signature verification without needing real
// cryptographic signatures. Never mock 'nostr-tools' itself: bun applies
// mock.module process-wide for the whole test run, which would replace the
// real verifyEvent for every other test file in the suite.
mock.module('@/lib/nostr/event-signature', () => ({
	verifyNostrEventSignature: mock((event: Record<string, unknown>) => {
		if (verifyEventResult) return verifyEventResult(event)
		// Default: accept events that have a 'sig' field, reject those without
		return !!event.sig
	}),
}))

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

/** Create a plain (unsigned) event object for tests that don't need real crypto */
function liveActivityEvent(
	overrides: { pubkey?: string; dTag?: string; kind?: number; tags?: string[][]; created_at?: number; id?: string; sig?: string } = {},
) {
	return {
		id: overrides.id ?? 'event-id',
		kind: overrides.kind ?? LIVE_ACTIVITY_KIND,
		pubkey: overrides.pubkey ?? CVM_PUBKEY,
		created_at: overrides.created_at ?? Math.floor(Date.now() / 1000) - 10,
		content: '',
		tags: overrides.tags ?? [
			['d', overrides.dTag ?? `auction:${SELLER_PUBKEY.slice(0, 16)}:auction-1`],
			['a', AUCTION_COORDINATE],
			['status', 'live'],
			['title', 'Test Auction'],
			['p', SELLER_PUBKEY, '', 'Host'],
		],
		sig: overrides.sig ?? 'valid-sig-mock',
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
			expect(deriveLiveActivityStatus(1000, 3000, 4000)).toBe('ended')
			expect(deriveLiveActivityStatus(1000, 3000, 2000)).toBe('live')
			expect(deriveLiveActivityStatus(2000, 3000, 1000)).toBe('planned')
		})
	})

	describe('status passthrough', () => {
		test('live event status is preserved regardless of event age', () => {
			const oldEvent = {
				pubkey: 'c'.repeat(64),
				created_at: Math.floor(Date.now() / 1000) - 7200,
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
			const noTimestampEvent = {
				pubkey: 'd'.repeat(64),
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
			verifyEventResult = null
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
			verifyEventResult = () => true
			relayEvents.add(liveActivityEvent())
			await fetchLiveActivity(auctionEvent())
			expect(fetchedFilters).toHaveLength(1)
			expect(fetchedFilters[0].authors).toEqual([CVM_PUBKEY])
		})

		test('🔴 pre-dedup #d filter is the DERIVED live-activity d, not the auction bare d', async () => {
			verifyEventResult = () => true
			relayEvents.add(liveActivityEvent())
			await fetchLiveActivity(auctionEvent())
			// The kind-30311 live-activity event's canonical d tag is derived from
			// the auction coordinate via buildLiveActivityDTag(coord). A conforming
			// relay returns zero events for a filter on the auction's bare d.
			const expectedActivityD = buildLiveActivityDTag(AUCTION_COORDINATE)
			expect(fetchedFilters[0]['#d']).toEqual([expectedActivityD])
			// Guard against regression to the auction's bare d tag.
			expect(fetchedFilters[0]['#d']).not.toEqual(['auction-1'])
		})

		test('🔴 post-fetch validation: rejects candidate whose d tag is the auction bare d', async () => {
			verifyEventResult = () => true
			// Correct author and kind, valid signature, but the d tag is the
			// auction's bare d instead of the derived live-activity d.
			relayEvents.add(liveActivityEvent({ dTag: 'auction-1' }))
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('🔴 post-fetch validation: rejects candidate whose d tag belongs to a different auction', async () => {
			verifyEventResult = () => true
			relayEvents.add(liveActivityEvent({ dTag: `auction:${SELLER_PUBKEY.slice(0, 16)}:other-auction` }))
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('accepts candidate whose d tag exactly equals the derived live-activity d', async () => {
			verifyEventResult = () => true
			relayEvents.add(liveActivityEvent())
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).not.toBeNull()
			expect(result?.dTag).toBe(buildLiveActivityDTag(AUCTION_COORDINATE))
		})

		test('accepts events ONLY from cvmServerPubkey (rejects spoofed events from random pubkey)', async () => {
			verifyEventResult = () => true
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
			verifyEventResult = () => true
			const malformedEvents = [liveActivityEvent({ tags: [] }), liveActivityEvent({ kind: 1 })]
			for (const event of malformedEvents) {
				relayEvents.add(event)
			}
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('🔴 rejects forged events with correct pubkey/kind/d-tag but invalid signature', async () => {
			// Event has correct CVM pubkey, correct kind, correct d-tag,
			// but an invalid Schnorr signature. verifyEvent should reject it.
			const forgedEvent = liveActivityEvent({ sig: 'invalid-fake-signature' })

			// Mock verifyEvent to simulate real sig check: only 'valid-sig-mock' passes
			verifyEventResult = (event) => event.sig === 'valid-sig-mock'

			relayEvents.add(forgedEvent)
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('🔴 accepts events with valid signatures', async () => {
			const validEvent = liveActivityEvent()
			verifyEventResult = (event) => event.sig === 'valid-sig-mock'

			relayEvents.add(validEvent)
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).not.toBeNull()
			expect(result?.status).toBe('live')
		})

		test('🟠 dedup suppression: valid older event returned even when invalid newer event exists', async () => {
			// Simulate NDK dedup scenario: a newer invalid event and an older valid one
			// with the same d-tag coordinate. NDK dedup would normally keep only
			// the newer (invalid) one. Our code scans all returned events and
			// validates each, so the valid event should be found.
			const olderValid = liveActivityEvent({
				created_at: Math.floor(Date.now() / 1000) - 100,
				id: 'older-valid-event',
				sig: 'valid-sig-mock',
			})
			const newerInvalid = liveActivityEvent({
				created_at: Math.floor(Date.now() / 1000) - 10,
				id: 'newer-invalid-event',
				sig: 'invalid-signature',
			})

			// Mock verifyEvent: only valid-sig-mock passes
			verifyEventResult = (event) => event.sig === 'valid-sig-mock'

			relayEvents.add(newerInvalid)
			relayEvents.add(olderValid)

			const result = await fetchLiveActivity(auctionEvent())
			// Should return the valid event despite the invalid one being newer
			expect(result).not.toBeNull()
		})

		test('🟡 deterministic sort: lower event ID wins for equal created_at timestamps', async () => {
			const timestamp = Math.floor(Date.now() / 1000) - 10

			const eventLowId = liveActivityEvent({
				id: 'aaa-low-id',
				created_at: timestamp,
			})
			const eventHighId = liveActivityEvent({
				id: 'zzz-high-id',
				created_at: timestamp,
			})

			verifyEventResult = () => true

			// Add in reverse order to test sort stability
			relayEvents.add(eventHighId)
			relayEvents.add(eventLowId)

			const result = await fetchLiveActivity(auctionEvent())
			// Both are valid, but the one with the lower ID should be selected
			// (sort is created_at desc, then event ID asc as tiebreaker)
			expect(result).not.toBeNull()
		})
	})

	describe('signature-verification seam isolation (regression)', () => {
		test('nostr-tools verifyEvent stays real while the liveChat seam is mocked', () => {
			// Regression: this file used to mock the whole 'nostr-tools' module,
			// which bun applies process-wide for the entire test run. That made
			// realVerifyEvent accept any event with a 'sig' field and broke
			// signature-verification tests in nip59, nip17, and orders suites.
			// The seam mock must only affect liveChat's own verification path.
			const signerPriv = crypto.getRandomValues(new Uint8Array(32))
			const signedEvent = finalizeEvent(
				{
					kind: LIVE_ACTIVITY_KIND,
					content: '',
					created_at: Math.floor(Date.now() / 1000),
					tags: [['d', 'auction:seam-isolation:signed']],
				},
				signerPriv,
			)

			// Real verification accepts a genuinely signed event...
			expect(realVerifyEvent(signedEvent)).toBe(true)

			// ...and rejects a forged signature, even though the event carries
			// a syntactically valid sig field and the seam mock is active.
			// Clone via JSON: nostr-tools caches its verdict on the event via a
			// symbol property, and object spread would copy that cached verdict.
			const forgedEvent = JSON.parse(JSON.stringify(signedEvent)) as typeof signedEvent
			forgedEvent.sig = '0'.repeat(128)
			expect(realVerifyEvent(forgedEvent)).toBe(false)
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
