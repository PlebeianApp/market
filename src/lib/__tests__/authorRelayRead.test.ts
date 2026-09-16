/**
 * Bounded author-relay read path — resolver tests (ADR-0002 Wave 1 addendum, F3).
 *
 * Pinned reads are canonical. When the pinned read misses, the bounded path may
 * consult the author's own declared relays (`kind 10002`, read through the
 * existing declaration reader) — inside a hard bound:
 *
 *  - per read: the declared list is untrusted input (deduped, scheme-filtered,
 *    read-capable only) and capped at 3 relays;
 *  - per relay: a timeout, and execution is SERIAL (no fan-out);
 *  - per session: a cap on distinct author relays with TTL + eviction;
 *  - on a cache hit the cached result is served and NO author-relay fetch fires;
 *  - results merge through the seam's latest-wins / coordinate-dedup rule;
 *  - authority reads NEVER consult author relays, flag ON or not.
 *
 * Every event here is a real `finalizeEvent`-signed event; the seam port is a
 * local recorder (no network) and the NDK context is a minimal stub, so this
 * file carries no `nostr-dev-kit` import and does not perturb the NDK
 * footprint guard.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools/pure'

import type { FetchOptions, NostrFilter } from '@/lib/nostr/io'
import { fetchNdkEventSet } from '@/lib/nostr/ndk-events'
import {
	AUTHOR_RELAY_TIMEOUT_MS,
	AuthorRelaySession,
	MAX_AUTHOR_RELAYS_PER_READ,
	createAuthorRelayReadDeps,
	readAuthorScopedEvents,
	resolveAuthorRelayRead,
	type AuthorRelayReadDeps,
	type AuthorRelayReadOutcome,
} from '@/lib/nostr/authorRelayRead'

const AUTHOR_PUBKEY = 'a1'.repeat(32)
const TEST_SECRET_KEY = new Uint8Array(32).fill(7)

const PROFILE_FILTER: NostrFilter = { kinds: [0], authors: [AUTHOR_PUBKEY] }

const stubNdk = {
	fetchEvent: async () => null,
	queuesNip05: { add: async (item: { func: () => Promise<unknown> }) => item.func() },
} as unknown as Parameters<typeof fetchNdkEventSet>[1]

interface RecordedFetch {
	relayUrls: string[]
}

/**
 * Recorder for the seam port. `handler` decides what each relay returns, so a
 * test can make one relay slow, one relay hang, and one relay answer. A fetch
 * with no relay override is the pinned read (it goes to the configured relay
 * set) and is recorded separately from author-relay egress.
 */
function recordingIo(handler: (relayUrl: string) => Promise<NostrEvent[]>, pinnedEvents: NostrEvent[] = []) {
	const calls: RecordedFetch[] = []
	let pinnedCalls = 0
	let inFlight = 0
	let maxInFlight = 0

	const io = {
		async fetchEvents(_filter: NostrFilter | NostrFilter[], opts?: FetchOptions): Promise<NostrEvent[]> {
			const relayUrls = opts?.relayUrls ?? []
			if (relayUrls.length === 0) {
				pinnedCalls += 1
				return pinnedEvents
			}
			const relayUrl = relayUrls[0] ?? ''
			calls.push({ relayUrls })
			inFlight += 1
			maxInFlight = Math.max(maxInFlight, inFlight)
			try {
				return await handler(relayUrl)
			} finally {
				inFlight -= 1
			}
		},
	} as unknown as Pick<AuthorRelayReadDeps['io'], 'fetchEvents'>

	return { io, calls, pinnedCalls: () => pinnedCalls, maxInFlight: () => maxInFlight }
}

function signedEvent(kind: number, createdAt: number, content = '', tags: string[][] = [], secretKey = TEST_SECRET_KEY): NostrEvent {
	return finalizeEvent({ kind, created_at: createdAt, tags, content }, secretKey)
}

/**
 * Tamper with a signed event the way a hostile relay would. The verification
 * cache symbol `finalizeEvent` attaches must be stripped, otherwise it rides
 * along on the spread and `verifyEvent` short-circuits to `true`.
 */
