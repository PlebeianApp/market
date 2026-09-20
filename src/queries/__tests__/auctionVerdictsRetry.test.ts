import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { VALIDATOR_VERDICT_KIND } from '@/lib/auction/constants'
import type { NostrEvent, NostrFilter } from '@/lib/nostr/io'

type RelayEvent = NostrEvent

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

// Same seam the sibling verdict-query test mocks, with the same shape: bun
// applies `mock.module` process-wide for the whole test run, so the mocks here
// must stay identical to `auctionVerdicts.test.ts`. The signature seam is
// deliberately NOT mocked — the fixtures below are really signed, so the parse
// boundary under it behaves as it does in production.
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
	ndkStore: {
		state: {
			ndk: null,
			zapNdk: null,
			explicitRelayUrls: [],
			writeRelayUrls: [],
			signer: undefined,
		},
	},
	ndkActions: {
		getNDK: () => ({}),
		fetchEventsWithTimeout: mock(async () => new Set<never>()),
	},
}))

// The mocks above must be registered before the module under test is imported,
// so the import is deferred past the hoisted `mock.module` calls.
type AuctionsQueries = typeof import('@/queries/auctions')
let queries!: AuctionsQueries
const AUCTION_VERDICT_RETRY_WINDOW_MS = 2500
const AUCTION_VERDICT_RETRY_STEP_MS = 300

beforeAll(async () => {
	queries = await import('@/queries/auctions')
	// Budget under test comes from the module, not from the local copies above.
	expect(queries.AUCTION_VERDICT_RETRY_WINDOW_MS).toBe(AUCTION_VERDICT_RETRY_WINDOW_MS)
	expect(queries.AUCTION_VERDICT_RETRY_STEP_MS).toBe(AUCTION_VERDICT_RETRY_STEP_MS)
})

const AUCTION_ROOT_EVENT_ID = '1'.repeat(64)
const AUCTION_COORDINATE = `30408:${'a'.repeat(64)}:auction-1`

const validatorSecretKey = generateSecretKey()
const validatorPubkey = getPublicKey(validatorSecretKey)

function verdictEvent(createdAt: number): NostrEvent {
	return finalizeEvent(
		{
			kind: VALIDATOR_VERDICT_KIND as unknown as number,
			created_at: createdAt,
			content: '',
			tags: [
				['d', `${'b'.repeat(64)}:${AUCTION_ROOT_EVENT_ID}:${'c'.repeat(64)}`],
				['p', 'b'.repeat(64)],
				['e', AUCTION_ROOT_EVENT_ID],
				['bid', 'c'.repeat(64)],
				['a', AUCTION_COORDINATE],
				['claim', 'valid_bid_placed'],
				['observed_at', String(createdAt)],
			],
		},
		validatorSecretKey,
	)
}

const verdict = verdictEvent(1700000000)

/**
 * Build an injected fetcher from a scripted sequence of responses. An Error
 * entry is thrown; an array entry is returned. The last entry repeats once the
 * script is exhausted, so "always empty" / "always throws" are expressible.
 */
function scriptedFetch(script: (RelayEvent[] | Error)[]) {
	const calls: NostrFilter[] = []
	const fn = async (filter: NostrFilter | NostrFilter[]) => {
		calls.push(filter as NostrFilter)
		const step = script[Math.min(calls.length - 1, script.length - 1)]
		if (step instanceof Error) throw step
		return [...step]
	}
	return { fn, calls }
}

describe('publish-path verdict reads — bounded transient retry', () => {
	test('budget is a 2500ms window with a 300ms step', () => {
		expect(queries.AUCTION_VERDICT_RETRY_WINDOW_MS).toBe(2500)
		expect(queries.AUCTION_VERDICT_RETRY_STEP_MS).toBe(300)
	})

	test('re-reads after an empty observation until the verdict appears', async () => {
		const { fn, calls } = scriptedFetch([[], [], [verdict]])

		const result = await queries.fetchAuctionVerdictsWithRetry(
			AUCTION_ROOT_EVENT_ID,
			null,
			AUCTION_COORDINATE,
			[validatorPubkey],
			fn,
			500,
			10,
		)

		expect(result.map((e) => e.id)).toEqual([verdict.id])
		expect(calls.length).toBe(3)
		// Every attempt stays scoped to the auction's declared auditors.
		for (const filter of calls) expect(filter.authors).toEqual([validatorPubkey])
	})

	test('returns the last empty observation when the window closes — the caller still fails closed', async () => {
		const { fn, calls } = scriptedFetch([[]])

		const result = await queries.fetchAuctionVerdictsWithRetry(
			AUCTION_ROOT_EVENT_ID,
			null,
			AUCTION_COORDINATE,
			[validatorPubkey],
			fn,
			60,
			10,
		)

		// No throw from the retry helper: the empty read is handed back so the
		// caller's quorum-shortfall throw (fail-closed) is what stops the publish.
		expect(result).toEqual([])
		expect(calls.length).toBeGreaterThan(1)
	})

	test('does not retry an auction that declares no auditors (permanent, not lag)', async () => {
		const { fn, calls } = scriptedFetch([[]])

		const result = await queries.fetchAuctionVerdictsWithRetry(AUCTION_ROOT_EVENT_ID, null, AUCTION_COORDINATE, [], fn, 500, 10)

		expect(result).toEqual([])
		expect(calls.length).toBe(0)
	})

	test('propagates a non-transient error immediately', async () => {
		const failure = new Error('unexpected response shape from relay')
		const { fn, calls } = scriptedFetch([failure])

		await expect(
			queries.fetchAuctionVerdictsWithRetry(AUCTION_ROOT_EVENT_ID, null, AUCTION_COORDINATE, [validatorPubkey], fn, 500, 10),
		).rejects.toThrow('unexpected response shape from relay')
		expect(calls.length).toBe(1)
	})

	test('retries a transient transport error, then returns the verdict', async () => {
		const { fn, calls } = scriptedFetch([new Error('socket closed'), [verdict]])

		const result = await queries.fetchAuctionVerdictsWithRetry(
			AUCTION_ROOT_EVENT_ID,
			null,
			AUCTION_COORDINATE,
			[validatorPubkey],
			fn,
			500,
			10,
		)

		expect(result.map((e) => e.id)).toEqual([verdict.id])
		expect(calls.length).toBe(2)
	})

	test('rethrows the transient error once the window closes', async () => {
		const { fn, calls } = scriptedFetch([new Error('relay connection timeout')])

		await expect(
			queries.fetchAuctionVerdictsWithRetry(AUCTION_ROOT_EVENT_ID, null, AUCTION_COORDINATE, [validatorPubkey], fn, 60, 10),
		).rejects.toThrow('relay connection timeout')
		expect(calls.length).toBeGreaterThan(1)
	})
})
