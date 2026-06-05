/**
 * Parsed shapes of the auction protocol's Nostr events under
 * `cashu_p2pk_bidder_path_v1`. See AUCTIONS.md §4 for the on-wire tag
 * layout; the types here are what callers see after Zod-parsing a raw
 * `NDKEvent` (parsers live in `src/lib/schemas/auction/*`).
 *
 * Naming convention: each `Parsed<Kind>Event` reflects ONE parsed
 * Nostr event of the named kind. The raw `NDKEvent` is kept on
 * `.rawEvent` so callers can still reach for signature checks, raw
 * tag access, or republish.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { AuctionSettlementStatus, Nut7ProofState, PathReleaseReason, ValidatorClaim, ValidatorReason } from './constants'

// =========================================================================
// kind 30408 — Auction listing (seller-signed, addressable) — §4.1
// =========================================================================

export type MinBidCurveShape = 'none' | 'linear' | 'exponential'

export interface MinBidCurve {
	shape: MinBidCurveShape
	/** Multiplier applied to the baseline floor at `t = max_end_at`. */
	peakMultiplier: number
	/** Raw tag value, for diagnostics. `''` when the tag is absent. */
	raw: string
}

export interface ParsedAuctionEvent {
	rawEvent: NDKEvent

	// Identity
	/** `d` tag — seller-chosen auction identifier. */
	dTag: string
	/** Seller's nostr pubkey (event author). */
	sellerPubkey: string
	/** Addressable coordinate `30408:<seller>:<d>`. */
	coordinate: string
	/**
	 * Root event id for this auction. Equals the event's own id for the
	 * first publish; subsequent updates carry the original id in the
	 * `auction_root_event_id` tag.
	 */
	rootEventId: string

	// Display
	title: string
	summary?: string
	content: string

	// Bidding parameters
	auctionType: 'english'
	startAt: number
	endAt: number
	maxEndAt: number
	settlementGrace: number
	currency: 'SAT'
	reserve: number
	startingBid: number
	bidIncrement: number
	minBidCurve: MinBidCurve

	// Cashu / key
	settlementPolicy: 'cashu_p2pk_bidder_path_v1'
	keyScheme: 'hd_p2pk'
	/** Allowed mints — at least one required. */
	mints: string[]
	/** Seller-published HD xpub used to derive per-bid `seller_child` pubkeys. */
	p2pkXpub: string

	// Validator config
	/** Validator pubkeys whose verdicts compliant clients consult for this auction. */
	auditors: string[]
	/** How many of the listed auditors must agree on `valid_bid_placed` for a bid to count. */
	auditorQuorum: number
	/** Max allowed difference between `bid.created_at` and the validator's `observed_at`. */
	maxSkewSec: number
	/**
	 * Seconds after `max_end_at` at which validators emit
	 * `griefed_pending_fallback` if no path release has arrived. Defaults
	 * to `settlement_grace / 2` when the tag is absent — §4.1.
	 */
	fallbackDelaySec: number

	// Bookkeeping
	vadiumRatioBps: number
	schema: string
}

// =========================================================================
// kind 1023 — Bid commitment (bidder-signed) — §4.2
// =========================================================================

export interface ParsedBidEvent {
	rawEvent: NDKEvent

	// Identity
	/** Bid event id. */
	id: string
	/** Bidder pubkey (event author). */
	bidderPubkey: string
	/** Bidder-claimed event timestamp (advisory; validators use observed_at). */
	createdAt: number

	// Auction reference
	/** Root event id of the referenced auction. */
	auctionRootEventId: string
	/** Auction coordinate `30408:<seller>:<d>`. */
	auctionCoordinate: string
	/** Seller pubkey copied from the auction event. */
	sellerPubkey: string

	// Bid value
	amount: number
	currency: 'SAT'
	mint: string

	// Lock
	/** P2PK locktime in unix seconds — MUST equal `max_end_at + settlement_grace`. */
	locktime: number
	/** Bidder's own secp256k1 refund pubkey (compressed hex). */
	refundPubkey: string
	/** Pubkey appearing in the lock script — should equal `derive(p2pk_xpub, path)`. */
	childPubkey: string
	/**
	 * The Cashu proofs' NUT-10 well-known P2PK secret strings, one per
	 * proof making up the bid lock. All entries share the same P2PK
	 * lock parameters (pubkey, locktime, refund) — only the per-proof
	 * `nonce` differs — but each must be parsed and validated
	 * independently because each is a separate redeemable proof at the
	 * mint. The bid event emits one `lock_secret` tag per entry, in
	 * order; the parser reassembles them into this array.
	 */
	lockSecrets: string[]
	/**
	 * `Y = hash_to_curve(secret)` for each proof making up the lock.
	 * The Cashu mint accepts these as the lookup key for proof-state
	 * queries (NUT-7) and `CheckStatePayload.Ys` takes them as a batch.
	 * MUST be parallel to {@link lockSecrets} (same length, same order).
	 */
	proofYs: string[]

	// Bookkeeping
	createdForEndAt: number
	bidNonce: string
	keyScheme: 'hd_p2pk'
	status: 'locked'
	prevBidId?: string
	note?: string
}

