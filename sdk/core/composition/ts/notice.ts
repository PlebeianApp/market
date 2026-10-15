/**
 * notice.ts — **the notice contract** (`design.md` §4.7): the surfaces read the SAME `Validator` the gate
 * does, so a badge can never disagree with the reason an item is missing from a feed (`AGENTS.md:118-119`).
 *
 * The gate answer is **lossy by design**: `AcceptDecision` is `'accept' | 'reject'`, and `'reject'` covers
 * *both* a refusal and a quarantine. The reason is recovered structurally, and this is the load-bearing
 * wiring rule: the gate answers the binary through `accept`; the reason is the `ValidationOutcome` through
 * `validate` — **both on the same instance**. This module turns that outcome into a renderable value:
 *
 * - **a refusal** → the failing constraint — the check that fired, the requirement within it, and the
 *   **tag the publisher actually wrote** (`ValidationRefusal.tag`, `design.md` §7.3) — the legacy notice's
 *   shape, rendered **per tag** without re-deriving the tag from a message;
 * - **a quarantine** → a **distinct** notice naming the unresolved `reference`: *"held: a referenced event
 *   could not be resolved"*. There is no failing constraint to state, and a quarantined event must **never**
 *   be told to fix a tag when the real problem is an event nobody could fetch (`AGENTS.md:106-109`).
 *
 * The notice also carries the doctrine's **interactivity** decision as a value: a refused or quarantined
 * item offers **no** bid, purchase, claim or settlement action, while owner surfaces still render it
 * (`design.md` §4.7).
 */
import type { AcceptContext, Event, ValidationOutcome, ValidationRefusal, Validator } from '../../validation/ts/index'
import type { AcceptDecision } from '../../event-access/ts/index'

/** The closed cause vocabulary, read off the refusal itself (the module's entry does not export it). */
type Cause = ValidationRefusal['cause']
/** The closed format-requirement vocabulary, read off the refusal itself. */
type Requirement = ValidationRefusal['requirement']

/** An admitted item: interactive, and rendered by every discovery surface. */
export interface AdmittedNotice {
	readonly kind: 'admitted'
	readonly interactive: true
	readonly message: string
}

/** A refusal: the failing constraint, naming the requirement and (when tag-scoped) the tag. */
export interface RefusalNotice {
	readonly kind: 'refusal'
	/** No bid, purchase, claim or settlement on a refused item (`design.md` §4.7). */
	readonly interactive: false
	readonly preset: string
	/** The `id` of the check that fired. */
	readonly check: string
	readonly cause: Cause
	readonly requirement?: Requirement
	/** The tag the publisher wrote, from the engine's own value — never re-derived. */
	readonly tag?: string
	/** The engine's own message. */
	readonly message: string
	/** The per-tag line a notice renders; the `AUCTION_FIELD_TAGS` behaviour's shape, from the value. */
	readonly label: string
}

/** A quarantine: no failing constraint — the unresolved reference nobody could answer. */
export interface QuarantineNotice {
	readonly kind: 'quarantine'
	readonly interactive: false
	readonly preset: string
	readonly check: string
	/** The reference the resolver could not answer. */
	readonly reference: string
	readonly message: string
	readonly label: string
}

export type AdmissionNotice = AdmittedNotice | RefusalNotice | QuarantineNotice

/** The one phrase a quarantined item renders — distinct from any refusal's. */
export const QUARANTINE_MESSAGE = 'held: a referenced event could not be resolved'

/** Map one `ValidationOutcome` to the notice a surface renders. Pure, and total over the three outcomes. */
export function admissionNotice(outcome: ValidationOutcome): AdmissionNotice {
	if (outcome.outcome === 'accepted') {
		return { kind: 'admitted', interactive: true, message: 'admitted' }
	}
	if (outcome.outcome === 'quarantined') {
		return {
			kind: 'quarantine',
			interactive: false,
			preset: outcome.preset,
			check: outcome.check,
			reference: outcome.reference,
			message: QUARANTINE_MESSAGE,
			label: `${QUARANTINE_MESSAGE} (reference ${outcome.reference})`,
		}
	}
	const { refusal } = outcome
	return {
		kind: 'refusal',
		interactive: false,
		preset: refusal.preset,
		check: refusal.check.id,
		cause: refusal.cause,
		...(refusal.requirement === undefined ? {} : { requirement: refusal.requirement }),
		...(refusal.tag === undefined ? {} : { tag: refusal.tag }),
		message: refusal.message,
		// The legacy notice's shape — `tag \`x\` is invalid — …` — now read off the engine's own value
		// rather than re-derived by each surface (`auctionAdmission.ts:104-117`).
		label: refusal.tag === undefined ? refusal.message : `tag \`${refusal.tag}\` is invalid — ${refusal.message}`,
	}
}

/** What a surface reads from the one `Validator`: the gate's binary, and the notice's reason. */
export async function inspectAdmission(validator: Validator, event: Event): Promise<AdmissionNotice> {
	return admissionNotice(await validator.validate(event))
}

/**
 * **The badge and the feed, read from the same instance.** The gate's binary through `accept`, the reason
 * through `validate` — never a second predicate, and never a captured snapshot (`design.md` §4.4/§4.7).
 */
export async function judgeAdmission(
	validator: Validator,
	event: Event,
	context: AcceptContext,
): Promise<{ readonly decision: AcceptDecision; readonly notice: AdmissionNotice }> {
	const decision = await validator.accept(event, context)
	const notice = admissionNotice(await validator.validate(event))
	return { decision, notice }
}
