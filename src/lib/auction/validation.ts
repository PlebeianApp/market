/**
 * Pure validation pipeline for kind-1023 bids under
 * `cashu_p2pk_bidder_path_v1` — implements AUCTIONS.md §7.1.
 *
 * "Pure" in two senses:
 *
 * 1. Side-effect-free. {@link validateBid} returns a verdict; the
 *    caller does the network I/O (NUT-7 against the mint, fetching the
 *    auction event, etc.) and feeds the results in.
 *
 * 2. Decoupled from event publishing. The validator process turns the
 *    returned verdict into a kind-30440 event; this module only
 *    decides what the verdict *is*.
 *
 * The pipeline runs in the order specified in §7.1's flowchart and
 * **short-circuits at the first failure** — a bid that's both
 * past-end-window and below-the-curve gets reported as
 * `post_end` (the first check that fails). That keeps the verdict
 * stable: rerunning validation with the same inputs always yields
 * the same verdict, and validators sweeping the bid set produce
 * deterministic results across runs.
 *
 * Failure verdicts always carry a {@link ValidatorReason} via the
 * `reason` field. Successful verdicts carry no reason. Both shapes
 * are discriminated by the `claim` field so callers don't need to
 * type-guard.
 */

import {
	AUCTION_MIN_BID_LEG_SATS,
	AUCTION_MIN_BID_SATS,
	BID_FLOOR_TIME_GRACE_SECONDS,
	type Nut7ProofState,
	type ValidatorClaim,
	type ValidatorReason,
} from './constants'
import type { ParsedAuctionEvent, ParsedBidEvent } from './events'
import { parseAuctionLockSecret } from '../cashu/p2pkSecret'

// ============================================================================
// Public API
// ============================================================================

/**
 * Output of {@link validateBid}. Discriminated by {@link claim}:
 *
 * - `valid_bid_placed`     → bid passes all checks; no `reason`.
 * - `bid_pending_review`   → NUT-7 hadn't returned yet; transient.
 * - `bid_invalid`          → `reason` carries the specific cause.
 */
export type BidValidationVerdict =
	| { claim: 'valid_bid_placed' }
	| { claim: 'bid_pending_review'; reason: 'nut7_unknown' }
	| { claim: 'bid_invalid'; reason: ValidatorReason; detail?: string }

/**
 * Hook for validator-specific policy decisions (relatr score,
 * blacklist, KYC, etc.). Returning `'pass'` is the default; returning
 * `{ reject, reason, detail? }` short-circuits the pipeline and the
 * verdict surfaces with `claim=bid_invalid` and the chosen reason.
 *
 * The hook receives the parsed auction + bid and the validator's own
 * observation timestamp. Policy callouts are wired here (rather than
 * as a post-pipeline step) so a policy-driven reject is indistinguishable
 * from a rule-driven reject in the verdict event — every reason gets
 * the same first-class treatment.
 */
export type PolicyHook = (input: {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	observedAt: number
}) => 'pass' | { reject: true; reason: ValidatorReason; detail?: string }

export interface ValidateBidInput {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	/** Validator's own observation timestamp in unix seconds. NOT the bidder's `created_at`. */
	observedAt: number
	/**
	 * Latest NUT-7 result the validator has for this bid's proof.
	 * `undefined` ≡ the validator hasn't queried yet — pipeline returns
	 * `bid_pending_review`.
	 */
	nut7State?: Nut7ProofState
	/**
	 * Current top valid bid amount on the auction at the moment of
	 * validation. Used by the floor computation. `undefined` means
	 * "no prior bid" → starting_bid is the baseline.
	 */
	currentTopBid?: number
	/**
	 * For a `prev_bid` continuation, the bidder's own replacement-chain
	 * delta (`bid.amount - previous bid amount`). Supplied by callers
	 * that hold the per-auction bid graph.
	 */
	bidChainLegAmount?: number
	/** Optional validator policy hook. */
	policy?: PolicyHook
}

// ============================================================================
// Floor computation — pure
// ============================================================================

const computeFloorMultiplier = (
	atSeconds: number,
	endAt: number,
	maxEndAt: number,
	shape: 'none' | 'linear' | 'exponential',
	peakMultiplier: number,
): number => {
	if (shape === 'none' || peakMultiplier <= 1) return 1
	if (maxEndAt <= endAt) return 1
	if (atSeconds <= endAt) return 1
	if (atSeconds >= maxEndAt) return peakMultiplier
	const tNorm = (atSeconds - endAt) / (maxEndAt - endAt)
	if (shape === 'linear') return 1 + (peakMultiplier - 1) * tNorm
	return Math.pow(peakMultiplier, tNorm)
}

