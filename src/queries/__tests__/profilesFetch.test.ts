import { afterEach, describe, expect, mock, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { finalizeEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'

import { applesauceIo, type NostrFilter } from '@/lib/nostr/io'
import { ndkActions } from '@/lib/stores/ndk'
import { fetchProfileByIdentifier, profileByIdentifierQueryOptions, wotScoreQueryOptions } from '../profiles'

// Infer NDK return types from the function under test instead of importing
// the NDK package directly — the NDK-footprint CI guard counts any src/ file
// containing the NDK package import path, and this test file must not
// increase the baseline.
type FetchResult = Awaited<ReturnType<typeof fetchProfileByIdentifier>>
type NDKUserLike = NonNullable<FetchResult['user']>
type NDKUserProfileLike = NonNullable<FetchResult['profile']>

// fetchProfileByIdentifier reads NDK from the `ndkActions` store (NDK-null
// guard) and profile events from `applesauceIo.fetchEvents` (the seam — the
// orders-seam.test.ts pattern). We stub the seam per test to drive each
// behavioral case.
const realFetchEvents = applesauceIo.fetchEvents
const realGetNDK = ndkActions.getNDK
const realSetTimeout = globalThis.setTimeout
const realFetch = globalThis.fetch

afterEach(() => {
	applesauceIo.fetchEvents = realFetchEvents
	;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
	globalThis.setTimeout = realSetTimeout as typeof globalThis.setTimeout
	globalThis.fetch = realFetch as typeof globalThis.fetch
})

const VALID_HEX = 'a'.repeat(64)

const TEST_SECRET_KEY = new Uint8Array(32).fill(1)

/** A validly-signed kind-0 metadata event for the given pubkey. */
function rawProfileEvent(profile: Record<string, unknown>, created_at = 1_700_000_000): NostrEvent {
	return finalizeEvent(
		{
			created_at,
			kind: 0,
			tags: [],
			content: JSON.stringify(profile),
		},
		TEST_SECRET_KEY,
	)
}

/** A minimal NDK stub: `fetchUser` parity is via fetchNdkUser (hex/npub), so
 * the stub only needs the kind-10019 fallback `fetchEvent` for zap helpers. */
function stubNdk(opts: { fetchEvent?: (filter: unknown) => Promise<unknown> } = {}) {
	return {
		fetchEvent: opts.fetchEvent ?? (async () => null),
		queuesNip05: { add: async (item: { func: () => Promise<unknown> }) => item.func() },
	}
}

describe('fetchProfileByIdentifier distinguishes genuine absence from transient failures', () => {
	test('returns the profile when the seam resolves a kind-0 event, rehydrated and parsed', async () => {
		const event = rawProfileEvent({ name: 'alice', about: 'hi' })
		// Type the mock's parameter so filter assertions can index mock.calls.
		const fetchEvents = mock(async (_filter: NostrFilter) => [event])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		const result = await fetchProfileByIdentifier(VALID_HEX)

		// The seam fetch is called with the hex-pubkey kind-0 filter.
		expect(fetchEvents).toHaveBeenCalledTimes(1)
		expect(fetchEvents.mock.calls[0][0]).toEqual({ kinds: [0], authors: [VALID_HEX] })
		// The returned user is a REAL NDKUser (consumers read .user?.pubkey).
		expect(result.user).toBeInstanceOf(Object)
		expect((result.user as NDKUserLike).pubkey).toBe(VALID_HEX)
		// The profile is parsed from the verified kind-0 event content.
		expect((result.profile as NDKUserProfileLike).name).toBe('alice')
		expect((result.profile as NDKUserProfileLike).about).toBe('hi')
	})

	test('returns { profile: null, user } for genuine absence (seam resolves no kind-0 event)', async () => {
		const fetchEvents = mock(async () => [])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		const result = await fetchProfileByIdentifier(VALID_HEX)

		// A successful null — NOT a transient failure. React Query commits this as
		// a successful result, which is what lets ProfilePage show "not found".
		expect(result.profile).toBeNull()
		expect((result.user as NDKUserLike).pubkey).toBe(VALID_HEX)
	})

	test('throws on timeout instead of returning a null-shaped success', async () => {
		// The seam never settles; the timeout must win the race and throw.
		const fetchEvents = mock(async () => new Promise<NostrEvent[]>(() => {}))
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()
		// Fire the timeout reject immediately so the test doesn't wait 8s.
		globalThis.setTimeout = ((cb: () => void) => {
			cb()
			return 0 as unknown as ReturnType<typeof globalThis.setTimeout>
		}) as typeof globalThis.setTimeout

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('Profile fetch timed out')
	})

	test('throws when the seam rejects (relay error) instead of returning null', async () => {
		const fetchEvents = mock(async () => Promise.reject(new Error('relay boom')))
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('relay boom')
	})

	test('NIP-05 identifier: kind-0 profile fetch happens on the seam AFTER HTTP resolution', async () => {
		// fetchProfileByIdentifier for a NIP-05 identifier resolves the
		// identity via the HTTP .well-known lookup (fromNip05), then fetches
		// kind-0 through the applesauceIo seam keyed on the resolved pubkey.
		const resolvedPubkey = 'b'.repeat(64)
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ names: { alice: resolvedPubkey } }), { status: 200 })) as unknown as typeof globalThis.fetch
		const fetchEvents = mock(async (_filter: NostrFilter) => [rawProfileEvent({ name: 'alice' })])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		const result = await fetchProfileByIdentifier('alice@example.com')

		// The kind-0 seam fetch is keyed on the RESOLVED pubkey.
		expect(fetchEvents).toHaveBeenCalledTimes(1)
		expect(fetchEvents.mock.calls[0][0]).toEqual({ kinds: [0], authors: [resolvedPubkey] })
		expect((result.profile as NDKUserProfileLike).name).toBe('alice')
		expect((result.user as NDKUserLike).pubkey).toBe(resolvedPubkey)
	})

	test('does not preflight-throw on zero connected relays; proceeds to the seam fetch', async () => {
		// Zero connected relays is a normal transient state while connect()
		// completes; the fetcher must not throw a preflight error but instead
		// proceed and let the timeout/operation determine the outcome. The
		// seam fetch is the live read; a resolution to zero events is genuine
		// absence, not a preflight failure.
		const fetchEvents = mock(async () => [])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		const result = await fetchProfileByIdentifier(VALID_HEX)

		// No preflight throw: a resolving-to-empty seam fetch is a
		// successful null (genuine absence), not an error.
		expect(result.profile).toBeNull()
		expect((result.user as NDKUserLike).pubkey).toBe(VALID_HEX)
	})

	test('throws when NDK is not initialized', async () => {
		const fetchEvents = mock(async () => [rawProfileEvent({ name: 'alice' })])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => null

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('NDK not initialized')
	})

	test('returns { profile: null, user: null } for a malformed identifier without a relay request', async () => {
		const fetchEvents = mock(async () => [rawProfileEvent({ name: 'alice' })])
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		const result = await fetchProfileByIdentifier('not-a-valid-identifier')

		expect(result).toEqual({ profile: null, user: null })
		expect(fetchEvents).not.toHaveBeenCalled()
	})

	test('can be retried after a transient failure: second call succeeds once the relay is ready', async () => {
		// Simulate the zero-relay startup scenario: the first call times out
		// (the seam never settles), then the relay connects and the retry
		// succeeds. This proves that refetchOnReconnect / the retry button
		// recover the query — the fetcher is stateless and a second
		// invocation works.
		const fetchEvents = mock(async () => new Promise<NostrEvent[]>(() => {}))
		applesauceIo.fetchEvents = fetchEvents as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()
		globalThis.setTimeout = ((cb: () => void) => {
			cb()
			return 0 as unknown as ReturnType<typeof globalThis.setTimeout>
		}) as typeof globalThis.setTimeout

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('Profile fetch timed out')

		// Restore real setTimeout and simulate the relay now being ready.
		globalThis.setTimeout = realSetTimeout as typeof globalThis.setTimeout
		const event = rawProfileEvent({ name: 'alice', about: 'hi' })
		const readyFetch = mock(async () => [event])
		applesauceIo.fetchEvents = readyFetch as typeof applesauceIo.fetchEvents

		const result = await fetchProfileByIdentifier(VALID_HEX)

		expect((result.profile as NDKUserProfileLike).name).toBe('alice')
		expect((result.user as NDKUserLike).pubkey).toBe(VALID_HEX)
	})
})

