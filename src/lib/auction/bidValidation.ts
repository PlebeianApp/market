import type { Nut7ProofState, ValidatorClaim } from './constants'
import { VALIDATOR_CONFIRM_CLAIMS, VALIDATOR_CONDEMN_CLAIMS } from './constants'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent } from './events'
import { validateBid } from './validation'

export type BidClassification = 'valid' | 'pending' | 'invalid'

export interface ClassifiedBid {
	bid: ParsedBidEvent
	classification: BidClassification
	observedAt: number
	nut7State?: Nut7ProofState
	invalidReason?: string
}

export interface ValidatedBidSet {
	classified: ClassifiedBid[]
	validBids: ParsedBidEvent[]
	pendingBids: ParsedBidEvent[]
	invalidBids: ParsedBidEvent[]
	canonicalWinner: ParsedBidEvent | null
	currentTopValidAmount: number
}

export interface ComputeValidatedBidsInput {
	auction: ParsedAuctionEvent
	bids: ParsedBidEvent[]
	verdicts: ParsedValidatorVerdictEvent[]
	/**
	 * NUT-7 proof states from the client's own `checkProofStateBatch` query,
	 * keyed by bid event id. These are mint-reported truth values and are
	 * passed through to `validateBid` unmodified: an absent entry stays
	 * unconfirmed and yields `bid_pending_review` (NUT-7 is NEVER defaulted
	 * to `unspent`/`spent`, and NEVER remapped — see ADR-0004 §3).
	 */
	nut7States?: Map<string, Nut7ProofState>
	/**
	 * Whether a structurally-valid `settled` settlement already exists for
	 * this auction. When true, a mint-reported `spent` on a quorum-confirmed
	 * bid is interpreted by THIS FUNCTION (the consumer of the state) as the
	 * expected terminal condition — 'seller already redeemed' for the winner,
	 * or a legitimate post-locktime refund for losers — instead of
	 * pre-settlement fraud. The `nut7State` value itself is never rewritten;
	 * only the valid/invalid decision accounts for the settlement context.
	 * Defaults to false.
	 */
	postSettlement?: boolean
	/**
	 * Optional narrowing for `postSettlement`: the bid ids recorded in the
	 * `settled` settlement (winner + payout legs). When provided, the
	 * terminal-condition interpretation applies ONLY to those bids — a
	 * drained, higher-amount non-settlement bid (pre-settlement fraud the
	 * validators cannot see) stays invalid instead of displacing the real
	 * winner from `canonicalWinner` and breaking the settlement's structural
	 * cross-checks. Pass the ids from `winning_bid` + `payout` tags.
	 */
	settledBidIds?: Set<string>
}

/** Verdict claims that confirm a bid as valid (per AUCTIONS.md §4.4.3). Re-exported from constants so the client quorum screen and the validator publisher agree. */
const CONFIRM_CLAIMS = VALIDATOR_CONFIRM_CLAIMS
/** Verdict claims that condemn a bid as invalid. */
const CONDEMN_CLAIMS = VALIDATOR_CONDEMN_CLAIMS

/**
 * A verdict is quorum-eligible only when the validator's own `observed_at`
 * satisfies the same temporal constraints the validator pipeline enforces
 * (AUCTIONS.md §7.1 T2.3/T2.4, ADR-0003 §2.3):
 *
 *   - `observed_at` inside the auction window `[start_at, max_end_at]`, and
 *   - `|bid.created_at - observed_at| <= max_skew_sec`.
 *
 * This is the anti-poisoning gate for verdict timestamps: a malicious
 * validator that publishes a verdict with an inflated `observed_at` (e.g. far
 * past `max_end_at`) simply fails its own timing check and DOES NOT COUNT
 * toward quorum — the bid stays `pending` rather than becoming `invalid`.
 * One bad validator cannot veto a bid; condemning or confirming requires
 * `auditorQuorum` eligible verdicts, and an honest quorum is achieved
 * independently by the remaining validators. (A validator that poisons
 * timestamps also destroys its own reputation and financial incentive.)
 */
