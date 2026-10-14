/**
 * resolve.ts — the link half: read a reference, call the injected resolver, and map the
 * answer to the outcome vocabulary.
 *
 * Five rules from the spec are visible here:
 *
 * - **A malformed reference is refused by this module's own reading, never repaired**
 *   (`#0df9fb`). The module reads the reference's *shape* against the strategy the preset
 *   declares (id · coordinate · id-with-coordinate-fallback) and never a kind's meaning; an
 *   absent or ill-shaped reference is `'malformed-reference'`.
 * - **A link follows the occurrence its preset names** — the element at `index` of the
 *   **first** tag named `tag` — and exactly one reference per link check. The event-level
 *   fan-out bound is therefore a bound on **resolutions attempted**, which is what the spec's
 *   gloss for bound 1 says; counting the event's tag occurrences instead would cap a quantity
 *   the engine never produces and quarantine a candidate for tags it would never have read.
 * - **An unanswered reference is quarantined, not refused** (D-O25): the port's `undefined`
 *   means *nobody could answer it* — and so does a resolver that **rejects** or throws, which
 *   is a reference the host could not answer rather than a candidate's verdict, so no
 *   rejection escapes this module (an outcome, never an exception). A reference that was
 *   answered and disagreed (a different fact) is the only thing that becomes `'differs'`.
 * - **A comparator outside the closed vocabulary is a preset the engine cannot interpret**,
 *   and it is refused **here, when the link check is reached and before any resolution** — the
 *   same way whatever the candidate's state, rather than one behaviour for a held reference and
 *   another for an unresolved or deleted one (the order's adjustment 1).
 * - **The engine interprets no kind-specific semantics** (`#18faf1` (provenance)): a comparison reads the
 *   named field of the candidate and of the referenced event, and not even an `e` tag's fourth
 *   element is read, because its meaning is the preset's to declare.
 *
 * The bound bookkeeping lives here too: the per-reference budget (a bounded wait), the chain
 * depth ceiling, and the revisit gate of bound 6 — all of them producing an **unresolved**
 * result, which is an outcome and never a rejection.
 */
import { DEADLINE, withDeadline, type UnresolvedStore } from './bounds'
import { ValidationError } from './errors'
import type {
	Comparator,
	Event,
	FieldRef,
	LinkCheck,
	LinkComparison,
	ReferenceStrategy,
	Resolution,
	ValidationBounds,
	ValidationCause,
} from './types'

/** A reference id: 32 bytes of lower-case hex, NIP-01's shape and no kind's meaning. */
const ID = /^[0-9a-f]{64}$/
/** An address coordinate: `kind:pubkey:d`, `d` possibly empty for a normal replaceable event. */
const COORDINATE = /^[0-9]+:[0-9a-f]{64}:.*$/

/**
 * The one reference value a link names: the element at `index` of the **first** tag named
 * `tag`. One link reads one reference, and this is the occurrence the preset names — never a
 * walk over the event's other tags of that name.
 */
/** #c7e678 — referenceValue: the one reference a link names, element `index` of the first `tag`. */
export function referenceValue(event: Event, tag: string, index: number): string | undefined {
	const found = event.tags.find((candidate) => candidate[0] === tag)
	return found?.[index]
}

/**
 * Every reference value the engine would **actually resolve** for these links, in preset
 * order: one per link check, from the occurrence each link names, skipping the links whose
 * reference the candidate does not carry. This is the quantity bound 1 caps — *resolutions
 * attempted per event* — and not the event's tag occurrences, which the engine never resolves.
 */
/** #77d411 — collectReferenceValues: every reference the engine would resolve, one per link check. */
export function collectReferenceValues(event: Event, links: readonly LinkCheck[]): string[] {
	const out: string[] = []
	for (const link of links) {
		const value = referenceValue(event, link.tag, link.index)
		if (value !== undefined) out.push(value)
	}
	return out
}

