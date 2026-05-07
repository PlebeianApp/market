import { z } from 'zod'

/**
 * Zod input/output schemas for the `english_auction_path_oracle_v1`
 * ContextVM tool family. Names + shapes are part of the CEP-15 schema
 * hash, so they MUST stay stable across implementations — bumping any
 * field requires a `_v2` tool name. Doc/annotation fields (`describe`,
 * defaults) are stripped during hash normalisation, so we can iterate
 * on those freely.
 *
 * Caller identity (`bidderPubkey` / `sellerPubkey`) is intentionally NOT
 * an input — the server injects it from the wrapping kind-25910 / 1059
 * signer via `injectClientPubkey: true`. This closes the §7.5.1 identity
 * hole (a caller can't lie about who they are).
 */

// -- request_path --------------------------------------------------------

export const requestPathInputSchema = {
	auctionEventId: z.string().describe('Root event id of the kind-30408 auction listing.'),
	auctionCoordinates: z.string().describe('Auction coordinate `30408:<seller-pubkey>:<d-tag>`.'),
	bidderRefundPubkey: z
		.string()
		.regex(/^0[23][0-9a-f]{64}$/i)
		.describe('Compressed secp256k1 pubkey (33 bytes hex, 02/03 prefix) used in the NUT-11 refund condition.'),
	intendedAmount: z
		.number()
		.int()
		.positive()
		.describe('Bidder-claimed bid amount in sats. Used by the anti-snipe floor and the grant→lock binding.'),
}

export const requestPathOutputSchema = {
	grantId: z.string().describe('Server-issued opaque id; echo back in submit_bid_token.'),
	derivationPath: z.string().describe('HD path the issuer assigned. Bidder MUST verify per AUCTIONS.md §5.6.'),
	childPubkey: z.string().describe('Compressed secp256k1 pubkey used as the P2PK lock key.'),
	xpub: z.string().describe('Echo of the auction `p2pk_xpub` for bidder-side verification.'),
	pathIssuerPubkey: z.string().describe('Issuer Nostr pubkey (server identity).'),
	issuedAt: z.number().int().describe('Unix seconds.'),
	expiresAt: z.number().int().describe('Unix seconds. Grant is invalid for submit_bid_token after this point.'),
	acceptedFloor: z
		.number()
		.int()
		.describe('Floor enforced when this grant was issued. Equals `intendedAmount` for now; server uses this in chain-validity checks.'),
}

// -- submit_bid_token ---------------------------------------------------

export const submitBidTokenInputSchema = {
	auctionEventId: z.string(),
	auctionCoordinates: z.string(),
	bidEventId: z.string().describe('Id of the kind-1023 commitment event the bidder just published.'),
	grantId: z.string().describe('Echo of the request_path grantId.'),
	lockPubkey: z.string().describe('P2PK lock pubkey actually used in the proofs. MUST equal grant.childPubkey.'),
	refundPubkey: z.string().regex(/^0[23][0-9a-f]{64}$/i),
	mintUrl: z.string().url().describe('Cashu mint URL of the locked proofs. MUST be in the auction allowlist.'),
	amount: z.number().int().positive().describe('This bid leg amount in sats.'),
	totalBidAmount: z.number().int().positive().describe('Bidder cumulative bid total in sats (sum of leg amounts).'),
	commitment: z.string().describe('Hex SHA-256 of the encoded token; matches the kind-1023 `commitment` tag.'),
	bidNonce: z.string(),
	locktime: z.number().int().describe('Cashu P2PK locktime; MUST equal `max_end_at + settlement_grace`.'),
	token: z.string().describe('Encoded Cashu token containing the locked proofs.'),
}

export const submitBidTokenOutputSchema = {
	bidEventId: z.string(),
	registryStatus: z.enum(['locked', 'rejected']),
	rejectReason: z.string().optional().describe('Present iff registryStatus === "rejected". Stable, machine-readable code.'),
}

// -- request_settlement -------------------------------------------------

export const requestSettlementInputSchema = {
	auctionEventId: z.string(),
	auctionCoordinates: z.string().optional(),
}

const releaseEntrySchema = z.object({
	bidEventId: z.string(),
	derivationPath: z.string(),
	childPubkey: z.string(),
	bidderPubkey: z.string(),
	mintUrl: z.string(),
	amount: z.number().int(),
	totalBidAmount: z.number().int(),
	commitment: z.string(),
	locktime: z.number().int(),
	refundPubkey: z.string(),
	token: z.string().describe('Encoded Cashu token; seller redeems with the derived child privkey.'),
})

export const requestSettlementOutputSchema = {
	status: z.enum(['settled', 'reserve_not_met', 'cancelled']),
	closeAt: z.number().int(),
	reserve: z.number().int().nonnegative(),
	finalAmount: z.number().int().nonnegative(),
	winningBidEventId: z.string().describe('Empty string when no winner.'),
	winnerPubkey: z.string().describe('Empty string when no winner.'),
	releaseId: z.string().optional(),
	releases: z.array(releaseEntrySchema).describe('One entry per leg of the winning bid chain. Empty for non-settled outcomes.'),
}

// -- get_auction_state --------------------------------------------------

export const getAuctionStateInputSchema = {
	auctionEventId: z.string(),
}

export const getAuctionStateOutputSchema = {
	phase: z.enum(['scheduled', 'active', 'closing', 'ended']),
	startAt: z.number().int(),
	endAt: z.number().int(),
	effectiveEndAt: z.number().int(),
	maxEndAt: z.number().int(),
	currentFloor: z
		.number()
		.int()
		.describe('Minimum acceptable bid amount at server-now per the auction `bid_increment` and (future) anti-snipe curve.'),
	topBidAmount: z.number().int().nonnegative(),
	bidCount: z.number().int().nonnegative(),
	pathsIssued: z.number().int().nonnegative(),
	pathsLocked: z.number().int().nonnegative(),
}

/**
 * Tool name constants — referenced by both the server-side registration
 * and the CEP-15 `withCommonToolSchemas` decorator. Hard-coding strings
 * twice is the kind of drift that breaks schema-hash interoperability.
 */
export const AUCTION_TOOL_NAMES = {
	requestPath: 'request_path',
	submitBidToken: 'submit_bid_token',
	requestSettlement: 'request_settlement',
	getAuctionState: 'get_auction_state',
} as const

export type AuctionToolName = (typeof AUCTION_TOOL_NAMES)[keyof typeof AUCTION_TOOL_NAMES]
