import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { AUCTION_KIND } from '@/lib/auction/constants'
import type { NostrFilter } from '@/lib/nostr/io'
import type { NostrEventLike } from '@/lib/nostr/eventLike'

/**
 * Spec-validity admission at the read boundary (AUCTIONS.md §4.1).
 *
 * The rule the read layer has to hold, stated as the three promises the
 * malformed-event defect broke:
 *
 *   1. a malformed 30408 is absent from the auction feed and from the browse
 *      surfaces (`fetchAuctions`, `fetchAuctionsByPubkey` default scope);
 *   2. it stays reachable by direct link (`fetchAuction` by id,
 *      `fetchAuctionByATag`) — the detail page renders it *with* a notice
 *      naming the offending tags, which is only possible if the read is
 *      ungated;
 *   3. the owner surface opts out (`{ includeInvalid: true }`), because a seller
 *      cannot republish a corrected event they cannot see.
 *
 * The gate is `inspectAuctionAdmission` → `parseAuctionEvent`, so this file also
 * pins that the read layer does not restate the rule: the fixture that fails is
 * the real staging event (only a `d` tag).
 *
 * Scope of the stub. `applesauceIo.fetchEvents` is replaced with an in-memory
 * relay that applies the filter it is handed, so each assertion is about which
 * events survive a read rather than about a canned return value. The test-label
 * gate is stubbed out here (it is pinned by `auctionTestLabelGate.test.ts`), so a
 * failure in this file can only be about admission.
 */

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

// The blacklist store is reached at module scope by `src/queries/auctions.tsx`;
// this file is about admission, so it stays "not loaded" (fail open).
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
	getMainRelay: () => null,
	fetchLatestAppEvent: async () => null,
	ndkStore: {
		state: { ndk: null, zapNdk: null, explicitRelayUrls: [], writeRelayUrls: [], signer: undefined },
	},
	ndkActions: {
		getNDK: () => ({}),
		fetchEventsWithTimeout: async () => [] as NostrEventLike[],
	},
	getAppRelaySet: () => undefined,
}))

let applesauceIo: (typeof import('@/lib/nostr/io-applesauce'))['applesauceIo']
let fetchAuction: (typeof import('@/queries/auctions'))['fetchAuction']
let fetchAuctionByATag: (typeof import('@/queries/auctions'))['fetchAuctionByATag']
let fetchAuctions: (typeof import('@/queries/auctions'))['fetchAuctions']
let fetchAuctionsByPubkey: (typeof import('@/queries/auctions'))['fetchAuctionsByPubkey']
let auctionsByPubkeyQueryOptions: (typeof import('@/queries/auctions'))['auctionsByPubkeyQueryOptions']
let getAuctionStartingBid: (typeof import('@/queries/auctions'))['getAuctionStartingBid']
let realFetchEvents: (typeof import('@/lib/nostr/io-applesauce'))['applesauceIo']['fetchEvents']

beforeAll(async () => {
	;({ applesauceIo } = await import('@/lib/nostr/io-applesauce'))
	;({ fetchAuction, fetchAuctionByATag, fetchAuctions, fetchAuctionsByPubkey, auctionsByPubkeyQueryOptions, getAuctionStartingBid } =
		await import('@/queries/auctions'))
	realFetchEvents = applesauceIo.fetchEvents
})

// --- fixtures ---

const SELLER_PUBKEY = 'c'.repeat(64)
const OTHER_PUBKEY = 'd'.repeat(64)
const AUDITOR_PK = 'b'.repeat(64)

const VALID_D = 'valid-auction'
const MALFORMED_D = 'malformed-auction'
const OTHER_D = 'other-auction'
const REPUBLISHED_D = 'republished-auction'
const RETITLED_D = 'retitled-auction'

