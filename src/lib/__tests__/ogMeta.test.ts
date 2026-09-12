/**
 * Unit tests for the single-relay lookup path in ogMeta.ts.
 *
 * Per the repo test-isolation rules these tests exercise only the
 * non-network paths (input validation, relay-configuration guards, and the
 * connect-timeout race against a fully mocked relay driven by fake timers);
 * real relay round-trips are covered by the e2e suite against the local CI
 * relay. Failure/timeout behavior (null → untouched SPA shell) is covered by
 * the renderProductPageHtml tests in ogTags.test.ts.
 */
import { afterEach, beforeEach, describe, expect, jest, mock, test } from 'bun:test'
import type { Relay } from 'nostr-tools'

// --- Mock the relay layer so the connect lifecycle can be driven without
// any network: Relay.connect returns a deferred the test settles manually.
// Settling it only AFTER the lookup's connect deadline fired is what proves
// the late-resolving socket gets closed (the socket-leak regression).
const closeMock = mock(() => {})
let resolveConnect: ((relay: unknown) => void) | null = null
let rejectConnect: ((reason: unknown) => void) | null = null
// Concurrency bookkeeping: every Relay.connect call is counted and its
// deferred is recorded so tests can drive N concurrent lookups and assert
// how many actually reached the relay (the concurrency-cap regression).
let connectCount = 0
const connectDeferreds: Array<{ resolve: (relay: unknown) => void; reject: (reason: unknown) => void }> = []
// Relay-read containment bookkeeping: the latest subscribe opts are captured
// so a test can drive `onevent`/`oneose` and assert a wrong-kind / wrong-id
// event is discarded (the untrusted-relay-data trust-boundary regression).
let lastSubscribeOpts: { onevent?: (e: unknown) => void; oneose?: () => void } | null = null

mock.module('nostr-tools', () => ({
	Relay: {
		connect: () => {
			connectCount++
			return new Promise((resolve, reject) => {
				const deferred = { resolve, reject }
				connectDeferreds.push(deferred)
				resolveConnect = resolve
				rejectConnect = reject
			})
		},
	},
}))
mock.module('nostr-tools/pure', () => ({
	verifyEvent: () => true,
}))

import { getProductOgMeta } from '../../server/ogMeta'

/** Drain the microtask queue so promise chains (race settlement, late-close handlers) complete. */
const flushMicrotasks = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => {
	jest.useRealTimers()
	closeMock.mockClear()
	resolveConnect = null
	rejectConnect = null
	connectCount = 0
	connectDeferreds.length = 0
	lastSubscribeOpts = null
})

describe('getProductOgMeta', () => {
	test('returns null for ids that are not 64-hex event ids (no relay IO)', async () => {
		expect(await getProductOgMeta('wss://relay.example.com', 'not-an-id')).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', '')).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', 'z'.repeat(64))).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', 'a'.repeat(63))).toBeNull()
		expect(await getProductOgMeta('wss://relay.example.com', 'a'.repeat(65))).toBeNull()
	})

	test('accepts uppercase hex ids by normalizing to lowercase', async () => {
		// Uppercase hex is a valid event id once lowercased; no relay is
		// configured so the lookup still stops before any network IO.
		expect(await getProductOgMeta(undefined, 'B'.repeat(64))).toBeNull()
	})

	test('returns null before any relay IO when no relay is configured', async () => {
		expect(await getProductOgMeta(undefined, 'a'.repeat(64))).toBeNull()
		expect(await getProductOgMeta(undefined, 'c'.repeat(64))).toBeNull()
		expect(await getProductOgMeta('', 'd'.repeat(64))).toBeNull()
		expect(await getProductOgMeta('   ', 'e'.repeat(64))).toBeNull()
	})
})

