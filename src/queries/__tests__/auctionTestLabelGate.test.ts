import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { AUCTION_KIND } from '@/lib/auction/constants'
import type { NostrFilter } from '@/lib/nostr/io'
import type { NostrEventLike } from '@/lib/nostr/eventLike'
import { testLabelActions } from '@/lib/stores/testLabels'
import { setCachedTestLabel, invalidateTestLabelCache } from '../testLabels'

/**
 * ADR-0009 — the auctions half of the gate, at the read boundary.
 *
 * The label mechanism promises three things at once, and only one of them is a
 * filter:
 *
 *   1. a labeled auction is absent from the auction feed (the discovery
 *      surface) — `fetchAuctions`;
 *   2. it stays reachable by direct link (`fetchAuction` by id), by a-tag
 *      (`fetchAuctionByATag`, which also feeds the Featured carousel — a
 *      curation surface, ungated by the rev 4 taxonomy), and on the seller's
 *      profile / owner dashboard (`fetchAuctionsByPubkey`);
 *   3. missing label data fails OPEN — no item is hidden because a read did not
 *      happen.
 *
 * These tests pin all three at the query layer. The counterpart for products is
 * `productsSearchTestLabelGate.test.ts`; the shared primitives are covered by
 * `testLabels.test.ts`.
 *
 * Stub boundary: the `applesauceIo` read port is replaced with an in-memory
 * relay that applies the filter it is handed, so the assertions are about which
 * events survive a read, not about a mocked return value. Label truth is seeded
 * through `setCachedTestLabel` for EVERY coordinate a read can return, so
 * `fetchTestLabels` resolves from cache and never reaches an authorized-labeler
 * settings read or the network (ADR-0005: unit tests make no network calls).
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

// `src/queries/auctions.tsx` reaches the blacklist store at module scope; the
// gate tests are about labels, so the blacklist stays "not loaded" (fail open).
mock.module('@/lib/stores/blacklist', () => ({
	blacklistActions: {
		isBlacklistLoaded: () => false,
		isPubkeyBlacklisted: () => false,
		isProductBlacklisted: () => false,
		isCollectionBlacklisted: () => false,
	},
}))

// The authorized-labeler settings read is the only thing that can make label
// authorization "determinable". Answering null pins the fail-open branch: no
// admin/editor set is known, so a coordinate with no loaded label state must
// never be hidden.
mock.module('@/queries/app-settings', () => ({
	fetchAdminSettings: async () => null,
	fetchEditorSettings: async () => null,
}))

mock.module('@/lib/stores/ndk', () => ({
	getWriteRelays: () => [],
	// The authorized-labeler settings read pulls these through
	// `@/queries/app-settings`; returning nothing keeps it offline and lands on
	// "authorization undeterminable" → the gate fails open (asserted below).
	getMainRelay: () => null,
	fetchLatestAppEvent: async () => null,
	ndkStore: {
		state: { ndk: null, zapNdk: null, explicitRelayUrls: [], writeRelayUrls: [], signer: undefined },
	},
	ndkActions: {
		getNDK: () => ({}),
		fetchEventsWithTimeout: mock(async () => [] as NostrEventLike[]),
	},
}))

/**
 * Loaded in `beforeAll`, not at module scope: the `mock.module` calls above
 * must be registered before `@/queries/auctions` is imported and Bun does not
 * hoist them. Deliberately not a top-level `await` — the repo's tsconfig sets
 * `module: preserve` with no `target`, so TLA is a type error for every file
 * that uses it, and this file adds no new diagnostics.
 */
let applesauceIo: (typeof import('@/lib/nostr/io-applesauce'))['applesauceIo']
let fetchAuction: (typeof import('@/queries/auctions'))['fetchAuction']
let fetchAuctionByATag: (typeof import('@/queries/auctions'))['fetchAuctionByATag']
let fetchAuctions: (typeof import('@/queries/auctions'))['fetchAuctions']
let fetchAuctionsByPubkey: (typeof import('@/queries/auctions'))['fetchAuctionsByPubkey']
let realFetchEvents: (typeof import('@/lib/nostr/io-applesauce'))['applesauceIo']['fetchEvents']
let realFetch: typeof globalThis.fetch

