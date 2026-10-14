/**
 * composition/ts/siblings.ts — **the composition rung's declared sibling list**.
 *
 * The rung's own independence rule is *not* "no sibling specifier" — composing siblings is the whole
 * job of a composition root (`design.md` §4.9). Its rule is **"no app import and no framework"** (the
 * `sdk/boundary.test.ts` rule), plus the requirement that **every sibling it composes is named here**,
 * so the rung's independence is a checkable fact rather than a licence. `siblings.test.ts` extracts
 * every specifier out of this directory and asserts that each relative one leaving the directory is on
 * this list, and that each entry on this list is actually used — set equality, both directions.
 *
 * Why a list at all, when the increments could have left the composition root where it was: measured
 * in the design run, the root's `../../validation/ts/index` import was a **live violation** of
 * `event-access`'s independence criterion (`#0c7fe3`, D-O19; `event-access/evidence/run.sh` §4/§4b), not
 * a design preference. The rung exists so the root can legitimately name its siblings while
 * `event-access/ts/` names none again.
 *
 * `../../event-access/ts/harness` is on the list because the moved regression suite (R1–R4, moved with
 * the root by V0) drives the **real** gate through the sibling's own host-side fakes — one harness, not
 * a second copy grown for the rung.
 *
 * `../../errors` and `../../result` are on the list because V1 absorbed the seed's kept half
 * (`validateWithSchema` / `RuntimeSchema`, `./schema.ts`), which returns `Result<Value, ValidationError>`
 * — the SDK's own shared error and result modules, siblings at the core level, moved unchanged.
 */
export const COMPOSITION_SIBLINGS: readonly string[] = Object.freeze([
  '../../validation/ts/index',
  '../../event-access/ts/index',
  '../../event-access/ts/harness',
  '../../errors',
  '../../result',
])
