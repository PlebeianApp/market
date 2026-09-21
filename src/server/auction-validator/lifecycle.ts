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
 *      → complete settlement evidence whose release was first observed after
 *        grace → settled_late (terminal). This lifecycle layer owns that
 *        observable timing classification; ingestion only records evidence.
 */

import {
	validateBid,
	validatePathRelease,
	validateSettlementCompleteness,
	type BidChainValidation,
	type BidValidationVerdict,
} from '../../lib/auction/validation'
import type { ParsedPathReleaseEvent, ParsedSettlementEvent } from '../../lib/auction/events'
import type { ValidatorClaim, ValidatorReason } from '../../lib/auction/constants'
import { aggregateProofStates, MAX_REPLACEMENT_CHAIN_DEPTH, type ValidatorAuctionState, type ValidatorBidState } from './state'

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
}

export const deriveVerdict = (input: DeriveVerdictInput): DerivedVerdict => {
	const { auctionState, bidState, now } = input

	// --- Phase 1: pre-close --------------------------------------------------

	if (now <= auctionState.auction.maxEndAt) {
		return derivePreCloseVerdict(auctionState, bidState)
	}

	// Auction has closed. From here on, only valid_bid_placed bids
	// participate in winner determination; bid_invalid bids hold their
	// pre-close verdict (no need to overwrite — losers and invalid bids
	// look the same to settlement consumers).
	const wasValid = bidState.currentClaim === 'valid_bid_placed' || bidState.postCloseDecision !== null

	if (!wasValid) {
		// Bid never reached valid_bid_placed → re-derive the pre-close
		// verdict for a stable, deterministic result (ADR-0012 Phase 1:
		// the verdict is a pure function of the bid, the auction and
		// `observed_at`, so re-deriving is idempotent by construction).
		return derivePreCloseVerdict(auctionState, bidState)
	}

	// --- Phase 2: close & settlement ----------------------------------------

	const sel = selectCanonicalEvidence(auctionState, bidState, now)
	const release = sel?.release

	if (bidState.postCloseDecision === 'loser') {
		// A losing bid refunds at locktime. A `settlement` release for a
		// loser is irrelevant — it may be a spurious publish (the bidder
		// released the wrong bid) or a relay replay of an unrelated release.
		// It is NOT fraud: the loser simply didn't win, and the release
		// doesn't change that. Stay at lost_pending_refund (don't call
		// deriveSettlementVerdict for a `settlement` release —
		// validateReleaseReason would condemn it as "release_reason=settlement
		// is only valid for the winning bid", which is a misuse of the
		// fraudulent_bid claim for a non-fraudulent action).
		//
		// EXCEPTION: a `fallback_settlement` release for a loser IS a valid
		// settlement path (the winner griefed, the fallback offer was
		// extended, and this loser-bidder accepted it). In that case proceed
		// to deriveSettlementVerdict so the fallback bidder can reach
		// settled_promptly.
		if (release && release.releaseReason === 'fallback_settlement') {
			return deriveSettlementVerdict(auctionState, bidState, sel, now)
		}
		return deriveLoserVerdict(auctionState, bidState, now)
	}

	// We're (or might be) the winner. Order matters:
	//   1. If kind-1025 arrived, verify derivation → terminal verdict.
	//   2. Else, if past grace, terminal griefed.
	//   3. Else, if past fallback_delay, griefed_pending_fallback.
	//   4. Else, still won_pending_settlement.

	if (release) {
		return deriveSettlementVerdict(auctionState, bidState, sel, now)
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

/**
 * ADR-0012 Phase 1: the pre-close verdict is a pure function of the bid, the
 * auction and the validator's `observed_at`, plus the validator's published
 * policy. No leading-bid position, no chain graph, no mint evidence.
 *
 * Three pieces of mutable local state used to be threaded in here and are all
 * deliberately gone:
 *
 * - `currentTopBid` fed the leading-bid minimum-increment check. The top bid
 *   depends on which bids a validator happened to observe, so two honest
 *   validators could derive different verdicts for the same bid.
 * - the `prev_bid` chain walk (`deriveBidChainValidation`) condemned a bid
 *   whose parent it had not seen. The chain is the bidder's own replacement
 *   history and a selection/settlement concern (ADR-0012 Phase 2).
 * - a NUT-7 poll of the mint (removed earlier under ADR-0004 and still
 *   bypassed here until Phase 1 deleted the step outright). Proof-state
 *   ownership is the client's; the seller's settlement path applies it over
 *   the winning chain before an irreversible redemption
 *   (`validateBidChainNut7PrePublish`).
 *
 * Re-deriving is therefore idempotent: same inputs, same verdict, every time.
 */
const derivePreCloseVerdict = (auctionState: ValidatorAuctionState, bidState: ValidatorBidState): DerivedVerdict => {
	const verdict: BidValidationVerdict = validateBid({
		auction: auctionState.auction,
		bid: bidState.bid,
		observedAt: bidState.observedAt,
	})

	// validateBid returns a strict union; widen it for the publisher.
	if (verdict.claim === 'valid_bid_placed') return { claim: 'valid_bid_placed' }
	return { claim: 'bid_invalid', reason: verdict.reason, detail: verdict.detail }
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
	sel: { settlement: ParsedSettlementEvent | undefined; release: ParsedPathReleaseEvent | undefined },
	now: number,
): DerivedVerdict => {
	const release = sel.release
	if (!release) return { claim: 'won_pending_settlement' }
	// Read the observed time bound to THIS release event (keyed by release
	// id), so a backdated or later-arriving release cannot inherit a
	// different event's earlier timestamp.
	const releaseObservedAt = auctionState.pathReleaseObservedAt.get(release.id) ?? now
	const releaseValidity = validatePathRelease({
		auction: auctionState.auction,
		bid: bidState.bid,
		release,
		now: releaseObservedAt,
		postCloseDecision: bidState.postCloseDecision,
		fallbackOfferedAt: auctionState.fallbackOfferedAt,
		expectedTokenAmount: deriveBidLegAmount(auctionState, bidState),
		skipCashuTokenCheck: true,
	})
	if (!releaseValidity.isValid) {
		return {
			claim: 'fraudulent_bid',
			reason: 'fraudulent_bid',
			detail: releaseValidity.detail,
		}
	}

	// 2. Seller declaration check: the deterministically selected
	//    settlement must exist and match the redeemed chain before we
	//    publish settled_*. NUT-7 proof-state verification is now the
	//    client's responsibility (ADR-0004) — the validator confirms
	//    settlement via kind-1024 + kind-1025 observation.
	//    sel.settlement is undefined when no authorized
	//    settlement references a valid release for this bid.
	const settlement = sel.settlement
	if (!settlement) {
		return { claim: 'won_pending_settlement' }
	}
	const settlementCompleteness = validateSettlementCompleteness({
		auction: auctionState.auction,
		settlement,
		winningBid: bidState.bid,
		pathRelease: release,
		winningBidClaim: bidState.currentClaim,
		winningBidPostCloseDecision: bidState.postCloseDecision,
		winningBidNut7State: undefined,
		// B1 (ADR-0004): NUT-7 poller removed — pass undefined when no
		// NUT-7 data so settlement completeness doesn't gate on NUT-7.
		winningBidNut7ProofStates: bidState.nut7States.size > 0 ? buildProofStateMap(bidState) : undefined,
		pathReleaseObservedAt: releaseObservedAt,
		bidChain: buildSettlementChain(auctionState, bidState, now),
	})
	if (!settlementCompleteness.isComplete) {
		return { claim: 'won_pending_settlement' }
	}

	// 4. On-time vs. late. Keep the validator's local clock as the source
	//    of truth for lifecycle timing, but use the validated release
	//    timing classification so prompt/late logic is centralised.
	if (settlementCompleteness.releaseTiming === 'late') return { claim: 'settled_late' }
	return { claim: 'settled_promptly' }
}

const buildSettlementChain = (
	auctionState: ValidatorAuctionState,
	bidState: ValidatorBidState,
	now: number,
): Array<{
	bid: ValidatorBidState['bid']
	pathRelease: ParsedPathReleaseEvent
	pathReleaseObservedAt?: number
	nut7State: ReturnType<typeof aggregateProofStates> | undefined
	nut7ProofStates: Map<string, ReturnType<typeof aggregateProofStates>> | undefined
}> => {
	const chain: Array<{
		bid: ValidatorBidState['bid']
		pathRelease: ParsedPathReleaseEvent
		pathReleaseObservedAt?: number
		nut7State: ReturnType<typeof aggregateProofStates> | undefined
		nut7ProofStates: Map<string, ReturnType<typeof aggregateProofStates>> | undefined
	}> = []
	const legs: ValidatorBidState[] = []
	const seen = new Set<string>()
	let current: ValidatorBidState | undefined = bidState
	while (current) {
		if (seen.has(current.bid.id)) break
		if (seen.size >= MAX_REPLACEMENT_CHAIN_DEPTH) break
		seen.add(current.bid.id)
		legs.unshift(current)
		const prevBidId = current.bid.prevBidId?.trim()
		if (!prevBidId) break
		current = auctionState.bids.get(prevBidId)
		if (!current) break
	}
	for (const leg of legs) {
		const pathRelease = selectCanonicalEvidence(auctionState, leg, now).release
		if (!pathRelease) continue
		// B1 (ADR-0004): When no NUT-7 data exists (poller removed), pass
		// undefined so validateSettlementLegNut7States skips the NUT-7
		// spend check — validators observe kind-1024 as proof of redemption.
		const hasNut7Data = leg.nut7States.size > 0
		chain.push({
			bid: leg.bid,
			pathRelease,
			pathReleaseObservedAt: auctionState.pathReleaseObservedAt.get(pathRelease.id),
			nut7State: hasNut7Data ? aggregateProofStates(leg.nut7States, leg.bid.proofYs) : undefined,
			nut7ProofStates: hasNut7Data ? buildProofStateMap(leg) : undefined,
		})
	}
	return chain
}

const buildProofStateMap = (bidState: ValidatorBidState): Map<string, ReturnType<typeof aggregateProofStates>> => {
	const perProof = new Map<string, ReturnType<typeof aggregateProofStates>>()
	for (const proofY of bidState.bid.proofYs) {
		// ADR-0004 §3: never default absent NUT-7 to 'unspent' — only the
		// mint's response may convert a proof state. Skip unset proofs so
		// the completeness check sees them as missing rather than unspent.
		const snapshot = bidState.nut7States.get(proofY.toLowerCase())
		if (snapshot) {
			perProof.set(proofY.toLowerCase(), snapshot.state)
		}
	}
	return perProof
}

const deriveBidLegAmount = (auctionState: ValidatorAuctionState, bidState: ValidatorBidState): number => {
	const prevBidId = bidState.bid.prevBidId?.trim()
	if (!prevBidId) return bidState.bid.amount
	const parent = auctionState.bids.get(prevBidId)
	if (!parent) return bidState.bid.amount
	return bidState.bid.amount - parent.bid.amount
}

/**
 * Deterministically select the canonical (settlement, release) pair for
 * a bid, independent of relay delivery order.
 *
 * Conflicting authorized seller kind-1024 events are triaged
 * settlement-first: among authorized settlements for this bid, prefer
 * those that reference a *valid* authorized release (the seller can only
 * legitimately settle once; a settlement naming an invalid/unknown
 * release is not valid), then tiebreak by earliest `created_at`, then
 * smallest event id — the same deterministic triage applied to releases
 * and winning bids. The canonical release is the one the selected
 * settlement names.
 *
 * Pre-settlement fallback: if no settlement references a valid release,
 * the canonical release is the earliest valid authorized candidate
 * (then earliest invalid — option a: an isolated unusable release still
 * flags `fraudulent_bid` at the verdict layer, but a later valid release
 * supersedes it), and there is no settlement.
 *
 * Note: the `settlement` release reason is valid for the winner at any
 * time (not grace-gated; only `voluntary_late` is), so "release-first"
 * selection would false-negative a legitimate late settlement — hence
 * settlement-first. `observedAt` is bound to the selected release's own
 * first-observed time (keyed by release id), never a different event's.
 */
const selectCanonicalEvidence = (
	auctionState: ValidatorAuctionState,
	bidState: ValidatorBidState,
	now: number,
): { settlement: ParsedSettlementEvent | undefined; release: ParsedPathReleaseEvent | undefined } => {
	const candidates = auctionState.pathReleases.get(bidState.bid.id) ?? []
	if (candidates.length === 0) return { settlement: undefined, release: undefined }

	// Validate each release once (settlement-independent validity).
	const rankedCandidates = candidates
		.map((r) => {
			const observedAt = auctionState.pathReleaseObservedAt.get(r.id) ?? now
			const validity = validatePathRelease({
				auction: auctionState.auction,
				bid: bidState.bid,
				release: r,
				now: observedAt,
				postCloseDecision: bidState.postCloseDecision,
				fallbackOfferedAt: auctionState.fallbackOfferedAt,
				expectedTokenAmount: deriveBidLegAmount(auctionState, bidState),
				skipCashuTokenCheck: true,
			})
			return { release: r, valid: validity.isValid, createdAt: r.createdAt, id: r.id }
		})
		.sort((a, b) => {
			if (a.valid !== b.valid) return a.valid ? -1 : 1
			if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
		})
	const validReleaseIds = new Set(rankedCandidates.filter((r) => r.valid).map((r) => r.id))
	const validReleases = rankedCandidates.filter((r) => r.valid)

	// Authorized settlements for this bid (fallback to the legacy single
	// slot for tests/older seed paths). Keep only those that reference a
	// valid authorized release.
	const allSettlements = auctionState.settlements.length
		? auctionState.settlements
		: auctionState.settlement
			? [auctionState.settlement]
			: []
	const validSettlements = allSettlements
		.filter(
			(s) =>
				s.status === 'settled' && s.winningBidId === bidState.bid.id && s.pathReleaseEventId && validReleaseIds.has(s.pathReleaseEventId),
		)
		.sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

	if (validSettlements.length > 0) {
		const settlement = validSettlements[0]!
		const release = candidates.find((r) => r.id === settlement.pathReleaseEventId)
		return { settlement, release }
	}

	// No settlement references a valid release: release-only fallback.
	// option (a) — if no valid release, the earliest invalid candidate is
	// returned so the verdict layer's fraudulent_bid signal is preserved.
	const fallback = (validReleases.length > 0 ? validReleases : rankedCandidates)[0]
	return { settlement: undefined, release: fallback?.release }
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
 * Assign a close role to a bid that only reached `valid_bid_placed` AFTER the
 * close snapshot ran (`assignCloseRoles` found no valid bids at close time →
 * no winner was picked). This happens on validator restart when relay
 * replay ordering delays a bid's observation past the close moment, or when a
 * bid arrives from a relay that only the restarted validator can see.
 *
 * Rather than unconditionally marking the bid 'loser' (the old behavior,
 * which prevented the highest valid bid from ever becoming the winner),
 * this checks whether the bid is the current `pickWinningBid` winner among
 * all `valid_bid_placed` bids (including this one). If it is → 'winner',
 * and any previously-marked 'winner' is demoted to 'loser' (a higher bid
 * arrived later). If it is not → 'loser'.
 *
 * This is deterministic: `pickWinningBid` sorts by amount (desc), then
 * `created_at` (asc), then `id` (lexical) — so two clients processing the
 * same bid set converge on the same winner regardless of arrival order.
 */
export const assignLateValidLoserRole = (auctionState: ValidatorAuctionState, bidState: ValidatorBidState): boolean => {
	if (!auctionState.closeHandled) return false
	if (bidState.postCloseDecision !== null) return false

	const winner = pickWinningBid(auctionState)
	if (winner === bidState) {
		// This bid is the highest valid bid → it's the winner. Demote any
		// previously-assigned winner (a lower bid that became valid earlier).
		for (const other of Array.from(auctionState.bids.values())) {
			if (other !== bidState && other.postCloseDecision === 'winner') {
				other.postCloseDecision = 'loser'
			}
		}
		bidState.postCloseDecision = 'winner'
	} else {
		bidState.postCloseDecision = 'loser'
	}
	return true
}

// ADR-0012 Phase 1 removed `currentTopValidBidAmount` from this module. Its
// only purpose was to feed `currentTopBid` into the pre-close verdict so the
// leading-bid minimum-increment check had a reference point — a validity rule
// derived from mutable leading-bid state, which is exactly what made two
// honest validators disagree. It also needed an `excludeBidId` workaround so a
// bid was not compared against itself and condemned as `under_increment`.
// Both the rule and the workaround are gone. The running top is a *selection*
// value (ADR-0012 Phase 2, `select()`), not a verdict input.
