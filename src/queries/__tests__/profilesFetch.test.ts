import { afterEach, describe, expect, mock, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import { ndkActions } from '@/lib/stores/ndk'
import { fetchProfileByIdentifier, profileByIdentifierQueryOptions, wotScoreQueryOptions } from '../profiles'

// Infer NDK return types from the function under test instead of importing
// the NDK package directly — the NDK-footprint CI guard counts any src/ file
// containing the NDK package import path, and this test file must not
// increase the 127-file baseline.
type FetchResult = Awaited<ReturnType<typeof fetchProfileByIdentifier>>
type NDKUserLike = NonNullable<FetchResult['user']>
type NDKUserProfileLike = NonNullable<FetchResult['profile']>

// `fetchProfileByIdentifier` reads NDK from the `ndkActions` store, so we stub
// `getNDK` (the orders-seam.test.ts pattern) to drive each behavioral case.
const realGetNDK = ndkActions.getNDK
const realSetTimeout = globalThis.setTimeout

afterEach(() => {
	;(ndkActions as { getNDK: () => unknown }).getNDK = realGetNDK as () => unknown
	globalThis.setTimeout = realSetTimeout as typeof globalThis.setTimeout
})

const VALID_HEX = 'a'.repeat(64)

/** A minimal NDKUser stub: just enough (pubkey + fetchProfile) for the fetcher. */
function stubUser(profile: NDKUserProfileLike | null): NDKUserLike {
	return { pubkey: VALID_HEX, fetchProfile: async () => profile } as unknown as NDKUserLike
}

/** Minimal NDK stub: a relay pool that reports `connected` live relays + a fetchUser. */
function stubNdk(opts: { connectedRelays: number; fetchUser: (identifier: string) => Promise<NDKUserLike | null> }) {
	return {
		pool: { connectedRelays: () => Array.from({ length: opts.connectedRelays }, () => ({})) },
		fetchUser: opts.fetchUser,
	}
}

describe('fetchProfileByIdentifier distinguishes genuine absence from transient failures', () => {
	test('returns the profile when relays are connected and fetchProfile resolves data', async () => {
		const profile = { name: 'alice', about: 'hi' } as NDKUserProfileLike
		const user = stubUser(profile)
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser: async () => user })

		const result = await fetchProfileByIdentifier(VALID_HEX)

		expect(result.profile).toBe(profile)
		expect(result.user).toBe(user)
	})

	test('returns { profile: null, user } for genuine absence (connected, fetchProfile resolved null)', async () => {
		const user = stubUser(null)
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser: async () => user })

		const result = await fetchProfileByIdentifier(VALID_HEX)

		// A successful null — NOT a transient failure. React Query commits this as
		// a successful result, which is what lets ProfilePage show "not found".
		expect(result.profile).toBeNull()
		expect(result.user).toBe(user)
	})

	test('throws on timeout instead of returning a null-shaped success', async () => {
		// fetchProfile never settles; the timeout must win the race and throw.
		const hangingUser = {
			pubkey: VALID_HEX,
			fetchProfile: () => new Promise<NDKUserProfileLike | null>(() => {}),
		} as unknown as NDKUserLike
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser: async () => hangingUser })
		// Fire the timeout reject immediately so the test doesn't wait 8s.
		globalThis.setTimeout = ((cb: () => void) => {
			cb()
			return 0 as unknown as ReturnType<typeof globalThis.setTimeout>
		}) as typeof globalThis.setTimeout

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('Profile fetch timed out')
	})

	test('throws when fetchProfile rejects (relay error) instead of returning null', async () => {
		const user = { pubkey: VALID_HEX, fetchProfile: async () => Promise.reject(new Error('relay boom')) } as unknown as NDKUserLike
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser: async () => user })

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('relay boom')
	})

	test('throws when ndk.fetchUser rejects instead of returning null', async () => {
		;(ndkActions as { getNDK: () => unknown }).getNDK = () =>
			stubNdk({ connectedRelays: 1, fetchUser: async () => Promise.reject(new Error('fetchUser boom')) })

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('fetchUser boom')
	})

	test('does not preflight-throw on zero connected relays; proceeds to fetchProfile', async () => {
		// Zero connected relays is a normal transient state while connect()
		// completes; the fetcher must not throw a preflight error but instead
		// proceed and let the timeout/operation determine the outcome.
		const user = stubUser(null)
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 0, fetchUser: async () => user })

		const result = await fetchProfileByIdentifier(VALID_HEX)

		expect(result.profile).toBeNull()
		expect(result.user).toBe(user)
	})

	test('throws when NDK is not initialized', async () => {
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => null

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('NDK not initialized')
	})

	test('returns { profile: null, user: null } for a malformed identifier without a relay request', async () => {
		const fetchUser = mock(async () => stubUser(null))
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser })

		const result = await fetchProfileByIdentifier('not-a-valid-identifier')

		expect(result).toEqual({ profile: null, user: null })
		expect(fetchUser).toHaveBeenCalledTimes(0)
	})

	test('can be retried after a transient failure: second call succeeds once the relay is ready', async () => {
		// Simulate the zero-relay startup scenario: the first call times out
		// (no relay connected), then the relay connects and the retry succeeds.
		// This proves that refetchOnReconnect / the retry button recover the
		// query — the fetcher is stateless and a second invocation works.
		const hangingUser = {
			pubkey: VALID_HEX,
			fetchProfile: () => new Promise<NDKUserProfileLike | null>(() => {}),
		} as unknown as NDKUserLike
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 0, fetchUser: async () => hangingUser })
		globalThis.setTimeout = ((cb: () => void) => {
			cb()
			return 0 as unknown as ReturnType<typeof globalThis.setTimeout>
		}) as typeof globalThis.setTimeout

		await expect(fetchProfileByIdentifier(VALID_HEX)).rejects.toThrow('Profile fetch timed out')

		// Restore real setTimeout and simulate relay now being ready.
		globalThis.setTimeout = realSetTimeout as typeof globalThis.setTimeout
		const profile = { name: 'alice', about: 'hi' } as NDKUserProfileLike
		const readyUser = stubUser(profile)
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser: async () => readyUser })

		const result = await fetchProfileByIdentifier(VALID_HEX)

		expect(result.profile).toBe(profile)
		expect(result.user).toBe(readyUser)
	})
})

