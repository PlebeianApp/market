/**
 * bounds.ts — the six bounds as declared values, their per-preset override, the bounded wait,
 * and the unresolved-reference book with oldest-first eviction **recorded as data loss**.
 *
 * **A bound is on how long this module waits for a resolver the host injected, never on the
 * network it does not touch** (`#4b58be` (provenance); the bound itself `#e80b77`, D-O25's bounded half): the module still
 * opens nothing, and the timer below is the wait's, not a socket's. **A bound that is exceeded
 * is an outcome, not an exception** — a reference the bound cuts off is *unresolved*, which is
 * the quarantine outcome, and no rejection escapes.
 *
 * The suggested defaults and their reasoning are
 * `runs/2026-09-30-first-usable-version/research/11-event-to-event-link-protocol.md` §4; they
 * are declared here as values a test reads rather than as constants in a loop (the order's
 * decision 4).
 */
import type { UnresolvedBook, ValidationBounds, ValidationPreset } from './types'

/**
 * The declared defaults (research §4): ten links per event, one chain hop, five seconds for
 * one reference, thirty seconds for one event, one mebibyte of held unresolved references,
 * three revisits five minutes apart.
 */
/** #e80b77 — DEFAULT_BOUNDS: the declared defaults, 10/1/5s/30s/1MiB and three revisits. */
export const DEFAULT_BOUNDS: ValidationBounds = Object.freeze({
	maxReferencesPerEvent: 10,
	maxChainDepth: 1,
	referenceTimeoutMs: 5_000,
	eventTimeoutMs: 30_000,
	unresolvedMemoryBytes: 1_048_576,
	revisitCount: 3,
	revisitIntervalMs: 300_000,
})

/** The effective bounds for one evaluation: the base, with the preset's own override on top. */
/** #e80b77 — mergeBounds: the effective bounds, the base with a preset's override. */
export function mergeBounds(base: ValidationBounds, override: Partial<ValidationBounds>): ValidationBounds {
	return { ...base, ...override }
}

/** The effective bounds a preset runs under, from a validator's declared base. */
/** #e80b77 — boundsFor: the effective bounds a preset runs under. */
export function boundsFor(preset: ValidationPreset, base: ValidationBounds): ValidationBounds {
	return mergeBounds(base, preset.bounds ?? {})
}

/**
 * The UTF-8 byte length of a reference. A helper rather than `.length`, because the memory bound
 * is stated in **bytes** and a multi-byte character in a `d`-tag coordinate must not be
 * undercounted. It is counted over code points in the language's own terms, so the module reads
 * **no host global** to do it (`#8e6079`).
 */
/** #bd3b66 — byteLength: the UTF-8 byte length of a reference, counted over code points. */
export function byteLength(value: string): number {
	let bytes = 0
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0
		bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
	}
	return bytes
}

/** A sentinel for a fired deadline, so a bounded wait is a **value** rather than a rejection. */
/** #e80b77 — DEADLINE: the fired-deadline sentinel, a value rather than a rejection. */
export const DEADLINE = Symbol('validation deadline')

/**
 * How many evicted reference names the book keeps. Bound 5 bounds the memory held for
 * unresolved references; the record of what was evicted is a **loss log**, and a loss log that
 * grows without bound is the same leak it exists to prove absent — so the count is exact and the
 * names are this many, most recent last. The declaration is here, as a value a test reads,
 * rather than as a literal in the eviction loop.
 */
/** #fb9a0a — EVICTION_RECORD_LIMIT: how many evicted names the loss record keeps. */
export const EVICTION_RECORD_LIMIT = 8

/**
 * Bound a promise by a wall-clock budget — the `withDeadline` pattern `event-access`'s
 * composition already uses (a sentinel resolved on timeout). The **deadline** never rejects: a
 * fired deadline is the `DEADLINE` sentinel, which the link half maps to `unresolved`. The
 * **work** promise's own rejection is forwarded, deliberately, because that is the generic
 * helper's job and the composition wants it; the link half catches it and reads it as "the
 * host could not answer this reference", which is quarantine — so nothing escapes this module
 * through a bound. A work promise that settles after the deadline wins is still handled, so a
 * late failure is never an unhandled rejection.
 */
