/**
 * The V4V zap-payout row status vocabulary — spec
 * `docs/protocol/auction-v4v-zap-payout-v1.md` §8 — as a value, plus the one
 * transition a verification result produces.
 *
 * Pure: no I/O, no clock, no relay, no wallet. The settlement's payout ledger
 * (§7.2) stores these strings; the UI renders exactly one sentence per status
 * (the "D14 discipline" of §8), so the sentences live here, verbatim, in one
 * place, and a test asserts each string equals the spec's wording.
 */

/** The row statuses of §8, in the spec's order. */
export const ZAP_PAYOUT_ROW_STATUSES = [
	'planned',
	'paid',
	'paid_unconfirmed',
	'rolled_up',
	'no_receipt_expected',
	'address_unreachable',
	'not_zap_capable',
	'below_minimum',
	'payment_failed',
	'not_paid',
] as const

export type ZapPayoutRowStatus = (typeof ZAP_PAYOUT_ROW_STATUSES)[number]

/**
 * One sentence per status — verbatim from §8 (double quotes stripped). Every
 * surface that has to explain a row to a human uses this, so the vocabulary has
 * exactly one wording.
 */
const STATUS_SENTENCES: Readonly<Record<ZapPayoutRowStatus, string>> = Object.freeze({
	planned: 'This share is scheduled to be paid when the auction settles.',
	paid: "This share was paid and the recipient's server published a receipt.",
	paid_unconfirmed: 'This share was paid, but no receipt was published yet.',
	rolled_up: 'This share was too small to send on its own and was paid together with another row.',
	no_receipt_expected: 'This destination is a plain Lightning address, so no zap receipt exists.',
	address_unreachable: "The recipient's Lightning address did not answer.",
	not_zap_capable: "The recipient's endpoint does not accept zaps.",
	below_minimum: 'The share is smaller than this endpoint accepts.',
	payment_failed: 'The Lightning payment did not complete.',
	not_paid: 'This share has not been paid.',
})

/** The one sentence that explains this row's state (§8, D14). */
export const describeZapPayoutRowStatus = (status: ZapPayoutRowStatus): string => STATUS_SENTENCES[status]

/**
 * What verification learned about one row.
 *
 * The six flags the spec's verification rules produce (§7.1, §6) are the core.
 * Three optional flags let the *plan* phase and the *attempt* phase be expressed
 * in the same vocabulary, so every one of the ten statuses is reachable here and
 * callers do not invent an eleventh:
 *
 * - `planned` — the row has been planned but the payout has not run yet.
 * - `rolledUp` — the plan folded this row into another payment (§6.2); it has no
 *   zap of its own to verify.
 * - `paymentAttempted` — a payment was actually attempted. Defaults to `true`
 *   (a reachable, in-limits row is attempted), so a caller that says nothing
 *   still gets `payment_failed` rather than the weaker `not_paid`.
 */
export interface ZapPayoutEvidence {
	readonly receiptVerified: boolean
	readonly endpointAnswered: boolean
	readonly zapCapable: boolean
	readonly withinLimits: boolean
	readonly paymentSucceeded: boolean
	readonly receiptExpected: boolean
	readonly planned?: boolean
	readonly rolledUp?: boolean
	readonly paymentAttempted?: boolean
}

/**
 * The precedence, in one place and in one order.
 *
 * The order is worst-fact-first: a healthier fact must never hide a worse one, so
 * each check is placed before any check it could otherwise mask.
 *
 * 1. `planned` — nothing has happened yet, so nothing else is known; reporting a
 *    planned row as a failure would be a lie in the other direction.
 * 2. `rolledUp` — the row was paid as part of another row, so this row has no
 *    payment of its own to succeed, fail or confirm.
 * 3. no answer → `address_unreachable`: the endpoint is the first hard fact.
 * 4. answered, not zap-capable, no receipt expected → `no_receipt_expected`
 *    (the accepted plain-Lightning-address tier, §10 open question 1).
 * 5. answered, not zap-capable, a receipt was expected → `not_zap_capable`.
 * 6. outside the endpoint's min/max → `below_minimum`.
 * 7. not attempted → `not_paid` (never conflated with a failed attempt).
 * 8. attempted and failed → `payment_failed`.
 * 9. paid with a verified receipt → `paid`.
 * 10. paid with a receipt expected but not yet verified → `paid_unconfirmed`:
 *     absent a receipt, `paid` is never claimable (§7.1).
 * 11. paid with no receipt expected at all → `paid`.
 */
export function zapPayoutRowStatusFrom(evidence: ZapPayoutEvidence): ZapPayoutRowStatus {
	if (evidence.planned) return 'planned'
	if (evidence.rolledUp) return 'rolled_up'
	if (!evidence.endpointAnswered) return 'address_unreachable'
	if (!evidence.zapCapable) return evidence.receiptExpected ? 'not_zap_capable' : 'no_receipt_expected'
	if (!evidence.withinLimits) return 'below_minimum'
	if (!evidence.paymentSucceeded) return evidence.paymentAttempted === false ? 'not_paid' : 'payment_failed'
	if (evidence.receiptVerified) return 'paid'
	return evidence.receiptExpected ? 'paid_unconfirmed' : 'paid'
}

/**
 * Terminal *and acceptable* states — the settlement may rest on these.
 *
 * `paid_unconfirmed` counts: the money moved and only the receipt is outstanding,
 * which §7.1 explicitly makes the strongest claim available without one.
 * `rolled_up` counts: the sats were paid, just not as this row's own zap.
 * `no_receipt_expected` counts: a plain Lightning address is a destination the
 * spec accepts paying.
 *
 * Deliberately NOT settled, though all are terminal and the row is finished:
 * `payment_failed`, `address_unreachable`, `not_zap_capable`, `below_minimum`,
 * `not_paid` — the recipient was not paid. `payment_failed` must never be folded
 * into "settled": that fold is exactly how an unpaid row would pass an audit.
 * `planned` is not settled because it is not terminal — it is still pending.
 */
export function isZapPayoutRowSettled(status: ZapPayoutRowStatus): boolean {
	return status === 'paid' || status === 'paid_unconfirmed' || status === 'rolled_up' || status === 'no_receipt_expected'
}
