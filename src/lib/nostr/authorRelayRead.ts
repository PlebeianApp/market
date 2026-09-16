/**
 * Bounded author-relay read path (ADR-0002 Wave 1 read topology (F3, proposed: PR #1333)).
 *
 * Pinned reads — the relays the operator named — stay canonical. When a pinned
 * read misses, the four degraded reads named in F3 may consult the relays the
 * author declared in their own kind-10002 list, inside an explicit bound:
 *
 * - **per read**: the declared list is untrusted input. Declarations are
 *   deduplicated, scheme-filtered (plain `ws`/`wss` only — no `.onion`, no
 *   non-WebSocket scheme, no embedded credentials), restricted to read-capable
 *   entries, and hard-capped at {@link MAX_AUTHOR_RELAYS_PER_READ} relays.
 * - **per relay**: a timeout ({@link AUTHOR_RELAY_TIMEOUT_MS} by default).
 * - **serial**: relays are contacted one at a time, never in parallel, so a
 *   read cannot fan out and cannot keep more than one author-relay connection
 *   open at a time.
 * - **per session**: a cap on the number of distinct author relays admitted
 *   during a session, with TTL + eviction
 *   ({@link MAX_DISTINCT_AUTHOR_RELAYS_PER_SESSION}), so N distinct authors
 *   cannot accumulate an unbounded relay pool.
 * - **cache-hit rule**: a warm cache serves the result and fires no fetch; the
 *   fetch runs only on a miss, and the merged result is what the caller caches
 *   under its own query key, so author-relay results land in the same cache
 *   entry as pinned ones.
 * - **no negative caching**: only a non-empty result is cached. An empty result
 *   stays a miss, so an event that lands on the author's relay just after a cold
 *   miss is still reachable on the next read instead of being pinned invisible
 *   for the whole TTL.
 * - **single-flight**: concurrent cold-miss callers for the same logical read
 *   await one shared in-flight run, so N concurrent callers cost the relay
 *   budget of ONE read, not N serial fan-outs.
 * - **merge**: per-relay results collapse through the seam's coordinate-level
 *   latest-wins rule (`mergeNdkEventSets`), so ordering semantics do not fork
 *   per relay class.
 *
 * No new egress happens when the flag is OFF, when the purpose is an authority
 * read, or when the author declared no usable relays: the pinned result stands.
 *
 * Disclosure consequence (proposed in PR #1333 as a deliberate tradeoff; NOT yet recorded in the ADR): inside
 * this bound, an author's declared relay learns the reader's IP and that a
 * filter naming that author was requested. The bound exists to keep that
 * disclosure finite and legible.
 */
import { applesauceIo } from './io'
import { fetchNdkEventSet, mergeNdkEventSets, type NDKEvent, type NDKFilter } from './ndk-events'
import { isAuthorRelayReadAllowed, isExternalAuthorReadsEnabledFromConfig, type AuthorRelayReadPurpose } from './authorRelayPolicy'
import { configStore } from '@/lib/stores/config'
import type { NostrIo } from './io'

/** Hard cap on author relays contacted for a single read. */
export const MAX_AUTHOR_RELAYS_PER_READ = 3
/** Per-relay deadline; a relay that exceeds it is abandoned and the read continues. */
export const AUTHOR_RELAY_TIMEOUT_MS = 3_000
/**
 * Session cap on distinct author relays. Three relays per read means this
 * admits the relay sets of roughly four distinct authors before refusing new
 * ones; already-admitted relays stay usable.
 */
export const MAX_DISTINCT_AUTHOR_RELAYS_PER_SESSION = 12
/** TTL for session relay admissions and cached read results. */
export const AUTHOR_RELAY_SESSION_TTL_MS = 10 * 60 * 1000

// Bound to Node's timer type so the module does not depend on DOM lib types.
type TimerHandle = ReturnType<typeof setTimeout>

/** Structural shape of a NIP-65 declaration (see `src/publish/relay-list.tsx`). */
export interface AuthorRelayPreference {
	url: string
	read: boolean
	write: boolean
}

export interface AuthorRelayReadRequest {
	/** Only `display` and `self` may consult author relays; `authority` never can. */
	purpose: AuthorRelayReadPurpose
	/** Author whose declared relays may be consulted (the reader, for self-scoped reads). */
	authorPubkey: string
	filter: NDKFilter | NDKFilter[]
}

export type AuthorRelayReadSource =
	/** An authority read: pinned-only by policy. */
	| 'authority'
	/** The single server decision is OFF (default outside production). */
	| 'disabled'
	/** A warm cache served the result; no fetch fired. */
	| 'cache'
	/** The author declared no usable relays. */
	| 'no-declared-relays'
	/** The session cap refused every candidate relay. */
	| 'session-cap'
	/** The bounded path ran (its result may still be empty). */
	| 'author-relays'

