/**
 * errors.ts — the reason-carrying rejection (E5).
 *
 * Every fail-closed path in the module raises a `StoreError` with a `Reason` from
 * the contract's own set, and the module throws nothing else. A `Reason` is an
 * error *condition*, not a class hierarchy: a caller switches on `reason`, and
 * another implementation of the contract spells the same five conditions with its
 * own classes.
 */
import type { Reason } from './types'

/**
 * #a6d035 — StoreError: the module's only error type, a contract `Reason` plus a human-readable message.
 */
export class StoreError extends Error {
	readonly reason: Reason

	constructor(reason: Reason, message: string) {
		super(message)
		this.name = 'StoreError'
		this.reason = reason
	}
}