beforeAll(async () => {
	;({ applesauceIo } = await import('@/lib/nostr/io-applesauce'))
	;({ fetchAuction, fetchAuctionByATag, fetchAuctions, fetchAuctionsByPubkey } = await import('@/queries/auctions'))
	realFetchEvents = applesauceIo.fetchEvents
	realFetch = globalThis.fetch
})

// --- fixtures ---

const MERCHANT_PUBKEY = 'c'.repeat(64)
const OTHER_PUBKEY = 'd'.repeat(64)
const LABELER_PUBKEY = 'a'.repeat(64)

// d-tags → coordinates (kind 30408 = auction listing)
const LABELED_D = 'labeled-auction'
const CONTROL_D = 'control-auction'
const OTHER_D = 'other-auction'

const LABELED_COORD = `30408:${MERCHANT_PUBKEY}:${LABELED_D}`
const CONTROL_COORD = `30408:${MERCHANT_PUBKEY}:${CONTROL_D}`
const OTHER_COORD = `30408:${OTHER_PUBKEY}:${OTHER_D}`

const ALL_COORDINATES = [LABELED_COORD, CONTROL_COORD, OTHER_COORD]

/**
 * A minimal but structurally real auction event. Two events sharing a d-tag are
 * "versions" of one auction: identical immutable tags, different `created_at`
 * and `id`, which is what `resolveAuctionVersionSet` collapses.
 */
const makeAuction = (params: { id: string; pubkey: string; dTag: string; created_at?: number }): NostrEventLike => ({
	id: params.id,
	pubkey: params.pubkey,
	kind: AUCTION_KIND,
	created_at: params.created_at ?? 1_700_000_000,
	content: `auction ${params.dTag}`,
	tags: [
		['d', params.dTag],
		['title', `Auction ${params.dTag}`],
		['schema', 'auction_v1'],
	],
})

const LABELED_V1 = makeAuction({ id: '1'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: LABELED_D, created_at: 1_700_000_000 })
const LABELED_V2 = makeAuction({ id: '2'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: LABELED_D, created_at: 1_700_000_500 })
const CONTROL_V1 = makeAuction({ id: '3'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: CONTROL_D, created_at: 1_700_000_000 })
const CONTROL_V2 = makeAuction({ id: '4'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: CONTROL_D, created_at: 1_700_000_500 })
const OTHER_AUCTION = makeAuction({ id: '5'.repeat(64), pubkey: OTHER_PUBKEY, dTag: OTHER_D })

/** The relay's whole content for the feed cases. */
let relayEvents: NostrEventLike[] = []
let requestedFilters: Array<NostrFilter | NostrFilter[]> = []

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

/** In-memory relay: applies the filter it is handed, like the real read port. */
const installRelayStub = () => {
	;(applesauceIo as { fetchEvents: unknown }).fetchEvents = async (filter: NostrFilter | NostrFilter[]) => {
		requestedFilters.push(filter)
		const filters = Array.isArray(filter) ? filter : [filter]
		return relayEvents.filter((event) => filters.some((candidate) => filterMatches(event, candidate)))
	}
}

/**
 * Seed label truth for the whole coordinate set. `setCachedTestLabel(coord,
 * null)` is the "known unlabeled" answer: it keeps every coordinate
 * cache-fresh, so label resolution stays offline and `isLoaded` becomes true.
 */
const seedLabels = (labeled: string[] = []) => {
	for (const coordinate of ALL_COORDINATES) {
		setCachedTestLabel(coordinate, labeled.includes(coordinate) ? { eventId: `label-${coordinate}`, labelerPubkey: LABELER_PUBKEY } : null)
	}
}

beforeEach(() => {
	relayEvents = [LABELED_V1, LABELED_V2, CONTROL_V1, CONTROL_V2, OTHER_AUCTION]
	requestedFilters = []
	// NIP-11 discovery probes relays over HTTP; the unit suite must stay offline.
	globalThis.fetch = (() => Promise.reject(new Error('ADR-0005: unit tests make no network calls'))) as unknown as typeof fetch
	installRelayStub()
	testLabelActions.clearLabels()
	// Without this the module-level cache keeps the previous test's label truth
	// alive, and `fetchTestLabels` writes cache hits back into the store.
	invalidateTestLabelCache()
})

afterEach(() => {
	;(applesauceIo as { fetchEvents: unknown }).fetchEvents = realFetchEvents
	globalThis.fetch = realFetch
	testLabelActions.clearLabels()
	testLabelActions.setShowTestListings(false)
	invalidateTestLabelCache()
})

