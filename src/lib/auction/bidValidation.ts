import type { Nut7ProofState } from './constants'
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
	 * keyed by bid event id. When absent, bids fall back to `bid_pending_review`.
	 */
	nut7States?: Map<string, Nut7ProofState>
}

function classifyBid(
	bid: ParsedBidEvent,
	auction: ParsedAuctionEvent,
	verdicts: ParsedValidatorVerdictEvent[],
	nut7States?: Map<string, Nut7ProofState>,
): ClassifiedBid {
	const confirmingVerdicts = verdicts.filter((v) => v.bidEventId === bid.id && auction.auditors.includes(v.validatorPubkey))

	// A `won_pending_settlement` verdict is a strictly stronger assertion than
	// `valid_bid_placed` (the validator confirmed the bid is valid AND is the
	// canonical pending-settlement winner). Kind-30440 is addressable on
	// `d = bidder:auction`, so a validator has exactly one latest verdict per
	// bid — once it upgrades to `won_pending_settlement`, the earlier
	// `valid_bid_placed` is replaced on the relay. Counting only
	// `valid_bid_placed` here would make winner determination break the moment
	// validators publish the settlement-ready state that `publishBidderPathRelease`
	// requires. Treat both as satisfying the valid-bid quorum.
	const validVerdicts = confirmingVerdicts.filter((v) => v.claim === 'valid_bid_placed' || v.claim === 'won_pending_settlement')
	const invalidVerdicts = confirmingVerdicts.filter((v) => v.claim === 'bid_invalid' || v.claim === 'fraudulent_bid')

	if (validVerdicts.length >= auction.auditorQuorum) {
		// B2 + M4 FIX: Use the MINIMUM observedAt across quorum validators, and
		// cap at maxEndAt. Post-close verdicts have observed_at > maxEndAt, which
		// triggers late_arrival + timestamp_skew in validateBid. The earliest
		// validator to confirm the bid is the most reliable timestamp for the
		// bid's acceptance window. Capping at maxEndAt ensures the time-window
		// check in validateBid does not reject bids that were validly placed
		// before the auction closed but only confirmed by some validators
		// after close.
		//
		// M4 security rationale (single-validator veto via observed_at poisoning):
		// A malicious validator could publish a verdict with an artificially
		// inflated observed_at (e.g. far past maxEndAt) to cause validateBid's
		// time-window check to reject an otherwise valid bid, effectively
		// vetoing it. By taking the MINIMUM across quorum validators and capping
		// at maxEndAt, a single validator cannot poison the observed_at to
		// invalidate a bid — at least quorum validators must collude to shift
		// the minimum above maxEndAt, and even then the cap prevents it.
		const minObservedAt = validVerdicts.reduce((min, v) => Math.min(min, v.observedAt), validVerdicts[0]!.observedAt)
		const observedAt = Math.min(minObservedAt, auction.maxEndAt)
		const nut7State = nut7States?.get(bid.id)

		// For ended auctions, NUT-7 spend state is no longer relevant for bid validity.
		// A 'spent' state after settlement means the seller redeemed (expected), not fraud.
		// Default undefined/unknown/spent states to 'unspent' so validateBid doesn't
		// reject bids as 'nut7_unknown' — the publish path
		// (publishAuctionSettlement) legitimately lacks NUT-7 data because it
		// doesn't poll the mint before winner determination; the NUT-7 atomicity
		// pre-check runs later, just before redemption.
		const ended = auction.maxEndAt > 0 && observedAt >= auction.maxEndAt
		const adjustedNut7State = ended
			? nut7State === 'spent' || nut7State == null || nut7State === 'unknown'
				? 'unspent'
				: nut7State
			: nut7State
		return {
			bid,
			classification: 'valid',
			observedAt,
			nut7State: adjustedNut7State,
		}
	}

	if (invalidVerdicts.length > 0) {
		return {
			bid,
			classification: 'invalid',
			observedAt: bid.createdAt,
			invalidReason: invalidVerdicts[0].reason,
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

function computeCanonicalWinner(validBids: ParsedBidEvent[], observedAtByBid: Map<string, number>): ParsedBidEvent | null {
	if (validBids.length === 0) return null

	return validBids.reduce((winner, bid) => {
		if (bid.amount > winner.amount) return bid
		if (bid.amount === winner.amount) {
			const bidObserved = observedAtByBid.get(bid.id) ?? bid.createdAt
			const winnerObserved = observedAtByBid.get(winner.id) ?? winner.createdAt
			if (bidObserved < winnerObserved) return bid
			if (bidObserved === winnerObserved && bid.id < winner.id) return bid
		}
		return winner
	})
}

export function computeValidatedBids(input: ComputeValidatedBidsInput): ValidatedBidSet {
	const { auction, bids, verdicts, nut7States } = input

	// Step 1: Compute legLockedAmount from signed chain before validation.
	computeLegLockedAmounts(bids)

	// M3 FIX: Rebid-chain verdict d-tag collision.
	// Kind-30440 is parameterized replaceable on d = "bidder:auction".
	// When a bidder rebids (same bidder, same auction), the validator
	// publishes a new verdict with the new bidEventId, which REPLACES the
	// old verdict on the relay. The old leg's verdict disappears, so
	// classifyBid can't find it and the old leg becomes 'pending',
	// breaking the validated chain.
	//
	// Fix: Walk the rebid chain backwards. If bid B has a valid verdict
	// and B.prevBidId points to bid A, then the same validators that
	// confirmed B must have also seen and confirmed A (validators process
	// the chain sequentially — they can't validate a rebid without first
	// validating the leg it replaces). We propagate the verdict set
	// backwards so earlier legs inherit the quorum-confirmed status.
	//
	// LIMITATION: This relies on the assumption that validators validate
	// the full chain before emitting a verdict for the latest leg. If a
	// validator only validates the delta without checking the previous
	// leg, this propagation would be unsound. In practice, validateBid
	// requires prevBid context (bidChainLegAmount) and validators fetch
	// the full chain, so this assumption holds. A future schema change
	// to include bidEventId in the d-tag (d = "bidder:auction:bidEventId")
	// would eliminate this issue entirely.
	// TODO(audit-m3): Consider changing d-tag to include bidEventId for
	// per-leg verdict addressability.
	const verdictsByBidId = new Map<string, ParsedValidatorVerdictEvent[]>()
	for (const v of verdicts) {
		const arr = verdictsByBidId.get(v.bidEventId) ?? []
		arr.push(v)
		verdictsByBidId.set(v.bidEventId, arr)
	}
	// Build parent chain map (which bids point to which via prevBidId).
	const parentOf = new Map<string, string | undefined>()
	for (const bid of bids) {
		parentOf.set(bid.id, bid.prevBidId)
	}
	// Propagate verdicts backwards: for each bid that has direct verdicts,
	// walk up the prevBid chain and copy the verdict references to ancestor
	// legs that lack their own direct verdicts.
	const propagatedVerdicts = new Map<string, ParsedValidatorVerdictEvent[]>()
	for (const [bidId, directVerdicts] of verdictsByBidId) {
		// Start with the bid that has direct verdicts
		let currentId: string | undefined = bidId
		const seen = new Set<string>()
		while (currentId && !seen.has(currentId)) {
			seen.add(currentId)
			// Only propagate to ancestor legs that don't have their own direct
			// verdicts (direct verdicts are always preferred).
			if (!verdictsByBidId.has(currentId) && !propagatedVerdicts.has(currentId)) {
				propagatedVerdicts.set(currentId, directVerdicts)
			}
			currentId = parentOf.get(currentId)
		}
	}
	// Merge propagated verdicts into the verdicts list for classification.
	// We create an augmented verdicts array that includes propagated
	// verdicts (with the ancestor bid's id substituted) so classifyBid
	// can find them by bidEventId.
	const augmentedVerdicts: ParsedValidatorVerdictEvent[] = [...verdicts]
	for (const [bidId, props] of propagatedVerdicts) {
		for (const v of props) {
			// Create a verdict copy pointing at the ancestor bid. The
			// observedAt is the same as the descendant's verdict — the
			// validator observed both at approximately the same time.
			augmentedVerdicts.push({ ...v, bidEventId: bidId })
		}
	}

	// Step 2: Classify each bid based on validator quorum (using augmented verdicts).
	const classified = bids.map((bid) => classifyBid(bid, auction, augmentedVerdicts, nut7States))

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
	const observedAtByBid = new Map<string, number>()
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
			currentTopBid: currentTopValidAmount,
			bidChainLegAmount: c.bid.legLockedAmount,
		})

		if (verdict.claim === 'valid_bid_placed') {
			finalValid.push(c.bid)
			observedAtByBid.set(c.bid.id, c.observedAt)
			if (c.bid.amount > currentTopValidAmount) {
				currentTopValidAmount = c.bid.amount
			}
		} else if (verdict.claim === 'bid_invalid') {
			finalInvalid.push(c.bid)
		} else {
			finalPending.push(c.bid)
		}
	}

	const canonicalWinner = computeCanonicalWinner(finalValid, observedAtByBid)

	return {
		classified,
		validBids: finalValid,
		pendingBids: finalPending,
		invalidBids: finalInvalid,
		canonicalWinner,
		currentTopValidAmount,
	}
}
