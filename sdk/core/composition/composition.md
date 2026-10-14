# The composition rung — `sdk/core/composition`

**Status:** landed by increment **V0** of `runs/2026-10-15-validation-contribution/increments.md`. The
mechanism it hosts is designed in `runs/2026-10-15-validation-contribution/design.md` §4.9.

## What this rung is

The `validation` engine is frozen and imports nothing outside itself (`validation.md` `#8e6079`); it
carries **no kind table** (`#18faf1`). `event-access` hosts the one accept boundary and declares its
ports structurally — it imports **neither** sibling (`event-access/ts/index.ts` `#0c7fe3`, D-O19). So
the place that builds the validator and hands its `accept` to the boundary can live in neither: it
needs a rung of its own. That rung is this one.

**Why it was needed, measured rather than asserted.** The composition root first landed at
`sdk/core/event-access/ts/composition-root.ts` (commit `bdf2ceb9`), where its
`../../validation/ts/index` import was a **live violation** of `event-access`'s independence criterion
(`event-access/evidence/run.sh` §4/§4b) and its two files pushed `event-access/ts` from the asserted
**10** `.ts` files to **12**. V0 relocates the root here and `event-access/ts/` names no sibling again.

## What it owns

1. `composeEventAccess` — the relocated composition root (`ts/composition-root.ts`), moved verbatim,
   that builds the validator from the host's declared demands and wires `validator.accept` into
   `event-access`'s **one** accept hook. Absent validation ⇒ the socket stays absent and `access.policy`
   **is** `DEFAULT_WRITE_BACK`.
2. From **V2**, the declaration registry and its guard (ownership · contribution · interpretability) —
   the contribution path by which a `sdk/commerce` module declares the validation its kinds demand.

## Its independence rule, and why it is not "no sibling specifier"

Composing siblings is this rung's whole job, so its rule is the `sdk/boundary.test.ts` rule —
**no app import and no framework** — plus the requirement that **every sibling it composes is named**
on the declared sibling list (`ts/siblings.ts`). `ts/siblings.test.ts` holds both directions of that set
equality as a checkable fact. Verified in the same increment: `bash
sdk/core/event-access/evidence/run.sh` §4 prints `0 matched lines, exit 1`, §4b's disallowed set is
empty, and the subject count is `10` again.

## Declared sibling list

| specifier | what it is |
| --- | --- |
| `../../validation/ts/index` | the engine (`createValidator`, and the types the root wires) |
| `../../event-access/ts/index` | the one accept boundary (`createEventAccess`, `DEFAULT_WRITE_BACK`) |
| `../../event-access/ts/harness` | the sibling's own host-side fakes, used by the moved R1–R4 suite |

## The regression floor this rung carries

The four behaviours proved at `event-access/ts/composition-root.test.ts` moved with the root
(`ts/composition-root.test.ts`) and must stay green:

| # | behaviour |
| --- | --- |
| R1 | absent declarations ⇒ the socket stays absent and `access.policy` **is** `DEFAULT_WRITE_BACK` |
| R2 | a refusing rule ⇒ dropped at **all three** destinations (not written, not delivered, not published) |
| R3 | quarantine ⇒ **never admitted**, the reference named, the resolver asked **by id** |
| R4 | the extra fetch ⇒ through the composition's **own** read path, never a second one |