function forgeEvent(event: NostrEvent, overrides: Partial<NostrEvent>): NostrEvent {
	const forged = { ...event, ...overrides }
	for (const symbol of Object.getOwnPropertySymbols(forged)) {
		delete (forged as Record<PropertyKey, unknown>)[symbol]
	}
	return forged
}

function authorRelays(urls: string[], opts: { read?: boolean; write?: boolean } = {}) {
	return urls.map((url) => ({ url, read: opts.read ?? true, write: opts.write ?? false }))
}

function makeDeps(
	overrides: Partial<AuthorRelayReadDeps> & {
		relayList?: string[]
		handler?: (relayUrl: string) => Promise<NostrEvent[]>
		pinnedEvents?: NostrEvent[]
	},
): { deps: AuthorRelayReadDeps; calls: RecordedFetch[]; pinnedCalls: () => number; maxInFlight: () => number; relayListCalls: string[] } {
	const { relayList = [], handler = async () => [], pinnedEvents = [], ...rest } = overrides
	const recorder = recordingIo(handler, pinnedEvents)
	const relayListCalls: string[] = []

	const deps: AuthorRelayReadDeps = {
		io: recorder.io,
		ndk: stubNdk,
		fetchAuthorRelayList: async (pubkey: string) => {
			relayListCalls.push(pubkey)
			return authorRelays(relayList)
		},
		isEnabled: () => true,
		now: () => 1_000_000,
		perRelayTimeoutMs: 50,
		session: new AuthorRelaySession({ maxDistinctRelays: 12, ttlMs: 60_000, now: () => 1_000_000 }),
		...rest,
	}

	return { deps, calls: recorder.calls, pinnedCalls: recorder.pinnedCalls, maxInFlight: recorder.maxInFlight, relayListCalls }
}

describe('bounded author-relay resolver — per-read bound', () => {
	test(`caps a read at ${MAX_AUTHOR_RELAYS_PER_READ} author relays`, async () => {
		const { deps, calls } = makeDeps({
			relayList: ['wss://r1.example', 'wss://r2.example', 'wss://r3.example', 'wss://r4.example', 'wss://r5.example'],
		})

		const outcome = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(MAX_AUTHOR_RELAYS_PER_READ).toBe(3)
		expect(calls).toHaveLength(3)
		expect(outcome.consultedRelays).toEqual(['wss://r1.example', 'wss://r2.example', 'wss://r3.example'])
	})

	test('dedupes equivalent relay declarations before connecting', async () => {
		const { deps, calls } = makeDeps({
			relayList: ['wss://r1.example', 'wss://R1.example/', 'wss://r1.example', 'wss://r2.example'],
		})

		const outcome = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(calls).toHaveLength(2)
		// the first-seen spelling is what gets connected to — dedupe must not rewrite the target
		expect(outcome.consultedRelays).toEqual(['wss://r1.example', 'wss://r2.example'])
	})

	test('drops non-ws/wss schemes, unparseable values, and .onion hosts', async () => {
		const { deps, calls } = makeDeps({
			relayList: [
				'https://r1.example',
				'wss://r2.example.onion',
				'ftp://r3.example',
				'localhost:10547',
				'',
				'ws://r4.example',
				'wss://r5.example',
			],
		})

		const outcome = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(outcome.consultedRelays).toEqual(['ws://r4.example', 'wss://r5.example'])
		expect(calls).toHaveLength(2)
	})

	test('never reads a write-only relay', async () => {
		const relayList = [
			{ url: 'wss://write-only.example', read: false, write: true },
			{ url: 'wss://read-write.example', read: true, write: true },
		]
		const { deps, calls } = makeDeps({})

		const outcome = await resolveAuthorRelayRead(
			{ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER },
			{ ...deps, fetchAuthorRelayList: async () => relayList },
		)

		expect(outcome.consultedRelays).toEqual(['wss://read-write.example'])
		expect(calls).toHaveLength(1)
	})
})

