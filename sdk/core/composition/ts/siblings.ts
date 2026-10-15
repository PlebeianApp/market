/**
 * composition/ts/siblings.ts — **the composition rung's declared sibling list**.
 *
 * The rung's own independence rule is *not* "no sibling specifier" — composing siblings is the whole
 * job of a composition root (`design.md` §4.9). Its rule is **"no app import and no framework"** (the
 * `sdk/boundary.test.ts` rule), plus the requirement that **every sibling its implementation composes is
 * named here**, so the rung's independence is a checkable fact rather than a licence. `siblings.test.ts`
 * holds both directions of that set equality over the rung's **implementation** files, and separately
 * checks every specifier in the directory (tests included) for an app/framework import or a path that
 * leaves `sdk/`.
 *
 * Why a list at all, when the increments could have left the composition root where it was: measured
 * in the design run, the root's `../../validation/ts/index` import was a **live violation** of
 * `event-access`'s independence criterion (`#0c7fe3`, D-O19; `event-access/evidence/run.sh` §4/§4b), not
 * a design preference. The rung exists so the root can legitimately name its siblings while
 * `event-access/ts/` names none again.
 *
 * `../../errors` and `../../result` are on the list because V1 absorbed the seed's kept half
 * (`validateWithSchema` / `RuntimeSchema`, `./schema.ts`), which returns `Result<Value, ValidationError>`
 * — the SDK's own shared error and result modules, siblings at the core level, moved unchanged.
 *
 * The **test-only** sibling specifiers (e.g. `../../event-access/ts/harness`, and the real
 * `sdk/commerce` declaration V3's end-to-end case drives) are deliberately NOT on this list: the list is
 * what the rung's implementation composes, and a test's fixtures are not part of that. They are still
 * governed — by the directory-wide arm of `siblings.test.ts`.
 */
export const COMPOSITION_SIBLINGS: readonly string[] = Object.freeze([
	'../../validation/ts/index',
	'../../event-access/ts/index',
	'../../errors',
	'../../result',
])