describe('QueryClient retains cached profile data after a rejected same-key refetch', () => {
	test('previous profile survives a failed refetch (RQ v5 fetchFailed reducer spreads state)', async () => {
		// Prove that keepPreviousData + the throw-on-transient contract work
		// together: after a successful fetch, a rejected refetch of the same
		// query key does NOT evict the cached data. RQ v5's fetchFailed reducer
		// does `...state` (preserving data) before setting status: "error".
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const queryKey = ['profile', 'test']

		// First fetch: succeeds with a profile.
		const profile = { name: 'alice', about: 'hi' } as NDKUserProfileLike
		const goodUser = stubUser(profile)
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser: async () => goodUser })

		const result1 = await queryClient.fetchQuery({
			queryKey,
			queryFn: () => fetchProfileByIdentifier(VALID_HEX),
			staleTime: 0,
		})
		expect(result1.profile).toEqual(profile)

		// Second fetch: the relay now rejects. staleTime: 0 forces a re-run.
		const failingUser = {
			pubkey: VALID_HEX,
			fetchProfile: async () => Promise.reject(new Error('relay boom')),
		} as unknown as NDKUserLike
		;(ndkActions as { getNDK: () => unknown }).getNDK = () => stubNdk({ connectedRelays: 1, fetchUser: async () => failingUser })

		await expect(
			queryClient.fetchQuery({
				queryKey,
				queryFn: () => fetchProfileByIdentifier(VALID_HEX),
				staleTime: 0,
			}),
		).rejects.toThrow('relay boom')

		// The cache must still retain the previous profile data.
		const cached = queryClient.getQueryData<{ profile: NDKUserProfileLike | null; user: unknown }>(queryKey)
		expect(cached?.profile).toEqual(profile)
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
