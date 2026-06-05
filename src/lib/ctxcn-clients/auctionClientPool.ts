import { PlebeianAuctionClient } from './PlebeianAuctionClient'
import { ndkActions } from '@/lib/stores/ndk'

/**
 * Per-(serverPubkey, relays) memoized cache for `PlebeianAuctionClient`.
 *
 * Why this exists:
 *   Every call site used to do `new PlebeianAuctionClient(...)` → one
 *   tool call → `disconnect()`. Each instance spins up its own
 *   `SimplePool` and tears it down on disconnect. In practice this
 *   meant:
 *     - a WebSocket handshake per tool call (slow on deployed envs);
 *     - the console spam "WebSocket is already in CLOSING or CLOSED
 *       state" when two flows overlapped (e.g. settlement preflight +
 *       a bid submission), because the pool was being closed while
 *       another caller was still publishing to it;
 *     - a fresh subscription per call, instead of one persistent
 *       subscription correlating responses by `id`.
 *
 *   With a cached client the WS stays open between calls and we keep
 *   one subscription per `(serverPubkey, relays)` combo — bid +
 *   settlement + state queries share the same socket.
 *
 * Cache key: `${serverPubkey}|${sortedRelays.join(',')}`. Different
 * relay sets get different clients (writes have to actually reach the
 * facilitator's relays, so we can't merge them). The signer pubkey
 * also pins the cache — see `disposeAllAuctionClients` for the
 * invalidate-on-logout reasoning.
 */

interface CachedClient {
	client: PlebeianAuctionClient
	/** Pubkey of the signer at the time the client was constructed. */
	signerPubkey: string
}

const cache = new Map<string, CachedClient>()

export interface GetAuctionClientParams {
	pathIssuerPubkey: string
	relays: string[]
}

/**
 * Get (or lazily create) a cached `PlebeianAuctionClient` for a given
 * facilitator pubkey + relay set. Reuses the current `ndk` + `signer`
 * from `ndkActions` — both MUST be present at call time, otherwise we
 * throw rather than silently building a client that can't sign.
 *
 * The returned client is shared. Callers MUST NOT call
 * `client.disconnect()` directly — use `releaseAuctionClient` (which
 * is a no-op) to make intent visible at the call site without
 * actually tearing down the shared socket.
 */
export function getAuctionClient(params: GetAuctionClientParams): PlebeianAuctionClient {
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available — sign in to use the auction client')
	if (!ndk) throw new Error('NDK is not initialised')

	const key = cacheKey(params)
	const existing = cache.get(key)

	// If we already have a client for this key AND the signer is
	// unchanged, reuse. Otherwise rebuild — the signer pubkey is part
	// of the wire identity, so a different account can't reuse the
	// previous account's subscription.
	if (existing) {
		const currentSignerPubkey = readSignerPubkeySync(signer)
		if (!currentSignerPubkey || currentSignerPubkey === existing.signerPubkey) {
			return existing.client
		}
		try {
			existing.client.disconnect()
		} catch {
			// nothing to do — fall through and rebuild
		}
		cache.delete(key)
	}

	const client = new PlebeianAuctionClient({
		signer,
		ndk,
		relays: params.relays,
		serverPubkey: params.pathIssuerPubkey,
	})

	// Resolve the signer pubkey lazily — most signers expose it
	// synchronously via the last-known user, but we don't want to
	// block here. If it's unknown at cache-time we leave it empty;
	// the next call will treat it as "no pin" and reuse.
	const signerPubkeyAtCacheTime = readSignerPubkeySync(signer) ?? ''
	cache.set(key, { client, signerPubkey: signerPubkeyAtCacheTime })
	return client
}

/**
 * Symbolic counterpart to `getAuctionClient`. Intentionally a no-op:
 * the cached client lives until `disposeAllAuctionClients` (logout /
 * HMR / app teardown). Kept so call sites read symmetrically and so
 * we have a single place to tear down per-call state if we ever need
 * to.
 */
export function releaseAuctionClient(_client: PlebeianAuctionClient): void {
	// no-op
}

/**
 * Dispose every cached client. Called by:
 *   - auth logout: the bidder identity is changing, so any subscription
 *     pinned to the previous user's pubkey is now noise;
 *   - HMR teardown (if we ever wire it): keeps WS handles from leaking
 *     across module reloads in development.
 */
export function disposeAllAuctionClients(): void {
	// `Array.from` (rather than `for…of` on the iterator) keeps us
	// compatible with the project's ES5 iterator settings — same reason
	// `nip60.ts` uses `Array.from(map.values())` elsewhere.
	const entries = Array.from(cache.values())
	for (const { client } of entries) {
		try {
			client.disconnect()
		} catch {
			// already torn down
		}
	}
	cache.clear()
}

function cacheKey(params: GetAuctionClientParams): string {
	const sortedRelays = [...params.relays].sort()
	return `${params.pathIssuerPubkey}|${sortedRelays.join(',')}`
}

/**
 * Best-effort sync read of the signer's current pubkey. NDK signers
 * expose `.user()` as async, but most browser-side signers cache the
 * last-known user on `_user`. Returning `null` when unknown is fine —
 * the caller treats that as "no pin" and reuses the cached client.
 */
function readSignerPubkeySync(signer: unknown): string | null {
	if (!signer || typeof signer !== 'object') return null
	const cached = (signer as { _user?: { pubkey?: string } })._user
	return cached?.pubkey ?? null
}