/** Is the reference a well-formed one for the strategy the preset declared? Shape only, never meaning. */
/** #d10f8b — wellFormed: is the reference well-formed for the declared strategy, shape only. */
export function wellFormed(value: string, strategy: ReferenceStrategy): boolean {
	if (strategy === 'by-id') return ID.test(value)
	if (strategy === 'by-coordinate') return COORDINATE.test(value)
	return ID.test(value) || COORDINATE.test(value)
}

/** One named field of an event, as a single value, or `undefined` when the field is absent. */
/** #c7e678 — fieldValue: one named field of an event as a single value. */
export function fieldValue(event: Event, field: FieldRef): string | undefined {
	if (typeof field !== 'string') return referenceValue(event, field.tag, field.index)
	if (field === 'id') return event.id
	if (field === 'pubkey') return event.pubkey
	if (field === 'kind') return String(event.kind)
	return event.content
}

/** One named field of an event as every value it carries — the list `'in'` compares against. */
/** #c7e678 — fieldValues: one named field as every value it carries. */
export function fieldValues(event: Event, field: FieldRef): string[] {
	if (typeof field === 'string') {
		const value = fieldValue(event, field)
		return value === undefined ? [] : [value]
	}
	return event.tags
		.filter((candidate) => candidate[0] === field.tag)
		.map((candidate) => candidate[field.index])
		.filter((value): value is string => value !== undefined)
}

/** A human-readable name for a field, for the refusal message. */
function describe(field: FieldRef): string {
	return typeof field === 'string' ? field : `${field.tag}[${field.index}]`
}

/** Is this comparison satisfied by the candidate and the referenced event? */
function satisfied(comparison: LinkComparison, candidate: Event, reference: Event): boolean {
	const left = fieldValue(candidate, comparison.candidate)
	const right = fieldValue(reference, comparison.reference)
	if (comparison.comparator === 'eq') return left !== undefined && left === right
	if (comparison.comparator === 'exists') return left !== undefined && right !== undefined
	return left !== undefined && fieldValues(reference, comparison.reference).includes(left)
}

/** The comparators the engine carries; anything else is a preset the engine cannot interpret (decision 5). */
const VOCABULARY: readonly Comparator[] = ['eq', 'exists', 'in']

/**
 * The preset's own precondition, checked **when the link check is reached and before any
 * resolution**: a comparison naming a comparator the vocabulary does not carry makes the
 * **preset** uninterpretable, so the engine raises `ValidationError` for it as a host
 * configuration error. Checking it here — rather than after a reference has resolved — is what
 * makes the same bad preset fail the same way against every candidate: unresolved, deleted and
 * held alike. It is never a per-candidate refusal, because refusing every candidate would blame
 * the wrong party for the host's mistake (the order's adjustment 1).
 */
function assertVocabulary(check: LinkCheck, preset: string): void {
	for (const comparison of check.compare ?? []) {
		if (!VOCABULARY.includes(comparison.comparator)) {
			throw new ValidationError({
				preset,
				check,
				cause: 'malformed-reference',
				message: `check ${check.id} names the comparator '${String(comparison.comparator)}', which the vocabulary (eq, exists, in) does not carry`,
			})
		}
	}
}

/** The link half's result, before the validator maps it to an outcome. */
/** #77d411 — LinkResult: the link half's result before the validator maps it. */
export type LinkResult =
	| { readonly kind: 'accepted' }
	| { readonly kind: 'refused'; readonly cause: ValidationCause; readonly message: string }
	| { readonly kind: 'unresolved'; readonly reference: string }

/** Everything the link half needs, all of it injected by the validator. */
/** #77d411 — LinkDeps: everything the link half needs, all injected. */
export interface LinkDeps {
	readonly preset: string
	readonly resolve: ((reference: string) => Promise<Resolution | undefined>) | undefined
	readonly clock: { now(): number }
	readonly bounds: ValidationBounds
	readonly store: UnresolvedStore
}

