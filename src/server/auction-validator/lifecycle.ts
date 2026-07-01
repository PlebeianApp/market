/**
 * Pure verdict-derivation rules for the auction validator.
 *
 * Every triggering event (new bid, NUT-7 update, time tick, kind-1025,
 * kind-1024) ultimately funnels through {@link deriveVerdict} which
 * returns "the verdict we should publish right now" for one bid. The
 * publisher diffs against the last-published verdict and only signs +
 * sends when something materially changed.
 *
 * No I/O happens here. Everything is a pure function over the state
 * model + current time. That keeps the lifecycle exhaustively
 * unit-testable: feed in a (state, now) → assert the verdict, no
 * mocks, no relay, no mint.
 *
 * Mental model — three lifecycle phases for any bid:
 *
 *   1. PRE-CLOSE (now ≤ auction.maxEndAt)
 *      → drive bid through §7.1 rule checks; verdicts in
 *        {bid_pending_review, valid_bid_placed, bid_invalid}.
 *
 *   2. CLOSE (now > maxEndAt, before settlement_grace expires)
 *      → highest valid bid → won_pending_settlement
 *        other valid bids → lost_pending_refund
 *        (terminal-invalid bids stay where they are.)
 *      → if winner publishes kind-1025: verify derivation →
 *        settled_promptly (or fraudulent_bid on mismatch).
 *      → if fallback_delay elapses without kind-1025: emit
 *        griefed_pending_fallback (one-shot).
 *
 *   3. POST-GRACE (now > maxEndAt + settlement_grace)
 *      → unsettled winner → griefed (terminal).
 */

import { validateBid, type BidValidationVerdict } from '../../lib/auction/validation'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '../../lib/auctionP2pk'
import type { ValidatorClaim, ValidatorReason } from '../../lib/auction/constants'
import { aggregateProofStates, type ValidatorAuctionState, type ValidatorBidState } from './state'

// ============================================================================
// Public verdict shape
// ============================================================================

/**
 * Result of deriving "what verdict should be published for this bid
 * right now." Discriminated by {@link claim}. `reason` is required on
 * negative claims, optional on lifecycle transitions (it doesn't
 * always carry one), absent on the "passed all checks" claims.
 */
export type DerivedVerdict = {
	claim: ValidatorClaim
	reason?: ValidatorReason | string
	detail?: string
}

/**
 * Whether the publisher should emit a fresh kind-30440 event. True
 * when the derived verdict differs from the last published one in
 * either claim or reason. (We deliberately ignore `detail` changes —
 * those are noise.)
 */
export const verdictChanged = (
	derived: DerivedVerdict,
	currentClaim: ValidatorClaim | null,
	currentReason: ValidatorReason | string | undefined,
): boolean => {
	if (derived.claim !== currentClaim) return true
	if ((derived.reason ?? null) !== (currentReason ?? null)) return true
	return false
}

// ============================================================================
// deriveVerdict — the only entry point callers should need
// ============================================================================

export interface DeriveVerdictInput {
	auctionState: ValidatorAuctionState
	bidState: ValidatorBidState
	/** Validator's own latest local timestamp. Drives close/grace transitions. */
	now: number
	/** Current top valid bid amount on this auction, used by the floor check. */
	currentTopBid?: number
}

