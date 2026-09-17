/**
 * Real applesauce-relay 6.2 semantics tests for the adapter's compat fixes
 * (PR #1253 review feedback) — the library half of the coverage.
 *
 * io.test.ts pins the ADAPTER WIRING with a mocked pool (bounded reconnect
 * config, completeOnAllEose operator, group-settled closeOnEose); this file
 * pins the REAL-library behaviour of those exact options against stub
 * WebSocket sockets, so the v6 hazards the fixes target are the library's
 * own:
 * - bounded reconnect: `reconnect: { count: 3, delay: 1000 }` (the config the
 *   adapter passes) must cap REQ attempts at 1 + 3, while v6's
 *   `reconnect: true` (the pre-fix adapter state) maps to RxJS retry() with
 *   NO count and never stops.
 * - group EOSE: a group REQ keeps delivering after the first relay's EOSE —
 *   the library premise that makes the adapter's group-settled closeOnEose
 *   both necessary and sufficient (maximotodev review scenario).
 * - request() completion: RelayGroup.completeOnAllEose() (the operator the
 *   adapter pins) completes only after EVERY relay EOSEs — v6's default
 *   completeOnAny(completeAfterFirstRelay(5s), allEose) would end the fetch
 *   5s after the first relay's EOSE, dropping slow relays' events.
 *
 * io.test.ts registers mock.module('applesauce-relay') for its adapter
 * tests, and bun's mock.module registry is global to one test invocation:
 * it intercepts every import resolving inside node_modules/applesauce-relay
 * — bare specifier, subpath, raw dist-file path, query-string-suffixed —
 * regardless of file execution order (verified empirically, both orders).
 * No specifier trick escapes the registry, so this file materializes a
 * sibling shim package that byte-copies the installed 6.2 dist under a
 * distinct package identity; the registry does not intercept it and the
 * REAL classes load no matter which files share the invocation.
 *
 * No network: globalThis.WebSocket is swapped for scriptable stubs (all relay
 * hostnames use the .invalid TLD, which cannot resolve).
 */
