/**
 * types.ts — the vocabulary of the `validation` contract.
 *
 * The spec is `../validation.md`; this file is one implementation's spelling of it. Exactly
 * the eight names the spec's front-matter prints as `contract.types` leave through
 * `index.ts`; the few names below that are not among the eight (`Comparator`, `FieldRef`,
 * `Resolution`, `AcceptContext`, the bounds and the unresolved book) are the shapes the
 * eight need, and they are **not** re-exported — the evidence diffs the two lists.
 *
 * Three rules from the spec are visible in the names below:
 *
 * - **The rules are data, and that is the whole language** (D-O25, `#485b96`). A
 *   `ValidationCheck` is a discriminated union of **data** — a `format` names a shape, a
 *   `link` names a reference and the comparisons it requires — and no rule is a function.
 *   A rule a test cannot read is a rule a test cannot falsify.
 * - **The engine interprets no kind-specific semantics** (`#18faf1` (provenance), `#485b96`'s amendment).
 *   Every field a comparison reads is named by its own index in the tag: the tagname, the
 *   element, the comparison. Not even an `e` tag's fourth element is read, because its
 *   meaning is the *preset's* to declare.
 * - **A refusal is typed and names its cause** (`#029611`). `ValidationRefusal` carries the
 *   preset, the check and the closed four-member `cause`; a **format** refusal additionally
 *   carries the `requirement` that fired, so a check holding several requirements — the shape
 *   the spec describes for a format — still reports refusals a caller can tell apart by the
 *   **value** alone, however the host grouped its requirements. A quarantine is the third
 *   outcome and is **not** a refusal, so it carries the reference that nobody could answer
 *   instead of a cause.
 *
 * **The module needs no store, no socket and no host global** (`#8e6079`, `#40d21a` (provenance)): the
 * preset set, the reference port and the clock are injected, and the handle the factory
 * returns carries no other edge.
 */
import type { NostrEvent } from 'nostr-tools'

/** E2's shape, adopted by the spec: the event view is a raw `nostr-tools` event, never a wrapper. */
/** #a3accd — Event: the raw `nostr-tools` event (E2), adopted not wrapped. */
export type Event = NostrEvent

/**
 * **The four refusal causes, a closed vocabulary** (D-O25, `#029611`; the order's decision 3).
 * They stay distinguishable in the value:
 *
 * - `'differs'` — the candidate does not match what the rule requires: a referenced event is
 *   held and its compared fields differ, or the candidate's own shape differs from a format;
 * - `'deleted'` — the referenced event was held and is gone by its author's deletion;
 * - `'expired'` — the referenced event carries an expiry in the past;
 * - `'malformed-reference'` — the reference the rule names cannot be read (absent or not
 *   well-formed), so nothing could be resolved at all.
 *
 * A reference that was answered and disagreed is a different fact from a reference nobody
 * could answer, and neither is the same as one that does not exist — which is why
 * `undefined` from the port is quarantine and never a refusal.
 */
/** #06cc5e — ValidationCause: the closed four-member refusal-cause vocabulary. */
export type ValidationCause = 'differs' | 'deleted' | 'expired' | 'malformed-reference'

/**
 * **Which requirement of a format check fired — a closed vocabulary on a different axis from
 * the four causes.** The causes say what *kind* of fact made the refusal (a reference held and
 * differing, deleted, expired, malformed); this says **which requirement of the check fired**,
 * and it is what keeps the refusals distinguishable in the value when one check carries several
 * requirements — required tags, tag cardinalities, value domains and content constraints, the
 * four a format names. It is **not** a fifth cause and it does not widen `ValidationCause`: a
 * format refusal's cause stays `'differs'` (the candidate does not match the declared shape),
 * and the requirement carries the difference. A link refusal carries none, because a link's
 * comparisons are named by the preset itself.
 */
/** #e4b72f — ValidationRequirement: the format requirement that fired, a distinct closed axis. */
export type ValidationRequirement = 'missing-tag' | 'cardinality' | 'domain' | 'content'

/**
 * **The comparator vocabulary, closed** (D-O25, the order's decision 5): each is a declared
 * name a preset asks for, and the engine carries no other. A comparison the vocabulary does
 * not carry is a preset the engine cannot interpret, so it is raised as `ValidationError`
 * naming it — never a silent pass, and never a per-candidate verdict (the order's adjustment 1).
 */