export const deriveVerdict = (input: DeriveVerdictInput): DerivedVerdict => {
	const { auctionState, bidState, now, currentTopBid = 0 } = input

	// --- Phase 1: pre-close --------------------------------------------------

	if (now <= auctionState.auction.maxEndAt) {
		return derivePreCloseVerdict(auctionState, bidState, currentTopBid)
	}

	// Auction has closed. From here on, only valid_bid_placed bids
	// participate in winner determination; bid_invalid bids hold their
	// pre-close verdict (no need to overwrite — losers and invalid bids
	// look the same to settlement consumers).
	const wasValid = bidState.currentClaim === 'valid_bid_placed' || bidState.postCloseDecision !== null

	if (!wasValid) {
		// Bid never reached valid_bid_placed → keep its current invalid
		// verdict; re-derive the pre-close verdict so a late-arriving
		// NUT-7 result that came in during the close window still flips
		// it correctly.
		return derivePreCloseVerdict(auctionState, bidState, currentTopBid)
	}

	// --- Phase 2: close & settlement ----------------------------------------

	const release = auctionState.pathReleases.get(bidState.bid.id)

	if (bidState.postCloseDecision === 'loser') {
		return deriveLoserVerdict(auctionState, bidState, now)
	}

	// We're (or might be) the winner. Order matters:
	//   1. If kind-1025 arrived, verify derivation → terminal verdict.
	//   2. Else, if past grace, terminal griefed.
	//   3. Else, if past fallback_delay, griefed_pending_fallback.
	//   4. Else, still won_pending_settlement.

	if (release) {
		return deriveSettlementVerdict(auctionState, bidState, release, now)
	}

	const graceExpires = auctionState.auction.maxEndAt + auctionState.auction.settlementGrace
	if (now >= graceExpires) {
		return { claim: 'griefed', reason: 'griefed' }
	}

	const fallbackElapses = auctionState.auction.maxEndAt + auctionState.auction.fallbackDelaySec
	if (now >= fallbackElapses) {
		return { claim: 'griefed_pending_fallback' }
	}

	return { claim: 'won_pending_settlement' }
}

// ============================================================================
// Pre-close verdict — wraps the §7.1 pipeline
// ============================================================================

const derivePreCloseVerdict = (auctionState: ValidatorAuctionState, bidState: ValidatorBidState, currentTopBid: number): DerivedVerdict => {
	const nut7State = aggregateProofStates(bidState.nut7States, bidState.bid.proofYs)

	const verdict: BidValidationVerdict = validateBid({
		auction: auctionState.auction,
		bid: bidState.bid,
		observedAt: bidState.observedAt,
		nut7State,
		currentTopBid,
		bidChainLegAmount: deriveBidChainLegAmount(auctionState, bidState),
	})

	// validateBid returns a strict union; widen it for the publisher.
	if (verdict.claim === 'valid_bid_placed') return { claim: 'valid_bid_placed' }
	if (verdict.claim === 'bid_pending_review') return { claim: 'bid_pending_review', reason: 'nut7_unknown' }
	return { claim: 'bid_invalid', reason: verdict.reason, detail: verdict.detail }
}

const deriveBidChainLegAmount = (auctionState: ValidatorAuctionState, bidState: ValidatorBidState): number | undefined => {
	const prevBidId = bidState.bid.prevBidId?.trim()
	if (!prevBidId) return undefined
	const previousBidState = auctionState.bids.get(prevBidId)
	if (!previousBidState) return undefined
	if (previousBidState.bid.bidderPubkey.toLowerCase() !== bidState.bid.bidderPubkey.toLowerCase()) return undefined
	return bidState.bid.amount - previousBidState.bid.amount
}

// ============================================================================
// Settlement & loser & grief verdicts
// ============================================================================

const deriveLoserVerdict = (auctionState: ValidatorAuctionState, bidState: ValidatorBidState, now: number): DerivedVerdict => {
	// Losing bidders refund at locktime. Pre-locktime → lost_pending_refund.
	// Post-locktime they can refund unilaterally → same claim (the verdict
	// captures "you didn't win; reclaim your funds"). We don't have an
	// explicit `refunded` transition because we can't observe the
	// post-locktime refund on the auction-relay layer without inspecting
	// the mint, and it doesn't change the auction outcome.
	void auctionState
	void now
	void bidState
	return { claim: 'lost_pending_refund' }
}