describe('bounded author-relay resolver — per-relay timeout and serial execution', () => {
	test('abandons a relay that never answers and continues to the next one', async () => {
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Alice' }))
		const { deps } = makeDeps({
			relayList: ['wss://hangs.example', 'wss://answers.example'],
			handler: async (relayUrl) => {
				if (relayUrl === 'wss://hangs.example') return new Promise<NostrEvent[]>(() => {})
				return [profile]
			},
		})

		const startedAt = Date.now()
		const outcome = await resolveAuthorRelayRead(
			{ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER },
			{ ...deps, perRelayTimeoutMs: 25 },
		)
		const elapsed = Date.now() - startedAt

		expect(outcome.consultedRelays).toEqual(['wss://hangs.example', 'wss://answers.example'])
		expect(Array.from(outcome.events).map((event) => event.id)).toEqual([profile.id])
		expect(elapsed).toBeLessThan(2_000)
	})

	test('exposes a default per-relay timeout', () => {
		expect(AUTHOR_RELAY_TIMEOUT_MS).toBeGreaterThan(0)
	})

	test('runs relay fetches serially, never in parallel', async () => {
		const { deps, maxInFlight } = makeDeps({
			relayList: ['wss://r1.example', 'wss://r2.example', 'wss://r3.example'],
			handler: async () => {
				await new Promise((resolve) => setTimeout(resolve, 5))
				return []
			},
		})

		await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(maxInFlight()).toBe(1)
	})
})

describe('bounded author-relay resolver — merge rule', () => {
	test('merges per-relay results with the seam latest-wins coordinate rule', async () => {
		const stale = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'stale' }))
		const fresh = signedEvent(0, 1_700_000_100, JSON.stringify({ name: 'fresh' }))
		const { deps } = makeDeps({
			relayList: ['wss://r1.example', 'wss://r2.example'],
			handler: async (relayUrl) => (relayUrl === 'wss://r1.example' ? [stale] : [fresh]),
		})

		const outcome = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(Array.from(outcome.events).map((event) => event.id)).toEqual([fresh.id])
	})

	test('drops events that fail signature verification at the seam', async () => {
		const good = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'good' }))
		const tampered = forgeEvent(good, { content: JSON.stringify({ name: 'evil' }) })
		const { deps } = makeDeps({
			relayList: ['wss://r1.example'],
			handler: async () => [good, tampered],
		})

		const outcome = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(Array.from(outcome.events).map((event) => event.id)).toEqual([good.id])
	})
})

describe('bounded author-relay resolver — cache-hit rule', () => {
	test('a warm cache serves the result and does not fire an author-relay fetch', async () => {
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Alice' }))
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'], handler: async () => [profile] })

		const first = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)
		const callsAfterFirst = calls.length
		const second = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(first.source).toBe('author-relays')
		expect(callsAfterFirst).toBe(1)
		expect(second.source).toBe('cache')
		expect(second.consultedRelays).toEqual([])
		expect(calls).toHaveLength(1)
		expect(Array.from(second.events).map((event) => event.id)).toEqual([profile.id])
	})

	test('a miss on a different filter still consults relays', async () => {
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'] })

		await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)
		await resolveAuthorRelayRead(
			{ purpose: 'self', authorPubkey: AUTHOR_PUBKEY, filter: { kinds: [17375], authors: [AUTHOR_PUBKEY] } },
			deps,
		)

		expect(calls).toHaveLength(2)
	})
})