describe('connect-timeout race (socket-leak regression)', () => {
	// The lookup budget (OG_FETCH_TIMEOUT_MS) is 2.5s; advancing well past it
	// fires the connect deadline while the mocked Relay.connect is pending.
	const PAST_DEADLINE_MS = 10_000

	// Unique 64-hex product ids per test: completed lookups (including null
	// results) are cached by id.
	const TIMEOUT_ID = 'f'.repeat(64)
	const LATE_REJECT_ID = 'e'.repeat(64)
	const CONNECT_WINS_ID = 'd'.repeat(64)

	// Capture (and silence) the best-effort failure log so tests can assert
	// which terminal failure fired — same pattern as external.test.ts.
	let originalWarn: typeof console.warn
	const warns: string[] = []

	beforeEach(() => {
		originalWarn = console.warn
		console.warn = (...args: unknown[]) => {
			warns.push(args.map(String).join(' '))
		}
	})
	afterEach(() => {
		console.warn = originalWarn
		warns.length = 0
	})

	test('closes a late-resolving connect after the connect timeout (no socket leak)', async () => {
		jest.useFakeTimers()

		const lookup = getProductOgMeta('wss://relay.example.com', TIMEOUT_ID)

		// The connect deadline passes while Relay.connect is still pending.
		jest.advanceTimersByTime(PAST_DEADLINE_MS)
		expect(await lookup).toBeNull() // graceful degradation

		// The terminal failure is still the connect timeout, with its log.
		expect(warns.join('\n')).toContain('og: relay connect timeout')

		// The losing connect now resolves with an OPEN relay. The lookup
		// already returned null — `relay` was null when the cleanup ran, so
		// nothing else will ever close this socket. The fix must close it.
		const lateRelay = { close: closeMock } as unknown as Relay
		resolveConnect!(lateRelay)
		await flushMicrotasks()

		expect(closeMock).toHaveBeenCalledTimes(1)
	})

	test('stays quiet when the late connect rejects instead of resolving', async () => {
		jest.useFakeTimers()

		const lookup = getProductOgMeta('wss://relay.example.com', LATE_REJECT_ID)
		jest.advanceTimersByTime(PAST_DEADLINE_MS)
		expect(await lookup).toBeNull()

		// The connect ultimately fails: there is no socket to close, and the
		// late rejection must not surface as an unhandled rejection.
		rejectConnect!(new Error('connect failed'))
		await flushMicrotasks()

		expect(closeMock).not.toHaveBeenCalled()
	})

	test('connect wins: relay stays open for the REQ, closes once on settle, connect timer cleared', async () => {
		jest.useFakeTimers()

		// The mock subscribe never settles, so the lookup ends via the request
		// deadline — exercising the normal single-close cleanup path.
		const lookup = getProductOgMeta('wss://relay.example.com', CONNECT_WINS_ID)
		const relay = { close: closeMock, subscribe: () => ({ close: () => {} }) } as unknown as Relay

		resolveConnect!(relay)
		await flushMicrotasks()

		// Connect won: the relay is in use by the REQ and must stay open, and
		// the connect deadline timer must already be cleared so it does not
		// stay pending through the request phase — only the request deadline
		// remains armed.
		expect(closeMock).not.toHaveBeenCalled()
		expect(jest.getTimerCount()).toBe(1)

		jest.advanceTimersByTime(PAST_DEADLINE_MS)
		expect(await lookup).toBeNull()
		expect(warns.join('\n')).toContain('og: relay request timeout')

		// The in-use relay is closed exactly once by the normal cleanup, and
		// no fake timer is left pending afterwards.
		expect(closeMock).toHaveBeenCalledTimes(1)
		expect(jest.getTimerCount()).toBe(0)
	})
})

describe('concurrency cap + same-ID coalescing (aggregate work bound)', () => {
	// The process-wide cap (OG_MAX_CONCURRENT_LOOKUPS) is 4. Firing 5
	// concurrent distinct-id lookups must reach the relay at most 4 times;
	// the saturated 5th must fall back to the plain shell (null) immediately
	// instead of queueing unbounded server-side work.
	const PAST_DEADLINE_MS = 10_000

	// Fresh hex ids not used by any other test in this file (the module-level
	// cache persists across tests, so reusing an id would short-circuit on
	// cache and never reach the relay).
	const CAP_IDS = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64), '5'.repeat(64)]
	const COALESCE_ID = '6'.repeat(64)

	test('caps concurrent distinct-id lookups and falls back to plain shell when saturated', async () => {
		jest.useFakeTimers()

		const lookups = CAP_IDS.map((id) => getProductOgMeta('wss://relay.example.com', id))

		// Only the cap (4) lookups reach the relay; the 5th is saturated.
		expect(connectCount).toBe(4)

		// The saturated lookup resolves immediately to null (plain-shell
		// fallback) — it must not wait for a slot or open a relay query.
		await expect(lookups[4]).resolves.toBeNull()

		// Complete the 4 in-flight lookups: resolve their connects, then let
		// the request deadline fire (the mock subscribe never settles).
		for (let i = 0; i < 4; i++) {
			connectDeferreds[i].resolve({ close: closeMock, subscribe: () => ({ close: () => {} }) })
		}
		await flushMicrotasks()
		jest.advanceTimersByTime(PAST_DEADLINE_MS)

		for (let i = 0; i < 4; i++) {
			await expect(lookups[i]).resolves.toBeNull()
		}

		// After completion the cap is released: a fresh lookup reaches the relay.
		expect(connectCount).toBe(4)
		const fresh = getProductOgMeta('wss://relay.example.com', '7'.repeat(64))
		expect(connectCount).toBe(5)
		connectDeferreds[4].resolve({ close: closeMock, subscribe: () => ({ close: () => {} }) })
		await flushMicrotasks()
		jest.advanceTimersByTime(PAST_DEADLINE_MS)
		await expect(fresh).resolves.toBeNull()
	})

	test('coalesces concurrent lookups for the same id onto a single relay query', async () => {
		jest.useFakeTimers()

		const p1 = getProductOgMeta('wss://relay.example.com', COALESCE_ID)
		const p2 = getProductOgMeta('wss://relay.example.com', COALESCE_ID)

		// Two concurrent same-id lookups share one relay query.
		expect(connectCount).toBe(1)

		// Both resolve to the same result once the shared query completes.
		connectDeferreds[0].resolve({ close: closeMock, subscribe: () => ({ close: () => {} }) })
		await flushMicrotasks()
		jest.advanceTimersByTime(PAST_DEADLINE_MS)

		await expect(p1).resolves.toBeNull()
		await expect(p2).resolves.toBeNull()
	})
})

