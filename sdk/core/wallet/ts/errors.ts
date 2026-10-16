/**
 * wallet/ts/errors.ts — the closed error surface.
 *
 * `#6fd585` the acceptance gate refuses a malformed registration fail-closed, with a refusal vocabulary built
 * from two closed enums that interpolates no value: `FundsRegistrationError` names the field it fails on and
 * the reason, and never echoes the offending value. The refund guard names its refusal from the same closed
 * discipline. Every error carries a stable code a caller can branch on.
 */

/** `#6fd585` FundsField — the closed set of registration fields a refusal may name. */
export type FundsField =
	| 'plan'
	| 'operations'
	| 'wrapperId'
	| 'method'
	| 'authorityKind'
	| 'witnessKinds'
	| 'store'
	| 'storeKind'
	| 'reconcileDeadlineMs'
	| 'journalReference'
	| 'ceiling'
	| 'contractVersion'

/** `#6fd585` FundsReason — the closed set of reasons a refusal may name. */
export type FundsReason =
	| 'empty'
	| 'unknown-step'
	| 'duplicate-step'
	| 'no-reconcile-step'
	| 'wrong-projection'
	| 'too-long'
	| 'untrimmed'
	| 'control-character'
	| 'not-in-union'
	| 'missing'
	| 'incomplete'
	| 'not-positive-integer'
	| 'stale-version'
	| 'duplicate-method'
	| 'not-a-function'

/**
 * `#6fd585` FundsRegistrationError — the gate's one fail-closed refusal: constructed from two closed enums, so no
 * value from a caller can reach its message, and a value with a hostile `toString` cannot turn a refusal into
 * a different error.
 */
export class FundsRegistrationError extends Error {
	readonly code = 'funds_registration'
	readonly field: FundsField
	readonly reason: FundsReason

	constructor(field: FundsField, reason: FundsReason) {
		super(`funds registration refused: ${field} ${reason}`)
		this.name = 'FundsRegistrationError'
		this.field = field
		this.reason = reason
	}
}

/** `#92fc64` RefundReason — the closed set of reasons the refund guard may name. */
export type RefundReason = 'duplicate' | 'unresolvable' | 'over-total'

/**
 * `#92fc64` FundsDuplicateRefundError — the refund guard's fail-closed refusal: a second refund set for one
 * order, a purchase set that does not resolve, or a refund above the purchase total. It carries the existing
 * refund set's identity as a property, but its message is a closed pair and interpolates no value.
 */
export class FundsDuplicateRefundError extends Error {
	readonly code = 'funds_duplicate_refund'
	readonly reason: RefundReason
	/** the existing refund set's identity, where one exists — a property, never interpolated into the message */
	readonly existingRefundSetId?: string

	constructor(reason: RefundReason, existingRefundSetId?: string) {
		super(`funds refund refused: ${reason}`)
		this.name = 'FundsDuplicateRefundError'
		this.reason = reason
		this.existingRefundSetId = existingRefundSetId
	}
}

/**
 * `#6fd585` PayAggregatorError — the aggregator's other fail-closed refusals (an unknown set, a stale writer, a
 * claim conflict): a stable code and a message that names the condition.
 */
export class PayAggregatorError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = 'PayAggregatorError'
		this.code = code
	}
}
