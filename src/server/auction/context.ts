import type { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'
import type { AuctionStateStore } from './state-store'

/**
 * Auction-issuer execution context — every persistence and registry
 * function in `src/server/auction/*` takes one of these so the same
 * domain logic can be hosted by any process that knows how to populate
 * the four fields. Today the only host is the ContextVM server in
 * `contextvm/server.ts`, signed with `CVM_SERVER_KEY`.
 *
 * Concretely the context bundles:
 *   - `ndk`          NDK instance connected to the operational relays.
 *   - `signer`       Issuer's NDK signer (NIP-44 encrypt + sign).
 *   - `issuerPubkey` The signer's pubkey, cached for quick comparison
 *                    against the auction event's `path_issuer` tag.
 *   - `stateStore`   Issuer-private SQLite store for rate-limit + dedup
 *                    state. Survives process restarts so a misbehaving
 *                    bidder can't reset their counters by triggering a
 *                    reload.
 */
export interface AuctionContext {
	ndk: NDK
	signer: NDKPrivateKeySigner
	issuerPubkey: string
	stateStore: AuctionStateStore
}
