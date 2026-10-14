/**
 * format.ts — the format half: required tags, cardinalities, value domains and content
 * constraints, all read from the preset's data.
 *
 * The engine's kind blindness is intact here: this file reads the tagname, the count and the
 * value a preset declares, and knows nothing about what any of them mean (`#18faf1` (provenance)).
 *
 * A format is **one rule that may carry several requirements at once** — the shape the spec
 * gives it (`required tags, tag cardinalities, value domains, content constraints`). So the
 * three failures are **distinguishable in the value**, and the difference does not depend on
 * the host having split the requirements into separate checks: every failure names the check
 * it came from **and** the `requirement` that fired (`'missing-tag'`, `'cardinality'`,
 * `'domain'`, `'content'`). The cause stays the closed vocabulary's `'differs'` (the candidate
 * does not match the declared shape) for all four; the requirement is what tells them apart
 * under one `check.id`, because a caller may not be expected to parse a message.
 */
import { byteLength } from './bounds'
import type { FormatCheck, Event, ValidationCause, ValidationRequirement } from './types'

/** What a failed format check reports: the closed cause, the requirement that fired, and the message. */
/** #e4b72f — FormatFailure: a failed format check's cause, requirement and message. */
export interface FormatFailure {
	readonly cause: ValidationCause
	readonly requirement: ValidationRequirement
	readonly message: string
}

/** How many tags of this name the candidate carries. */
function occurrences(event: Event, tag: string): number {
	return event.tags.filter((candidate) => candidate[0] === tag).length
}

/**
 * Evaluate one format check against a candidate. Returns `undefined` when the candidate
 * conforms, or the failure the refusal carries. **Nothing is repaired**: the candidate is read
 * and never written (`#0df9fb`).
 */
/** #7efb71 — evaluateFormat: evaluate one format check against a candidate. */
export function evaluateFormat(check: FormatCheck, event: Event): FormatFailure | undefined {
	for (const requirement of check.requires ?? []) {
		const count = occurrences(event, requirement.tag)
		if (count < requirement.atLeast) {
			return {
				cause: 'differs',
				requirement: 'missing-tag',
				message: `check ${check.id} requires at least ${requirement.atLeast} ${requirement.tag} tag(s); the candidate carries ${count}`,
			}
		}
		if (requirement.atMost !== undefined && count > requirement.atMost) {
			return {
				cause: 'differs',
				requirement: 'cardinality',
				message: `check ${check.id} allows at most ${requirement.atMost} ${requirement.tag} tag(s); the candidate carries ${count}`,
			}
		}
	}
	for (const domain of check.domains ?? []) {
		for (const candidate of event.tags) {
			if (candidate[0] !== domain.tag) continue
			const value = candidate[1] ?? ''
			if (!domain.values.includes(value)) {
				return {
					cause: 'differs',
					requirement: 'domain',
					message: `check ${check.id}: the ${domain.tag} value ${value} is outside the declared domain (${domain.values.join(', ')})`,
				}
			}
		}
	}
	if (check.maxContentBytes !== undefined) {
		const size = byteLength(event.content)
		if (size > check.maxContentBytes) {
			return {
				cause: 'differs',
				requirement: 'content',
				message: `check ${check.id} allows at most ${check.maxContentBytes} content byte(s); the candidate carries ${size}`,
			}
		}
	}
	return undefined
}
