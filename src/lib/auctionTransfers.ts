/**
 * Auction transfer schemas.
 *
 * Historically this module defined a kind-14 NIP-44 DM topic family for
 * the path-oracle protocol (`auction_path_request_v1`, `auction_path_grant_v1`,
 * `auction_path_release_v1`, `auction_bid_token_v1`, `auction_refund_v1`).
 * The path-oracle has since moved to ContextVM `tools/call` over Nostr per
 * AUCTIONS.md §4.5 / §7.5; the DM topics are no longer the wire format.
 *
 * What remains here are pure type shapes (no JSON parsers — those were
 * deleted along with the kind-14 fetch path):
 *   - `AuctionBidTokenEnvelope` is the in-memory shape of the locked
 *     token, kept as a convenient struct for `submit_bid_token`'s
 *     internal validator. The token itself is now persisted on the
 *     path-registry entry's `lockPayload` (AUCTIONS.md §7.5.2).
 *   - `AuctionPathGrantEnvelope` is the canonical shape of a grant
 *     response, used by the §5.6 bidder-side verifier
 *     (`verifyAuctionPathGrantEnvelope` in `auctionPathOracle.ts`) and
 *     its test. The actual transport is MCP — see
 *     `src/lib/ctxcn-clients/PlebeianServerClient.ts` (generated via
 *     `bunx ctxcn add <facilitator-pubkey>`).
 */

export const AUCTION_BID_TOKEN_TOPIC = 'auction_bid_token_v1'
export const AUCTION_PATH_GRANT_TOPIC = 'auction_path_grant_v1'

export interface AuctionBidTokenEnvelope {
	type: typeof AUCTION_BID_TOKEN_TOPIC
	auctionEventId: string
	auctionCoordinates?: string
	bidEventId: string
	bidderPubkey: string
	sellerPubkey: string
	pathIssuerPubkey: string
	refundPubkey: string
	lockPubkey: string
	locktime: number
	mintUrl: string
	amount: number
	totalBidAmount: number
	commitment: string
	bidNonce: string
	grantId?: string
	token: string
	createdAt: number
}

export interface AuctionPathGrantEnvelope {
	type: typeof AUCTION_PATH_GRANT_TOPIC
	grantId: string
	requestId: string
	auctionEventId: string
	auctionCoordinates: string
	bidderPubkey: string
	pathIssuerPubkey: string
	xpub: string
	derivationPath: string
	childPubkey: string
	issuedAt: number
	expiresAt: number
}