const deriveSettlementVerdict = (
	auctionState: ValidatorAuctionState,
	bidState: ValidatorBidState,
	release: { derivationPath: string; childPubkey: string },
	now: number,
): DerivedVerdict => {
	// 1. Cryptographic check: does the revealed path derive to the
	//    bid's child_pubkey? Mismatch → fraudulent bid (the lock pubkey
	//    was never legitimately a child of seller_xpub).
	let derivedChild: string
	try {
		derivedChild = deriveAuctionChildP2pkPubkeyFromXpub(auctionState.auction.p2pkXpub, release.derivationPath)
	} catch (err) {
		return {
			claim: 'fraudulent_bid',
			reason: 'fraudulent_bid',
			detail: `derivation failed: ${err instanceof Error ? err.message : String(err)}`,
		}
	}
	if (derivedChild.toLowerCase() !== release.childPubkey.toLowerCase()) {
		return {
			claim: 'fraudulent_bid',
			reason: 'fraudulent_bid',
			detail: `derive(p2pk_xpub, path)=${derivedChild} ≠ release.child_pubkey=${release.childPubkey}`,
		}
	}
	if (derivedChild.toLowerCase() !== bidState.bid.childPubkey.toLowerCase()) {
		return {
			claim: 'fraudulent_bid',
			reason: 'fraudulent_bid',
			detail: `derive(p2pk_xpub, path)=${derivedChild} ≠ bid.child_pubkey=${bidState.bid.childPubkey}`,
		}
	}

	// 2. Mint-side check: NUT-7 must report at least one proof as spent
	//    for this to be a confirmed settlement. Until that flips we hold
	//    at won_pending_settlement (don't downgrade).
	const aggregate = aggregateProofStates(bidState.nut7States, bidState.bid.proofYs)
	if (aggregate !== 'spent') {
		return { claim: 'won_pending_settlement' }
	}

	// 3. On-time vs. late. The kind-1025 created_at carries the bidder
	//    clock; we use the validator's `now` instead (consistent with
	//    how we treat created_at vs observed_at elsewhere).
	const graceExpires = auctionState.auction.maxEndAt + auctionState.auction.settlementGrace
	if (now > graceExpires) return { claim: 'settled_late' }
	return { claim: 'settled_promptly' }
}

// ============================================================================
// Winner determination — used by the close lifecycle to assign roles
// ============================================================================

/**
 * Pick the winning bid from an auction's currently-`valid_bid_placed`
 * set, applying §8 tie-break:
 *   1. Highest amount.
 *   2. Earliest `created_at`.
 *   3. Lexically smallest bid event id.
 *
 * Returns `null` if no bid passes the bar (reserve_not_met / no_bids).
 *
 * `now` lets the caller decide whether the bid was valid AT close
 * (i.e. ignore late-arriving NUT-7 flips that demoted a bid after
 * max_end_at). For our model the simpler "bid is currently
 * valid_bid_placed" check is fine.
 */
export const pickWinningBid = (auctionState: ValidatorAuctionState): ValidatorBidState | null => {
	const candidates: ValidatorBidState[] = []
	for (const bidState of Array.from(auctionState.bids.values())) {
		if (bidState.currentClaim !== 'valid_bid_placed') continue
		if (bidState.bid.amount < auctionState.auction.reserve) continue
		candidates.push(bidState)
	}
	if (!candidates.length) return null

	candidates.sort((a, b) => {
		if (a.bid.amount !== b.bid.amount) return b.bid.amount - a.bid.amount
		if (a.bid.createdAt !== b.bid.createdAt) return a.bid.createdAt - b.bid.createdAt
		return a.bid.id.localeCompare(b.bid.id)
	})
	return candidates[0]
}

/**
 * Apply close-time role assignment to an auction's bids. Sets
 * `postCloseDecision` on each bid to `'winner'` / `'loser'` based on
 * {@link pickWinningBid}. Idempotent: only runs once per auction
 * (gated on `closeHandled`).
 *
 * Returns the winning bid, if any, so the caller can prioritise its
 * verdict re-publishing.
 */
export const assignCloseRoles = (auctionState: ValidatorAuctionState): ValidatorBidState | null => {
	if (auctionState.closeHandled) return null
	const winner = pickWinningBid(auctionState)
	for (const bidState of Array.from(auctionState.bids.values())) {
		if (bidState.currentClaim !== 'valid_bid_placed') continue
		bidState.postCloseDecision = bidState === winner ? 'winner' : 'loser'
	}
	auctionState.closeHandled = true
	return winner
}

/**
 * Recompute the current top valid bid amount for an auction. Used by
 * pre-close floor checks. Walks live bids and picks the max amount on
 * any that has reached `valid_bid_placed`.
 */
export const currentTopValidBidAmount = (auctionState: ValidatorAuctionState): number => {
	let top = 0
	for (const bidState of Array.from(auctionState.bids.values())) {
		if (bidState.currentClaim !== 'valid_bid_placed') continue
		if (bidState.bid.amount > top) top = bidState.bid.amount
	}
	return top
}
