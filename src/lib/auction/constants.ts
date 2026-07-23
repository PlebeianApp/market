/**
 * Auction protocol constants — `cashu_p2pk_bidder_path_v1`.
 *
 * Lives in `src/lib/auction/` (the bidder-held-path scheme's home) to
 * keep it isolated from the legacy `src/lib/auction*.ts` files during
 * the transition. Once Phase 2 deletes the v1 code, this directory's
 * contents will become the canonical auction module.
 *
 * See AUCTIONS.md for the full spec.
 */

import type { NDKFilter } from '@nostr-dev-kit/ndk'

// ---------- Settlement policy --------------------------------------------

/** Value of the auction event's `settlement_policy` tag — see §4.1. */
export const AUCTION_SETTLEMENT_POLICY = 'cashu_p2pk_bidder_path_v1'

/** Value of the auction event's `key_scheme` tag — single supported scheme in v1. */
export const AUCTION_KEY_SCHEME = 'hd_p2pk'

/** Value of the auction event's `auction_type` tag — single supported type in v1. */
export const AUCTION_TYPE_ENGLISH = 'english'

/** Value of the auction event's `currency` tag — single supported currency in v1. */
export const AUCTION_CURRENCY_SAT = 'SAT'

// ---------- Nostr event kinds --------------------------------------------

/**
 * Cast helper for Nostr kind constants. NDKFilter's `kinds` array is typed
 * as a union of the built-in NDKKind enum members; our auction kinds aren't
 * members, so we cast through `unknown` to keep filter usage typesafe.
 */
type AuctionKind = NonNullable<NDKFilter['kinds']>[number]

/** Kind 30408 — auction listing (addressable, seller-signed). §4.1. */
export const AUCTION_KIND = 30408 as unknown as AuctionKind

/** Kind 1023 — bid commitment (regular event, bidder-signed). §4.2. */
export const AUCTION_BID_KIND = 1023 as unknown as AuctionKind

/** Kind 1024 — settlement (regular event, seller-signed). §4.3.2. */
export const AUCTION_SETTLEMENT_KIND = 1024 as unknown as AuctionKind

/** Kind 1025 — path release (regular event, bidder-signed). §4.3.1. */
export const AUCTION_PATH_RELEASE_KIND = 1025 as unknown as AuctionKind

/** Kind 1026 — fallback offer (regular event, seller-signed, optional). §8.3. */
export const AUCTION_FALLBACK_OFFER_KIND = 1026 as unknown as AuctionKind

/** Kind 30440 — validator bid verdict (parameterized replaceable). §4.4.1. */
export const VALIDATOR_VERDICT_KIND = 30440 as unknown as AuctionKind

/** Kind 30441 — validator policy declaration (parameterized replaceable). §4.4.2. */
export const VALIDATOR_POLICY_KIND = 30441 as unknown as AuctionKind

/** Kind 30442 — aggregate bidder reputation (parameterized replaceable, optional). §4.4.4. */
export const BIDDER_AGGREGATE_REPUTATION_KIND = 30442 as unknown as AuctionKind

// ---------- Floor / curve / clock tolerances -----------------------------

/** Project-level minimum cumulative bid amount. Keeps tiny bids above Cashu mint-fee / proof edge cases. */
export const AUCTION_MIN_BID_SATS = 10

/** Minimum amount any bid-chain leg must lock. Applies to rebid deltas. */
export const AUCTION_MIN_BID_LEG_SATS = AUCTION_MIN_BID_SATS

/**
 * Server-side lag tolerance for the bid floor computation — see §6.1.
 *
 * Validators compute the curve floor at
 * `effective_t = clamp(observed_at - GRACE, end_at, max_end_at)` to
 * absorb relay-propagation latency between the bidder clicking "Bid"
 * and the validator receiving the event. A bidder who delays publishing
 * past this window pays the curve at the actual observed time.
 */
export const BID_FLOOR_TIME_GRACE_SECONDS = 5

/** Default `max_skew_sec` when the auction event omits the tag — §4.1. */
export const DEFAULT_MAX_SKEW_SECONDS = 120

/** Default `auditor_quorum` when the auction event omits the tag — §4.1. */
export const DEFAULT_AUDITOR_QUORUM = 1

/**
 * Default ratio of `settlement_grace` after which validators emit
 * `griefed_pending_fallback` if no path release has arrived. The seller
 * uses this signal to start offering the bid to second-highest.
 * Numerator/denominator: emit at `max_end_at + settlement_grace / 2`.
 */
