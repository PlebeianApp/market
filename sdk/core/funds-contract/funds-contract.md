---
module: funds-contract
kind: module
schema: architecture
applies: core@0.1
inherits: [core]
implements: []
opt-out: []
test-support: ["ts/*.test.ts"]
levels:
  objective: present
  technical-spec: present — the per-leg authority rule, the port and its shapes, the rung vocabulary, the acceptance gate, the conservation rule and the terminal rule
  implementation: present-for-types-only — types only, no behaviour: this module ships the port's three operations, the shapes they exchange, the rung vocabulary, the per-rail operations subset and the registration shape, and it performs nothing
  tests: present — a type-level test in ts/, enforced by `bun run typecheck` and exercised by `bun test`; the type surface is the deliverable, so the typecheck is the load-bearing gate
contract:
  entry: ts/index.ts   # the types-only implementation's entry; the document remains the technical spec
  operations: [obtain, submit, reconcile]
  exports: []   # no value exports: the whole surface is types, and this module performs nothing
  types: [FundsStep, FundsOperations, FundsAuthorityKind, FundsProgress, FundsRung, FundsWitnessKind, FundsIntent, FundsQuote, FundsRefusal, FundsWitness, FundsState, FundsHandle, WrapperRegistration]
implementations:
  - id: ts
    lang: typescript
    dir: ts
    entry: ts/index.ts
    package: null
    install: [bun, install]   # every action is a token array, never a shell string
    build: []                 # the types erase; there is nothing to build
    test: [bun, test]
    typecheck: [bun, run, typecheck]
    needs: []                 # CODE dependencies (module names), not `inherits`
access:
  group: m_funds-contract
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - the rail wrappers that inherit this contract and cite its port — the Coco wrapper among them
  - the aggregator, which inherits the wrappers, reads the registration shape this contract owns and executes the acceptance gate
  - checkout and orders, which read the intent and the set status rather than a rail
naming:
  reserves: the payment layer's own vocabulary — the port's three operations, the rung names and the authority kinds — stated once here so every wrapper shares one dialect
  does_not: no rail name appears in a contract statement; the reserved mount names (core, market) are untouched; no descendant module is named anywhere on a declaring line
  rename: a one-word answer substitutes the directory, the module key, the MD filename, the access group and every command or path that names the module, and nothing else — every declaring line, its identity and every citation of it stays byte-identical
source:
  run: runs/2026-10-06-payments-architecture/ — the increment order's I0, read with the corrected-money and corrected-port refinements
  direction: round-5-direction.md (the bound, O5 amended as the shape); architect-O5-contract.md (what the contract owns and what it must not contain); witness-B1-passive-legs.md (the authority rule and the ladder)
  corrected: fix-port-and-refund.md (the three-operation vocabulary, the declaration tie and the human-transition count) and fix-money-mechanisms.md (the one rung set, the terminal non-settlement rule and the conservation basis)
  decision: the contract is an ordinary module, inherits core, and is never a write into the core mount
evidence: evidence/ — regenerated, never hand-edited: run.sh (the gate this module passes) and hash-refs.py (the spec <-> implementation cross-reference)
---

# funds-contract — the payment contract: the port, the authority rule, the rungs, the gate

**The job, in one sentence** — own exactly one thing, the payment contract: the method-discriminated port and
the shapes it exchanges, the per-leg authority rule, the rung vocabulary, the acceptance gate's declared
shape, the conservation rule and the terminal rule — so the rail wrappers conform to one checkable spec and
the aggregator can enforce it.

**What it is not.** It is not a ledger, a host or a layer. The contract holds **no durable state** — no
journal, no store, no leg record, no per-order state — and it **performs nothing**; the moment it stored the
intent, the evidence or the reference it would be the store the method refuses, and the moment it performed a
step it would be a host. The intent, the durable reference and the leg record are written by each wrapper (per
leg) and by the aggregator (the set); this contract **states** the obligation and owns the vocabulary. It also
carries no transport and no authority code: no NWC client, no invoice decoder, no local-wallet internals —
those are each wrapper's, never the shared ancestor's.