describe('QueryClient retains cached profile data after a rejected same-key refetch', () => {
	test('previous profile survives a failed refetch (RQ v5 fetchFailed reducer spreads state)', async () => {
		// Prove that keepPreviousData + the throw-on-transient contract work
		// together: after a successful fetch, a rejected refetch of the same
		// query key does NOT evict the cached data. RQ v5's fetchFailed reducer
		// does `...state` (preversing data) before setting status: "error".
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const queryKey = ['profile', 'test']

		// First fetch: succeeds with a profile.
		const event = rawProfileEvent({ name: 'alice', about: 'hi' })
		applesauceIo.fetchEvents = (async () => [event]) as typeof applesauceIo.fetchEvents
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk()

		const result1 = await queryClient.fetchQuery({
			queryKey,
			queryFn: () => fetchProfileByIdentifier(VALID_HEX),
			staleTime: 0,
		})
		expect(result1.profile?.name).toBe('alice')

		// Second fetch: the relay now rejects. staleTime: 0 forces a re-run.
		applesauceIo.fetchEvents = (async () => Promise.reject(new Error('relay boom'))) as typeof applesauceIo.fetchEvents

		await expect(
			queryClient.fetchQuery({
				queryKey,
				queryFn: () => fetchProfileByIdentifier(VALID_HEX),
				staleTime: 0,
			}),
		).rejects.toThrow('relay boom')

		// The cache must still retain the previous profile data.
		const cached = queryClient.getQueryData<{ profile: NDKUserProfileLike | null; user: unknown }>(queryKey)
		expect(cached?.profile?.name).toBe('alice')
	})
})

describe('identity-scoped query options disable for invalid input (zero relay I/O)', () => {
	test('profileByIdentifierQueryOptions disables for empty / whitespace / malformed identifiers', () => {
		expect(profileByIdentifierQueryOptions('').enabled).toBe(false)
		expect(profileByIdentifierQueryOptions('   ').enabled).toBe(false)
		expect(profileByIdentifierQueryOptions('not-a-valid-identifier').enabled).toBe(false)
		expect(profileByIdentifierQueryOptions('abc').enabled).toBe(false)
	})

	test('profileByIdentifierQueryOptions enables for valid hex pubkeys', () => {
		expect(profileByIdentifierQueryOptions(VALID_HEX).enabled).toBe(true)
	})

	test('wotScoreQueryOptions disables for invalid hex pubkeys', () => {
		expect(wotScoreQueryOptions('').enabled).toBe(false)
		expect(wotScoreQueryOptions('   ').enabled).toBe(false)
		expect(wotScoreQueryOptions('not-hex').enabled).toBe(false)
		expect(wotScoreQueryOptions('abc'.repeat(10)).enabled).toBe(false)
	})

	test('wotScoreQueryOptions enables for valid 64-char hex pubkeys', () => {
		expect(wotScoreQueryOptions(VALID_HEX).enabled).toBe(true)
	})
})