/** #0fea4f — Comparator: the closed comparator vocabulary, `eq` `exists` `in`. */
export type Comparator = 'eq' | 'exists' | 'in'

/**
 * **The fetch strategy the link names** (research §2.4): by an event id, by an address
 * coordinate, or by id with a coordinate fallback. The strategy is the preset's declaration;
 * the module reads only the reference's *shape* against it and never a kind's meaning.
 */
/** #d10f8b — ReferenceStrategy: the fetch strategy a link names. */
export type ReferenceStrategy = 'by-id' | 'by-coordinate' | 'by-id-fallback-coordinate'

/**
 * **A named field a comparison reads** — an envelope field, or one element of one tag. The
 * `{ tag, index }` form is how the engine stays kind-blind: the preset says which element of
 * which tag carries the value, and the engine never assumes what that element means.
 */
/** #c7e678 — FieldRef: a named field, an envelope field or one element of one tag. */
export type FieldRef = 'id' | 'pubkey' | 'kind' | 'content' | { readonly tag: string; readonly index: number }

/** One comparison: the candidate's named field against the referenced event's, by one comparator. */
/** #c7e678 — LinkComparison: one comparison, the candidate's field against the referenced event's. */
export interface LinkComparison {
	readonly candidate: FieldRef
	readonly reference: FieldRef
	readonly comparator: Comparator
}

/** A format's required tag and its cardinality: at least `atLeast`, and at most `atMost` when declared. */
/** #7efb71 — FormatRequirement: a format's required tag and its cardinality. */
export interface FormatRequirement {
	readonly tag: string
	readonly atLeast: number
	readonly atMost?: number
}

/** A format's value domain: every occurrence of `tag` must carry a value drawn from `values`. */
/** #7efb71 — FormatDomain: a format's value domain. */
export interface FormatDomain {
	readonly tag: string
	readonly values: readonly string[]
}

/**
 * The link branch of `ValidationCheck`, named so `resolve.ts` and the tests can narrow on it.
 * A link reads **one** reference: the element at `index` of the **first** tag named `tag`, the
 * occurrence its preset names. It never walks the event's other tags of that name.
 */
/** #485b96 — LinkCheck: the link branch of `ValidationCheck`. */
export interface LinkCheck {
	readonly kind: 'link'
	readonly id: string
	readonly tag: string
	readonly index: number
	readonly strategy: ReferenceStrategy
	readonly compare?: readonly LinkComparison[]
}

/** The format branch of `ValidationCheck`. */
/** #485b96 — FormatCheck: the format branch of `ValidationCheck`. */
export interface FormatCheck {
	readonly kind: 'format'
	readonly id: string
	readonly requires?: readonly FormatRequirement[]
	readonly domains?: readonly FormatDomain[]
	readonly maxContentBytes?: number
}

/**
 * **A rule is data** (D-O25, `#485b96`). Exactly two kinds and no third: a `format` states
 * the shape of one kind's event (required tags, cardinalities, value domains, content
 * constraints), and a `link` names a reference to follow and the named fields to compare.
 * The engine interprets neither kind's semantics — the `id` names the check so a refusal can
 * carry it, and nothing else here is read as meaning.
 */
/** #485b96 — ValidationCheck: a rule as data, a closed two-member union. */
export type ValidationCheck = FormatCheck | LinkCheck

/**
 * **A preset is what the host hands in** (`#485b96`): the kinds it covers and the checks to
 * run against them, with its own bound overrides. An empty `kinds` list covers every kind —
 * which is why `PASS_THROUGH` needs no kind table. The module ships **no** preset of its own,
 * so a host that declares nothing gets exactly the behaviour of no module at all (`#07b8c7`).
 */
/** #f7aab6 — ValidationPreset: a preset, the kinds it covers and the checks to run. */
export interface ValidationPreset {
	readonly name: string
	readonly kinds: readonly number[]
	readonly checks: readonly ValidationCheck[]
	readonly bounds?: Partial<ValidationBounds>
}

/**
 * **A refusal is typed and names its cause** (`#029611`, D-O25): the preset, the check that
 * fired, one of the four causes, and the message a caller reads. Never a bare string and
 * never a silent drop.
 *
 * A **format** refusal also carries `requirement` — which requirement of that check fired —
 * because a format is one rule that may hold several requirements at once, and a caller must be
 * able to tell a missing tag from a wrong cardinality from a value outside its domain **in the
 * value**, even when all four fired under the one `check.id`. A link refusal carries no
 * requirement: a link's comparisons are named by the preset, and its cause (`'differs'`,
 * `'deleted'`, `'expired'`, `'malformed-reference'`) is the whole difference.
 */