import { beforeEach, afterEach, describe, expect, jest, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Real library classes via the shim package (see header). node_modules is
// git-ignored, so the copy is a throwaway runtime artifact, rebuilt fresh
// on every invocation of this file.
const realDir = path.join(import.meta.dir, '../../../node_modules/applesauce-relay')
const shimDir = path.join(import.meta.dir, '../../../node_modules/applesauce-relay-hermetic')
fs.rmSync(shimDir, { recursive: true, force: true })
fs.mkdirSync(path.join(shimDir, 'dist'), { recursive: true })
fs.cpSync(path.join(realDir, 'dist'), path.join(shimDir, 'dist'), { recursive: true })
const realPkg = JSON.parse(fs.readFileSync(path.join(realDir, 'package.json'), 'utf8')) as {
	name: string
	version: string
	type?: string
}
fs.writeFileSync(
	path.join(shimDir, 'package.json'),
	JSON.stringify({ name: 'applesauce-relay-hermetic', version: realPkg.version, type: realPkg.type ?? 'module' }),
)
// Types come from the real package's dist declarations (import type is erased
// at runtime, so the mock registry never intercepts it); values come from the
// shim, so the classes are real no matter which files share the invocation.
import type { RelayGroup as RelayGroupType } from '../../../node_modules/applesauce-relay/dist/group.js'
import type { RelayPool as RelayPoolType } from '../../../node_modules/applesauce-relay/dist/pool.js'

const { RelayPool } = (await import('applesauce-relay-hermetic/dist/pool.js')) as {
	RelayPool: typeof RelayPoolType
}
const { RelayGroup } = (await import('applesauce-relay-hermetic/dist/group.js')) as {
	RelayGroup: typeof RelayGroupType
}

// ---------------------------------------------------------------------------
// Stub WebSocket plumbing
// ---------------------------------------------------------------------------
//
// Contract required by rxjs webSocket + applesauce Relay (verified against
// node_modules/rxjs/.../WebSocketSubject.js and applesauce-relay dist):
// - `new WebSocket(url)`: RelayPool normalizes relay URLs (trailing slash,
//   pool.js relay()), so the constructor always receives the normalized URL.
// - Opening must be asynchronous (real sockets never open synchronously);
//   once open, readyState is 1 or outgoing sends are silently dropped.
// - `send(data)` receives the JSON-serialized message; we record it per URL.
// - `onmessage({ data: JSON.stringify(msg) })` is how the "server" pushes.
// - `close()` -> readyState 3 + async `onclose({ wasClean: true })`.
// - A connection DEATH is `onerror({})` + `onclose({ wasClean: false })` —
//   the unclean close is what arms the relay's reconnect path and errors the
//   req() observable (which is what the bounded retry policy bounds).

/** Relay URLs (normalized) whose connections die right after opening. */
const flaky = new Set<string>()
/** Live sockets per relay URL, in construction order. */
const socketsByUrl = new Map<string, StubWebSocket[]>()
/** Outgoing client messages per relay URL, in order. */
const sentByUrl = new Map<string, unknown[][]>()

const realWebSocket = globalThis.WebSocket

class StubWebSocket {
	static CONNECTING = 0
	static OPEN = 1
	static CLOSING = 2
	static CLOSED = 3

	url: string
	readyState = 0
	onopen: ((ev: unknown) => void) | null = null
	onclose: ((ev: { wasClean: boolean }) => void) | null = null
	onerror: ((ev: unknown) => void) | null = null
	onmessage: ((ev: { data: string }) => void) | null = null

	constructor(url: string) {
		this.url = url
		const list = socketsByUrl.get(url) ?? []
		list.push(this)
		socketsByUrl.set(url, list)
		queueMicrotask(() => {
			this.readyState = 1
			this.onopen?.({})
		})
		if (flaky.has(url)) {
			// The connection opens, then dies (unclean close) — one microtask
			// later, so any queued REQ is drained and hits the wire first.
			queueMicrotask(() => {
				this.onerror?.({})
				this.readyState = 3
				this.onclose?.({ wasClean: false })
			})
		}
	}

	send(data: string) {
		const msg = JSON.parse(data) as unknown[]
		const list = sentByUrl.get(this.url) ?? []
		list.push(msg)
		sentByUrl.set(this.url, list)
	}

	close() {
		if (this.readyState === 3) return
		this.readyState = 3
		queueMicrotask(() => this.onclose?.({ wasClean: true }))
	}
}

/** The pool normalizes URLs with a trailing slash — mirror it for lookups. */
function norm(url: string): string {
	return url.endsWith('/') ? url : `${url}/`
}

function sentTo(url: string): unknown[][] {
	return sentByUrl.get(norm(url)) ?? []
}

function reqCount(url: string): number {
	return sentTo(url).filter((m) => m[0] === 'REQ').length
}

function closeCount(url: string): number {
	return sentTo(url).filter((m) => m[0] === 'CLOSE').length
}

/** The REQ subscription id a relay URL received (per-relay nanoid). */
function subId(url: string): string {
	const req = sentTo(url).find((m) => m[0] === 'REQ')
	return req?.[1] as string
}

/** Push a server->client nostr message to every live socket for a URL. */
function serverPush(url: string, msg: unknown[]) {
	for (const sock of socketsByUrl.get(norm(url)) ?? []) {
		if (sock.readyState === 1) sock.onmessage?.({ data: JSON.stringify(msg) })
	}
}

/** Await microtask turns so opens/closes/message cascades settle. */
async function flush(times = 25) {
	for (let i = 0; i < times; i++) await Promise.resolve()
}

/** Wait until REQs have gone out for both relay URLs. */
async function waitForReq(a: string, b: string) {
	for (let i = 0; i < 500; i++) {
		if (sentTo(a).some((m) => m[0] === 'REQ') && sentTo(b).some((m) => m[0] === 'REQ')) return
		await flush(10)
	}
	throw new Error(`REQ never sent (${a}, ${b})`)
}

/**
 * Advance fake time in small steps, draining microtasks between steps so
 * socket open/die cycles and RxJS retries interleave the way they would on
 * a real event loop.
 */
async function advanceBy(totalMs: number, stepMs = 500) {
	for (let t = 0; t < totalMs; t += stepMs) {
		jest.advanceTimersByTime(stepMs)
		await flush(5)
	}
}

// Fresh relay URLs per test — nothing in the real library caches across pool
// instances, but unique URLs keep each test's wire log unambiguous.
let relayCounter = 0
function freshRelayUrl(label: string): string {
	relayCounter += 1
	return `wss://${label}-${relayCounter}.invalid`
}

// Stub nostr event — EventMemory dedup does no signature verification, so
// fake ids/sigs pass through the real request path untouched.
const stubEvent = {
	id: 'evt-00000000000000000000000000000000000000000000000000000000000e0',
	pubkey: 'pk-00000000000000000000000000000000000000000000000000000000000b0',
	created_at: 1,
	kind: 1,
	tags: [],
	content: 'hello',
	sig: `aa`.repeat(64),
}

beforeEach(() => {
	socketsByUrl.clear()
	sentByUrl.clear()
	flaky.clear()
	globalThis.WebSocket = StubWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
	globalThis.WebSocket = realWebSocket
})

// ---------------------------------------------------------------------------
// T1 — bounded reconnect retries (fix 1: the adapter's reconnect config)
// ---------------------------------------------------------------------------

describe('applesauce-relay 6.2 real-library semantics: bounded reconnect (T1)', () => {
	test('req() with the adapter\u2019s { count: 3, delay: 1000 } policy sends exactly 1+3 REQs to a dying relay, then surfaces ERROR', async () => {
		jest.useFakeTimers()
		try {
			const url = freshRelayUrl('t1-bounded')
			flaky.add(norm(url))
			const pool = new RelayPool()

			const messages: { type?: string; from?: string }[] = []
			const sub = pool
				.req([url], [{ kinds: [1] }], { resubscribe: false, reconnect: { count: 3, delay: 1000 } })
				.subscribe((m) => messages.push(m as { type?: string; from?: string }))

			// Initial attempt: socket opens on a microtask, REQ goes out,
			// then the connection dies.
			await flush()
			expect(reqCount(url)).toBe(1)

			// Retry #1 at +1000ms, #2 at +2000ms cumulative, #3 at +3000ms
			// (relay-level reconnect backoff interleaves; REQ is sent once the
			// relay reports ready again).
			await advanceBy(30_000)
			expect(reqCount(url)).toBe(4)

			// The exhausted retries surface as an ERROR message for this
			// relay (group internalSubscription catchError) — the signal the
			// adapter's closeOnEose treats as terminal.
			expect(messages.some((m) => m.type === 'ERROR' && m.from === norm(url))).toBe(true)

			// Plateau: a full minute later there is still no fifth REQ — the
			// bound holds (this is 5.2's 3-attempt policy, restored).
			await advanceBy(60_000)
			expect(reqCount(url)).toBe(4)

			sub.unsubscribe()
		} finally {
			jest.useRealTimers()
		}
	})

	test('req() with reconnect: true (pre-fix adapter state) never stops retrying a dying relay', async () => {
		jest.useFakeTimers()
		try {
			const url = freshRelayUrl('t1-unbounded')
			flaky.add(norm(url))
			const pool = new RelayPool()

			const sub = pool.req([url], [{ kinds: [1] }], { resubscribe: false, reconnect: true }).subscribe(() => {})

			// v6 maps `reconnect: true` to RxJS retry() with NO count
			// (relay.js customConnectionRetryOperator) — retries resume
			// immediately (retry delay is of(null)), gated only by the
			// relay's own reconnect backoff. Attempts keep coming forever:
			// after a minute there are strictly more than the bounded
			// policy's ceiling of 4, and the stream never settles.
			await advanceBy(60_000)
			expect(reqCount(url)).toBeGreaterThan(4)
			expect(reqCount(url)).toBeGreaterThanOrEqual(1)

			// Still climbing: another 30s produces even more attempts — no
			// give-up path exists (this is the unbounded pre-fix behaviour).
			const countAt60s = reqCount(url)
			await advanceBy(30_000)
			expect(reqCount(url)).toBeGreaterThan(countAt60s)

			sub.unsubscribe()
		} finally {
			jest.useRealTimers()
		}
	})
})

// ---------------------------------------------------------------------------
// T2 — group EOSE semantics (fix 2 premise: the reviewer's scenario)
// ---------------------------------------------------------------------------

describe('applesauce-relay 6.2 real-library semantics: group EOSE (T2)', () => {
	test('group REQ keeps delivering after the first relay EOSEs — no CLOSE until the consumer stops (maximotodev review premise)', async () => {
		const urlA = freshRelayUrl('t2-a')
		const urlB = freshRelayUrl('t2-b')
		const pool = new RelayPool()

		const log: string[] = []
		const sub = pool.req([urlA, urlB], [{ kinds: [1] }], { resubscribe: false }).subscribe((m) => {
			const msg = m as { type: string; event?: { id: string } }
			if (msg.type === 'EOSE') log.push(`eose:${(m as { from: string }).from}`)
			if (msg.type === 'EVENT') log.push(`event:${msg.event?.id}`)
		})
		try {
			await waitForReq(urlA, urlB)

			// Relay A EOSEs first; relay B is still working. The group stream
			// itself must not tear anything down here.
			serverPush(urlA, ['EOSE', subId(urlA)])
			await flush()
			log.push('after-a-eose')
			expect(closeCount(urlA) + closeCount(urlB)).toBe(0)

			// B delivers its event AFTER A's EOSE — a first-EOSE close (the
			// pre-fix adapter behaviour) would have dropped it.
			serverPush(urlB, ['EVENT', subId(urlB), stubEvent])
			await flush()
			expect(log).toContain(`event:${stubEvent.id}`)

			// Even after every relay has EOSEd, a group REQ sends no CLOSE —
			// stopping is the consumer's (adapter's) decision.
			serverPush(urlB, ['EOSE', subId(urlB)])
			await flush()
			expect(closeCount(urlA) + closeCount(urlB)).toBe(0)

			// The event was observed while the group was still open — after
			// A's EOSE but before consumer teardown (the log's marker order
			// proves the sequence).
			expect(log.indexOf(`event:${stubEvent.id}`)).toBeGreaterThan(log.indexOf('after-a-eose'))

			// Consumer teardown is what puts CLOSE on the wire.
			sub.unsubscribe()
			await flush()
			expect(closeCount(urlA) + closeCount(urlB)).toBeGreaterThan(0)
		} finally {
			sub.unsubscribe()
		}
	})
})

// ---------------------------------------------------------------------------
// T3 — request() completion semantics (fix 3: completeOnAllEose)
// ---------------------------------------------------------------------------

describe('applesauce-relay 6.2 real-library semantics: request() completion (T3)', () => {
	test('request() with completeOnAllEose() collects the slow relay\u2019s event instead of completing at first-EOSE+5s', async () => {
		jest.useFakeTimers()
		try {
			const urlA = freshRelayUrl('t3-a')
			const urlB = freshRelayUrl('t3-b')
			const pool = new RelayPool()

			const events: { id: string }[] = []
			let completed = false
			const sub = pool.request([urlA, urlB], [{ kinds: [1] }], { complete: RelayGroup.completeOnAllEose() }).subscribe({
				next: (event) => events.push(event as { id: string }),
				complete: () => {
					completed = true
				},
			})

			await waitForReq(urlA, urlB)

			// A EOSEs at t=0. v6's DEFAULT completion —
			// completeOnAny(completeAfterFirstRelay(5s), completeOnAllEose()) —
			// would end the request at t=5000 without B's event; pinning that
			// regression is the point of this test.
			serverPush(urlA, ['EOSE', subId(urlA)])
			jest.advanceTimersByTime(5000)
			await flush()
			expect(completed).toBe(false)

			// B delivers at t=6000 and EOSEs — the group completes and B's
			// event is in the collected results, inside the adapter's 8s
			// backstop window.
			jest.advanceTimersByTime(1000)
			serverPush(urlB, ['EVENT', subId(urlB), stubEvent])
			serverPush(urlB, ['EOSE', subId(urlB)])
			await flush()
			expect(completed).toBe(true)
			expect(events.map((e) => e.id)).toEqual([stubEvent.id])

			sub.unsubscribe()
		} finally {
			jest.useRealTimers()
		}
	})

	test('request() with completeOnAllEose() does not complete while a relay never EOSEs — the adapter\u2019s 8s backstop is the resolution path', async () => {
		jest.useFakeTimers()
		try {
			const urlA = freshRelayUrl('t3-never-a')
			const urlB = freshRelayUrl('t3-never-b')
			const pool = new RelayPool()

			let completed = false
			const sub = pool.request([urlA, urlB], [{ kinds: [1] }], { complete: RelayGroup.completeOnAllEose() }).subscribe({
				complete: () => {
					completed = true
				},
			})

			await waitForReq(urlA, urlB)

			// A streams an event and EOSEs; B goes permanently silent (its
			// socket is open but it never sends EOSE).
			serverPush(urlA, ['EVENT', subId(urlA), stubEvent])
			serverPush(urlA, ['EOSE', subId(urlA)])

			// completeOnAllEose counts B as still OPEN — no completion at the
			// v6 default fuse (first-EOSE+5s), nor at the adapter's 8s
			// backstop: the backstop (io.test.ts pins the adapter wiring)
			// unsubscribes and resolves with partial results; the library
			// observable itself would hang until its own 30s timeout.
			jest.advanceTimersByTime(8000)
			await flush()
			expect(completed).toBe(false)

			jest.advanceTimersByTime(21_000)
			await flush()
			expect(completed).toBe(false)

			sub.unsubscribe()
		} finally {
			jest.useRealTimers()
		}
	})
})
