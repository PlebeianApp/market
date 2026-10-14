/**
 * validator.ts — `createValidator`: the two operations over the six bounds.
 *
 * **`validate(event)` is the module's own entry** (`#8393ac`): it returns the outcome value —
 * accepted, a typed refusal, or a quarantine (D-O25). **`accept(event, context)` *is* the
 * composition's `AcceptHook`** (D-O24, the order's decision 2): `'accept'` for accepted and
 * `'reject'` for refused **and** for quarantined, because a quarantined event is never
 * admitted; the module's own value, returned by `validate`, is what carries which.
 *
 * **Nothing by default** (`#07b8c7`): with no preset covering the candidate the pass-through
 * preset answers and no check runs, on both operations. **No repair anywhere** (`#0df9fb`):
 * the candidate is read and never written. **A bound exceeded is an outcome** (D-O25): the
 * fan-out ceiling and a chain ceiling below one, and both wall-clock budgets, resolve as
 * *unresolved*, which is the quarantine outcome — and a resolver that rejects or throws is
 * *unresolved* too, so no rejection escapes this module.
 *
 * The one thing that throws is a **preset the engine cannot interpret**, and it throws for the
 * same reason in each case: the engine cannot honour the declaration, so accepting it would be
 * a host configuration error surfacing as a per-candidate verdict. There are three of them — a
 * comparator outside the closed vocabulary (checked at the link check, before any resolution), a
 * chain depth above one hop (checked at the preset, before any candidate is judged), and a third
 * rule kind (checked where the kind is read). See `errors.ts`.
 */
import { boundsFor, DEADLINE, DEFAULT_BOUNDS, UnresolvedStore, withDeadline } from './bounds'
import { ValidationError } from './errors'
import { evaluateFormat } from './format'
import { selectPreset } from './presets'
import { collectReferenceValues, evaluateLink, type LinkResult } from './resolve'
import type {
	AcceptContext,
	AcceptDecision,
	Event,
	LinkCheck,
	Resolution,
	ResolutionAt,
	UnresolvedBook,
	ValidationBounds,
	ValidationCause,
	ValidationCheck,
	ValidationOutcome,
	ValidationPort,
	ValidationPreset,
	ValidationRefusal,
	ValidationRequirement,
	Validator,
	ValidatorOptions,
} from './types'

/** The resolver the engine drives: the injected port, or the composition's own resolver. */
type Resolver = (reference: string) => Promise<Resolution | undefined>

/** The validator. One instance holds the preset set, the injected edges and the session-scoped book. */
class ValidatorImpl implements Validator {
	readonly presets: readonly ValidationPreset[]
	readonly bounds: ValidationBounds
	private readonly port: ValidationPort | undefined
	private readonly clock: { now(): number }
	private readonly store: UnresolvedStore

	constructor(options: ValidatorOptions) {
		this.presets = options.presets ?? []
		this.bounds = { ...DEFAULT_BOUNDS, ...(options.bounds ?? {}) }
		this.port = options.port
		const port = this.port
		// **The default must be a real clock, never a constant.** Bound 6's revisit gate is
		// `now - lastAttemptAt >= intervalMs`: with the clock frozen at a constant the left side is
		// always zero, so a reference quarantined under this configuration could never be revisited
		// — a declared bound with no mechanism, which is a claim this module cannot honour. So an
		// injected `clock` still wins, a port's own `now()` is still preferred when a port is given,
		// and only the last resort is the host's wall clock — the same shape the store's own
		// `SYSTEM_CLOCK` takes (`event-store/ts/store.ts`) and, like it, this module's one host
		// read. Milliseconds here rather than that precedent's seconds, because every bound this
		// spec states is a millisecond budget.
		this.clock = options.clock ?? (port !== undefined ? { now: () => port.now() } : { now: () => Date.now() })
		this.store = new UnresolvedStore(this.bounds.unresolvedMemoryBytes)
	}

	/** The unresolved book, readable without driving a call (the `EvictionPolicy` precedent, `#d4f95d`). */
	get unresolved(): UnresolvedBook {
		return this.store.book
	}

	/** The module's own entry: the outcome value, never an exception for a candidate's own fate. */
	async validate(event: Event): Promise<ValidationOutcome> {
		return this.evaluate(event, undefined)
	}

	/**
	 * The composition's `AcceptHook` (D-O24). `'accept'` only for an accepted candidate;
	 * `'reject'` for a refusal **and** for a quarantine, because a quarantined event is never
	 * admitted. The flow and the tier the gate is told reach the injected port as its `at`
	 * argument, and the composition's own `resolve` is the resolver when no port is injected.
	 */
	async accept(event: Event, context: AcceptContext): Promise<AcceptDecision> {
		const outcome = await this.evaluate(event, context)
		return outcome.outcome === 'accepted' ? 'accept' : 'reject'
	}

	/**
	 * The port wins when one is injected, and the composition's `resolve` is the fallback when
	 * none is — so the module is drivable both standalone (`validate`, with a port) and as the
	 * composition's gate (`accept`, with the context's resolver and no port at all).
	 */
	private resolver(at: ResolutionAt | undefined, context: AcceptContext | undefined): Resolver | undefined {
		const port = this.port
		if (port !== undefined) return (reference) => port.resolve(reference, at)
		if (context === undefined) return undefined
		return async (reference) => {
			const held = await context.resolve(reference)
			return held === undefined ? undefined : { state: 'held', event: held }
		}
	}

