import type { ParsedBidEvent } from './events'
import type { ClassifiedBid, ValidatedBidSet } from './bidValidation'

/**
 * `reserve_not_met` publish guard (ADR-0011 review A2, #1280).
 *
 * Publishing `reserve_not_met` is a TERMINAL, seller-signed statement that an
 * auction closed without reaching its reserve. It must never be published
 * while a bid that meets the reserve still has UNRESOLVED collateral evidence:
 *
 *   - A quorum-confirmed, structurally valid bid can be demoted to `pending`
 *     when its mint keyset could not be fetched (`computeValidatedBids`
 *     classifies "evidence unavailable" as pending — ADR-0011 Decision 6a).
 *     Such a bid is absent from `canonicalWinner`, so a guard that only
 *     inspects the canonical winner silently treats the auction as
 *     reserve-unmet and lets the seller publish a terminal state that
 *     contradicts a reserve-meeting bid which may yet become valid.
 *
 * The fix is to preserve "evidence unavailable" explicitly and RETRY:
 * `kind: 'evidence-unavailable'` means "do not publish yet — re-poll the
 * evidence". It is deliberately narrower than "any pending bid":
 *
 *   - a bid pending because validators have not reached quorum is the
 *     pre-existing situation (`reserve_not_met` remains the seller's tool to
 *     close an auction whose validator quorum never formed), so it does not
 *     block here;
 *   - a bid pending purely because its DLEQ evidence could not be gathered is
 *     temporary infrastructure state, so it does block.
 */
export type ReserveNotMetGuardDecision =
	/** No bid at or above the reserve exists on either side: publish is safe. */
	| { kind: 'clear' }
	/** A canonical winner already meets the reserve — publishing would displace it. */
	| { kind: 'blocked'; winnerBidId: string; winnerAmount: number }
	/** Reserve-meeting bid(s) with unresolved DLEQ evidence — retry, do not publish. */
	| { kind: 'evidence-unavailable'; bidIds: string[]; maxPendingAmount: number }

/**
 * Decide whether `reserve_not_met` may be published for an auction.
 *
 * @param validated the `computeValidatedBids` result for the auction.
 * @param reserve the auction's reserve (sats). `0` means "no reserve".
 */
export function evaluateReserveNotMetGuard(
	validated: Pick<ValidatedBidSet, 'canonicalWinner' | 'classified'>,
	reserve: number,
): ReserveNotMetGuardDecision {
	const winner = validated.canonicalWinner
	if (winner && winner.amount >= reserve) {
		return { kind: 'blocked', winnerBidId: winner.id, winnerAmount: winner.amount }
	}

	const evidenceUnavailableBids: ParsedBidEvent[] = validated.classified.filter(isEvidenceUnavailableReserveBid(reserve)).map((c) => c.bid)

	if (evidenceUnavailableBids.length > 0) {
		return {
			kind: 'evidence-unavailable',
			bidIds: evidenceUnavailableBids.map((bid) => bid.id),
			maxPendingAmount: Math.max(...evidenceUnavailableBids.map((bid) => bid.amount)),
		}
	}

	return { kind: 'clear' }
}

const isEvidenceUnavailableReserveBid =
	(reserve: number) =>
	(c: ClassifiedBid): boolean =>
		c.classification === 'pending' && c.pendingReason === 'dlequ_evidence_unavailable' && c.bid.amount >= reserve