describe('bounded author-relay resolver — session bound', () => {
	test('refuses new distinct author relays beyond the session cap (no egress)', async () => {
		let now = 1_000_000
		const session = new AuthorRelaySession({ maxDistinctRelays: 2, ttlMs: 60_000, now: () => now })
		const { deps, calls } = makeDeps({
			relayList: ['wss://r1.example'],
			handler: async () => [],
			now: () => now,
			session,
		})

		await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: 'b1'.repeat(32), filter: PROFILE_FILTER }, deps)
		await resolveAuthorRelayRead(
			{ purpose: 'display', authorPubkey: 'b2'.repeat(32), filter: PROFILE_FILTER },
			{ ...deps, fetchAuthorRelayList: async () => authorRelays(['wss://r2.example']) },
		)
		const callsAtCap = calls.length

		const refused: AuthorRelayReadOutcome = await resolveAuthorRelayRead(
			{ purpose: 'display', authorPubkey: 'b3'.repeat(32), filter: PROFILE_FILTER },
			{ ...deps, fetchAuthorRelayList: async () => authorRelays(['wss://r3.example']) },
		)

		expect(callsAtCap).toBe(2)
		expect(refused.source).toBe('session-cap')
		expect(refused.consultedRelays).toEqual([])
		expect(calls).toHaveLength(2)
	})

	test('already-admitted relays stay usable at the session cap', async () => {
		let now = 1_000_000
		const session = new AuthorRelaySession({ maxDistinctRelays: 1, ttlMs: 60_000, now: () => now })
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'], handler: async () => [], now: () => now, session })

		await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: 'b1'.repeat(32), filter: PROFILE_FILTER }, deps)
		const second = await resolveAuthorRelayRead(
			{ purpose: 'display', authorPubkey: 'b2'.repeat(32), filter: PROFILE_FILTER },
			{ ...deps, fetchAuthorRelayList: async () => authorRelays(['wss://r1.example']) },
		)

		expect(second.source).toBe('author-relays')
		expect(calls).toHaveLength(2)
	})

	test('evicts expired admissions after the TTL so the session set stays bounded', async () => {
		let now = 1_000_000
		const session = new AuthorRelaySession({ maxDistinctRelays: 1, ttlMs: 10_000, now: () => now })
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'], handler: async () => [], now: () => now, session })

		await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: 'b1'.repeat(32), filter: PROFILE_FILTER }, deps)
		now += 20_000

		const afterTtl = await resolveAuthorRelayRead(
			{ purpose: 'display', authorPubkey: 'b2'.repeat(32), filter: PROFILE_FILTER },
			{ ...deps, fetchAuthorRelayList: async () => authorRelays(['wss://r2.example']) },
		)

		expect(afterTtl.source).toBe('author-relays')
		expect(afterTtl.consultedRelays).toEqual(['wss://r2.example'])
		expect(calls).toHaveLength(2)
		expect(session.distinctRelayCount()).toBe(1)
	})
})