const ids = (events: NostrEventLike[]) => events.map((event) => event.id)

describe('fetchAuctions — the auction feed is a discovery surface (ADR-0009)', () => {
	test('excludes a test-labeled auction and keeps the unlabeled ones', async () => {
		seedLabels([LABELED_COORD])

		const results = await fetchAuctions(200)

		expect(ids(results)).not.toContain(LABELED_V2.id)
		expect(ids(results)).not.toContain(LABELED_V1.id)
		expect(ids(results)).toContain(CONTROL_V2.id)
		expect(ids(results)).toContain(OTHER_AUCTION.id)
		expect(results).toHaveLength(2)
	})

	test('a labeled coordinate drops as a whole — every version goes, not just the displayed one', async () => {
		seedLabels([LABELED_COORD])

		const results = await fetchAuctions(200)

		// The gate is per coordinate and runs before the version collapse, so a
		// surviving older version cannot resurrect the auction in the feed.
		expect(results.some((event) => event.tags.some((tag) => tag[0] === 'd' && tag[1] === LABELED_D))).toBe(false)
		// The control's two versions still collapse to one displayed auction.
		expect(results.filter((event) => event.tags.some((tag) => tag[0] === 'd' && tag[1] === CONTROL_D))).toHaveLength(1)
	})

	test('does not over-filter when every coordinate is known unlabeled', async () => {
		seedLabels()

		const results = await fetchAuctions(200)

		expect(ids(results)).toEqual([LABELED_V2.id, CONTROL_V2.id, OTHER_AUCTION.id])
	})

	test('the show-test-listings toggle reveals the labeled auction', async () => {
		seedLabels([LABELED_COORD])
		testLabelActions.setShowTestListings(true)

		const results = await fetchAuctions(200)

		expect(ids(results)).toContain(LABELED_V2.id)
		expect(results).toHaveLength(3)
	})

	test('fails open: with no label state loaded, nothing is hidden', async () => {
		// No seeded label state at all — the store is "not loaded", so the filter
		// must be a no-op rather than hiding items on missing data.
		const results = await fetchAuctions(200)

		expect(ids(results)).toContain(LABELED_V2.id)
		expect(results).toHaveLength(3)
	})
})

describe('the auction detail and by-pubkey reads stay ungated (ADR-0009 steps 3-4)', () => {
	test('fetchAuction (direct link by id) returns a labeled auction', async () => {
		seedLabels([LABELED_COORD])

		const auction = await fetchAuction(LABELED_V2.id)

		expect(auction?.id).toBe(LABELED_V2.id)
	})

	test('fetchAuctionByATag returns a labeled auction and still resolves its version set', async () => {
		seedLabels([LABELED_COORD])

		const auction = await fetchAuctionByATag(MERCHANT_PUBKEY, LABELED_D)

		// The version read must not be gated mid-resolution: the newest version
		// is the displayed one, not an older survivor or a null result.
		expect(auction?.id).toBe(LABELED_V2.id)
	})

	test('fetchAuctionsByPubkey (seller profile / owner dashboard) returns a labeled auction', async () => {
		seedLabels([LABELED_COORD])

		const results = await fetchAuctionsByPubkey(MERCHANT_PUBKEY, 100)

		expect(ids(results)).toContain(LABELED_V2.id)
		expect(ids(results)).toContain(CONTROL_V2.id)
	})

	test('the gate is not applied inside the shared version read', async () => {
		seedLabels([LABELED_COORD])

		// The by-a-tag read resolves through the same helper the feed used to
		// gate. If that helper filtered, the labeled auction would come back
		// null here and the direct-link promise would only hold by fallback.
		const byATag = await fetchAuctionByATag(MERCHANT_PUBKEY, LABELED_D)
		const byId = await fetchAuction(LABELED_V2.id)

		expect(byATag).not.toBeNull()
		expect(byId).not.toBeNull()

		// And neither read even asks for labels: a detail read neither gates nor
		// needs label truth to return the item.
		const requestedKinds = requestedFilters.flatMap((filter) => (Array.isArray(filter) ? filter : [filter])).flatMap((f) => f.kinds ?? [])
		expect(requestedKinds).not.toContain(1985)
	})
})
