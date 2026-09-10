import { afterEach, describe, expect, test, setSystemTime } from 'bun:test'
import { fetchMintKeysets, clearKeysetCache } from '../auction/validation'
import type { MintKeyset } from '@cashu/cashu-ts'

const MINT_URL = 'https://mint.example.com'

// A transient mint failure must NOT be cached for the full 5-minute success
// TTL, or settlement stays degraded after the mint recovers. The failure TTL
// is a few seconds (see KEYSET_CACHE_FAILURE_TTL_MS in validation.ts); this
// test proves recovery: a failed request is re-queried once the failure TTL
// elapses and returns the real keyset (no stale empty keyset).
describe('fetchMintKeysets — negative-cache recovery', () => {
	const realFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = realFetch
		clearKeysetCache()
		setSystemTime()
	})

	const realKeysets: MintKeyset[] = [
		{ id: 'keyset-1', unit: 'sat', active: true },
		{ id: 'keyset-2', unit: 'sat', active: false },
	]

	test('a transient failure is re-queried after the failure TTL elapses and returns the real keyset', async () => {
		let calls = 0
		// First call: the mint is down (transient network error). Second call:
		// the mint has recovered and returns the real keysets.
		globalThis.fetch = (async () => {
			calls += 1
			if (calls === 1) {
				throw new Error('ECONNRESET: mint unreachable')
			}
			return new Response(JSON.stringify({ keysets: realKeysets }), { status: 200 })
		}) as unknown as typeof globalThis.fetch

		// t0: first request fails -> empty keyset (negative cache).
		setSystemTime(new Date('2026-01-01T00:00:00Z'))
		const first = await fetchMintKeysets(MINT_URL)
		expect(first).toEqual([])
		expect(calls).toBe(1)

		// Immediately after the failure, a second call is still served from the
		// negative cache (no re-query) — the dead mint is not hammered.
		const cached = await fetchMintKeysets(MINT_URL)
		expect(cached).toEqual([])
		expect(calls).toBe(1)

		// After the (short) failure TTL elapses, the next call re-queries the
		// mint and returns the real keyset — no stale empty keyset.
		setSystemTime(new Date('2026-01-01T00:00:06Z'))
		const recovered = await fetchMintKeysets(MINT_URL)
		expect(recovered).toEqual(realKeysets)
		expect(calls).toBe(2)
	})
})
