/**
 * declaration.ts — **the declaration layer's spelling** (`design.md` §4.1, §4.5).
 *
 * NONE of these names enters the `validation` module. The engine "knows no event kind of its own"
 * (`#18faf1`) and may not carry a kind table, so ownership, contribution and the source of a demand are
 * the declaration layer's vocabulary — read by this rung's guard and report, **never by the engine**
 * (`design.md` §7.5, "zero engine change").
 *
 * **A declaration is a value, not a call**, for the same reason `WriteBackPolicy` and the store's
 * `EvictionPolicy` are: *what it accepts is read by a test rather than inferred from prose* (`#d4f95d`).
 *
 * **It crosses no boundary.** `sdk/boundary.test.ts` forbids React/`@`/`@ui`/`@platform` imports and any
 * import escaping `sdk/`, and a declaration is pure data plus a **citation** of the parser that is the
 * single definition of valid — so a `sdk/commerce` module can import these types (`import type`, erased)
 * without failing that test. That is why the declarations belong to `sdk/commerce`, not to a `src/`
 * surface: the app's parsers live in `src/lib/schemas/**`, outside `sdk/`, so the declaration may only
 * **cite** them, never import them.
 */
import type { ValidationCheck, ValidationPreset } from '../../validation/ts/index'

/**
 * The owner identity (`design.md` §7.5): the **module key**, `commerce.auctions` — a value both a
 * declaration and a report can name, with no new identity minted.
 */
export type OwnerKey = string

/**
 * A citation, not an import: `'src/lib/schemas/auction/auctionEvent.ts#parseAuctionEvent'`. The parser
 * named here IS the single definition of valid for the kind (`auctionAdmission.ts:15-20`), so naming it
 * is what keeps a module from re-transcribing its parser into a second artifact — the drift that
 * produced the original 30408 defect.
 */
export type ParserRef = string

/** The kinds a module OWNS, with the demand each carries (one entry per kind — the one-for-one criterion). */
export interface KindOwnership {
	readonly kind: number
	/** The spec/ADR the demand comes from — our own text, never a NIP: e.g. `'AUCTIONS.md §4.1'`. */
	readonly source: string
	/** The parser that IS the single definition of valid for this kind, cited not imported. */
	readonly parser?: ParserRef
	/**
	 * The rules, in the engine's own `ValidationCheck` vocabulary (`design.md` §4.2 — the landed closed
	 * two-member union, not a second language). An empty list is a **declared "owned and demands
	 * nothing"** — a fact, never a silence (`design.md` §4.6).
	 */
	readonly checks: readonly ValidationCheck[]
}

/** A demand this module routes to ANOTHER owner, by name (`design.md` §4.5). */
export interface Contribution {
	readonly kind: number
	/** The owner this demand is routed to — who must grant it (`accepts`). */
	readonly via: OwnerKey
	readonly source: string
	readonly checks: readonly ValidationCheck[]
}

/** A contribution this owner ADMITS from another module, by name (`design.md` §4.5). */
export interface ContributionGrant {
	readonly from: OwnerKey
	readonly kinds: readonly number[]
}

/**
 * **What a `sdk/commerce` module exports — one `validationDeclaration` value per module.** Collected by
 * name by the composition, which hands the set to the rung (`design.md` §6).
 */
export interface CommerceValidationDeclaration {
	readonly owner: OwnerKey
	readonly kinds: readonly KindOwnership[]
	readonly contributions: readonly Contribution[]
	readonly accepts: readonly ContributionGrant[]
	/**
	 * Bound overrides for this owner's presets. Typed through the engine's own `ValidationPreset.bounds`
	 * (`Partial<ValidationBounds>`) rather than by reaching the module's internal `types.ts` — the
	 * module's entry does not export `ValidationBounds`, and the rung imports its siblings by their
	 * declared entry.
	 */
	readonly bounds?: ValidationPreset['bounds']
}

/**
 * The declaration a module that declares nothing exports: an empty `kinds` list. It is **not** installed
 * as a rule (an empty snapshot keeps the engine's pass-through default), but exporting it names the
 * module as **looked at** rather than silent (`design.md` §4.6).
 */
export function emptyDeclaration(owner: OwnerKey): CommerceValidationDeclaration {
	return Object.freeze({ owner, kinds: [], contributions: [], accepts: [] })
}