/** #029611 — ValidationRefusal: a typed refusal naming its preset, check, cause and requirement. */
export interface ValidationRefusal {
	readonly preset: string
	readonly check: ValidationCheck
	readonly cause: ValidationCause
	/** Which requirement fired, for a format refusal; absent for a link refusal. */
	readonly requirement?: ValidationRequirement
	/**
	 * **The offending tag**, for a format refusal that is scoped to one tag — the one the publisher
	 * actually wrote. Absent for an envelope-level failure (`maxContentBytes`, which is about `content`
	 * and no tag) and for a link refusal.
	 *
	 * **Why it is here, and not re-derived by the caller.** The I4b amendment above states a format refusal
	 * carries the requirement "which required tag was missing" — and the app's doctrine requires the notice
	 * to state **which constraint failed** rendered **per tag** (`AGENTS.md:105-109`; the legacy notice's
	 * `AUCTION_FIELD_TAGS` map, `auctionAdmission.ts:64-97`, exists to name the tag the publisher wrote). A
	 * refusal that named only `'missing-tag'` would force every notice to re-derive the tag from the
	 * message, and a re-derived tag can disagree with the reason the gate dropped the item — the
	 * badge-versus-feed divergence the doctrine forbids by name (`design.md` §7.3). This field closes that:
	 * one predicate, one tag, read by the badge and the feed alike.
	 */
	readonly tag?: string
	readonly message: string
}

/**
 * **The three outcomes** (D-O25, `#029611`'s amendment). One of them is accepted; one is a
 * refusal carrying its preset, its check and its cause; one is **quarantined** — the
 * reference could not be resolved within the bounds, so the event is held and never admitted,
 * and a reference nobody could answer is named rather than blamed.
 */
/** #6bf840 — ValidationOutcome: the three outcomes, accepted · refused · quarantined. */
export type ValidationOutcome =
	| { readonly outcome: 'accepted' }
	| { readonly outcome: 'refused'; readonly refusal: ValidationRefusal }
	| { readonly outcome: 'quarantined'; readonly preset: string; readonly check: string; readonly reference: string }

/** What the port answered for a held reference: the event is there and can be compared. */
/** #82c32d — ResolutionHeld: the port's held answer. */
export interface ResolutionHeld {
	readonly state: 'held'
	readonly event: Event
}
/** What the port answered for a deleted reference — a fact distinct from not-held. */
/** #82c32d — ResolutionDeleted: the port's deleted answer. */
export interface ResolutionDeleted {
	readonly state: 'deleted'
}
/** What the port answered for an expired reference — a fact distinct from deleted and not-held. */
/** #82c32d — ResolutionExpired: the port's expired answer. */
export interface ResolutionExpired {
	readonly state: 'expired'
}

/**
 * **The port's answer** (the order's decision 3): `held`, `deleted`, `expired` — or
 * `undefined`, which means **nobody could answer it**, which is quarantine and never refusal.
 * The host, not this module, tells deleted from expired from plain-not-held; that is the one
 * thing this module may not know.
 */
/** #82c32d — Resolution: the port's answer, held/deleted/expired or `undefined`. */
export type Resolution = ResolutionHeld | ResolutionDeleted | ResolutionExpired

/** The tier the endpoint declares — passed to the resolver. Flow was previously included and
 * was removed per the maintainer's 2026-10-02 ruling: the rule never learns which boundary it
 * is policing. */
/** #8e6079 — ResolutionAt: the tier the resolver is told, never which boundary. */
export interface ResolutionAt {
	readonly tier: 'local' | 'remote'
}

/**
 * **What the module needs of a host** (D-O24, `#8393ac`): the reference resolver and the
 * clock. It is **not** a rival boundary and holds no store — the port *answers*, and the
 * module decides. The clock is in **milliseconds**, because every bound the spec states is a
 * wall-clock budget in milliseconds and a second unit would force a conversion none of them
 * needs.
 */
/** #8e6079 — ValidationPort: what the module needs of a host, the resolver and the clock. */
export interface ValidationPort {
	resolve(reference: string, at?: ResolutionAt): Promise<Resolution | undefined>
	now(): number
}