// =========================================================================
// kind 1025 — Path release (bidder-signed) — §4.3.1
// =========================================================================

export interface ParsedPathReleaseEvent {
	rawEvent: NDKEvent

	/** Path release event id. */
	id: string
	/** Bidder pubkey (event author). */
	bidderPubkey: string
	createdAt: number

	/** Bid event id this release applies to. */
	bidEventId: string
	/** Auction coordinate the bid belongs to. */
	auctionCoordinate: string
	/** Seller pubkey the path is intended for. */
	sellerPubkey: string

	/** The derivation path now revealed. BIP-32 style, e.g. `m/123/456/789/...`. */
	derivationPath: string
	/** Equals the bid event's `child_pubkey`. Lets observers verify without fetching the bid. */
	childPubkey: string

	releaseReason: PathReleaseReason
	/** Optional kind-30440 verdict id(s) the bidder is responding to. */
	auditorRefs: string[]
	/** Optional kind-1026 fallback offer id, present for fallback settlements. */
	fallbackOfferId?: string
	content: string
}

// =========================================================================
// kind 1024 — Settlement (seller-signed) — §4.3.2
// =========================================================================

export interface AuctionFallbackChainEntry {
	bidEventId: string
	status: 'griefed' | 'declined' | 'accepted' | 'refunded_at_locktime'
}

export interface ParsedSettlementEvent {
	rawEvent: NDKEvent

	id: string
	sellerPubkey: string
	createdAt: number

	auctionRootEventId: string
	auctionCoordinate: string

	status: AuctionSettlementStatus
	closeAt: number
	winningBidId?: string
	winnerPubkey?: string
	finalAmount: number

	/** Id of the kind-1025 the seller acted on (required when status=settled). */
	pathReleaseEventId?: string
	/** Fallback cascade history (when the original winner griefed). */
	fallbackChain: AuctionFallbackChainEntry[]
	/** Machine-readable reason for cancelled / failure outcomes. */
	reason?: string
}

// =========================================================================
// kind 1026 — Fallback offer (seller-signed, optional) — §8.3
// =========================================================================

export interface ParsedFallbackOfferEvent {
	rawEvent: NDKEvent

	id: string
	sellerPubkey: string
	createdAt: number

	auctionCoordinate: string
	/** Bid the seller is now offering to settle (typically the second-highest). */
	bidEventId: string
	/** Bidder being offered the settlement. */
	offeredToPubkey: string
	/** Deadline (unix seconds) by which the offered bidder must publish kind-1025. */
	deadline: number
	content: string
}

// =========================================================================
// kind 30440 — Validator bid verdict (parameterized replaceable) — §4.4.1
// =========================================================================

export interface ParsedValidatorVerdictEvent {
	rawEvent: NDKEvent

	id: string
	validatorPubkey: string
	createdAt: number

	// Replaceable key components
	/** Format: `<bidder_pubkey>:<auction_root_event_id>`. */
	dTag: string
	bidderPubkey: string
	auctionRootEventId: string
	auctionCoordinate: string
	/** The most recent kind-1023 bid event id this verdict refers to. */
	bidEventId: string

	claim: ValidatorClaim
	/** Validator's own observation timestamp (NOT the bidder's `created_at`). */
	observedAt: number
	/** Required when `claim ∈ { bid_invalid, fraudulent_bid }` etc. */
	reason?: ValidatorReason | string
	/** Most recent NUT-7 state the validator saw for the bid's proof. */
	nut7State?: Nut7ProofState
	nut7ObservedAt?: number

	/** Free-form JSON content the validator may attach (notes, threshold values, etc.). */
	contentJson?: unknown
}

// =========================================================================
// kind 30441 — Validator policy declaration — §4.4.2
// =========================================================================

export interface ValidatorPolicyDocument {
	type: 'auction_validator_policy_v1'
	relatrMinScore?: number
	requireNip05?: boolean
	minAccountAgeDays?: number
	blacklist?: string[]
	blacklistRefs?: string[]
	requiredAttestors?: string[]
	categoryAllowlist?: string[]
	categoryDenylist?: string[]
	maxAcceptableSkewSec?: number
	griefingDecayDays?: number
	notes?: string
}

export interface ParsedValidatorPolicyEvent {
	rawEvent: NDKEvent

	id: string
	validatorPubkey: string
	createdAt: number

	/** d-tag, typically `policy:auction:v1` or `policy:auction:<scope>`. */
	dTag: string
	name: string
	policy: ValidatorPolicyDocument
}

// =========================================================================
// kind 30442 — Aggregate bidder reputation (optional) — §4.4.4
// =========================================================================

export interface BidderAggregateReputationDocument {
	type: 'auction_bidder_aggregate_v1'
	windowDays: number
	bids_valid: number
	bids_invalid: number
	wins_settled: number
	wins_griefed: number
	wins_fraudulent: number
	updatedAt: number
}

export interface ParsedBidderAggregateReputationEvent {
	rawEvent: NDKEvent

	id: string
	validatorPubkey: string
	createdAt: number

	/** d-tag: `<bidder_pubkey>`. */
	dTag: string
	bidderPubkey: string
	aggregate: BidderAggregateReputationDocument
}