const FULL_TAGS = (dTag: string, title: string): string[][] => [
	['d', dTag],
	['title', title],
	['auction_type', 'english'],
	['currency', 'SAT'],
	['start_at', '1700000000'],
	['end_at', '1700086400'],
	['max_end_at', '1700086400'],
	['settlement_grace', '60'],
	['starting_bid', '1000'],
	['bid_increment', '100'],
	['reserve', '0'],
	['mint', 'https://mint.example.com'],
	['p2pk_xpub', 'xpub-fixture'],
	['auditors', AUDITOR_PK],
	['auditor_quorum', '1'],
	['key_scheme', 'hd_p2pk'],
	['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
	['schema', 'auction_v1'],
]

const makeAuction = (params: { id: string; pubkey: string; dTag: string; created_at?: number; tags?: string[][] }): NostrEventLike => ({
	id: params.id,
	pubkey: params.pubkey,
	kind: AUCTION_KIND,
	created_at: params.created_at ?? 1_700_000_000,
	content: `auction ${params.dTag}`,
	tags: params.tags ?? FULL_TAGS(params.dTag, `Auction ${params.dTag}`),
})

const VALID_AUCTION = makeAuction({ id: '1'.repeat(64), pubkey: SELLER_PUBKEY, dTag: VALID_D })
const OTHER_AUCTION = makeAuction({ id: '2'.repeat(64), pubkey: OTHER_PUBKEY, dTag: OTHER_D })
const MALFORMED_AUCTION = makeAuction({
	id: '3'.repeat(64),
	pubkey: SELLER_PUBKEY,
	dTag: MALFORMED_D,
	tags: [['d', MALFORMED_D]],
})

/** Two valid versions of one coordinate: the newer one is the displayed event. */
const REPUBLISHED_V1 = makeAuction({ id: '4'.repeat(64), pubkey: SELLER_PUBKEY, dTag: REPUBLISHED_D, created_at: 1_700_000_000 })
const REPUBLISHED_V2 = makeAuction({
	id: '5'.repeat(64),
	pubkey: SELLER_PUBKEY,
	dTag: REPUBLISHED_D,
	created_at: 1_700_000_500,
	tags: FULL_TAGS(REPUBLISHED_D, 'Republished auction (corrected description)'),
})

/**
 * A coordinate whose newest version drops a required *mutable* tag (`title`).
 * Immutable fields still match, so the version resolver accepts the newest as
 * the display event — and admission then judges the event the feed would render.
 */
const RETITLED_V1 = makeAuction({ id: '6'.repeat(64), pubkey: SELLER_PUBKEY, dTag: RETITLED_D, created_at: 1_700_000_000 })
const RETITLED_V2 = makeAuction({
	id: '7'.repeat(64),
	pubkey: SELLER_PUBKEY,
	dTag: RETITLED_D,
	created_at: 1_700_000_500,
	tags: FULL_TAGS(RETITLED_D, '').filter((tag) => tag[0] !== 'title'),
})

let relayEvents: NostrEventLike[] = []

const filterMatches = (event: NostrEventLike, filter: NostrFilter): boolean => {
	const filterWithTags = filter as NostrFilter & { '#d'?: string[] }
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false
	if (filter.authors && !filter.authors.includes(event.pubkey)) return false
	if (filter.ids && !filter.ids.includes(event.id)) return false
	if (filterWithTags['#d'] && !filterWithTags['#d'].some((d) => event.tags.some((tag) => tag[0] === 'd' && tag[1] === d))) {
		return false
	}
	return true
}

const installRelayStub = () => {
	;(applesauceIo as { fetchEvents: unknown }).fetchEvents = async (filter: NostrFilter | NostrFilter[]) => {
		const filters = Array.isArray(filter) ? filter : [filter]
		return relayEvents.filter((event) => filters.some((candidate) => filterMatches(event, candidate)))
	}
}

beforeEach(() => {
	relayEvents = [VALID_AUCTION, OTHER_AUCTION, MALFORMED_AUCTION, REPUBLISHED_V1, REPUBLISHED_V2, RETITLED_V1, RETITLED_V2]
	// NIP-11 discovery probes relays over HTTP; the unit suite must stay offline.
	globalThis.fetch = (() => Promise.reject(new Error('ADR-0005: unit tests make no network calls'))) as unknown as typeof fetch
	installRelayStub()
})

afterEach(() => {
	;(applesauceIo as { fetchEvents: unknown }).fetchEvents = realFetchEvents
})

const ids = (events: NostrEventLike[]) => events.map((event) => event.id)

describe('fetchAuctions — a malformed event is not a feed item', () => {
	test('drops the malformed event and keeps the well-formed ones', async () => {
		const results = await fetchAuctions(200)

		expect(ids(results)).not.toContain(MALFORMED_AUCTION.id)
		expect(ids(results)).toContain(VALID_AUCTION.id)
		expect(ids(results)).toContain(OTHER_AUCTION.id)
		expect(results.some((event) => event.tags.some((tag) => tag[0] === 'd' && tag[1] === MALFORMED_D))).toBe(false)
	})

	test('does not over-filter: every well-formed auction survives, versions still collapse', async () => {
		const results = await fetchAuctions(200)

		// Three coordinates survive — valid, other, and the republished pair
		// collapsing to its newest version. (The fourth, `retitled`, is the
		// next case: its display event is malformed.)
		expect(results).toHaveLength(3)
		expect(ids(results)).toContain(REPUBLISHED_V2.id)
		expect(ids(results)).not.toContain(REPUBLISHED_V1.id)
	})

	test('judges the version the feed would render: a malformed republish takes its coordinate out', async () => {
		// `RETITLED_V2` keeps every immutable field, so it is the display event
		// for its coordinate — and it is missing the required `title`. The older
		// version is not resurrected, because the feed renders one event per
		// coordinate and that event is malformed.
		const results = await fetchAuctions(200)

		expect(ids(results)).not.toContain(RETITLED_V2.id)
		expect(ids(results)).not.toContain(RETITLED_V1.id)
	})

	test('drops a zero-timing auction as well (the ruling of 2026-09-19)', async () => {
		// Every required tag is present; the timing values are `0`. It used to be
		// a feed item that sorted last, and it is now not a feed item at all.
		const zeroTimestamps = makeAuction({
			id: '8'.repeat(64),
			pubkey: OTHER_PUBKEY,
			dTag: 'zero-timestamps',
			tags: FULL_TAGS('zero-timestamps', 'Zero timestamps').map((tag) =>
				tag[0] === 'start_at' || tag[0] === 'end_at' || tag[0] === 'max_end_at' ? [tag[0], '0'] : tag,
			),
		})
		relayEvents = [zeroTimestamps]

		const results = await fetchAuctions(200)

		expect(ids(results)).toEqual([])
	})
})

describe('fetchAuctionsByPubkey — browsing gated, owner surface opted out', () => {
	test('default scope drops the seller’s malformed event (seller profile, "more from seller")', async () => {
		const results = await fetchAuctionsByPubkey(SELLER_PUBKEY, 100)

		expect(ids(results)).not.toContain(MALFORMED_AUCTION.id)
		expect(ids(results)).toContain(VALID_AUCTION.id)
	})

	test('{ includeInvalid: true } keeps it — the owner dashboard has to show it', async () => {
		const results = await fetchAuctionsByPubkey(SELLER_PUBKEY, 100, { includeInvalid: true })

		expect(ids(results)).toContain(MALFORMED_AUCTION.id)
		expect(ids(results)).toContain(VALID_AUCTION.id)
	})

	test('the two scopes cannot share a cache entry', () => {
		const browsing = auctionsByPubkeyQueryOptions(SELLER_PUBKEY, 100).queryKey
		const owner = auctionsByPubkeyQueryOptions(SELLER_PUBKEY, 100, { includeInvalid: true }).queryKey

		expect(browsing).not.toEqual(owner)
		// Both stay under the prefix the publish flows invalidate.
		expect(browsing.slice(0, 3)).toEqual(['auctions', 'byPubkey', SELLER_PUBKEY])
		expect(owner.slice(0, 3)).toEqual(['auctions', 'byPubkey', SELLER_PUBKEY])
	})
})

describe('getAuctionStartingBid — one source of truth for the floor', () => {
	test('reads the declared floor', () => {
		expect(getAuctionStartingBid(VALID_AUCTION)).toBe(1000)
	})

	test('does not fall back to the product-shaped `price` tag', () => {
		// The old fallback rendered a plausible floor for an event that declares
		// none, while the parser (#1315), the settlement path and the validators
		// all saw no floor. Absent is now absent.
		const priceOnly = makeAuction({
			id: '9'.repeat(64),
			pubkey: SELLER_PUBKEY,
			dTag: 'price-only',
			tags: [
				['d', 'price-only'],
				['title', 'Price-only fixture'],
				['price', '4321', 'SAT'],
			],
		})

		expect(getAuctionStartingBid(priceOnly)).toBe(0)
	})

	test('a present but unparseable value reads as no declared floor', () => {
		const unparseable = makeAuction({
			id: 'a'.repeat(64),
			pubkey: SELLER_PUBKEY,
			dTag: 'unparseable-floor',
			tags: [
				['d', 'unparseable-floor'],
				['starting_bid', 'soon'],
			],
		})

		expect(getAuctionStartingBid(unparseable)).toBe(0)
	})

	test('a null event reads as no declared floor', () => {
		expect(getAuctionStartingBid(null)).toBe(0)
	})
})

describe('the direct reads stay ungated — reachability is what the notice explains', () => {
	test('fetchAuction by id returns the malformed event', async () => {
		const auction = await fetchAuction(MALFORMED_AUCTION.id)

		expect(auction?.id).toBe(MALFORMED_AUCTION.id)
	})

	test('fetchAuctionByATag resolves the malformed event’s coordinate', async () => {
		const auction = await fetchAuctionByATag(SELLER_PUBKEY, MALFORMED_D)

		expect(auction?.id).toBe(MALFORMED_AUCTION.id)
	})
})