/**
 * Evaluate one link check. The order of the checks is the spec's, with the preset judged
 * **before** the candidate: the comparator vocabulary is checked the moment the link check is
 * reached (a preset the engine cannot interpret fails there, before any resolution, whatever
 * the candidate's state); then the reference is read, a malformed one refused, and — within the
 * bounds — resolved and compared. A reference that cannot be answered inside the bounds is
 * `unresolved`, whatever cut it off — a fired deadline, an `undefined` answer, or a resolver
 * that rejected.
 */
/** #77d411 — evaluateLink: evaluate one link check, the preset before the candidate. */
export async function evaluateLink(check: LinkCheck, event: Event, deps: LinkDeps): Promise<LinkResult> {
	// The preset first, the candidate second: a comparator outside the vocabulary is a host's
	// error, and it is refused here — at the preset, before any resolution — so the same bad
	// preset fails identically however the candidate's reference would have resolved.
	assertVocabulary(check, deps.preset)

	const reference = referenceValue(event, check.tag, check.index)
	if (reference === undefined) {
		return {
			kind: 'refused',
			cause: 'malformed-reference',
			message: `check ${check.id} names ${check.tag}[${check.index}], which the candidate does not carry`,
		}
	}
	if (!wellFormed(reference, check.strategy)) {
		return {
			kind: 'refused',
			cause: 'malformed-reference',
			message: `check ${check.id}: the reference ${reference} is not a well-formed ${check.strategy} reference`,
		}
	}

	// Bound 6 — the revisit gate: a reference already held is not retried inside the interval,
	// and not retried at all once the count is spent. Both are unresolved, not a refusal.
	const now = deps.clock.now()
	if (deps.store.has(reference)) {
		if (!deps.store.shouldRevisit(reference, now, deps.bounds.revisitIntervalMs)) {
			return { kind: 'unresolved', reference }
		}
		if (!deps.store.canRevisit(reference, deps.bounds.revisitCount)) {
			return { kind: 'unresolved', reference }
		}
	}

	// No resolver at all is nobody could answer it — quarantine, never refusal.
	if (deps.resolve === undefined) {
		deps.store.record(reference, now)
		return { kind: 'unresolved', reference }
	}

	// Bound 3 — the per-reference budget: a bounded wait, and a fired deadline is a value.
	// A resolver that **rejects** — or throws before it ever returns a promise — is a reference
	// the host could not answer: `unresolved`, exactly like an `undefined` answer, and never a
	// rejection escaping this module. `withDeadline` forwards the work's own rejection (the
	// composition's other waiters want it); this module reads it as "nobody could answer it".
	let bounded: Resolution | undefined | typeof DEADLINE
	try {
		bounded = await withDeadline(deps.resolve(reference), deps.bounds.referenceTimeoutMs)
	} catch {
		deps.store.record(reference, now)
		return { kind: 'unresolved', reference }
	}
	if (bounded === DEADLINE) {
		deps.store.record(reference, now)
		return { kind: 'unresolved', reference }
	}
	if (bounded === undefined) {
		deps.store.record(reference, now)
		return { kind: 'unresolved', reference }
	}
	if (bounded.state === 'deleted') {
		deps.store.forget(reference)
		return { kind: 'refused', cause: 'deleted', message: `check ${check.id}: the referenced event ${reference} was deleted` }
	}
	if (bounded.state === 'expired') {
		deps.store.forget(reference)
		return { kind: 'refused', cause: 'expired', message: `check ${check.id}: the referenced event ${reference} has expired` }
	}

	deps.store.forget(reference)
	for (const comparison of check.compare ?? []) {
		if (!satisfied(comparison, event, bounded.event)) {
			return {
				kind: 'refused',
				cause: 'differs',
				message: `check ${check.id}: the candidate's ${describe(comparison.candidate)} does not satisfy '${comparison.comparator}' against the referenced event's ${describe(comparison.reference)}`,
			}
		}
	}
	return { kind: 'accepted' }
}
