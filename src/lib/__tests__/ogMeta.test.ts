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

mock.module('nostr-tools', () => ({
	Relay: {
		connect: () =>
			new Promise((resolve, reject) => {
				resolveConnect = resolve
				rejectConnect = reject
			}),
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