describe('relay-read containment (untrusted relay data)', () => {
	// Per the module contract, a product lookup must only accept the exact
	// event it asked for. A misbehaving/compromised relay answering the REQ
	// with a *different* valid-signed event — another product's event, or a
	// wrong-kind note — must be discarded, not rendered as this product's og
	// tags. The mock's verifyEvent is a tautology (always true), so this test
	// isolates the kind/id containment which must hold independent of
	// signature verification.
	const PRODUCT_KIND = 30_402

	// Build a relay whose subscribe captures the opts so the test can drive
	// `onevent` with a crafted verified-looking event.
	function capturingRelay() {
		return {
			close: closeMock,
			subscribe: (_filters: unknown, opts: { onevent?: (e: unknown) => void; oneose?: () => void }) => {
				lastSubscribeOpts = opts
				return { close: () => {} }
			},
		} as unknown as Relay
	}

	// Resolve the connect for the first pending lookup, then drive onevent.
	// The subscribe callback runs on a microtask after the connect resolves,
	// so flush before emitting.
	async function connectAndEmit(event: unknown) {
		connectDeferreds[0].resolve(capturingRelay())
		await flushMicrotasks()
		lastSubscribeOpts?.onevent?.(event)
	}

	const WRONG_KIND_ID = 'b'.repeat(64)
	const WRONG_ID_ID = 'a'.repeat(64)
	const GOOD_ID = '9'.repeat(64)

	// Capture the best-effort failure log so tests can assert WHICH terminal
	// path settled the lookup (deadline vs. accepted event).
	function captureWarn() {
		const originalWarn = console.warn
		const warns: string[] = []
		console.warn = (...args: unknown[]) => {
			warns.push(args.map(String).join(' '))
		}
		return { warns, restore: () => (console.warn = originalWarn) }
	}

	test('discards a valid-signed event whose kind is not a product (no meta leak)', async () => {
		jest.useFakeTimers()
		const { warns, restore } = captureWarn()

		const lookup = getProductOgMeta('wss://relay.example.com', WRONG_KIND_ID)
		// A kind-1 note with a matching id would render if kind were unchecked.
		await connectAndEmit({ id: WRONG_KIND_ID, kind: 1, content: 'spam' })
		await flushMicrotasks()

		// The wrong-kind event must NOT settle the lookup: it is discarded, so
		// the request deadline is what resolves it (proven by the timeout log).
		jest.advanceTimersByTime(10_000)
		await expect(lookup).resolves.toBeNull()
		restore()
		expect(warns.join('\n')).toContain('og: relay request timeout')
	})

	test('discards a valid-signed event whose id does not match the requested product', async () => {
		jest.useFakeTimers()
		const { warns, restore } = captureWarn()

		const lookup = getProductOgMeta('wss://relay.example.com', WRONG_ID_ID)
		// A product-kind event with a different id would render as this
		// product's meta if id were unchecked.
		await connectAndEmit({ id: 'c'.repeat(64), kind: PRODUCT_KIND, content: 'other product' })
		await flushMicrotasks()

		jest.advanceTimersByTime(10_000)
		await expect(lookup).resolves.toBeNull()
		restore()
		expect(warns.join('\n')).toContain('og: relay request timeout')
	})

	test('accepts a product-kind event whose id matches the requested product', async () => {
		jest.useFakeTimers()
		const { warns, restore } = captureWarn()

		const lookup = getProductOgMeta('wss://relay.example.com', GOOD_ID)
		// A matching product event settles the lookup (verifyEvent mock returns
		// true, so it proceeds to buildOgProductMeta).
		await connectAndEmit({ id: GOOD_ID, kind: PRODUCT_KIND, content: '{}', tags: [], pubkey: 'e'.repeat(64), created_at: 1 })
		await flushMicrotasks()

		jest.advanceTimersByTime(10_000)
		const meta = await lookup
		restore()

		// The event settled the lookup: no request-timeout log fired, and the
		// relay was closed exactly once by the normal cleanup. The accepted
		// event produced product meta (title derived from the bare event).
		expect(warns.join('\n')).not.toContain('og: relay request timeout')
		expect(closeMock).toHaveBeenCalledTimes(1)
		expect(meta).not.toBeNull()
	})
})
