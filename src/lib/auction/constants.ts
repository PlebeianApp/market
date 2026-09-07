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
 * Keep auction kind constants typed as numbers so they work with both
 * nostr-tools events and relay filter builders without importing NDK.
 */
type AuctionKind = number

/** Kind 30408 — auction listing (addressable, seller-signed). §4.1. */
export const AUCTION_KIND = 30408 as AuctionKind

/** Kind 1023 — bid commitment (regular event, bidder-signed). §4.2. */
export const AUCTION_BID_KIND = 1023 as AuctionKind

/** Kind 1024 — settlement (regular event, seller-signed). §4.3.2. */
export const AUCTION_SETTLEMENT_KIND = 1024 as AuctionKind

/** Kind 1025 — path release (regular event, bidder-signed). §4.3.1. */
export const AUCTION_PATH_RELEASE_KIND = 1025 as AuctionKind

/** Kind 1026 — fallback offer (regular event, seller-signed, optional). §8.3. */
export const AUCTION_FALLBACK_OFFER_KIND = 1026 as AuctionKind

/** Kind 30440 — validator bid verdict (parameterized replaceable). §4.4.1. */
export const VALIDATOR_VERDICT_KIND = 30440 as AuctionKind

/** Kind 30441 — validator policy declaration (parameterized replaceable). §4.4.2. */
export const VALIDATOR_POLICY_KIND = 30441 as AuctionKind

/** Kind 30442 — aggregate bidder reputation (parameterized replaceable, optional). §4.4.4. */
export const BIDDER_AGGREGATE_REPUTATION_KIND = 30442 as AuctionKind

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
 * Verdict claims that confirm a bid as valid (per AUCTIONS.md §4.4.3).
 * Shared by the validator publisher (Fix 3: suppress late_arrival
 * downgrades of a prior confirm) and the client quorum screen
 * (`computeValidatedBids`). Kept here so both sides agree on the set.
 */
export const VALIDATOR_CONFIRM_CLAIMS: ReadonlySet<ValidatorClaim> = new Set<ValidatorClaim>(['valid_bid_placed', 'won_pending_settlement'])

/** Verdict claims that condemn a bid as invalid. */
export const VALIDATOR_CONDEMN_CLAIMS: ReadonlySet<ValidatorClaim> = new Set<ValidatorClaim>(['bid_invalid', 'fraudulent_bid'])

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
	'dleq_invalid',
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

// ---------- DLEQ rollout boundary (ADR-0011, Decision 7) ------------------

/** Default rollout boundary — 2026-09-08T00:00:00Z (PR-merge epoch). */
export const DEFAULT_DLEQ_ROLLOUT_START_AT = 1788825600

/**
 * Resolve the rollout boundary from a raw env value, falling back to the
 * default when unset, empty, whitespace, or non-canonical (fail-closed — a
 * malformed value must never enable a MORE permissive boundary). Only a
 * canonical digits-only string (e.g. `"1788825600"` or an explicit `"0"` for
 * immediate rollout) is accepted; everything else (`"0x12AB"`, `"1.79e9"`,
 * negatives, fractions, whitespace) falls back to the default.
 */
export function resolveDleqRolloutStartAt(raw: string | undefined): number {
	if (raw === undefined) return DEFAULT_DLEQ_ROLLOUT_START_AT
	const trimmed = raw.trim()
	if (!/^\d+$/.test(trimmed)) return DEFAULT_DLEQ_ROLLOUT_START_AT
	const parsed = Number(trimmed)
	return Number.isSafeInteger(parsed) ? parsed : DEFAULT_DLEQ_ROLLOUT_START_AT
}

/**
 * Migration boundary for NUT-12 DLEQ bid-time collateral verification.
 *
 * Auctions whose `start_at >= APP_AUCTION_DLEQ_ROLLOUT_START_AT` follow the
 * DLEQ-required path (ADR-0011): every allowlisted mint must advertise NUT-12
 * support (Decision 5) and bids must publish `dleq_proof` tags (Decision 1).
 * Auctions started before this boundary are grandfathered under the legacy
 * non-DLEQ path so live auctions are not broken mid-flight (Decision 7).
 *
 * Overridable via the `APP_AUCTION_DLEQ_ROLLOUT_START_AT` environment variable
 * (epoch seconds), following the repo's `APP_*` convention — see
 * `src/server/runtime.ts`. The default literal is the rollout epoch; operators
 * pin the real value at deploy.
 *
 * NOTE: bundlers inline `process.env.*` at build time for browser bundles, so
 * the fallback must remain a build-time literal (never a runtime lookup). A
 * deploy that wants a different boundary must set the env var at build time or
 * bump `DEFAULT_DLEQ_ROLLOUT_START_AT`.
 */
export const APP_AUCTION_DLEQ_ROLLOUT_START_AT: number = resolveDleqRolloutStartAt(process.env.APP_AUCTION_DLEQ_ROLLOUT_START_AT)

/**
 * True when an auction starting at `startAt` (epoch seconds) must follow the
 * DLEQ-required path (ADR-0011, Decision 7: migration by `start_at`).
 *
 * `startAt` is expected to be a validated non-negative integer epoch (callers
 * pass the field parsed from the auction event, which the bid/auction Zod
 * schemas already normalize). Non-finite input is treated as pre-rollout,
 * which errs toward grandfathering a malformed coordinate rather than failing
 * it open.
 */
export function requiresDleqForAuction(startAt: number): boolean {
	return startAt >= APP_AUCTION_DLEQ_ROLLOUT_START_AT
}
