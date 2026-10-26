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
2. From **V1**, the absorbed kept half of the retired `sdk/core/validation.ts` seed —
   `validateWithSchema` / `RuntimeSchema` (`ts/schema.ts`), the guard's own shape-check for a
   declaration and a parser. (`EventSchemaRegistry.validate` and `validateEventWithSchema` retired: the
   engine's `validate` is the one predicate, and a second kind check has no separate rule.)
3. From **V2**, the declaration registry and its guard (ownership · contribution · interpretability) —
   the contribution path by which a `sdk/commerce` module declares the validation its kinds demand.

## Its independence rule, and why it is not "no sibling specifier"

Composing siblings is this rung's whole job, so its rule is the `sdk/boundary.test.ts` rule —
**no app import and no framework** — plus the requirement that **every sibling it composes is named**
on the declared sibling list (`ts/siblings.ts`). `ts/siblings.test.ts` holds both directions of that set
equality as a checkable fact. Verified in the same increment: `bash
sdk/core/event-access/evidence/run.sh` §4 prints `0 matched lines, exit 1`, §4b's disallowed set is
empty, and the subject count is `10` again.

**One compiler-flag exception, recorded rather than hidden.** `ts/tsconfig.json` omits
`noImplicitOverride`, which every self-contained module sets. This rung's program necessarily includes
SDK-root siblings (`../../errors`, `../../result`), and `sdk/core/errors.ts:5` declares
`readonly cause?: unknown`, overriding `Error.cause` — under `noImplicitOverride` that is TS4114, on a
file outside V0–V4's change scope (only `sdk/core/{composition,validation,event-access,commerce}/**`).
The rung's own files override nothing, so the flag protects nothing here and its removal surfaces no
error of the rung's own. Every other strict flag is kept.

## Declared sibling list

| specifier                       | what it is                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `../../validation/ts/index`     | the engine (`createValidator`, and the types the root wires)                            |
| `../../event-access/ts/index`   | the one accept boundary (`createEventAccess`, `DEFAULT_WRITE_BACK`)                     |
| `../../event-access/ts/harness` | the sibling's own host-side fakes, used by the moved R1–R4 suite                        |
| `../../errors`                  | the SDK's shared error module — `ValidationError` for the absorbed `validateWithSchema` |
| `../../result`                  | the SDK's `Result` — the shape `validateWithSchema` (and, from V2, the guard) returns   |

## The contribution path (V2)

`ts/declaration.ts` is the **declaration layer's spelling** — `CommerceValidationDeclaration`, `KindOwnership`,
`Contribution`, `ContributionGrant` — none of which enters the `validation` module (`design.md` §7.5, zero
engine change). `ts/registry.ts` is the **registry, its guard and the report**:

- **one structural owner per kind**; a second module with a genuine demand **contributes** it by name
  (`Contribution.via`) and the owner **admits** it by name (`ContributionGrant.from`) — **both halves must
  exist**, and the merged declaration stays the owner's;
- an **undeclared overlap** is refused, naming the closed **`(kind, claimed-by-two)`** pair;
- an **uninterpretable check** — a comparator outside `eq · exists · in`, a `maxChainDepth` above one hop,
  or a reference count past the engine's own declared `maxReferencesPerEvent` — is refused **at
  registration, before any candidate is judged**;
- `snapshot()` is the engine's preset set; `report()` is a value a test reads (owned kinds,
  owned-with-no-rules, contributions, grants, and the **unplaced** kinds the host declares it renders).

`ts/compose.ts` is the **collection path**: `composeCommerce` builds the registry and passes `validation`
to `composeEventAccess` **only when the snapshot is non-empty** — the one branch that preserves **R1**
(zero declarations ⇒ the socket stays absent ⇒ `access.policy` **is** `DEFAULT_WRITE_BACK`). A bad
declaration throws `DeclarationError` there, at boot.

The tree's own declarations are collected by `sdk/commerce/validationDeclarations.ts`: one
`validationDeclaration` value per `sdk/commerce/<module>`, with `orders`' demand for kinds 16 · 17 routed
to `messaging` (which owns them, and admits it). The corpus criterion — one module ↔ one declaration ↔
one `KindOwnership` per owned kind — is held by `sdk/commerce/declarations.test.ts`.

## The first real demand (V3)

`sdk/commerce/auctions` declares **kind 30408** with real checks, read off the cited inventory
(`inventory.md` §5) in the engine's own closed rule language — required tags (`d`, `title`, `start_at`,
`end_at`, `starting_bid`, `p2pk_xpub`, `mint`, `auditors`) and the four locked literals of `AUCTIONS.md`
§4.1 as closed domains. `NOT_YET_GATED_30408` names the cited rules the landed data-only union **cannot**
express (numeric ranges, the cross-field refines `end_at ≥ start_at` / `max_end_at ≥ end_at` /
`auditor_quorum ≤ |auditors|`, hex/coordinate shapes, and the multi-event settlement completeness) —
declared and still unexecuted, never transcribed (`design.md` §4.2b/§7.1).

`ts/gate.test.ts` proves the path end to end: an absent `end_at` is dropped by the gated read path, the
same event with `end_at` crosses, direct navigation still resolves the dropped one naming the failing
check and requirement, and with 30408 withdrawn the same subject is ungated again.

## The reason travels (V4)

The gate answer is **lossy by design** — `'reject'` covers a refusal _and_ a quarantine — so the reason is
recovered structurally: the binary through `accept`, the `ValidationOutcome` through `validate`, **both on
the same `Validator` instance** (`design.md` §4.7). The smallest type change that makes it expressible is
one field — **`ValidationRefusal.tag`** (`design.md` §7.3), set by the format half for the three
tag-scoped requirements (`missing-tag`, `cardinality`, `domain`) and absent for `content` and for a link
refusal. It carries the tag the publisher **wrote**, from the engine's own reading, so no surface
re-derives it and no badge can disagree with the feed.

`ts/notice.ts` is the notice contract: `admissionNotice(outcome)` maps the outcome to a renderable value —
a **refusal** naming the check, the requirement and the tag (the legacy per-tag `label`, built from the
value); a **quarantine** naming the unresolved `reference` and _nothing else_ ("held: a referenced event
could not be resolved"), never a made-up failing tag; and an `interactive` flag expressing the doctrine's
interactivity gate. `judgeAdmission(validator, event, context)` returns both readings of the one instance,
which `ts/notice.test.ts` asserts agree for a refusal **and** for a quarantine.

**No declaring line in `validation.md` was edited, and no amendment paragraph added.** The module's I4b
amendment already states a format refusal carries the requirement _"which required tag was missing"_; the
`tag` field is that sentence implemented, so the spec and the directory agree as they stand (and the
module's `#`-token cross-reference verifier still resolves every code token — 26/26).

## The regression floor this rung carries

The four behaviours proved at `event-access/ts/composition-root.test.ts` moved with the root
(`ts/composition-root.test.ts`) and must stay green:

| #   | behaviour                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- |
| R1  | absent declarations ⇒ the socket stays absent and `access.policy` **is** `DEFAULT_WRITE_BACK`       |
| R2  | a refusing rule ⇒ dropped at **all three** destinations (not written, not delivered, not published) |
| R3  | quarantine ⇒ **never admitted**, the reference named, the resolver asked **by id**                  |
| R4  | the extra fetch ⇒ through the composition's **own** read path, never a second one                   |
