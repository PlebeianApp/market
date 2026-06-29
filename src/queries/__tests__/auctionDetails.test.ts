import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

let fetchedFilters: NDKFilter[] = []
let relayEvents = new Set<NDKEvent>()

// Deferred gate used to PROVE the per-auction reads run concurrently. While the
// gate is closed no `fetchEventsWithTimeout` promise resolves. A sequential
// `await` chain would issue exactly one filter before the gate opens; a
// `Promise.all` batch issues every one of them up front.
let openGate: () => void = () => {}
let gate: Promise<void> = new Promise(() => {})

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

mock.module('@/lib/stores/blacklist', () => ({
	blacklistActions: {
		isBlacklistLoaded: () => false,
		isPubkeyBlacklisted: () => false,
		isProductBlacklisted: () => false,
		isCollectionBlacklisted: () => false,
	},
}))

mock.module('@/lib/stores/ndk', () => ({
	ndkActions: {
		getNDK: () => ({}),
		// Record the filter, then park on the gate. The composite's Promise.all
		// therefore dispatches every call before any can resolve; a sequential
		// chain would dispatch only the first.
		fetchEventsWithTimeout: mock((filter: NDKFilter) => {
			fetchedFilters.push(filter)
			return gate.then(() => relayEvents)
		}),
	},
}))

const { fetchAuctionDetails } = await import('@/queries/auctions')

const AUCTION_ROOT_EVENT_ID = '1'.repeat(64)
const SELLER_PUBKEY = 'a'.repeat(64)
const AUCTION_COORDINATE = `30408:${SELLER_PUBKEY}:auction-1`

describe('fetchAuctionDetails — Fix 3 (#1046) parallel auction reads', () => {
	beforeEach(() => {
		fetchedFilters = []
		relayEvents = new Set()
		gate = new Promise<void>((resolve) => {
			openGate = resolve
		})
	})

	test('returns an empty structured result and skips the relay when given no root id', async () => {
		const result = await fetchAuctionDetails('', { auctionCoordinates: AUCTION_COORDINATE })

		expect(result).toEqual({
			bids: [],
			settlements: [],
			pathReleases: [],
			verdicts: [],
			claimOrders: [],
		})
		expect(fetchedFilters).toHaveLength(0)
	})

	test('issues every per-auction read concurrently via Promise.all, not a sequential waterfall', async () => {
		// Kick the composite off WITHOUT awaiting. While the gate is closed a
		// sequential chain would be parked on the first fetch; a Promise.all
		// batch dispatches all of them synchronously.
		const pending = fetchAuctionDetails(AUCTION_ROOT_EVENT_ID, { auctionCoordinates: AUCTION_COORDINATE })

		// Flush microtasks so fetchAuctionDetails's synchronous body (which
		// constructs the Promise.all and thus invokes every fetcher) runs.
		await Promise.resolve()
		await Promise.resolve()

		// bids / settlements / pathReleases / verdicts / claimOrders => 5 reads.
		// If the reads were sequential this would be 1 (blocked on the gate).
		expect(fetchedFilters).toHaveLength(5)

		openGate()
		const result = await pending

		// Structured shape — every channel is an array.
		expect(Object.keys(result).sort()).toEqual(['bids', 'claimOrders', 'pathReleases', 'settlements', 'verdicts'])
		for (const value of Object.values(result)) {
			expect(Array.isArray(value)).toBe(true)
		}
	})

	test('omits the coordinate-only reads when no auction coordinate is supplied', async () => {
		openGate()
		const result = await fetchAuctionDetails(AUCTION_ROOT_EVENT_ID)

		// Without a coordinate, the two reads that key off `#a` short-circuit:
		// fetchAuctionClaimOrders (coordinate required) and
		// fetchAuctionPathReleases (buildAuctionPathReleaseFilter returns null).
		// The three root-id reads (bids, settlements, verdicts) still fire.
		expect(fetchedFilters).toHaveLength(3)
		expect(result.claimOrders).toEqual([])
		expect(result.pathReleases).toEqual([])
	})
})