export interface AuthorRelayReadOutcome {
	events: Set<NDKEvent>
	source: AuthorRelayReadSource
	/** Author relays actually contacted, in serial order. */
	consultedRelays: string[]
}

export interface AuthorRelayReadSourceOutcome {
	events: Set<NDKEvent>
	source: AuthorRelayReadSource | 'pinned'
	/** Author relays actually contacted, in serial order. */
	consultedRelays: string[]
}

export interface AuthorRelaySessionOptions {
	maxDistinctRelays?: number
	ttlMs?: number
	now?: () => number
}

/**
 * Per-session bound for the bounded path: which distinct author relays have
 * been admitted (with TTL + eviction) and which read results are still warm.
 *
 * One instance is shared by every read in the session
 * ({@link authorRelaySession}); it is the reason N distinct authors cannot
 * accumulate an unbounded relay pool.
 */
export class AuthorRelaySession {
	private readonly admissions = new Map<string, number>()
	private readonly cache = new Map<string, { events: NDKEvent[]; at: number }>()
	private readonly inFlight = new Map<string, Promise<AuthorRelayReadOutcome>>()
	private readonly maxDistinctRelays: number
	private readonly ttlMs: number
	private readonly now: () => number

	constructor(options: AuthorRelaySessionOptions = {}) {
		this.maxDistinctRelays = options.maxDistinctRelays ?? MAX_DISTINCT_AUTHOR_RELAYS_PER_SESSION
		this.ttlMs = options.ttlMs ?? AUTHOR_RELAY_SESSION_TTL_MS
		this.now = options.now ?? (() => Date.now())
	}

	/**
	 * Admit as many candidate relays as the session bound allows. A relay
	 * already admitted within the TTL is refreshed rather than counted again;
	 * once the cap is reached, new distinct relays are refused (no egress).
	 */
	admit(candidates: string[], at: number = this.now()): string[] {
		this.evictExpired(at)
		const admitted: string[] = []
		for (const relayUrl of candidates) {
			if (this.admissions.has(relayUrl)) {
				this.admissions.set(relayUrl, at)
				admitted.push(relayUrl)
				continue
			}
			if (this.admissions.size >= this.maxDistinctRelays) continue
			this.admissions.set(relayUrl, at)
			admitted.push(relayUrl)
		}
		return admitted
	}

	/** Distinct author relays currently admitted. */
	distinctRelayCount(at: number = this.now()): number {
		this.evictExpired(at)
		return this.admissions.size
	}

	getCached(cacheKey: string, at: number = this.now()): NDKEvent[] | undefined {
		const entry = this.cache.get(cacheKey)
		if (!entry) return undefined
		if (at - entry.at >= this.ttlMs) {
			this.cache.delete(cacheKey)
			return undefined
		}
		// Defensive: an empty entry is not a served result. Nothing writes one
		// (see setCached), but a stale entry from an older session shape must not
		// be able to satisfy a read either.
		if (entry.events.length === 0) {
			this.cache.delete(cacheKey)
			return undefined
		}
		return entry.events
	}

	/**
	 * Cache a completed read. **Only non-empty results are cached.**
	 *
	 * Caching an empty result would pin "absent" for the full TTL: an event
	 * arriving at the author's relay immediately after a cold miss would stay
	 * invisible until the entry expired, and every subsequent read would be
	 * answered from that negative entry without ever re-checking. A miss stays a
	 * miss — the bounded path may run again on the next read.
	 */
	setCached(cacheKey: string, events: NDKEvent[], at: number = this.now()): void {
		if (events.length === 0) {
			this.cache.delete(cacheKey)
			return
		}
		this.evictExpired(at)
		this.cache.set(cacheKey, { events, at })
	}

	/**
	 * The in-progress bounded read for this key, if one is running. Concurrent
	 * cold-miss callers share it instead of each starting their own serial
	 * fan-out (single-flight): the per-read cap and the serial rule bound the
	 * *session*, so overlapping callers must not multiply the egress.
	 */
	getInFlight(cacheKey: string): Promise<AuthorRelayReadOutcome> | undefined {
		return this.inFlight.get(cacheKey)
	}

	setInFlight(cacheKey: string, run: Promise<AuthorRelayReadOutcome>): void {
		this.inFlight.set(cacheKey, run)
	}

	/** Clear a finished in-flight read, without clobbering a newer run for the key. */
	clearInFlight(cacheKey: string, run: Promise<AuthorRelayReadOutcome>): void {
		if (this.inFlight.get(cacheKey) === run) this.inFlight.delete(cacheKey)
	}

	/** Drop every admission, cached result, and in-flight read (tests / session teardown). */
	reset(): void {
		this.admissions.clear()
		this.cache.clear()
		this.inFlight.clear()
	}