function isQuorumEligibleVerdict(v: ParsedValidatorVerdictEvent, bid: ParsedBidEvent, auction: ParsedAuctionEvent): boolean {
	if (v.observedAt < auction.startAt || v.observedAt > auction.maxEndAt) return false
	if (Math.abs(bid.createdAt - v.observedAt) > auction.maxSkewSec) return false
	return true
}

function classifyBid(
	bid: ParsedBidEvent,
	auction: ParsedAuctionEvent,
	eligibleConfirms: ParsedValidatorVerdictEvent[],
	condemnVerdicts: ParsedValidatorVerdictEvent[],
	nut7States?: Map<string, Nut7ProofState>,
): ClassifiedBid {
	// A `won_pending_settlement` verdict is a strictly stronger assertion than
	// `valid_bid_placed` (the validator confirmed the bid is valid AND is the
	// canonical pending-settlement winner). Both are collected as confirm
	// claims by the caller. Kind-30440 is addressable on
	// `d = bidder:auction:bid` (per-bid, ADR-0003 §4.4.1 amendment), so a
	// validator has exactly one latest verdict per bid. Within a single bid's
	// lifecycle, once the validator upgrades to `won_pending_settlement`, the
	// earlier `valid_bid_placed` is replaced on the relay (same d-tag for the
	// same bid). Counting only `valid_bid_placed` here would make winner
	// determination break the moment validators publish the settlement-ready
	// state that `publishBidderPathRelease` requires.
	if (eligibleConfirms.length >= auction.auditorQuorum) {
		return {
			bid,
			classification: 'valid',
			// The client-side re-run (validateBid below) uses the bid's own
			// signed `created_at` rather than any validator timestamp:
			//   - deterministic across clients (relay verdict timing varies;
			//     signed event data does not — AUCTIONS.md §8 tie-breaks are
			//     created_at-based for the same reason);
			//   - always passes the window/skew checks for an in-window bid;
			//   - the curve floor at placement time is never HIGHER than the
			//     floor quorum validators already accepted at their own
			//     (within-skew) observation times, so no quorum-confirmed bid
			//     can be rejected here by the amount check.
			observedAt: bid.createdAt,
			// NUT-7 is passed through truthfully (ADR-0004 §3): unconfirmed
			// stays unconfirmed, `spent` stays `spent`. Consumer logic below
			// accounts for the settlement context when interpreting it.
			nut7State: nut7States?.get(bid.id),
		}
	}

	// Condemnation also requires quorum. A single `bid_invalid` verdict must
	// not veto a bid (same anti-poisoning principle as the confirm side):
	// structural invalidity is deterministic, so honest validators converge on
	// the same condemnation and quorum forms; a lone malicious validator's
	// condemn verdict leaves the bid `pending` instead of `invalid`.
	if (condemnVerdicts.length >= auction.auditorQuorum) {
		return {
			bid,
			classification: 'invalid',
			observedAt: bid.createdAt,
			invalidReason: condemnVerdicts[0].reason,
		}
	}

	return {
		bid,
		classification: 'pending',
		observedAt: bid.createdAt,
	}
}

function computeLegLockedAmounts(bids: ParsedBidEvent[]): void {
	const bidById = new Map(bids.map((b) => [b.id, b]))

	for (const bid of bids) {
		if (bid.prevBidId) {
			const prevBid = bidById.get(bid.prevBidId)
			if (prevBid) {
				bid.legLockedAmount = bid.amount - prevBid.amount
			}
			// If prevBid not found, legLockedAmount stays as-is (broken chain
			// will be caught by validateBid's chain validation).
		} else {
			bid.legLockedAmount = bid.amount
		}
	}
}

