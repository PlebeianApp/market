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
 * What this file pins — and what it does not. Label truth is injected through
 * the module cache (`setCachedTestLabel`) and the store, which is what makes
 * the file deterministic and offline; the consequence is that it exercises the
 * store→filter half only. It does NOT exercise the label pipeline that makes a
 * label real (authorization of the labeler, namespace validation, NIP-09
 * reconciliation, event-driven store loading): those are pinned by
 * `testLabels.test.ts` (pure primitives) and by the e2e family
 * `e2e/tests/test-labels-auctions.spec.ts` (a real relay round trip).
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

/**
 * Answer of the authorized-labeler settings read. Defaults to `null` — the
 * fail-open branch: no admin/editor set is known, so a coordinate with no
 * loaded label state must never be hidden. One case needs the opposite answer
 * (a determinable authorized set) to prove that a read issues no label query
 * *because it is ungated*, not because authorization was unavailable; that case
 * sets this to a set and the reset below puts it back.
 */
let adminSettingsAnswer: { admins: string[] } | null = null

/**
 * The port every label read actually travels through
 * (`fetchAuthorizedLabelEvents` / `fetchLabelDeletionEvents` →
 * `ndkActions.fetchEventsWithTimeout`, `src/queries/testLabels.tsx`). Instrumented
 * so a case can assert that a read issues NO label query at all — the
 * `applesauceIo` port cannot carry kind-1985/kind-5 queries, so observing it
 * would prove nothing.
 */
const labelReadPortMock = mock(async (_filter: unknown, _options?: unknown) => [] as NostrEventLike[])

mock.module('@/queries/app-settings', () => ({
	fetchAdminSettings: async () => adminSettingsAnswer,
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
		fetchEventsWithTimeout: labelReadPortMock,
	},
	// `fetchTestLabels` reads this once authorization is determinable; without
	// it the label read would throw instead of reaching `labelReadPortMock`.
	getAppRelaySet: () => undefined,
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
/** Auditor listed on the auction fixtures — required by AUCTIONS.md §4.1. */
const AUDITOR_PUBKEY = 'e'.repeat(64)

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
 *
 * Every required tag is present on purpose. The feed is gated on spec validity
 * as well as on labels (`filterAdmissibleAuctionEvents`, AUCTIONS.md §4.1), so a
 * fixture that is not a well-formed auction would be dropped before the label
 * gate this file pins ever ran — and the assertions below would pass for the
 * wrong reason.
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
		['auditors', AUDITOR_PUBKEY],
		['auditor_quorum', '1'],
		['key_scheme', 'hd_p2pk'],
		['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
	],
})

const LABELED_V1 = makeAuction({ id: '1'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: LABELED_D, created_at: 1_700_000_000 })
const LABELED_V2 = makeAuction({ id: '2'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: LABELED_D, created_at: 1_700_000_500 })
const CONTROL_V1 = makeAuction({ id: '3'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: CONTROL_D, created_at: 1_700_000_000 })
const CONTROL_V2 = makeAuction({ id: '4'.repeat(64), pubkey: MERCHANT_PUBKEY, dTag: CONTROL_D, created_at: 1_700_000_500 })
const OTHER_AUCTION = makeAuction({ id: '5'.repeat(64), pubkey: OTHER_PUBKEY, dTag: OTHER_D })

/** The relay's whole content for the feed cases. */
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

/**
 * In-memory relay: applies the filter it is handed, like the real read port.
 * It does NOT model `limit` (production passes 1/50/100/200) or nak's active
 * purge of NIP-09-deleted events — no case here depends on either, so they are
 * left out rather than half-modelled.
 */
const installRelayStub = () => {
	;(applesauceIo as { fetchEvents: unknown }).fetchEvents = async (filter: NostrFilter | NostrFilter[]) => {
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
	adminSettingsAnswer = null
	labelReadPortMock.mockClear()
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
	adminSettingsAnswer = null
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

	test('the show-test-listings toggle reveals the labeled auction, and switching it off re-hides it', async () => {
		seedLabels([LABELED_COORD])

		// Off (the default): the gate applies. Without this half the case would
		// pass vacuously if no label were known at all.
		const hidden = await fetchAuctions(200)
		expect(ids(hidden)).not.toContain(LABELED_V2.id)
		expect(hidden).toHaveLength(2)

		testLabelActions.setShowTestListings(true)
		const revealed = await fetchAuctions(200)
		expect(ids(revealed)).toContain(LABELED_V2.id)
		expect(revealed).toHaveLength(3)

		// Back to the default — the reveal is a browsing aid, not a state change
		testLabelActions.setShowTestListings(false)
		const rehidden = await fetchAuctions(200)
		expect(ids(rehidden)).not.toContain(LABELED_V2.id)
		expect(rehidden).toHaveLength(2)
	})

	test('fails open: with no label state loaded, nothing is hidden', async () => {
		// No seeded label state at all — the store is "not loaded", so the filter
		// must be a no-op rather than hiding items on missing data.
		const results = await fetchAuctions(200)

		expect(ids(results)).toContain(LABELED_V2.id)
		expect(results).toHaveLength(3)
	})

	test('fails open for the optimistic window too: a labeled coordinate without a completed load hides nothing', async () => {
		// `setLabel` is the publish path's optimistic write. It populates the
		// coordinate set WITHOUT arming `isLoaded`, so this is the one state in
		// which "labels known" and "load complete" disagree — the state a
		// fail-closed implementation would hide on. Marking an item must never
		// hide it until a label load has actually completed.
		testLabelActions.setLabel(LABELED_COORD, 'optimistic-label', LABELER_PUBKEY)
		expect(testLabelActions.areLabelsLoaded()).toBe(false)

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

	test('the shared version read is not gated: the detail reads issue no label query at all', async () => {
		// Two things have to hold for this assertion to mean anything.
		//
		// 1. Authorization must be DETERMINABLE. With a null authorized set no
		//    label read happens on any path, so "no label query" would be true
		//    for the wrong reason.
		adminSettingsAnswer = { admins: [LABELER_PUBKEY] }
		// 2. No label truth is seeded, so a gate on this path would have to
		//    resolve it — over the port label reads actually use.
		const byATag = await fetchAuctionByATag(MERCHANT_PUBKEY, LABELED_D)
		const byId = await fetchAuction(LABELED_V2.id)

		// The by-a-tag read resolves through the shared version helper the feed
		// used to gate: were it filtered there, the direct-link promise would
		// only hold through the by-a-tag fallback path.
		expect(byATag).not.toBeNull()
		expect(byId).not.toBeNull()

		// And a detail read does not ask for labels at all — not through the
		// applesauce port (which cannot carry kind-1985/kind-5 filters) but
		// through `ndkActions.fetchEventsWithTimeout`, the port
		// `fetchAuthorizedLabelEvents` / `fetchLabelDeletionEvents` use.
		expect(labelReadPortMock).not.toHaveBeenCalled()
	})
})
