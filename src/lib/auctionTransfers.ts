/**
 * Auction transfer schemas.
 *
 * Historically this module defined a kind-14 NIP-44 DM topic family for
 * the path-oracle protocol (`auction_path_request_v1`, `auction_path_grant_v1`,
 * `auction_path_release_v1`, `auction_bid_token_v1`, `auction_refund_v1`).
 * The path-oracle has since moved to ContextVM `tools/call` over Nostr per
 * AUCTIONS.md §4.5 / §7.5; the DM topics are no longer the wire format.
 *
 * What remains here:
 *   - `AuctionBidTokenEnvelope` is the canonical shape of the locked-token
 *     payload the bidder hands to the issuer. It used to ride a kind-14
 *     DM; it now rides as the `submit_bid_token` tool's input fields.
 *     The shape is reused by the issuer's inline validator so the
 *     existing helpers (commitment SHA-256 etc.) keep working.
 *   - `AuctionPathGrantEnvelope` is the canonical shape of a grant
 *     response, kept for the §5.6 bidder-side verifier
 *     (`verifyAuctionPathGrantEnvelope` in `auctionPathOracle.ts`) and
 *     its test. The actual transport is now MCP — see
 *     `src/lib/ctxcn-clients/PlebeianServerClient.ts` (generated via
 *     `bunx ctxcn add <facilitator-pubkey>`).
 *
 * Removed: refund / path-request / path-release DM envelope shapes —
 * losers self-refund at locktime under path-oracle, and the request/
 * release exchanges are MCP `tools/call` invocations.
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const parseAuctionBidTokenEnvelope = (value: string): AuctionBidTokenEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_BID_TOKEN_TOPIC) return null
		if (!isNonEmptyString(parsed.auctionEventId) || !isNonEmptyString(parsed.bidEventId)) return null
		if (!isNonEmptyString(parsed.bidderPubkey) || !isNonEmptyString(parsed.sellerPubkey)) return null
		if (!isNonEmptyString(parsed.pathIssuerPubkey) || !isNonEmptyString(parsed.refundPubkey)) return null
		if (!isNonEmptyString(parsed.lockPubkey) || !isNonEmptyString(parsed.token)) return null
		if (!isNonEmptyString(parsed.mintUrl) || !isNonEmptyString(parsed.commitment) || !isNonEmptyString(parsed.bidNonce)) return null
		if (typeof parsed.amount !== 'number' || typeof parsed.totalBidAmount !== 'number' || typeof parsed.locktime !== 'number') return null
		return {
			type: AUCTION_BID_TOKEN_TOPIC,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: typeof parsed.auctionCoordinates === 'string' ? parsed.auctionCoordinates : undefined,
			bidEventId: parsed.bidEventId,
			bidderPubkey: parsed.bidderPubkey,
			sellerPubkey: parsed.sellerPubkey,
			pathIssuerPubkey: parsed.pathIssuerPubkey,
			refundPubkey: parsed.refundPubkey,
			lockPubkey: parsed.lockPubkey,
			locktime: parsed.locktime,
			mintUrl: parsed.mintUrl,
			amount: parsed.amount,
			totalBidAmount: parsed.totalBidAmount,
			commitment: parsed.commitment,
			bidNonce: parsed.bidNonce,
			grantId: typeof parsed.grantId === 'string' ? parsed.grantId : undefined,
			token: parsed.token,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
		}
	} catch {
		return null
	}
}

export const parseAuctionPathGrantEnvelope = (value: string): AuctionPathGrantEnvelope | null => {
	try {
		const parsed = JSON.parse(value)
		if (!isRecord(parsed) || parsed.type !== AUCTION_PATH_GRANT_TOPIC) return null
		if (!isNonEmptyString(parsed.grantId) || !isNonEmptyString(parsed.requestId)) return null
		if (!isNonEmptyString(parsed.auctionEventId) || !isNonEmptyString(parsed.auctionCoordinates)) return null
		if (!isNonEmptyString(parsed.bidderPubkey) || !isNonEmptyString(parsed.pathIssuerPubkey)) return null
		if (!isNonEmptyString(parsed.xpub) || !isNonEmptyString(parsed.derivationPath) || !isNonEmptyString(parsed.childPubkey)) return null
		if (typeof parsed.issuedAt !== 'number' || typeof parsed.expiresAt !== 'number') return null
		return {
			type: AUCTION_PATH_GRANT_TOPIC,
			grantId: parsed.grantId,
			requestId: parsed.requestId,
			auctionEventId: parsed.auctionEventId,
			auctionCoordinates: parsed.auctionCoordinates,
			bidderPubkey: parsed.bidderPubkey,
			pathIssuerPubkey: parsed.pathIssuerPubkey,
			xpub: parsed.xpub,
			derivationPath: parsed.derivationPath,
			childPubkey: parsed.childPubkey,
			issuedAt: parsed.issuedAt,
			expiresAt: parsed.expiresAt,
		}
	} catch {
		return null
	}
}
