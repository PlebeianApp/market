import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import type { AuctionContext } from '../src/server/auction/context'
import { AuctionStateStore } from '../src/server/auction/state-store'

/**
 * Build an `AuctionContext` for the ContextVM server process.
 *
 * Uses the `CVM_SERVER_KEY` signer (same identity the MCP transport
 * announces as `path_issuer`) and an NDK instance pointed at the same
 * relays the SDK's `ApplesauceRelayPool` uses. NDK is a peer to the
 * CVM relay handler, not a substitute — we keep them separate because
 * NDK gives us first-class NIP-44 + sign helpers that we already use
 * across the auction domain modules.
 *
 * Issuer-private rate-limit + dedup state lives in a SQLite database at
 * `AUCTION_STATE_PATH` (default: `./contextvm/data/auction-state.sqlite`).
 *
 * The returned context is cached for the life of the process; first call
 * connects, subsequent calls reuse.
 */

interface BuildContextOptions {
	relays: string[]
	privateKeyHex: string
	stateStorePath?: string
}

let cached: AuctionContext | null = null

export async function buildContextVmAuctionContext(options: BuildContextOptions): Promise<AuctionContext> {
	if (cached) return cached
	const ndk = new NDK({ explicitRelayUrls: options.relays })
	await ndk.connect()
	const signer = new NDKPrivateKeySigner(options.privateKeyHex)
	await signer.blockUntilReady()
	const issuerPubkey = (await signer.user()).pubkey
	const storePath = options.stateStorePath || process.env.AUCTION_STATE_PATH || './contextvm/data/auction-state.sqlite'
	const stateStore = new AuctionStateStore(storePath)
	cached = { ndk, signer, issuerPubkey, stateStore }
	return cached
}