describe('bounded author-relay resolver — carve-outs and no-egress cases', () => {
	test('an authority read never consults author relays, even with the flag ON', async () => {
		const { deps, calls, relayListCalls } = makeDeps({ relayList: ['wss://r1.example'] })

		const outcome = await resolveAuthorRelayRead({ purpose: 'authority', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(outcome.source).toBe('authority')
		expect(outcome.events.size).toBe(0)
		expect(outcome.consultedRelays).toEqual([])
		expect(calls).toHaveLength(0)
		expect(relayListCalls).toEqual([])
	})

	test('an authority read stays inert even when the relay list reader would throw', async () => {
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'] })

		const outcome = await resolveAuthorRelayRead(
			{ purpose: 'authority', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER },
			{
				...deps,
				fetchAuthorRelayList: async () => {
					throw new Error('must not be called')
				},
			},
		)

		expect(outcome.source).toBe('authority')
		expect(calls).toHaveLength(0)
	})

	test('a disabled flag stays pinned-only', async () => {
		const { deps, calls, relayListCalls } = makeDeps({ relayList: ['wss://r1.example'], isEnabled: () => false })

		const outcome = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(outcome.source).toBe('disabled')
		expect(outcome.events.size).toBe(0)
		expect(calls).toHaveLength(0)
		expect(relayListCalls).toEqual([])
	})

	test('no declared relays (or none usable) means no egress', async () => {
		const empty = makeDeps({ relayList: [] })
		const unusable = makeDeps({ relayList: ['https://nope.example'] })

		expect(
			(await resolveAuthorRelayRead({ purpose: 'self', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, empty.deps)).source,
		).toBe('no-declared-relays')
		expect(empty.calls).toHaveLength(0)
		expect(
			(await resolveAuthorRelayRead({ purpose: 'self', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, unusable.deps)).source,
		).toBe('no-declared-relays')
		expect(unusable.calls).toHaveLength(0)
	})

	test('a failing relay-list read degrades to the pinned result instead of throwing', async () => {
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'] })

		const outcome = await resolveAuthorRelayRead(
			{ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER },
			{
				...deps,
				fetchAuthorRelayList: async () => {
					throw new Error('relay list unavailable')
				},
			},
		)

		expect(outcome.source).toBe('no-declared-relays')
		expect(calls).toHaveLength(0)
	})

	test('a relay that errors is skipped without failing the read', async () => {
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Alice' }))
		const { deps } = makeDeps({
			relayList: ['wss://broken.example', 'wss://answers.example'],
			handler: async (relayUrl) => {
				if (relayUrl === 'wss://broken.example') throw new Error('connection refused')
				return [profile]
			},
		})

		const outcome = await resolveAuthorRelayRead({ purpose: 'display', authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }, deps)

		expect(outcome.consultedRelays).toEqual(['wss://broken.example', 'wss://answers.example'])
		expect(Array.from(outcome.events).map((event) => event.id)).toEqual([profile.id])
	})
})

describe('createAuthorRelayReadDeps — production wiring', () => {
	test('reads the single /api/config decision and defaults OFF', async () => {
		const { configActions, configStore } = await import('@/lib/stores/config')
		const previous = configStore.state.config

		try {
			configActions.setConfig({})
			const offDeps = createAuthorRelayReadDeps({ ndk: stubNdk, fetchAuthorRelayList: async () => [] })
			expect(offDeps.isEnabled()).toBe(false)

			configActions.setConfig({ externalAuthorReadsEnabled: true })
			const onDeps = createAuthorRelayReadDeps({ ndk: stubNdk, fetchAuthorRelayList: async () => [] })
			expect(onDeps.isEnabled()).toBe(true)

			// the wiring consults the browser seam, never a second relay stack
			expect(typeof onDeps.io.fetchEvents).toBe('function')
		} finally {
			configActions.setConfig(previous)
		}
	})
})

describe('readAuthorScopedEvents — pinned first, bounded path only on a miss', () => {
	test('a pinned hit serves without any author-relay egress', async () => {
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Pinned' }))
		const { deps, calls, relayListCalls } = makeDeps({
			relayList: ['wss://r1.example'],
			pinnedEvents: [profile],
		})

		const result = await readAuthorScopedEvents(PROFILE_FILTER, { authorPubkey: AUTHOR_PUBKEY, purpose: 'display' }, deps)

		expect(result.source).toBe('pinned')
		expect(Array.from(result.events).map((event) => event.id)).toEqual([profile.id])
		expect(calls).toHaveLength(0)
		expect(relayListCalls).toEqual([])
	})

	test('a pinned miss consults the bounded path and returns the merged result', async () => {
		const remote = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'OffRelay' }))
		const { deps, calls } = makeDeps({
			relayList: ['wss://r1.example'],
			handler: async () => [remote],
			pinnedEvents: [],
		})

		const result = await readAuthorScopedEvents(PROFILE_FILTER, { authorPubkey: AUTHOR_PUBKEY, purpose: 'display' }, deps)

		expect(result.source).toBe('author-relays')
		expect(Array.from(result.events).map((event) => event.id)).toEqual([remote.id])
		expect(calls).toHaveLength(1)
	})

	test('a pinned miss with the flag OFF returns an empty set (degraded, no egress)', async () => {
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'], pinnedEvents: [], isEnabled: () => false })

		const result = await readAuthorScopedEvents(PROFILE_FILTER, { authorPubkey: AUTHOR_PUBKEY, purpose: 'self' }, deps)

		expect(result.source).toBe('disabled')
		expect(result.events.size).toBe(0)
		expect(calls).toHaveLength(0)
	})

	test('an authority request never leaves the pinned result', async () => {
		const pinned = signedEvent(31990, 1_700_000_000, JSON.stringify({ name: 'app' }))
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'], pinnedEvents: [] })

		const result = await readAuthorScopedEvents({ kinds: [31990] }, { authorPubkey: AUTHOR_PUBKEY, purpose: 'authority' }, deps)

		expect(result.source).toBe('authority')
		expect(result.events.size).toBe(0)
		expect(calls).toHaveLength(0)
		expect(pinned.id).toBeTruthy()
	})
})

describe('bounded author-relay resolver — a miss stays a miss (no negative caching)', () => {
	test('an empty author-relay result is not cached, so the next read re-checks', async () => {
		let attempt = 0
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Alice' }))
		const { deps, calls } = makeDeps({
			relayList: ['wss://r1.example'],
			handler: async () => {
				attempt += 1
				return attempt === 1 ? [] : [profile]
			},
		})

		const request = { purpose: 'display' as const, authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }
		const first = await resolveAuthorRelayRead(request, deps)
		expect(first.source).toBe('author-relays')
		expect(first.events.size).toBe(0)

		// The profile landed on the author's relay after the cold miss. It must be
		// reachable on the next read: a cached empty result would pin "absent" for
		// the whole TTL and this read would answer `cache` with no egress.
		const second = await resolveAuthorRelayRead(request, deps)
		expect(second.source).toBe('author-relays')
		expect(Array.from(second.events).map((event) => event.id)).toEqual([profile.id])
		expect(calls).toHaveLength(2)
	})

	test('a warm cache never serves an empty entry', () => {
		const session = new AuthorRelaySession({ maxDistinctRelays: 12, ttlMs: 60_000, now: () => 1_000_000 })

		session.setCached('display:author:filter', [], 1_000_000)

		expect(session.getCached('display:author:filter', 1_000_000)).toBeUndefined()
	})

	test('a non-empty result is still cached (positive caching preserved)', async () => {
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Alice' }))
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'], handler: async () => [profile] })

		const request = { purpose: 'display' as const, authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }
		await resolveAuthorRelayRead(request, deps)
		const second = await resolveAuthorRelayRead(request, deps)

		expect(second.source).toBe('cache')
		expect(calls).toHaveLength(1)
	})
})

describe('bounded author-relay resolver — single-flight on a cold miss', () => {
	test('concurrent callers share one bounded read instead of one fan-out each', async () => {
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Alice' }))
		const { deps, calls, maxInFlight } = makeDeps({
			relayList: ['wss://r1.example', 'wss://r2.example', 'wss://r3.example'],
			handler: async () => {
				await new Promise((resolve) => setTimeout(resolve, 5))
				return [profile]
			},
		})

		const request = { purpose: 'display' as const, authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }
		const results = await Promise.all([1, 2, 3].map(() => resolveAuthorRelayRead(request, deps)))

		// Three concurrent cold-miss callers cost ONE read's egress (3 cap-bound
		// relays), never 3 × 3, and the serial rule holds across them.
		expect(calls).toHaveLength(3)
		expect(maxInFlight()).toBe(1)
		for (const result of results) {
			expect(result.source).toBe('author-relays')
			expect(Array.from(result.events).map((event) => event.id)).toEqual([profile.id])
		}
	})

	test('a caller arriving after the shared read settled is served from the cache', async () => {
		const profile = signedEvent(0, 1_700_000_000, JSON.stringify({ name: 'Alice' }))
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'], handler: async () => [profile] })

		const request = { purpose: 'display' as const, authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }
		await Promise.all([1, 2].map(() => resolveAuthorRelayRead(request, deps)))
		const later = await resolveAuthorRelayRead(request, deps)

		expect(later.source).toBe('cache')
		expect(calls).toHaveLength(1)
	})

	test('an empty shared read leaves no settled in-flight entry behind', async () => {
		const { deps, calls } = makeDeps({ relayList: ['wss://r1.example'] })

		const request = { purpose: 'display' as const, authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }
		await Promise.all([1, 2].map(() => resolveAuthorRelayRead(request, deps)))
		expect(calls).toHaveLength(1)

		// A stale (settled) in-flight promise would answer this read with no egress.
		await resolveAuthorRelayRead(request, deps)
		expect(calls).toHaveLength(2)
	})

	test('a failed shared read is not replayed from the in-flight map', async () => {
		const { deps, calls } = makeDeps({
			relayList: ['wss://r1.example'],
			fetchAuthorRelayList: async () => {
				throw new Error('declaration reader unavailable')
			},
		})

		const request = { purpose: 'display' as const, authorPubkey: AUTHOR_PUBKEY, filter: PROFILE_FILTER }
		const first = await resolveAuthorRelayRead(request, deps)
		const second = await resolveAuthorRelayRead(request, deps)

		expect(first.source).toBe('no-declared-relays')
		expect(second.source).toBe('no-declared-relays')
		expect(calls).toHaveLength(0)
	})
})
