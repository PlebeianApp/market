import type { SettlementDescriptor, SettlementPhase } from '@/lib/auction/settlementDescriptor'

/**
 * UI states surfaced by the order-detail settlement card. All of them are
 * derived exclusively from the validated settlement descriptor
 * (`getSettlementDescriptor`, ADR-0003/ADR-0004) — never from raw
 * `settlements[0]` / path-release boolean pairs, because relay-sourced events
 * are untrusted and path release alone is not settlement.
 */
export type OrderSettlementDisplayState =
	| 'Awaiting Settlement'
	| 'Path Release Observed'
	| 'Settlement Event Observed'
	| 'Settled'
	| 'Reserve Not Met'
	| 'Griefed (No Fallback)'
	| 'Cancelled'
	| 'Validating…'

const PHASE_WITH_SETTLEMENT_EVENT: ReadonlySet<SettlementPhase> = new Set<SettlementPhase>(['settled', 'closed'])

/**
 * Map a validated settlement descriptor to the order-card display state.
 *
 * `null` descriptor means "the auction has not ended yet" (the descriptor
 * returns null before the bidding cutoff), which is a legitimate
 * `Awaiting Settlement` state. A separate `Validating…` state exists for
 * cases where the descriptor cannot be produced at all (auction data still
 * loading or unparseable) — the caller surfaces that instead of guessing a
 * wrong status.
 */
export function describeOrderSettlementStatus(descriptor: SettlementDescriptor | null): OrderSettlementDisplayState {
	if (!descriptor) return 'Awaiting Settlement'

	// Completeness validation has not finished cross-checking the settlement
	// against its path release / bid chain yet — do not show a final status.
	if (descriptor.verifiedBadge === 'verifying') return 'Validating…'

	const { phase, verifiedBadge } = descriptor

	// A validated (or accepted-but-unredeemed) settlement event exists.
	if (phase === 'settled') return 'Settled'
	if (phase === 'reserve-not-met') return 'Reserve Not Met'
	// Terminal grief: the winning bidder never released the path and the seller
	// exercised no fallback. Representable without a path release — a path
	// release is not payment proof, and its absence is not proof of payment.
	if (phase === 'griefed-no-fallback') return 'Griefed (No Fallback)'
	if (phase === 'cancelled') return 'Cancelled'

	// Terminal `closed` phase still means a settlement event was observed.
	if (PHASE_WITH_SETTLEMENT_EVENT.has(phase)) return 'Settlement Event Observed'

	// Pre-settlement phases: the verified badge tells us whether a path
	// release (buyer payment) or settlement event has been observed.
	if (verifiedBadge === 'settlement' || verifiedBadge === 'settlement-pending-redemption') return 'Settlement Event Observed'
	if (verifiedBadge === 'path-release') return 'Path Release Observed'
	return 'Awaiting Settlement'
}