	private evictExpired(at: number): void {
		for (const [relayUrl, admittedAt] of Array.from(this.admissions.entries())) {
			if (at - admittedAt >= this.ttlMs) this.admissions.delete(relayUrl)
		}
	}
}

/**
 * Resolver dependencies. Production callers use
 * {@link createAuthorRelayReadDeps}; tests inject a recording seam port and a
 * stub NDK context, so this module can be exercised without network I/O.
 */
export interface AuthorRelayReadDeps {
	io: Pick<NostrIo, 'fetchEvents'>
	ndk: Parameters<typeof fetchNdkEventSet>[1]
	/** The existing kind-10002 declaration reader; this path never re-parses NIP-65 tags itself. */
	fetchAuthorRelayList: (pubkey: string) => Promise<AuthorRelayPreference[]>
	/** The single `/api/config` decision (see `authorRelayPolicy.ts`). */
	isEnabled: () => boolean
	now?: () => number
	perRelayTimeoutMs?: number
	maxRelaysPerRead?: number
	session?: AuthorRelaySession
}

/** Session-wide bound shared by every bounded read in the page session. */
export const authorRelaySession = new AuthorRelaySession()

/**
 * Production wiring for the bounded path: the browser seam, the existing
 * declaration reader, the single `/api/config` decision, and the shared
 * session bound.
 */
export function createAuthorRelayReadDeps(wiring: {
	ndk: AuthorRelayReadDeps['ndk']
	fetchAuthorRelayList: AuthorRelayReadDeps['fetchAuthorRelayList']
}): AuthorRelayReadDeps {
	return {
		io: applesauceIo,
		ndk: wiring.ndk,
		fetchAuthorRelayList: wiring.fetchAuthorRelayList,
		isEnabled: () => isExternalAuthorReadsEnabledFromConfig(configStore.state.config),
		now: () => Date.now(),
		perRelayTimeoutMs: AUTHOR_RELAY_TIMEOUT_MS,
		maxRelaysPerRead: MAX_AUTHOR_RELAYS_PER_READ,
		session: authorRelaySession,
	}
}

const SUPPORTED_RELAY_PROTOCOLS = new Set(['ws:', 'wss:'])

/**
 * Normalize one untrusted declaration into a dedupe key plus the exact URL to
 * connect to. Returns `null` for anything that is not a plain `ws`/`wss` relay
 * without credentials: a relay declaration is attacker-controlled input, and
 * `.onion`/non-WebSocket targets are either unroutable in the browser or a
 * transport we did not choose.
 *
 * Dedupe must not rewrite the connection target, so the first-seen spelling is
 * what callers connect to while comparisons use the normalized key.
 */
function normalizeRelayDeclaration(rawUrl: unknown): { key: string; url: string } | null {
	if (typeof rawUrl !== 'string') return null
	const url = rawUrl.trim()
	if (!url) return null

	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return null
	}

	if (!SUPPORTED_RELAY_PROTOCOLS.has(parsed.protocol)) return null
	if (parsed.username || parsed.password) return null

	const hostname = parsed.hostname.toLowerCase()
	if (!hostname || hostname === 'localhost' || hostname.endsWith('.onion')) return null

	const key = `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname.replace(/\/+$/, '')}`
	return { key, url }
}

/**
 * Select the relays a single read may contact: read-capable declarations only,
 * deduplicated, scheme-filtered, capped. Exported for the ADR's reviewer, who
 * must be able to check the per-read bound from code.
 */
export function selectAuthorRelays(
	preferences: ReadonlyArray<AuthorRelayPreference> | null | undefined,
	maxRelays = MAX_AUTHOR_RELAYS_PER_READ,
): string[] {
	const seen = new Set<string>()
	const selected: string[] = []
	for (const preference of preferences ?? []) {
		// Untrusted shape: require an explicit read-capable declaration.
		if (!preference || preference.read !== true) continue
		const normalized = normalizeRelayDeclaration(preference.url)
		if (!normalized || seen.has(normalized.key)) continue
		seen.add(normalized.key)
		selected.push(normalized.url)
		if (selected.length >= maxRelays) break
	}
	return selected
}

/** Cache key for a logical read: purpose + author + filter shape. */
function authorRelayReadCacheKey(request: AuthorRelayReadRequest): string {
	const filters = Array.isArray(request.filter) ? request.filter : [request.filter]
	const serialized = filters.map((filter) => JSON.stringify(filter, Object.keys(filter).sort())).join('|')
	return `${request.purpose}:${request.authorPubkey}:${serialized}`
}

/** Resolve `null` when a relay fetch exceeds its deadline or rejects. */
function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
	return new Promise<T | null>((resolve) => {
		const timer: TimerHandle = setTimeout(() => resolve(null), timeoutMs)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			() => {
				clearTimeout(timer)
				resolve(null)
			},
		)
	})
}

