/**
 * errors.ts — the typed, refusal-cause-carrying rejection (`#029611`).
 *
 * The module's only error type. It carries the whole `ValidationRefusal` — the preset, the
 * check, the closed cause and (for a format) the requirement — and **this is the only thing
 * the module throws**, raised only where an exception is the honest shape: a preset the engine
 * cannot interpret at all. There are exactly three — a comparator outside the closed vocabulary,
 * a `maxChainDepth` above one hop, and a third rule kind — and each is a **host's configuration
 * error**, not a candidate's verdict, so returning a per-candidate refusal for it would quietly
 * blame every candidate for the host's mistake.
 *
 * **Nothing else leaves as a rejection.** Every candidate verdict is a value `validate`
 * returns, and `accept` maps (`#029611`'s amendment: "every outcome is a value a caller
 * reads"); **a bound exceeded is an outcome, never an exception** (D-O25); and a resolver that
 * **rejects or throws** is a reference the host could not answer, which the link half returns as
 * `unresolved` — quarantine — rather than forwarding (`resolve.ts`). This paragraph is the
 * module's throw contract, and the falsification suite holds it to both halves.
 */
import type { ValidationCause, ValidationRefusal } from './types'

/**
 * The module's only error type: the refusal it stands for, plus the cause read directly.
 * `reason` is the four-member `ValidationCause`, so a caller switches on it exactly as the
 * other modules' error types let it.
 */
/** #029611 — ValidationError: the module's only error, a refusal's cause and value. */
export class ValidationError extends Error {
	readonly reason: ValidationCause
	readonly refusal: ValidationRefusal

	constructor(refusal: ValidationRefusal) {
		super(refusal.message)
		this.name = 'ValidationError'
		this.reason = refusal.cause
		this.refusal = refusal
	}
}