**Why it is a types-only implementation.** The shapes this contract declares get **one home**, here, and that
home is a types-only `ts/` implementation: the port's three operations, the shapes they exchange, the rung
vocabulary, the per-rail operations subset and the registration shape, and nothing that performs. So
`implementation: present-for-types-only` and the `ts` block below are honest, not a formality — the module
compiles, its surface is type-checked, and it has no value exports, no store, no transport and no authority
code. The decision this records (the port's types live in the contract, once, rather than one copy per
wrapper) supersedes the earlier spec-only resolution: it is an amendment **by addition**, so the statements
that were true remain true, the front-matter fields changed, and the statement at the end of this section is
added to record what the module now ships. A wrapper obtains these types from this ancestor and declares the
code dependency; the shapes are no longer minted per wrapper.

**The files this module owns.** `funds-contract/funds-contract.md` (this document); `funds-contract/ts/index.ts`
(the entry, re-exporting the surface), `funds-contract/ts/types.ts` (the port's types) and
`funds-contract/ts/port.test.ts` (the type-level test); and `funds-contract/evidence/run.sh` and
`funds-contract/evidence/hash-refs.py` — `run.sh` prints only and the caller redirects it, and
`hash-refs.py` resolves this module's port tokens against its own spec and its ancestors. Neither writes into
the tree. The toolchain files (`ts/package.json`, `ts/tsconfig.json`, `ts/bun.lock`) are the toolchain's, not
this document's.

## The statements

One statement per behaviour, each a line of its own with its content-hash identity assigned by
`python3 -B core/checks/check.py --root . --assign` — never typed. No declaring line names a rail or a
descendant: a rail that lands adds a method value in its own wrapper and edits nothing here.

## `#a8e2cf` — A leg names its authority, and its witness must be independent of the beneficiary

Every leg declares the **kind** of authority it addresses, and the kind is derived from the leg's method,
never asserted beside it. A **local** authority is a proof repository the app itself holds: it carries its
own balance semantics and its own offline reconciliation, and it is the arbiter of its own state. A
**remote-and-observable** authority is one the app can only address and observe through a rail, so the leg's
binding carries a **verification expectation** — which witness closes it — rather than a reconciliation
handle. Those two are the whole table; a rail adds a method value, never an authority kind.

An **authority** is the party that can hold or move value and is the arbiter of the state of its leg. A
**witness** is the artifact that closes a leg, and it must be **independent of the party who benefits from
"settled"**: the silent failure of a money design is the party who took the money declaring the money
arrived, so a seller-side or provider-side attestation is a beneficiary's own word — a _declared_ witness — and
never a settlement. An authority may be a party (the payee's node is, by protocol, the only party that knows
an invoice settled); the witness that closes the leg is a separate thing, and the beneficiary may never be it.

## `#de8ec0` — The port is three operations, and a rail declares which of them it has

The contract declares one port, the payment layer's own vocabulary:
`obtain(intent) -> FundsQuote | FundsRefusal`, `submit(quote, reference) -> FundsHandle`,
`reconcile(reference) -> FundsHandle`. A wrapper implements the port over one rail and owns its own durable
journal. `obtain` returns the leg's **durable reference** in the rail's own form — an invoice and its payment
hash, a mint's quote — so the term stays rail-agnostic and names the reference, not a particular rail.

The port's operations are a **closed set of exactly three**, and a wrapper **declares** the subset it exposes:
`operations` is a non-empty subset of `obtain`/`submit`/`reconcile`, and the wrapper's declared plan is that
subset's **ordered projection** in the port's canonical order. The tie is one-directional and asserts only
self-consistency — which of the three operations the rail has — never that they behave; behaviour is the
conformance suite's. A **passive** leg is legal by this declaration: a rail whose payable artifact is
broadcast — an invoice exposed for the buyer to scan, with nothing in the app that submits it — declares
`obtain` and `reconcile` and **omits `submit`**, so its absent `submit` is a **declared fact** rather than a
missing method. A rail that does declare `submit` (a leg that moves money) must also declare `reconcile`,
because a money-mover with no reconcile step is a paid but unlearnable leg.

## `#6f9f08` — One rung vocabulary, and only a cryptographic witness settles a leg

Progress markers, in order: `intent -> attempted -> submitted`. Proof rungs, per leg: **`attested`** — a
party's or authority's word with no artifact behind it; **`witnessed-settled`** — a **cryptographic** artifact
checkable against the leg's own expectation; **`unresolved`** — no witness yet, and one may still arrive (a
blocked, unconfirmed leg is a **sub-state** of this, not a rung of its own); **`abandoned`** — the window
elapsed and no artifact will arrive. This is one set: a parenthesised family name in an implementation is
mapped onto one of these four, never given a rung of its own.