/**
 * Per AUCTIONS.md §6.1. `Math.ceil` so a fractional multiplier still
 * requires the bidder to pay AT LEAST the floor — never less.
 */
export const computeBidFloor = (input: { auction: ParsedAuctionEvent; topBid: number; atSeconds: number }): number => {
	const { auction, topBid, atSeconds } = input
	const baseline =
		topBid > 0 ? topBid + Math.max(auction.bidIncrement, AUCTION_MIN_BID_LEG_SATS) : Math.max(auction.startingBid, AUCTION_MIN_BID_SATS)
	const multiplier = computeFloorMultiplier(
		atSeconds,
		auction.endAt,
		auction.maxEndAt,
		auction.minBidCurve.shape,
		auction.minBidCurve.peakMultiplier,
	)
	return Math.max(0, Math.ceil(baseline * multiplier))
}

// ============================================================================
// validateBid — the §7.1 pipeline
// ============================================================================

/**
 * Run the full §7.1 decision tree against one bid. Pure: same inputs
 * always yield the same verdict. Order of checks matters — see the
 * module docstring on short-circuiting.
 */
export const validateBid = (input: ValidateBidInput): BidValidationVerdict => {
	const { auction, bid, observedAt, nut7State, currentTopBid = 0, bidChainLegAmount, policy } = input

	// --- Step 1: cross-event reference integrity -----------------------------

	if (bid.auctionRootEventId !== auction.rootEventId) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `bid references root ${bid.auctionRootEventId}, auction root is ${auction.rootEventId}`,
		}
	}
	if (bid.auctionCoordinate !== auction.coordinate) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `bid coordinate ${bid.auctionCoordinate} doesn't match auction ${auction.coordinate}`,
		}
	}
	if (bid.sellerPubkey.toLowerCase() !== auction.sellerPubkey.toLowerCase()) {
		return { claim: 'bid_invalid', reason: 'bad_lock', detail: 'bid `p` tag does not match auction seller pubkey' }
	}

	// --- Step 2: time-window checks ------------------------------------------

	if (bid.createdAt < auction.startAt) {
		return { claim: 'bid_invalid', reason: 'pre_start', detail: `created_at=${bid.createdAt} < start_at=${auction.startAt}` }
	}
	if (bid.createdAt > auction.maxEndAt) {
		return { claim: 'bid_invalid', reason: 'post_end', detail: `created_at=${bid.createdAt} > max_end_at=${auction.maxEndAt}` }
	}
	if (observedAt < auction.startAt || observedAt > auction.maxEndAt) {
		return {
			claim: 'bid_invalid',
			reason: 'late_arrival',
			detail: `observed_at=${observedAt} outside [${auction.startAt}, ${auction.maxEndAt}]`,
		}
	}
	if (Math.abs(bid.createdAt - observedAt) > auction.maxSkewSec) {
		return {
			claim: 'bid_invalid',
			reason: 'timestamp_skew',
			detail: `|created_at - observed_at|=${Math.abs(bid.createdAt - observedAt)} > max_skew_sec=${auction.maxSkewSec}`,
		}
	}

	// --- Step 3: mint allowlist ---------------------------------------------

	if (!auction.mints.includes(bid.mint)) {
		return {
			claim: 'bid_invalid',
			reason: 'unsupported_mint',
			detail: `mint ${bid.mint} not in auction allowlist [${auction.mints.join(', ')}]`,
		}
	}

	// --- Step 4: lock secret structure --------------------------------------

	const expectedLocktime = auction.maxEndAt + auction.settlementGrace
	if (bid.locktime !== expectedLocktime) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `bid locktime tag=${bid.locktime}, expected max_end_at+settlement_grace=${expectedLocktime}`,
		}
	}
	if (bid.lockSecrets.length !== bid.proofYs.length) {
		return {
			claim: 'bid_invalid',
			reason: 'bad_lock',
			detail: `lock_secret and proof_y tags must be parallel: ${bid.lockSecrets.length} vs ${bid.proofYs.length}`,
		}
	}
	// Validate every proof's secret independently. All MUST share the same
	// lock parameters — the bidder split their input across multiple
	// denominations but each output proof is its own P2PK lock with its
	// own nonce. Reject the bid if any proof is malformed; we don't want
	// validators to selectively trust subsets of a lock set.
	for (let i = 0; i < bid.lockSecrets.length; i++) {
		const lockParse = parseAuctionLockSecret(bid.lockSecrets[i], {
			expectedLocktime,
			expectedChildPubkey: bid.childPubkey,
			expectedRefundPubkey: bid.refundPubkey,
		})
		if (!lockParse.ok) {
			return {
				claim: 'bid_invalid',
				reason: 'bad_lock',
				detail: `proof ${i + 1}/${bid.lockSecrets.length}: ${lockParse.reason}${lockParse.detail ? `: ${lockParse.detail}` : ''}`,
			}
		}
	}

	// --- Step 5: amount + curve floor ---------------------------------------

	const effectiveT = clamp(observedAt - BID_FLOOR_TIME_GRACE_SECONDS, auction.endAt, auction.maxEndAt)
	const minRequired = computeBidFloor({ auction, topBid: currentTopBid, atSeconds: effectiveT })

	if (bid.amount < minRequired) {
		// Two distinct reasons depending on whether the curve was active.
		const inCurveWindow = observedAt > auction.endAt && auction.minBidCurve.shape !== 'none'
		return {
			claim: 'bid_invalid',
			reason: inCurveWindow ? 'under_curve' : 'under_increment',
			detail: `amount=${bid.amount} < required=${minRequired} (top_bid=${currentTopBid}, t=${effectiveT})`,
		}
	}
	if (bid.prevBidId) {
		if (bidChainLegAmount === undefined) {
			return {
				claim: 'bid_invalid',
				reason: 'replacement_chain_invalid',
				detail: `prev_bid=${bid.prevBidId} context unavailable for replacement-chain validation`,
			}
		}
		if (!Number.isSafeInteger(bidChainLegAmount) || bidChainLegAmount < AUCTION_MIN_BID_LEG_SATS) {
			return {
				claim: 'bid_invalid',
				reason: 'under_increment',
				detail: `replacement-chain delta=${bidChainLegAmount} must be an integer of at least ${AUCTION_MIN_BID_LEG_SATS} sats`,
			}
		}
	}

	// --- Step 6: NUT-7 proof state ------------------------------------------

	switch (nut7State) {
		case undefined:
		case 'unknown':
			return { claim: 'bid_pending_review', reason: 'nut7_unknown' }
		case 'pending':
			return { claim: 'bid_pending_review', reason: 'nut7_unknown' }
		case 'spent':
			// Pre-settlement spent = fake / fraudulent bid. The bidder either
			// controlled the lock pubkey themselves and drained behind the
			// scenes, or the bid was already redeemed somehow. Either way it's
			// invalid for the auction. Reason `proof_spent` covers the
			// not-yet-deemed-fraudulent variant; the fraudulent_bid claim is
			// raised at settlement time when a kind-1025 reveals a path that
			// doesn't derive to the lock pubkey.
			return {
				claim: 'bid_invalid',
				reason: 'proof_spent',
				detail: `mint reports at least one of ${bid.proofYs.length} proof(s) as SPENT (any spent proof invalidates the bid)`,
			}
		case 'unspent':
			// Proceed to policy.
			break
	}

	// --- Step 7: validator-specific policy ----------------------------------

	if (policy) {
		const verdict = policy({ auction, bid, observedAt })
		if (verdict !== 'pass') {
			return { claim: 'bid_invalid', reason: verdict.reason, detail: verdict.detail }
		}
	}

	// --- Step 8: success ----------------------------------------------------

	return { claim: 'valid_bid_placed' }
}

// ============================================================================
// Convenience helpers
// ============================================================================

const clamp = (value: number, min: number, max: number): number => {
	if (value < min) return min
	if (value > max) return max
	return value
}

/**
 * The set of {@link ValidatorClaim} values produced by {@link validateBid}.
 * Validators may later transition these to post-close claims
 * (`won_pending_settlement`, etc.) — that lifecycle is handled by the
 * validator service rather than this module.
 */
export const VALIDATE_BID_CLAIMS: readonly ValidatorClaim[] = ['valid_bid_placed', 'bid_invalid', 'bid_pending_review']