	/**
	 * A refusal value. `requirement` is set for a format failure — which requirement of the
	 * check fired — and left out for a link refusal, whose cause is the whole difference.
	 */
	private refused(
		preset: string,
		check: ValidationCheck,
		cause: ValidationCause,
		message: string,
		requirement?: ValidationRequirement,
	): ValidationOutcome {
		const refusal: ValidationRefusal = { preset, check, cause, message, requirement }
		return { outcome: 'refused', refusal }
	}

	private quarantine(preset: ValidationPreset, check: string, reference: string): ValidationOutcome {
		return { outcome: 'quarantined', preset: preset.name, check, reference }
	}

	/** The per-check loop, under the event budget's own bound. */
	private async runChecks(
		preset: ValidationPreset,
		event: Event,
		bounds: ValidationBounds,
		resolve: Resolver | undefined,
	): Promise<ValidationOutcome> {
		for (const check of preset.checks) {
			if (check.kind === 'format') {
				const failure = evaluateFormat(check, event)
				if (failure !== undefined) {
					return this.refused(preset.name, check, failure.cause, failure.message, failure.requirement)
				}
				continue
			}
			if (check.kind === 'link') {
				const result: LinkResult = await evaluateLink(check, event, {
					preset: preset.name,
					resolve,
					clock: this.clock,
					bounds,
					store: this.store,
				})
				if (result.kind === 'accepted') continue
				if (result.kind === 'refused') return this.refused(preset.name, check, result.cause, result.message)
				return this.quarantine(preset, check.id, result.reference)
			}
			// The engine carries exactly two rule kinds and no third (D-O25, `#485b96`).
			throw new ValidationError({
				preset: preset.name,
				check,
				cause: 'malformed-reference',
				message: `a check of kind ${JSON.stringify((check as { kind?: unknown }).kind)} is neither a format nor a link; the engine carries exactly two kinds`,
			})
		}
		return { outcome: 'accepted' }
	}

	/**
	 * One candidate through one preset. The pass-through answer is decided first (`#07b8c7`);
	 * then the preset's own declaration is judged — a chain depth above one hop is refused here,
	 * before the candidate is touched; then both ceilings that can be read off the event before
	 * any wait (fan-out, chain depth below one); then the checks, bounded by the event budget,
	 * with each reference bounded by its own.
	 */
	private async evaluate(event: Event, context: AcceptContext | undefined): Promise<ValidationOutcome> {
		const preset = selectPreset(this.presets, event)
		if (preset.checks.length === 0) return { outcome: 'accepted' }
		const bounds = boundsFor(preset, this.bounds)
		this.store.limit(bounds.unresolvedMemoryBytes)
		const links = preset.checks.filter((check): check is LinkCheck => check.kind === 'link')
		// Bound 1's quantity: one reference per link check, from the occurrence each link names.
		// These are the resolutions the engine would attempt, not the event's tag occurrences.
		const references = collectReferenceValues(event, links)
		const first = links[0]

		// A preset asking for **chain following** is refused here, at the preset, **before any
		// candidate is judged** — loudly, like a comparator the engine does not carry, and for the
		// same reason: the engine takes exactly one hop, so `maxChainDepth` above one is a declared
		// bound with no mechanism, and accepting it would report a one-hop check for a two-hop
		// declaration. Implementing the chain is not this engine's to invent: the spec does not say
		// what a *referenced* event's own links are, and assuming it would be the engine
		// interpreting a kind (`#18faf1` (provenance)). A preset with no link check has nothing to follow, so it
		// is judged normally.
		if (links.length > 0 && bounds.maxChainDepth > 1) {
			throw new ValidationError({
				preset: preset.name,
				check: first as ValidationCheck,
				cause: 'malformed-reference',
				message: `preset ${preset.name} declares maxChainDepth ${bounds.maxChainDepth}, which asks for chain following; the engine takes exactly one hop and does not interpret what a referenced event's own links are`,
			})
		}

		// Bound 1 — the fan-out ceiling, over **resolutions attempted**: one reference per link
		// check, which is the quantity the spec's gloss names ("references resolved per event").
		// Over it, the reference past the ceiling is unresolved: an outcome.
		if (references.length > bounds.maxReferencesPerEvent) {
			return this.quarantine(preset, first !== undefined ? first.id : preset.name, references[bounds.maxReferencesPerEvent] ?? '')
		}
		// Bound 2 — the chain-depth ceiling below one hop. This engine takes one hop, so a ceiling
		// below one forbids even the candidate's own direct references: an outcome, not a rejection.
		if (references.length > 0 && bounds.maxChainDepth < 1) {
			return this.quarantine(preset, first !== undefined ? first.id : preset.name, references[0] ?? '')
		}

		const at: ResolutionAt | undefined = context === undefined ? undefined : { tier: context.tier }
		const resolve = this.resolver(at, context)

		// Bound 4 — the per-event budget wraps the whole evaluation. A fired event deadline is
		// every remaining reference unresolved at once: the quarantine outcome.
		const bounded = await withDeadline(this.runChecks(preset, event, bounds, resolve), bounds.eventTimeoutMs)
		if (bounded === DEADLINE) {
			return this.quarantine(preset, first !== undefined ? first.id : preset.name, references[0] ?? '')
		}
		return bounded
	}
}

/**
 * The contract's factory. With no options the module is the spec's default: no preset set, so
 * a pass-through that refuses nothing (`#07b8c7`), and no port or clock because nothing it can
 * be asked to do needs one.
 */
/** #8393ac — createValidator: the contract's factory, both operations over the six bounds. */
export function createValidator(options: ValidatorOptions = {}): Validator {
	return new ValidatorImpl(options)
}