A leg may be **settled only on a cryptographic witness**. A cryptographic witness is checkable against an
artifact **without trusting the reporter** — a preimage whose hash matches the expectation the set already
holds, or a receipt whose signature verifies against a pinned provider key. A **declared** witness — a
beneficiary's "settled", a seller's attestation, a wallet's bare acknowledgement with no preimage — may move
a leg no further than `attested` and settles nothing. A leg whose only source is an untrusted wrapper is
capped at `attested`, and its amount is excluded from the conservation sum. **Time produces no witness**: it
may reach the non-settlement terminal (`abandoned`) and it may never write `witnessed-settled`. A
cryptographic settle is monotone, terminal and write-once; a declared rung is recomputed from the
observations; and every observation is append-only.

The wallet's own lifecycle states are a different, validated union, cited (`#f4028b`) and never borrowed as a
rung name; and bearer material never crosses a boundary — that statement is the wallet's (`#7654d1`), cited
here and not restated.

## `#1b7115` — The rule that a durable reference precedes the money is the wallet module's

The ordering rule — that a durable reference exists before an irreversible boundary, so a late or out-of-band
signal reconciles against a reference **already written** instead of a callback that never comes — is the
wallet module's own statement (`#18e1c3`), cited here and never restated as this contract's rule. What this
contract adds is only the per-leg obligation: each wrapper declares the shape of its durable reference and
the boundary it is written before, and **every leg has its reference written before its money moves** — at
the point the rail acts, or at exposure for a passive leg whose exposure is its irreversible boundary.
The contract itself holds no journal and no record; it states the obligation and owns the vocabulary.

## `#87e7a5` — The acceptance gate refuses a malformed declaration, never conduct

A wrapper joins the payment layer by handing the aggregator a **declaration** whose shape this contract owns:
its stable wrapper identity, its method, the port it implements, the authority kind derived from that method,
the operations it exposes with their ordered plan, its declared durable store and the store's kind, the
witness kinds it can produce, a reconcile deadline where the authority is remote, the shape and boundary of
its journal reference, its ceiling, and the contract version it was written against. The aggregator
**accepts** a wrapper, and accepts only a well-formed declaration; the runtime check is the aggregator's, the
shape is this contract's.

It **refuses**, with one fail-closed error that names the field it fails on and **never echoes the value**: an
empty, unknown, duplicate or reconcile-less plan, or a plan that is not the declared operations' ordered
projection; a malformed wrapper identity; a method outside the set; an absent or method-disagreeing authority
kind; an empty or out-of-set witness-kind list; an absent or incomplete store; a missing reconcile deadline on
a remote leg; a malformed journal reference; a non-positive ceiling; a stale contract version; and a method
already registered. Nothing else is refused.

The gate's **honest limit**, stated once so the spec does not overclaim: it enforces the **shape and
self-consistency of a declaration, never its conduct**. It cannot make a declared plan the plan that runs,
make `reconcile` truthful, make a declared witness producible or a returned witness valid, make a store
durable or its compare-and-set atomic, or make a ceiling the cart's own number. A well-formed declaration that
lies is accepted, and the residue is one human judgment per wrapper and per return site. This is deliberate:
the precedent the gate lifts enforces exactly as much and no more, so the gate is worth building but it is not
the discriminator between designs.

## `#5cd6a4` — Conservation: a per-leg band, summed for the set, and a signed residual

The basis is **net**, and the residual has an owner: the aggregate is **derived from the parts** — a frozen
total is the sum of the legs' frozen shares — fees are netted before the comparison, and the merchant's share
is the **residual by construction**. Each settled leg's observed amount is compared against **that leg's own
frozen share** with a per-leg band of two satoshis, because the scope the specimen itself measures is the
receipt, not the sum.

The band that applies to the **aggregate** is the **sum of the per-leg bands**, `N x tolerance` where N is the
leg count, by the triangle inequality over the per-leg residuals. A flat band on the sum is wrong and is not
this rule. The case that must never be reachable is a fully-settled set whose every leg is within its own
per-leg band and which is reported as anything other than `complete`.

