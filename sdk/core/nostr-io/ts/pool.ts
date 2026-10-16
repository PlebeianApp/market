/**
 * pool.ts — the pool contract's shapes and the adapter boundary.
 *
 * Four things live here, all of them the seam's own:
 *
 * 1. **The adopted shape, normalised.** `toUpstreamPool` turns either arm of the
 *    vendor's published `UpstreamPool` (`#fa487d`) into a single `NostrRequest`,
 *    which is one place that turns a request into a stream. The vendor documents
 *    that same contract as satisfied by four independent backends (`#c6ae9c`), so
 *    normalising it here is what lets a host wire any of them the standard way.
 * 2. **The reason vocabulary's mapping** (`#5ecac1`, `#6a5bcb` (provenance)). A relay's own
 *    refusal text is a wire detail; the contract's `RelayReason` is the value a
 *    caller observes. `mapClosedReason` is the one place that translation happens,
 *    and it is pure so a case can assert it without a socket.
 * 3. **The unique target set.** `uniqueRelays` keeps the host's order and drops a
 *    repeated URL, which is neither adding, preferring, reordering nor blacklisting
 *    a relay (`#06200d`) — and it is what stops one relay from being asked twice.
 * 4. **The pool's own URL key.** `normalizeRelayUrl` is the key the vendor's pool
 *    files a relay under; the seam looks its health up by that key rather than by
 *    a spelling the pool never used.
 */
import type { FilterIn, NostrRequest, RelayReason, RelayUrl, UpstreamPool } from './types'
import { RelaySeamError } from './errors'

/**
 * #fa487d — toUpstreamPool: the one place a request becomes a stream. Both arms
 * of the adopted union reach `request(relays, filters)`; nothing else is added,
 * and in particular no store, cache or deduplication is bound here.
 */
export function toUpstreamPool(pool: UpstreamPool): NostrRequest {
	if (typeof pool === 'function') return pool
	return (relays, filters) => pool.request(relays, filters)
}

/**
 * #d7b4db — toFilterArray: NIP-01's filters are one-or-many; the pool always takes many. A single filter
 * becomes a one-element array, an array a shallow copy in the host's order, and
 * a duplicate is **kept** — de-duplication is `uniqueRelays`' job, a different
 * rule (`#06200d`).
 *
 * Anything that is not an object is a caller error, so it is a typed refusal
 * (`RelaySeamError` with `rejected`) rather than a silent coercion to
 * `[undefined]` handed to the pool. This is the same decision the store arm
 * (`event-store/ts/filters.ts:37`) and the event-access arm
 * (`event-access/ts/filters.ts:21`) make; the three copies are the deliberate
 * module isolation, and only their divergence was the defect (`#10.1`).
 */
export function toFilterArray(filters: FilterIn | FilterIn[]): FilterIn[] {
	if (filters === null || typeof filters !== 'object') {
		throw new RelaySeamError('rejected', `a filter must be an object or an array of objects, not ${typeof filters}`)
	}
	return Array.isArray(filters) ? [...filters] : [filters]
}

/**
 * #06200d — uniqueRelays: the **unique** target set — the host's order, with a URL that appears more than
 * once kept once. Two spellings of one relay stay two entries — the relay set is
 * the host's answer and the seam does not rewrite what it was given.
 */
export function uniqueRelays(relays: readonly RelayUrl[]): RelayUrl[] {
	return [...new Set(relays)]
}

/**
 * #499675 — normalizeRelayUrl [1:1]: the key a pool files a relay under, for the pools that normalise a URL before
 * they keep it. The transformation is the vendor's own, read in the installed
 * copy (`applesauce-core` 6.2.0 `dist/helpers/url.js`, `normalizeURL`): parse as a
 * URL, collapse doubled slashes in the path, drop a port that the scheme already
 * implies, and take the serialisation — so `wss://relay.invalid` and
 * `wss://relay.invalid/` are the one relay the pool holds. A string that is not a
 * URL at all throws, and the caller turns that into a typed refusal rather than
 * into an invented "not connected".
 */
export function normalizeRelayUrl(url: RelayUrl): string {
	const parsed = new URL(url)
	parsed.pathname = parsed.pathname.replace(/\/+/g, '/')
	if (
		(parsed.port === '80' && (parsed.protocol === 'ws:' || parsed.protocol === 'http:')) ||
		(parsed.port === '443' && (parsed.protocol === 'wss:' || parsed.protocol === 'https:'))
	) {
		parsed.port = ''
	}
	return parsed.toString()
}

/**
 * #7a5f39 — mapClosedReason [1:1]: a relay's CLOSED/refusal text to the contract's reason vocabulary.
 *
 * The order matters: NIP-01's machine-readable prefixes (`auth-required:`,
 * `rate-limited:`, `error:`) come first, then the human phrases a relay may send
 * instead, and a bare close is `closed`. Anything unrecognised is `rejected` —
 * a refusal is never a silent absence.
 */
export function mapClosedReason(reason: string): RelayReason {
	const text = reason.toLowerCase()
	if (text.startsWith('auth-required') || text.includes('auth required')) return 'auth-required'
	if (text.startsWith('rate-limited') || text.includes('rate limited') || text.includes('too many')) return 'rate-limited'
	if (text.includes('timeout') || text.includes('timed out')) return 'timeout'
	if (text.includes('not found') || text.includes('could not be found') || text.includes('no such')) return 'not-found'
	if (text.trim() === '' || text.startsWith('closed') || text.includes('unsubscribed')) return 'closed'
	return 'rejected'
}