/** #e80b77 — withDeadline: bound a promise by a wall-clock budget, a fired deadline a value. */
export function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T | typeof DEADLINE> {
	return new Promise<T | typeof DEADLINE>((resolve, reject) => {
		let settled = false
		const timer = setTimeout(() => {
			settled = true
			resolve(DEADLINE)
		}, deadlineMs)
		work.then(
			(value) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				resolve(value)
			},
			(error: unknown) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

/** One held unresolved reference: what it costs, when it was first and last tried, how many attempts. */
interface Held {
	bytes: number
	firstAt: number
	lastAttemptAt: number
	revisits: number
}

/**
 * **The unresolved-reference book** (bound 5, and the revisit record of bound 6). It is
 * session-scoped: it lives in memory in the validator, survives no restart and needs no
 * durable storage (`#029611`'s amendment — "quarantine is session-scoped"), and it is a value
 * a test reads through `Validator.unresolved`.
 *
 * Eviction is **oldest-first and recorded**: when the byte bound is hit, the oldest reference
 * is removed and its name is written into `evictions` — recorded as data loss, never a silent
 * drop. An evicted reference is **re-resolved, not forgotten**: because it has left the book,
 * the next evaluation calls the port again for it rather than remembering it as unresolved.
 *
 * **The loss record is bounded too.** `evictionCount` counts every eviction; `evictions` keeps
 * only the most recent `EVICTION_RECORD_LIMIT` names. A record that grew with every eviction
 * would make the "memory held for unresolved references" bound bound one structure while
 * leaking another, which is the defect this shape exists to rule out.
 */
/** #fb9a0a — UnresolvedStore: the session-scoped unresolved-reference book. */
export class UnresolvedStore {
	private readonly held = new Map<string, Held>()
	private readonly history: string[] = []
	private evicted = 0
	private bytes = 0
	private limitBytes: number

	constructor(limitBytes: number = DEFAULT_BOUNDS.unresolvedMemoryBytes) {
		this.limitBytes = limitBytes
	}

	/** The bound in force for this evaluation (a preset may override it). */
	limit(limitBytes: number): void {
		this.limitBytes = limitBytes
	}

	/** The book, as a value a test reads. */
	get book(): UnresolvedBook {
		return {
			references: [...this.held.keys()],
			bytes: this.bytes,
			limitBytes: this.limitBytes,
			evictionCount: this.evicted,
			evictions: [...this.history],
		}
	}

	has(reference: string): boolean {
		return this.held.has(reference)
	}

	/** Is enough time past since the last attempt for a revisit? (bound 6's interval) */
	shouldRevisit(reference: string, now: number, intervalMs: number): boolean {
		const entry = this.held.get(reference)
		return entry !== undefined && now - entry.lastAttemptAt >= intervalMs
	}

	/** Is there revisit budget left? (bound 6's count) */
	canRevisit(reference: string, count: number): boolean {
		const entry = this.held.get(reference)
		return entry !== undefined && entry.revisits < count
	}

	/**
	 * Record one unanswered attempt: a new reference enters with its cost, an existing one has
	 * its attempt and revisit count advanced. Before a new reference enters, the oldest entries
	 * are evicted until it fits — each eviction recorded, oldest first.
	 */
	record(reference: string, now: number): void {
		const existing = this.held.get(reference)
		if (existing !== undefined) {
			existing.revisits += 1
			existing.lastAttemptAt = now
			return
		}
		const bytes = byteLength(reference)
		while (this.bytes + bytes > this.limitBytes && this.held.size > 0) {
			const oldest = this.held.keys().next().value
			if (oldest === undefined) break
			const entry = this.held.get(oldest)
			if (entry === undefined) break
			this.held.delete(oldest)
			this.bytes -= entry.bytes
			this.evicted += 1
			this.history.push(oldest)
			if (this.history.length > EVICTION_RECORD_LIMIT) this.history.shift()
		}
		this.held.set(reference, { bytes, firstAt: now, lastAttemptAt: now, revisits: 1 })
		this.bytes += bytes
	}

	/** A reference that resolved is no longer held: it leaves the book (and is retried afresh if it returns). */
	forget(reference: string): void {
		const entry = this.held.get(reference)
		if (entry === undefined) return
		this.held.delete(reference)
		this.bytes -= entry.bytes
	}
}