/**
 * **The six bounds, as declared values** (D-O25's bounded half; the suggested defaults and
 * their reasoning are in `runs/2026-09-30-first-usable-version/research/11-event-to-event-link-protocol.md`
 * §4). They are part of the contract rather than tuning: each is overridable per preset, each
 * is a value a test reads, and **a bound exceeded is an outcome, never an exception**.
 *
 * `maxChainDepth` is read as a **boolean** — whether a referenced event's own links are
 * followed at all — because that is what the spec's gloss for bound 2 says, and this engine
 * follows exactly one hop: below one forbids even the candidate's own direct references (an
 * outcome), and **above one is a preset the engine cannot interpret**, refused loudly at the
 * preset rather than silently ignored. Implementing a chain is not this implementation's to
 * invent: the spec does not say what a *referenced* event's own links are, and guessing would
 * be the engine interpreting a kind.
 *
 * Bound 6 is one bound with two numbers — how often a quarantined reference is retried, and
 * how far apart the retries are.
 */
/** #e80b77 — ValidationBounds: the six bounds as declared values. */
export interface ValidationBounds {
	readonly maxReferencesPerEvent: number
	readonly maxChainDepth: number
	readonly referenceTimeoutMs: number
	readonly eventTimeoutMs: number
	readonly unresolvedMemoryBytes: number
	readonly revisitCount: number
	readonly revisitIntervalMs: number
}

/**
 * **The unresolved-reference book, as a value a test reads** (the `WriteBackPolicy` /
 * `EvictionPolicy` precedent, `#d4f95d`): what is held, how many bytes it costs, the bound it
 * was measured against, and the evictions **recorded as data loss** — oldest first, never a
 * silent drop.
 *
 * The book is bounded **on both sides**: `bytes` is capped by `limitBytes`, and the eviction
 * record is a **count plus the most recent few names**, never an ever-growing log. A loss log
 * that grows without bound would be a memory bound that does not bound the memory — the very
 * leak the record exists to prove absent — so `evictionCount` is exact and `evictions` is a
 * window (`EVICTION_RECORD_LIMIT` in `bounds.ts`).
 */
/** #fb9a0a — UnresolvedBook: the unresolved-reference book, a value a test reads. */
export interface UnresolvedBook {
	readonly references: readonly string[]
	readonly bytes: number
	readonly limitBytes: number
	readonly evictionCount: number
	readonly evictions: readonly string[]
}

/**
 * **The validator's options** (D-O24, `#8e6079`): the preset set, the port, the bound
 * overrides and the clock are all injected, and none is reached for. With no preset set the
 * module is a pass-through that refuses nothing (`#07b8c7`).
 */
/** #8e6079 — ValidatorOptions: the validator's injected options, preset set · port · clock · bounds. */
export interface ValidatorOptions {
	readonly presets?: readonly ValidationPreset[]
	readonly port?: ValidationPort
	readonly bounds?: Partial<ValidationBounds>
	readonly clock?: { now(): number }
}

/**
 * **The composition's `AcceptContext`** (D-O24, `#8393ac`), declared structurally because no
 * specifier may leave this module. `tier` is the endpoint's declared tier, and `resolve` is the
 * one capability a link needs — the composition's own resolver, so a host that injects no port
 * still resolves its links. The flow was previously included (`operation`) and was removed per
 * the maintainer's 2026-10-02 ruling.
 */
export interface AcceptContext {
	readonly tier: 'local' | 'remote'
	resolve(reference: string): Promise<Event | undefined>
}

/** What the gate answers (`#8393ac`): a value, never a silent drop. */
/** #8393ac — AcceptDecision: what the gate answers, a value never a silent drop. */
export type AcceptDecision = 'accept' | 'reject'

/**
 * **The contract's handle.** The two operations, plus the declared values a host reads
 * **without driving a call** — the preset set, the bounds, and the unresolved book
 * (`#d4f95d`). `accept` **is** the composition's `AcceptHook` (`#8393ac`, D-O24): it takes the
 * event and the composition's `AcceptContext`, and answers `'accept'` or `'reject'` — with
 * `'reject'` covering both a refusal and a quarantine, because a quarantined event is never
 * admitted.
 */
/** #8393ac — Validator: the contract's handle, both operations and the declared values. */
export interface Validator {
	readonly presets: readonly ValidationPreset[]
	readonly bounds: ValidationBounds
	readonly unresolved: UnresolvedBook
	validate(event: Event): Promise<ValidationOutcome>
	accept(event: Event, context: AcceptContext): Promise<AcceptDecision>
}