const noEvents = () => new Set<NDKEvent>()

/**
 * Run the bounded author-relay path for one read.
 *
 * Returns an empty set — never an error — whenever the bound or the policy says
 * the pinned result stands, so callers can merge the outcome unconditionally.
 */
export async function resolveAuthorRelayRead(request: AuthorRelayReadRequest, deps: AuthorRelayReadDeps): Promise<AuthorRelayReadOutcome> {
	// Authority carve-out: checked before anything else, including the flag, and
	// before the declaration reader is touched.
	if (request.purpose === 'authority') {
		return { events: noEvents(), source: 'authority', consultedRelays: [] }
	}
	if (!isAuthorRelayReadAllowed(request.purpose, deps.isEnabled())) {
		return { events: noEvents(), source: 'disabled', consultedRelays: [] }
	}

	const session = deps.session ?? authorRelaySession
	const now = deps.now ?? (() => Date.now())
	const perRelayTimeoutMs = deps.perRelayTimeoutMs ?? AUTHOR_RELAY_TIMEOUT_MS
	const maxRelaysPerRead = deps.maxRelaysPerRead ?? MAX_AUTHOR_RELAYS_PER_READ

	const cacheKey = authorRelayReadCacheKey(request)
	const cached = session.getCached(cacheKey, now())
	if (cached) {
		// Cache hit: serve the warm result and fire no author-relay fetch.
		return { events: mergeNdkEventSets(cached), source: 'cache', consultedRelays: [] }
	}

	// Single-flight: a cold miss that another caller is already running is joined,
	// not re-run. Without this, N concurrent callers each walk the serial relay
	// list and the session sees N× the egress the per-read bound promises.
	const inFlight = session.getInFlight(cacheKey)
	if (inFlight) return inFlight

	const run = runBoundedRead(request, deps, session, cacheKey, {
		now,
		perRelayTimeoutMs,
		maxRelaysPerRead,
	})
	session.setInFlight(cacheKey, run)
	const clear = () => session.clearInFlight(cacheKey, run)
	run.then(clear, clear)
	return run
}

/** The serial, bounded single fetch — factored out so it can be shared in-flight. */
async function runBoundedRead(
	request: AuthorRelayReadRequest,
	deps: AuthorRelayReadDeps,
	session: AuthorRelaySession,
	cacheKey: string,
	bounds: { now: () => number; perRelayTimeoutMs: number; maxRelaysPerRead: number },
): Promise<AuthorRelayReadOutcome> {
	const { now, perRelayTimeoutMs, maxRelaysPerRead } = bounds

	let preferences: AuthorRelayPreference[] = []
	try {
		preferences = (await deps.fetchAuthorRelayList(request.authorPubkey)) ?? []
	} catch {
		// A relay list we cannot read degrades to the pinned result.
		preferences = []
	}

	const candidates = selectAuthorRelays(preferences, maxRelaysPerRead)
	if (candidates.length === 0) {
		return { events: noEvents(), source: 'no-declared-relays', consultedRelays: [] }
	}

	const admitted = session.admit(candidates, now())
	if (admitted.length === 0) {
		return { events: noEvents(), source: 'session-cap', consultedRelays: [] }
	}

	// Serial, bounded execution: one relay at a time, each with its own deadline.
	const collected: NDKEvent[][] = []
	const consultedRelays: string[] = []
	for (const relayUrl of admitted) {
		consultedRelays.push(relayUrl)
		const events = await withDeadline(
			fetchNdkEventSet(deps.io, deps.ndk, request.filter, { relayUrls: [relayUrl], timeoutMs: perRelayTimeoutMs }),
			perRelayTimeoutMs,
		)
		if (events && events.size > 0) collected.push(Array.from(events))
	}

	const merged = mergeNdkEventSets(...collected)
	session.setCached(cacheKey, Array.from(merged), now())
	return { events: merged, source: 'author-relays', consultedRelays }
}

/**
 * Read an author-scoped filter the F3 way: pinned first, bounded author-relay
 * path only on a pinned miss, merged under the seam's latest-wins rule.
 *
 * A pinned hit means the bounded path is never consulted at all (cache-hit
 * rule), and an authority read never leaves the pinned result.
 */
export async function readAuthorScopedEvents(
	filter: NDKFilter | NDKFilter[],
	options: { authorPubkey: string; purpose: AuthorRelayReadPurpose },
	deps: AuthorRelayReadDeps,
): Promise<AuthorRelayReadSourceOutcome> {
	const pinned = await fetchNdkEventSet(deps.io, deps.ndk, filter)
	if (pinned.size > 0) {
		return { events: pinned, source: 'pinned', consultedRelays: [] }
	}

	return resolveAuthorRelayRead({ ...options, filter }, deps)
}
