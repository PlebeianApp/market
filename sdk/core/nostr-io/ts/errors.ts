/**
 * errors.ts — the reason-carrying rejection (`#5ecac1`).
 *
 * Every refusal in the module raises a `RelaySeamError` carrying a `RelayReason`
 * from the contract's own vocabulary, and the module throws nothing else. A
 * reason is an error *condition*, not a class hierarchy: a caller switches on
 * `reason`, and another implementation of the contract spells the same six
 * conditions with its own classes.
 */
import type { RelayReason } from './types'

/** #5ecac1 — RelaySeamError: the module's only error type, a contract reason plus a human-readable message. */
export class RelaySeamError extends Error {
	readonly reason: RelayReason

	constructor(reason: RelayReason, message: string) {
		super(message)
		this.name = 'RelaySeamError'
		this.reason = reason
	}
}