export const FALLBACK_DELAY_NUMERATOR = 1
export const FALLBACK_DELAY_DENOMINATOR = 2

// ---------- HD path entropy ----------------------------------------------

/**
 * Number of non-hardened levels in a bidder-generated derivation path —
 * §5.5. Five levels × 31 random bits = ~155 bits of entropy, which makes
 * brute-forcing the path from `(p2pk_xpub, child_pubkey)` infeasible.
 */
export const AUCTION_PATH_HD_DEPTH = 5

/** Max value for a single non-hardened BIP-32 index (2^31 − 1). */
export const AUCTION_PATH_HD_MAX_INDEX = 0x7fffffff

// ---------- Auction event tag set ----------------------------------------

/**
 * Single-value tags that MUST NOT change once the auction is first
 * published. The seller may publish updates (kind 30408 is addressable),
 * but updates touching any of these are rejected by compliant clients
 * and validators — §4.1.
 */
export const AUCTION_IMMUTABLE_SINGLE_TAGS = [
	'auction_type',
	'start_at',
	'end_at',
	'currency',
	'price',
	'starting_bid',
	'bid_increment',
	'reserve',
	'key_scheme',
	'p2pk_xpub',
	'max_end_at',
	'settlement_grace',
	'min_bid_curve',
	'settlement_policy',
	'schema',
	'auditor_quorum',
	'max_skew_sec',
	'fallback_delay_sec',
] as const

/** Multi-value tags that MUST NOT change once the auction is first published. */
export const AUCTION_IMMUTABLE_MULTI_TAGS = ['mint', 'auditors'] as const

/** Tag name used by bid + settlement events to reference the auction's root event id. */
export const AUCTION_ROOT_EVENT_ID_TAG = 'auction_root_event_id'

// ---------- Settlement statuses ------------------------------------------

/** Bid `status` tag values considered "live" / counted by validators. */
export const ACTIVE_AUCTION_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

/** kind-1024 settlement statuses — §4.3.2. */
export type AuctionSettlementStatus = 'settled' | 'reserve_not_met' | 'cancelled' | 'griefed_no_fallback'

/** kind-1025 path release reasons — §4.3.1. */
export type PathReleaseReason = 'settlement' | 'fallback_settlement' | 'voluntary_late'

// ---------- Validator verdict taxonomy — §4.4.3 ---------------------------

/** All possible `claim` values a validator may emit on a kind-30440 verdict. */
export const VALIDATOR_CLAIMS = [
	// transient (replaced as bid progresses)
	'valid_bid_placed',
	'bid_invalid',
	'bid_pending_review',
	// post-close (terminal-ish)
	'won_pending_settlement',
	'lost_pending_refund',
	'settled_promptly',
	'settled_late',
	'griefed',
	'griefed_pending_fallback',
	'fraudulent_bid',
	'cancelled',
] as const

export type ValidatorClaim = (typeof VALIDATOR_CLAIMS)[number]

/**
 * Standardised machine codes for `bid_invalid` / negative verdicts — §4.4.3.
 * Validators MAY emit additional implementation-specific reasons; compliant
 * clients SHOULD show unknown reasons verbatim rather than ignoring them.
 */
export const VALIDATOR_REASONS = [
	// time-window
	'pre_start',
	'post_end',
	'late_arrival',
	'timestamp_skew',
	// amount/curve
	'under_increment',
	'under_curve',
	// mint / token
	'unsupported_mint',
	'bad_lock',
	'bad_proof_y',
	'proof_spent',
	'proof_missing',
	// signature / structure
	'signature_invalid',
	'replacement_chain_invalid',
	// policy (validator-subjective)
	'relatr_below_threshold',
	'on_blacklist',
	'account_too_young',
	'nip05_unverified',
	'kyc_not_attested',
	'outside_validator_jurisdiction',
] as const

export type ValidatorReason = (typeof VALIDATOR_REASONS)[number]

/** NUT-7 proof-state values as reported by a Cashu mint. */
export type Nut7ProofState = 'unspent' | 'pending' | 'spent' | 'missing' | 'unknown'

// ---------- Schema markers -----------------------------------------------

export const AUCTION_SCHEMA_TAG = 'auction_v1'
export const VALIDATOR_POLICY_SCHEMA_TYPE = 'auction_validator_policy_v1'
export const BIDDER_AGGREGATE_SCHEMA_TYPE = 'auction_bidder_aggregate_v1'

// ---------- d-tag prefixes -----------------------------------------------

/** d-tag prefix for validator policy events (kind 30441). */
export const VALIDATOR_POLICY_D_PREFIX = 'policy:auction'