function computeCanonicalWinner(validBids: ParsedBidEvent[]): ParsedBidEvent | null {
	if (validBids.length === 0) return null

	return validBids.reduce((winner, bid) => {
		if (bid.amount > winner.amount) return bid
		if (bid.amount === winner.amount) {
			// Tie-break per AUCTIONS.md §8.0: earliest `created_at` wins,
			// then lexical smallest bid event id. Deterministic — never
			// relay-state-dependent (observed_at varies by relay, so two
			// compliant clients could otherwise display different winners).
			if (bid.createdAt < winner.createdAt) return bid
			if (bid.createdAt === winner.createdAt && bid.id < winner.id) return bid
		}
		return winner
	})
}

export function computeValidatedBids(input: ComputeValidatedBidsInput): ValidatedBidSet {
	const { auction, bids, verdicts, nut7States } = input
	const postSettlement = input.postSettlement ?? false

	// Step 1: Compute legLockedAmount from signed chain before validation.
	computeLegLockedAmounts(bids)

	const bidsById = new Map(bids.map((b) => [b.id, b]))

	// Step 2: Screen verdicts. Only auction auditors count, verdicts are
	// deduplicated per (validator, referenced bid) keeping the latest
	// (kind-30440 is replaceable; multi-relay fetches can return stale copies),
	// and confirm claims must be quorum-eligible (see isQuorumEligibleVerdict).
	const latestByValidatorAndBid = new Map<string, ParsedValidatorVerdictEvent>()
	for (const v of verdicts) {
		if (!auction.auditors.includes(v.validatorPubkey)) continue
		const key = `${v.validatorPubkey}:${v.bidEventId}`
		const existing = latestByValidatorAndBid.get(key)
		if (!existing || (v.createdAt ?? 0) >= (existing.createdAt ?? 0)) {
			latestByValidatorAndBid.set(key, v)
		}
	}

	const eligibleConfirmsByBidId = new Map<string, ParsedValidatorVerdictEvent[]>()
	const condemnByBidId = new Map<string, ParsedValidatorVerdictEvent[]>()
	for (const v of latestByValidatorAndBid.values()) {
		const refBidForScreen = bidsById.get(v.bidEventId)
		if (CONDEMN_CLAIMS.has(v.claim)) {
			if (!refBidForScreen) continue
			if (!isQuorumEligibleVerdict(v, refBidForScreen, auction)) continue
			const arr = condemnByBidId.get(v.bidEventId) ?? []
			arr.push(v)
			condemnByBidId.set(v.bidEventId, arr)
			continue
		}
		if (!CONFIRM_CLAIMS.has(v.claim)) continue
		if (!refBidForScreen) continue
		if (!isQuorumEligibleVerdict(v, refBidForScreen, auction)) continue
		const arr = eligibleConfirmsByBidId.get(v.bidEventId) ?? []
		arr.push(v)
		eligibleConfirmsByBidId.set(v.bidEventId, arr)
	}

	// M3: Rebid-chain verdict backward-propagation (belt-and-braces).
	// Kind-30440 is now parameterized replaceable on d = "bidder:auction:bid"
	// (ADR-0003 §4.4.1 amendment), so each leg has its own replaceable
	// address and a rebid no longer DELETES the prior leg's verdict on the
	// relay — the collision this propagation was originally written to
	// compensate for no longer occurs. The walk is retained as defense-in-
	// depth for mixed-version relay state during rollout (old verdicts with
	// the 2-part d-tag may still be present) and for the edge case where a
	// validator observed a descendant but never published a standalone
	// verdict for an ancestor leg.
	//
	// If bid B has quorum-eligible verdicts and B.prevBidId points to bid A,
	// the same validators that confirmed B must have also seen and confirmed
	// A (validators process the chain sequentially — they can't validate a
	// rebid without first validating the leg it replaces). We propagate the
	// verdict set backwards so earlier legs inherit the quorum-confirmed
	// status. The walk only FILLS ancestors that lack their own eligible
	// verdicts, so once a leg has its own surviving verdict (the norm under
	// the per-bid d-tag scheme) this is a no-op.
	//
	// Propagated verdicts are NOT re-checked for timing eligibility against
	// the ancestor's `created_at`: eligibility was already established
	// against the descendant bid the validator actually observed, and the
	// ancestor's own window membership is enforced by validateBid's
	// `pre_start`/`post_end` checks when the leg is re-validated below.
	// The propagation copies preserve every validator-supplied field
	// (truthful data); only the `bidEventId` routing key is re-pointed.
	//
	// LIMITATION: This relies on the assumption that validators validate
	// the full chain before emitting a verdict for the latest leg. If a
	// validator only validates the delta without checking the previous
	// leg, this propagation would be unsound. In practice, validateBid
	// requires prevBid context (bidChainLegAmount) and validators fetch
	// the full chain, so this assumption holds.
	const parentOf = new Map<string, string | undefined>()
	for (const bid of bids) {
		parentOf.set(bid.id, bid.prevBidId)
	}
	for (const [bidId, directEligible] of [...eligibleConfirmsByBidId]) {
		let currentId = parentOf.get(bidId)
		const seen = new Set<string>([bidId])
		while (currentId && !seen.has(currentId)) {
			seen.add(currentId)
			// Only fill ancestors that have no quorum-eligible verdicts of
			// their own (direct eligible verdicts are always preferred).
			if (!eligibleConfirmsByBidId.has(currentId)) {
				eligibleConfirmsByBidId.set(
					currentId,
					directEligible.map((v: ParsedValidatorVerdictEvent) => ({ ...v, bidEventId: currentId })),
				)
			}
			currentId = parentOf.get(currentId)
		}
	}

	// Step 3: Classify each bid based on validator quorum.
	const classified = bids.map((bid) =>
		classifyBid(bid, auction, eligibleConfirmsByBidId.get(bid.id) ?? [], condemnByBidId.get(bid.id) ?? [], nut7States),
	)

	// M5 FIX: Cross-bid dedup check at parse/classification time.
	// Two different bids in the same auction must not share the same
	// lock_secret or proof_y. If they do, one bid is reusing proofs
	// from another — the bid amount is not cryptographically bound to
	// the proofs, so an attacker could submit a high-amount bid reusing
	// proofs committed in a lower-amount bid. Mark any bid whose
	// lock_secret/proof_y multiset collides with an earlier-observed bid
	// as invalid. We process in order of observedAt (earliest wins).
	// M5: Exclude bids with duplicate proofs (same-bidder only).
	// A bid that claims the same lock_secret/proof_y as an earlier-observed
	// bid from the same bidder is likely reusing proofs committed in a
	// lower-amount bid. Different bidders can legitimately share proof_y
	// values (they lock proofs at the same mint). We process in order of
	// observedAt (earliest wins).
	const seenLockSecretsByBidder = new Map<string, Set<string>>()
	const seenProofYsByBidder = new Map<string, Set<string>>()
	const sortedByObserved = [...classified].sort((a, b) => a.observedAt - b.observedAt)
	const bidsWithDuplicateProofs = new Set<string>()
	for (const c of sortedByObserved) {
		if (c.classification === 'invalid') continue
		const bidder = c.bid.bidderPubkey.toLowerCase()
		const bidderSeenSecrets = seenLockSecretsByBidder.get(bidder) ?? new Set()
		const bidderSeenProofYs = seenProofYsByBidder.get(bidder) ?? new Set()
		let hasDup = false
		for (const secret of c.bid.lockSecrets) {
			if (bidderSeenSecrets.has(secret.toLowerCase())) {
				hasDup = true
				break
			}
		}
		if (!hasDup) {
			for (const proofY of c.bid.proofYs) {
				if (bidderSeenProofYs.has(proofY.toLowerCase())) {
					hasDup = true
					break
				}
			}
		}
		if (hasDup) {
			bidsWithDuplicateProofs.add(c.bid.id)
		} else {
			for (const secret of c.bid.lockSecrets) bidderSeenSecrets.add(secret.toLowerCase())
			for (const proofY of c.bid.proofYs) bidderSeenProofYs.add(proofY.toLowerCase())
			seenLockSecretsByBidder.set(bidder, bidderSeenSecrets)
			seenProofYsByBidder.set(bidder, bidderSeenProofYs)
		}
	}
	// Step 4: Run validateBid for each quorum-confirmed bid, accumulating
	// currentTopBid from previously-validated bids.
	let currentTopValidAmount = 0
	const finalValid: ParsedBidEvent[] = []
	const finalPending: ParsedBidEvent[] = []
	const finalInvalid: ParsedBidEvent[] = []

	for (const c of classified) {
		if (c.classification === 'invalid') {
			finalInvalid.push(c.bid)
			continue
		}
		// M5: Bids with duplicate lock_secret/proof_y are invalid.
		if (bidsWithDuplicateProofs.has(c.bid.id)) {
			finalInvalid.push(c.bid)
			continue
		}
		if (c.classification === 'pending') {
			finalPending.push(c.bid)
			continue
		}
	}

	// Build validCandidates from classified bids that passed M5 duplicate checks.
	const validCandidates = classified
		.filter((c) => c.classification === 'valid' && !bidsWithDuplicateProofs.has(c.bid.id))
		.sort((a, b) => a.observedAt - b.observedAt)

	for (const c of validCandidates) {
		const verdict = validateBid({
			auction,
			bid: c.bid,
			observedAt: c.observedAt,
			nut7State: c.nut7State,
			// ADR-0004: NUT-7 is client-side evidence for pre-settlement fraud
			// detection. A quorum-confirmed bid (validators asserted
			// structural validity) must NOT be blocked by a missing NUT-7
			// poll — the bid is pending REVIEW by validators, not by the
			// mint. Skip the NUT-7 gate here; the actual NUT-7 state is
			// applied separately below for the pre-settlement fraud /
			// post-settlement redemption interpretation.
			skipNut7Check: true,
			currentTopBid: currentTopValidAmount,
			bidChainLegAmount: c.bid.legLockedAmount,
		})

		if (verdict.claim === 'valid_bid_placed') {
			// Structural checks passed. Now apply NUT-7 evidence separately.
			// - `spent` pre-settlement = double-spend fraud → invalid.
			// - `spent` post-settlement (recorded in the settlement) = expected
			//   terminal redemption → valid (see spendExcusable below).
			// - `undefined`/`pending`/`unknown` = no NUT-7 evidence yet → the bid
			//   stays VALID (quorum-confirmed); NUT-7 is fraud-detection evidence,
			//   not a validity gate for a quorum-confirmed bid.
			if (c.nut7State === 'spent') {
				const spendExcusable = postSettlement && input.settledBidIds !== undefined && input.settledBidIds.has(c.bid.id)
				if (spendExcusable) {
					finalValid.push(c.bid)
					if (c.bid.amount > currentTopValidAmount) currentTopValidAmount = c.bid.amount
				} else {
					finalInvalid.push(c.bid)
				}
				continue
			}
			// No NUT-7 evidence, or unspent → valid.
			finalValid.push(c.bid)
			if (c.bid.amount > currentTopValidAmount) {
				currentTopValidAmount = c.bid.amount
			}
			continue
		}

		if (verdict.claim === 'bid_invalid') {
			finalInvalid.push(c.bid)
		} else {
			finalPending.push(c.bid)
		}
	}

	const canonicalWinner = computeCanonicalWinner(finalValid)

	return {
		classified,
		validBids: finalValid,
		pendingBids: finalPending,
		invalidBids: finalInvalid,
		canonicalWinner,
		currentTopValidAmount,
	}
}
