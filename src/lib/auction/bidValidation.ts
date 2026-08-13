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

	const validVerdicts = confirmingVerdicts.filter((v) => v.claim === 'valid_bid_placed')
	const invalidVerdicts = confirmingVerdicts.filter((v) => v.claim === 'bid_invalid' || v.claim === 'fraudulent_bid')

	if (validVerdicts.length >= auction.auditorQuorum) {
		const observedAt = validVerdicts.reduce((max, v) => Math.max(max, v.observedAt), bid.createdAt)
		const nut7State = nut7States?.get(bid.id)
		return {
			bid,
			classification: 'valid',
			observedAt,
			nut7State,
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

	// Step 2: Classify each bid based on validator quorum.
	const classified = bids.map((bid) => classifyBid(bid, auction, verdicts, nut7States))

	// Step 3: Sort valid candidates chronologically by observedAt for sequential
	// currentTopBid accumulation.
	const validCandidates = classified.filter((c) => c.classification === 'valid').sort((a, b) => a.observedAt - b.observedAt)

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
		if (c.classification === 'pending') {
			finalPending.push(c.bid)
			continue
		}
	}

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
