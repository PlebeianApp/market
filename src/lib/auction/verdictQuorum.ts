import { VALIDATOR_CONFIRM_CLAIMS, VALIDATOR_CONDEMN_CLAIMS } from './constants'
import type { ParsedValidatorVerdictEvent } from './events'

/**
 * Result of tallying validator verdicts for a single published bid.
 *
 * `hasPositiveVerdict` / `hasNegativeVerdict` are quorum-gated: they only
 * flip true once the number of distinct configured auditors that confirmed
 * (or condemned) the bid reaches `auditorQuorum`. This mirrors the validator
 * publisher's own quorum semantics (AUCTIONS.md §4.4.3) so the client's
 * "confirmed"/"rejected" UI agrees with the validator's valid/invalid decision.
 */
export interface VerdictQuorumResult {
	/** The newest verdict from a configured auditor for this bid (for display). */
	representativeVerdict: ParsedValidatorVerdictEvent | null
	confirmCount: number
	condemnCount: number
	hasPositiveVerdict: boolean
	hasNegativeVerdict: boolean
	/** A verdict exists, but neither a confirm nor a condemn quorum has formed. */
	hasNeutralVerdict: boolean
}

/**
 * Tally configured-auditor verdicts for one bid into a quorum decision.
 *
 * @param verdicts     Parsed kind-30440 verdicts, newest-first (as returned by
 *                     `fetchAuctionVerdicts`).
 * @param bidEventId   The published kind-1023 bid event id. When provided,
 *                     verdicts are bound to exactly this bid (a rebid's verdict
 *                     cannot leak into an earlier leg and vice-versa).
 * @param validatorPubkeys The auction's configured `auditors` (trusted only).
 * @param auditorQuorum    The auction's `auditor_quorum` (default 1).
 */
export function computeVerdictQuorum(
	verdicts: ParsedValidatorVerdictEvent[],
	bidEventId: string | undefined,
	validatorPubkeys: string[],
	auditorQuorum: number | undefined,
): VerdictQuorumResult {
	const seenValidators = new Set<string>()
	let representative: ParsedValidatorVerdictEvent | null = null
	let confirm = 0
	let condemn = 0

	for (const v of verdicts) {
		// Bind to the exact published bid event, not just the bidder.
		if (bidEventId && v.bidEventId !== bidEventId) continue
		// Only accept verdicts from the auction's configured auditors.
		if (!validatorPubkeys.includes(v.validatorPubkey)) continue
		// Dedupe: one latest verdict per validator (input is newest-first).
		if (seenValidators.has(v.validatorPubkey)) continue
		seenValidators.add(v.validatorPubkey)

		if (!representative) representative = v
		if (VALIDATOR_CONFIRM_CLAIMS.has(v.claim)) confirm++
		else if (VALIDATOR_CONDEMN_CLAIMS.has(v.claim)) condemn++
	}

	const quorum = auditorQuorum && auditorQuorum > 0 ? auditorQuorum : 1
	const hasPositiveVerdict = confirm >= quorum
	const hasNegativeVerdict = condemn >= quorum

	return {
		representativeVerdict: representative,
		confirmCount: confirm,
		condemnCount: condemn,
		hasPositiveVerdict,
		hasNegativeVerdict,
		hasNeutralVerdict: !!representative && !hasPositiveVerdict && !hasNegativeVerdict,
	}
}
