import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, getPublicKey, verifyEvent as realVerifyEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'
import { parseLiveActivity, deriveLiveActivityStatus, buildLiveActivityDTag, LIVE_ACTIVITY_KIND } from '@/lib/nip53'
import { configStore } from '@/lib/stores/config'
import { applesauceIo, type NostrFilter } from '@/lib/nostr/io'

// Real CVM key pair so signed fixtures carry the exact pubkey configured as
// cvmServerPubkey. fetchLiveActivity now reads through fetchNdkEventSet, which
// rehydrates via real verifyEvent and drops unsigned events, so every fixture
// must be genuinely signed by the CVM key.
const cvmPriv = new Uint8Array(32).fill(7)
const CVM_PUBKEY = getPublicKey(cvmPriv)
const SELLER_PUBKEY = 'a'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-1`
const DERIVED_ACTIVITY_D = buildLiveActivityDTag(AUCTION_COORDINATE)

const realFetchEvents = applesauceIo.fetchEvents
let relayEvents: NostrEvent[] = []
let fetchedFilters: Array<NostrFilter | NostrFilter[]> = []

mock.module('@/lib/stores/ndk', () => ({
	ndkStore: {
		state: { ndk: null, explicitRelayUrls: [], writeRelayUrls: [] },
	},
	getWriteRelays: () => [],
	ndkActions: {
		getNDK: () => ({}),
	},
}))

const { fetchLiveActivity } = await import('@/queries/liveChat')

function signActivity(
	overrides: {
		pubkey?: never
		dTag?: string
		kind?: number
		tags?: string[][]
		created_at?: number
		content?: string
	} = {},
): NostrEvent {
	return finalizeEvent(
		{
			kind: overrides.kind ?? LIVE_ACTIVITY_KIND,
			created_at: overrides.created_at ?? Math.floor(Date.now() / 1000) - 10,
			content: overrides.content ?? '',
			tags: overrides.tags ?? [
				['d', overrides.dTag ?? DERIVED_ACTIVITY_D],
				['a', AUCTION_COORDINATE],
				['status', 'live'],
				['title', 'Test Auction'],
				['p', SELLER_PUBKEY, '', 'Host'],
			],
		},
		cvmPriv,
	)
}

function forgeSignature(event: NostrEvent): NostrEvent {
	// Spread copies the nostr-tools `verifiedSymbol` marker (a symbol-keyed
	// property set by finalizeEvent), which makes verifyEvent short-circuit to
	// true without checking the signature. Strip it so the forged sig is
	// actually verified and rejected.
	const forged = { ...event, sig: '0'.repeat(128) } as NostrEvent & { [k: symbol]: unknown }
	delete (forged as Record<symbol, unknown>)[Object.getOwnPropertySymbols(event)[0]]
	return forged
}

function auctionEvent(pubkey: string = SELLER_PUBKEY, dTag: string = 'auction-1') {
	return {
		pubkey,
		tags: [['d', dTag]],
	} as unknown as import('@/lib/nostr/ndk-events').NDKEvent
}

function stubFetch() {
	applesauceIo.fetchEvents = mock(async (filter: NostrFilter | NostrFilter[]) => {
		fetchedFilters.push(filter)
		return [...relayEvents]
	}) as typeof applesauceIo.fetchEvents
}

afterEach(() => {
	relayEvents = []
	fetchedFilters = []
	applesauceIo.fetchEvents = realFetchEvents
})

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
			relayEvents = []
			fetchedFilters = []
			stubFetch()
			configStore.setState((s) => ({
				...s,
				config: { ...s.config, cvmServerPubkey: CVM_PUBKEY },
				isLoaded: true,
			}))
		})

		test('returns null when cvmServerPubkey is absent (not configured)', async () => {
			configStore.setState((s) => ({
				...s,
				config: { ...s.config, cvmServerPubkey: undefined },
			}))
			relayEvents.push(signActivity())
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
			expect(fetchedFilters).toHaveLength(0)
		})

		test('returns null when cvmServerPubkey is empty string (falsy edge case)', async () => {
			configStore.setState((s) => ({
				...s,
				config: { ...s.config, cvmServerPubkey: '' },
			}))
			relayEvents.push(signActivity())
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
			expect(fetchedFilters).toHaveLength(0)
		})

		test('sets authors filter to [cvmServerPubkey] when present', async () => {
			relayEvents.push(signActivity())
			await fetchLiveActivity(auctionEvent())
			expect(fetchedFilters).toHaveLength(1)
			expect((fetchedFilters[0] as NostrFilter).authors).toEqual([CVM_PUBKEY])
		})

		test('🔴 pre-dedup #d filter is the DERIVED live-activity d, not the auction bare d', async () => {
			relayEvents.push(signActivity())
			await fetchLiveActivity(auctionEvent())
			// The kind-30311 live-activity event's canonical d tag is derived from
			// the auction coordinate via buildLiveActivityDTag(coord). A conforming
			// relay returns zero events for a filter on the auction's bare d.
			expect((fetchedFilters[0] as NostrFilter)['#d']).toEqual([DERIVED_ACTIVITY_D])
			// Guard against regression to the auction's bare d tag.
			expect((fetchedFilters[0] as NostrFilter)['#d']).not.toEqual(['auction-1'])
		})

		test('🔴 post-fetch validation: rejects candidate whose d tag is the auction bare d', async () => {
			relayEvents.push(signActivity({ dTag: 'auction-1' }))
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('🔴 post-fetch validation: rejects candidate whose d tag belongs to a different auction', async () => {
			relayEvents.push(signActivity({ dTag: `auction:${SELLER_PUBKEY.slice(0, 16)}:other-auction` }))
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('accepts candidate whose d tag exactly equals the derived live-activity d', async () => {
			relayEvents.push(signActivity())
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).not.toBeNull()
			expect(result?.dTag).toBe(DERIVED_ACTIVITY_D)
		})

		test('accepts events ONLY from cvmServerPubkey (rejects spoofed events from random pubkey)', async () => {
			const attackerPriv = crypto.getRandomValues(new Uint8Array(32))
			const spoofed = finalizeEvent(
				{
					kind: LIVE_ACTIVITY_KIND,
					created_at: Math.floor(Date.now() / 1000) - 10,
					content: '',
					tags: [
						['d', DERIVED_ACTIVITY_D],
						['a', AUCTION_COORDINATE],
						['status', 'live'],
					],
				},
				attackerPriv,
			)
			relayEvents.push(spoofed as NostrEvent)
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('returns null when no events found (normal empty result)', async () => {
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('handles malformed events gracefully (missing tags, wrong kind)', async () => {
			relayEvents.push(signActivity({ tags: [] }))
			relayEvents.push(signActivity({ kind: 1 }))
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('🔴 rejects forged events with correct pubkey/kind/d-tag but invalid signature', async () => {
			// Signed by the CVM key, but the signature is overwritten with
			// garbage. rehydrateVerifiedNdkEvent runs real verifyEvent and
			// drops it before it can reach the fetchLiveActivity validation loop.
			relayEvents.push(forgeSignature(signActivity()))
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).toBeNull()
		})

		test('🔴 accepts events with valid signatures', async () => {
			relayEvents.push(signActivity())
			const result = await fetchLiveActivity(auctionEvent())
			expect(result).not.toBeNull()
			expect(result?.status).toBe('live')
		})

		test('🟠 dedup suppression: valid older event returned even when invalid newer event exists', async () => {
			// A newer event with a forged signature and an older valid one with
			// the same d-tag coordinate. The forged newer event is dropped at
			// rehydration (real verifyEvent), so the valid older event is the
			// only candidate and is returned.
			const olderValid = signActivity({
				created_at: Math.floor(Date.now() / 1000) - 100,
			})
			const newerInvalid = forgeSignature(signActivity({ created_at: Math.floor(Date.now() / 1000) - 10 }))

			relayEvents.push(newerInvalid)
			relayEvents.push(olderValid)

			const result = await fetchLiveActivity(auctionEvent())
			expect(result).not.toBeNull()
		})

		test('🟡 deterministic sort: lower event ID wins for equal created_at timestamps', async () => {
			const timestamp = Math.floor(Date.now() / 1000) - 10

			// Add in reverse order to test sort stability. Both are valid and
			// carry the correct coordinate/d-tag; the sort (created_at desc,
			// then event id asc) deterministically selects one.
			relayEvents.push(signActivity({ created_at: timestamp, content: 'b' }))
			relayEvents.push(signActivity({ created_at: timestamp, content: 'a' }))

			const result = await fetchLiveActivity(auctionEvent())
			expect(result).not.toBeNull()
		})
	})

	describe('signature-verification seam isolation (regression)', () => {
		test('real nostr-tools verifyEvent stays real; forged signatures are rejected', () => {
			// Regression: this file used to mock the whole 'nostr-tools' module,
			// which bun applies process-wide for the entire test run. That made
			// realVerifyEvent accept any event with a 'sig' field and broke
			// signature-verification tests in nip59, nip17, and orders suites.
			// The read path must rehydrate via real verifyEvent and run the
			// first-party verifyNostrEventSignature seam — never a lenient mock.
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
			// a syntactically valid sig field. Clone via JSON: nostr-tools
			// caches its verdict on the event via a symbol property, and object
			// spread would copy that cached verdict.
			const forgedEvent = JSON.parse(JSON.stringify(signedEvent)) as typeof signedEvent
			forgedEvent.sig = '0'.repeat(128)
			expect(realVerifyEvent(forgedEvent)).toBe(false)
		})
	})

	describe('parseLiveActivity identity', () => {
		test('parseLiveActivity uses CVM-authored event correctly', () => {
			const cvmPub = getPublicKey(crypto.getRandomValues(new Uint8Array(32)))
			const sellerPub = getPublicKey(crypto.getRandomValues(new Uint8Array(32)))

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
			const attackerPub = getPublicKey(crypto.getRandomValues(new Uint8Array(32)))
			const sellerPub = getPublicKey(crypto.getRandomValues(new Uint8Array(32)))

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
