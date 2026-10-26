/**
 * errors.ts — the reason-carrying refusal (E5, `#f64bec`).
 *
 * Every refusal in this module raises an `EventAccessError` carrying a `Reason` from the
 * contract's own vocabulary, and the module throws nothing else. A reason is an error
 * *condition*, not a class hierarchy: a caller switches on `reason`, and another
 * implementation of the contract spells the same six conditions with its own classes.
 *
 * **The fail-closed filter boundary surfaces this same type.** The endpoint's read
 * rejects a malformed identity filter with a typed refusal (`#f775fb`), and this module
 * hands it back as its own — one implementation of the predicate, reached by a call
 * (D-O5), never a second implementation grown here.
 */
import type { Reason } from './types'

/** #97386c — EventAccessError: the module's only error type [1:1], a contract `Reason` plus a human-readable message. */
export class EventAccessError extends Error {
	readonly reason: Reason

	constructor(reason: Reason, message: string) {
		super(message)
		this.name = 'EventAccessError'
		this.reason = reason
	}
}