A fully-settled, all-legs-settled set that is **beyond** the aggregate band has exactly **two directions**,
and its residual is signed: **`short-settled`** when the residual falls below the band (the merchant is owed —
under-collected) and **`over-settled`** when it rises above (the merchant holds extra — over-collected). It is
never one state, and neither direction is a non-settlement terminal. The partition arithmetic itself is not
re-derived here: this contract states the rule, its basis and its bands, and the aggregate's own module owns
the computation.

## `#445a29` — Every terminal is reached by a named rule or by a named human

Every declared terminal must be **reachable by a rule**: a lifecycle that names a state no transition reaches
leaves the thing it governs unfinished in perpetuity and silently requires a human to close it. So for every
terminal there is a named rule that reaches it and a named owner of that rule — and a non-settlement terminal
is a **distinct state from settlement**, surfaced as such, never a settlement written by a timer.

A transition is **human-reached if and only if its only trigger is a human-supplied input**. There are exactly
three, each named: the **buyer's manual preimage** closing a manual or passive leg — a hand-entered preimage
validated against the leg's own expectation; the **seller's confirmation** moving a leg to the declared
non-settlement rung on the purchase set; and the **seller opening a refund set** — the refund direction's
initiation, a seller-side second payment whose state is on-protocol and whose trigger is off-protocol. Every
other transition, the time-reached non-settlement terminal included (time is a rule input), is rule-reached.
A human-reached terminal records **who may close it**; it is never a licence for the gate or for this contract
to close anything silently.

## `#939eef` — The non-settlement terminal is reached only where no witness exists, and it is not reversible and not a settlement

A leg reaches the non-settlement terminal `abandoned` **only where no witness exists and none can still
arrive** — never by the mere elapse of a clock. A leg whose witness might still arrive stays `unresolved`: a
window that has not yet elapsed, and an observation that _failed_, each leave the leg `unresolved`, because
the artifact could still be reported — so the terminal is **never a back door out of `unresolved` for a leg
whose witness might still arrive**. The terminal is **terminal**: it is write-once and _not reversible_, so a
later observation never lowers it and never reopens it to a settlement. And it is **not a settlement**: a leg
at `abandoned` carries no witness and remains unwitnessed, and time alone never writes `witnessed-settled`
(`#6f9f08`). Which window a rail's leg uses, and what counts as an observation that failed for that rail, is
the rail's own fact, stated in the rail and not here.

## `#d16b28` — The port's types have one home here: this module ships the three operations, the shapes they exchange, the rung vocabulary, the per-rail operations subset and the registration shape, and it performs nothing

The port's types ship **once**, in this module, and they ship as **types only** — no store, no transport, no
authority code, no side effects. The three operations, the shapes they exchange, the rung vocabulary, the
per-rail operations subset that lets a leg without a `submit` be legal, and the registration shape the
aggregator's gate will validate are all declared in `ts/types.ts` and re-exported from `ts/index.ts`; every
wrapper obtains them from this ancestor instead of minting its own copy, so there is one dialect and one place
a change lands. The module performs nothing: it has no value exports, opens no socket, writes no record and
holds no durable state.

## `#09f049` — A composing app leaves its authority's reconcilers enabled, or supplies an equivalent

A leg whose settlement is read from a **local** authority's own operation record — rather than from a fresh
call the wrapper makes at settle time — depends on that authority's reconciliation actually running. So a
composing app **must leave its authority's own reconcilers enabled** — its proof-state watcher, its quote
watcher and its settlement processor — **or supply an equivalent**, and **with them disabled a leg cannot
settle and must not be reported as settled**. The obligation is stated here because this contract owns what a
composing app must supply; _which_ reconcilers a given authority actually has is the wrapper's to name, and
the wrapper is where the check lives: a wrapper that reads a settle out of the authority's own record must
refuse it when the reconcilers are off, so the requirement is a condition on the read rather than a promise
about the app's diligence.

## What this contract deliberately does not contain

No journal, no store, no leg record and no durable state; no transport and no authority code; no per-rail
vocabulary in a declaring line (a rail that lands edits nothing here — the method union and the app's
registry carry the volatile list); no restatement of the wallet's bearer, ordering or lifecycle statements
(cited, never restated); no re-derivation of the conservation arithmetic; and no citation of a descendant —
the aggregator and every wrapper are below this node, so no declaring line names one.
