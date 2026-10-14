---
module: wallet
kind: module
schema: architecture
applies: core@0.1
inherits: [core, funds-contract]
implements: []
opt-out: []
test-support: ["ts/*.test.ts", "ts/memory.ts"]
levels:
  objective: present
  technical-spec: present — the set record and its derivation, the conservation rule and its two directions, the acceptance gate, the watcher and the refund guard
  implementation: present — dependency-free TypeScript in ts/, the set's owner, with the contract's types obtained from the ancestor and every wrapper injected as a port; and the interactive page under visuals/webui/ — a self-contained model of the semantics, with a console that drives the derived set state
  tests: present — the module's conformance suite, run by `cd wallet/ts && bun test`
contract:
  entry: ts/index.ts
  operations: [pay, status, reconcile, openRefund, partition]
  exports: [PayAggregator, deriveSetState, FundsRegistrationGate, MemorySetStore, FundsRegistrationError, FundsDuplicateRefundError, PayAggregatorError]
  types: [AggregatorOptions, AggregatorWrapper, LegEntry, LegHandle, LegIntent, LegPartition, RefundRequest, SetDirection, SetHandle, SetIntent, SetRecord, SetState, SetStore, WitnessVerifier, SettlingWitnessKind]
implementations:
  - id: ts
    lang: typescript
    dir: ts
    entry: ts/index.ts
    package: null
    install: [bun, install]   # every action is a token array, never a shell string
    build: []
    test: [bun, test]
    typecheck: [bun, run, typecheck]
    needs: [funds-contract]   # CODE dependency (module name): the port's types are obtained from the ancestor
access:
  group: m_wallet
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - the app's checkout, which declares the intent set and reads the set handle
  - the app's orders, which reads the set verdict keyed by the order's own identity and opens the refund
naming:
  reserves: the set's own vocabulary — the set record and its states, the conservation partition, the gate's refusal vocabulary and the refund guard
  does_not: no rail name appears anywhere here — the wrappers are injected ports, so adding a rail edits the app's registry and not this module; the reserved mount names (core, market) are untouched; no descendant is named on a declaring line
  rename: a one-word answer substitutes the directory, the module key, the MD filename, the access group and every command or path that names the module, and nothing else — every declaring line, its identity and every citation of it stays byte-identical
  was: pay-aggregator — renamed to wallet on 2026-10-07, in the one unit of work that moved the Coco wallet host aside to cashu-wrapper; this module is the set's owner and names no rail, so its name is the app's money seam — the module the app composes, distinct from the protocol wrappers it takes as injected ports
source:
  run: runs/2026-10-06-payments-architecture/ — the increment order's I5, read with the gate-and-refund, the money-mechanism and the state-machine refinements
  direction: architect-O5-wrappers-and-aggregator.md (the set the aggregator owns, and the line that would make it a host); architect-B2-acceptance-gate.md (the registration shape, the mechanical-versus-declared split and the refusal vocabulary)
  corrected: refine-gate-and-refund.md (the plan/port tie, the no-echo refusal and the refund guard); fix-money-mechanisms.md (the aggregate band and its two directions, the terminal, the deadline); refine-state-machine-and-rungs.md (the states and which terminals a rule reaches); refine-witness-trust.md (the cryptographic-versus-declared split)
  decision: the aggregator inherits core and the contract only — it names no rail — and takes the wrappers as injected ports, so it stays byte-identical when a new rail lands
webui:
  - id: webui
    title: The payment state machine, laid out to be driven
    entry: visuals/webui/index.html
    run: [bun, run, visuals/webui/run.ts]
    skill: visuals/webui/SKILL.md
    port: 4329
    ready: { kind: http, target: http://127.0.0.1:4329/ }
evidence: evidence/ — regenerated, never hand-edited: run.sh (the gate this module passes) and hash-refs.py (the spec <-> implementation cross-reference)
---

# wallet — the set, the conservation rule, the acceptance gate and the refund guard

**The job, in one sentence** — own the purchase set: bind one frozen total to an ordered set of leg
handles, keep each leg's witness rather than a verdict, derive the set state from what is proven, enforce
the conservation rule over the aggregate, run the acceptance gate every wrapper must pass, watch the set to
its rule-reached terminal, and be the durable authority on whether a refund set exists for an order.

**What it is.** The one node whose job is a fact about the **set**: no wrapper can see the other legs, the
frozen total or the order, so no wrapper can answer "did the whole purchase settle". The aggregator adds
exactly the set record, the conservation partition, the witness-versus-expectation comparison and the
refund guard — and nothing else.

**What it is not.** It owns **no leg journal**: it holds each leg's witness expectation and the handle by
which the owning wrapper is asked, and never a copy of any leg's reference. It does not gather the per-leg
records, it does not re-derive a leg's witness itself (it re-checks only the self-contained kinds against
the expectation it already stores), and it is not the authority on any leg. If it ever wrote a leg's
reference or asked an authority directly, it would be a host rather than the set's owner — the line the
design draws, and this module stays on the set's side of it.

**It names no rail.** The aggregator's declaring lines cite only the contract, and each wrapper is taken as
an **injected port** (the same shape `event-access` takes its two ports), so adding a fourth rail touches
the app's registry and the new wrapper — never this module. The wrappers' names appear nowhere here:
a declaring line that named a rail it does not inherit would be a hard graph finding, and the module is
built so that property is true of it.

**The files this module owns.** `wallet/wallet.md` (this document); `wallet/ts/index.ts`
(the entry), `wallet/ts/types.ts` (the set's vocabulary and the injected ports),
`wallet/ts/errors.ts` (the closed error surface), `wallet/ts/gate.ts` (the acceptance gate),
`wallet/ts/aggregator.ts` (the set's owner), `wallet/ts/memory.ts` (the test-only in-memory
set store) and `wallet/ts/aggregator.test.ts` (the conformance suite); and
`wallet/evidence/run.sh` and `wallet/evidence/hash-refs.py`; and the interactive page under
`wallet/visuals/webui/` — `visuals/webui/index.html` (the self-contained model), `visuals/webui/run.ts`
(the run program that serves it on the reserved payment-surface port) and `visuals/webui/SKILL.md` (its skill
file), all three declared in the front-matter's `webui:` block. The toolchain files
(`ts/package.json`, `ts/tsconfig.json`, `ts/bun.lock`) are the toolchain's, not this document's. The
in-memory store and the test file are **test support**, declared in the front-matter's `test-support:` and
out of contract: a statement must not be fulfilled by tooling, so the store cites the set-store statement as
its provenance, never as a behaviour.

## The statements

One statement per behaviour, each a line of its own with its content-hash identity assigned by
`python3 -B core/checks/check.py --root . --assign` — never typed. The port's vocabulary is the contract's,
cited and never restated.

## `#c5418e` — The set record records a witness per leg, never a verdict, and the set state is derived from what is proven, excluding any untrusted leg

The set record binds one frozen total to an ordered list of legs and, for each leg, keeps the **witness it
saw** — the kind, the source, when it was observed and its reference — never a verdict (the contract's rung
vocabulary, `#6f9f08`). A leg entry carries
its expectation (the payment hash the set already holds) and its frozen share, and an **`untrusted`**
marker. The set state is **derived**, never stored as a leg's claim: a leg counts toward the settled sum
only when it is `witnessed-settled` **and not `untrusted`**, and an `untrusted` leg is excluded from the
derivation **and from its amounts**. The case that must never be reachable is a set reported `complete` (or
otherwise paid) while one of its legs is `untrusted` — it is forbidden by construction, because a set with
an untrusted leg can never satisfy the completeness condition, and a named test asserts it. The record is
written **before any leg is submitted**, and it holds the leg handle by which the owning wrapper is asked —
never a copy of any leg's reference.

## `#6fd585` — The acceptance gate accepts only a well-formed, self-consistent registration and refuses it fail-closed from closed enums that interpolate no value

Every wrapper is accepted or refused at registration (the contract's acceptance-gate statement, `#87e7a5`).
The gate validates the registration shape the
contract owns — the wrapper's stable identity and method, the operations it exposes and their ordered plan,
the declared store and its kind, the authority kind, the witness kinds it can produce, the reconcile
deadline where the authority is remote, the journal reference and its boundary, the ceiling and the contract
version. It refuses, fail-closed, with a single error constructed from two **closed** enums — a field and a
reason — that interpolates **no value**, so no payload of any type can reach the message and a value with a
hostile `toString` cannot turn a refusal into another error. It refuses the empty, the unknown and the
duplicate plan; a plan that is not the declared operations' ordered projection; **a plan with no reconcile
step** — a wrapper that can move money but can never be learned; an identity that is empty, oversized,
untrimmed or carries a control character; an authority kind outside its two values; a missing or non-positive
reconcile deadline on a remote leg; an empty or out-of-ladder witness-kind list; an absent store; a
non-positive ceiling; a stale contract version; and a method already registered.

**The gate's honest limit, stated once so the spec does not overclaim.** It enforces the **shape and
self-consistency of a declaration, never its conduct**. It cannot make a declared plan the plan that runs,
make `reconcile` truthful, make a declared witness producible, make a store durable or its compare-and-set
atomic, or make a ceiling the cart's own number. A well-formed declaration that lies is accepted, and the
residue is one human judgment per wrapper and per return site. It is worth building — a malformed
registration is a real failure mode — but it is not the discriminator between designs, and the behavioural
enforcement the design wanted is the conformance suite, a deliverable. The gate refuses a wrapper with no
reconciliation in its plan; whether a wrapper can **produce** the witness kinds it declares is not
mechanically checkable, and the suite, not the gate, carries that obligation.

## `#16a79e` — Conservation is a per-leg band summed for the aggregate, with a signed residual and two directions; a fully settled set cannot be reported incomplete

The basis is **net**, and the residual has an owner: the aggregate is derived from the parts — the frozen
total is the sum of the legs' frozen shares, fees are netted before the comparison, and the merchant's share
is the residual by construction (the contract's conservation basis, `#5cd6a4`). Each settled leg's observed amount is compared against **that leg's own
frozen share** with a per-leg band. The band that applies to the **aggregate** is the **sum of the per-leg
bands**, `N x tolerance`, by the triangle inequality over the per-leg residuals — never a flat per-leg bound
applied to a sum. A fully settled set, every leg `witnessed-settled` and each within its own per-leg band,
is `complete`, and a fully settled set is **impossible to report as incomplete**: the case that must never
be reachable is such a set reported as anything but `complete`, and a named test asserts it. A fully settled
set **beyond** the aggregate band takes the direction its **signed residual** implies — `short-settled`
(below the band; the merchant is owed) or `over-settled` (above it; the merchant holds extra) — two states,
never one, and neither is `abandoned`.

## `#dc848c` — A set whose legs are all terminal with at least one abandoned reaches its terminal state by rule; time alone never settles a leg

The watcher asks each owning wrapper for its leg's handle (the contract's rule that every terminal is reached
by a named rule or a named human, `#445a29`). A set whose legs are **all terminal and at least
one `abandoned`** reaches `abandoned` **without a human** — the rule is "every leg terminal, at least one
non-settled", and the input is time (a rule input, not a human). A remote leg that **has not answered**
reaches `unresolved`, and the set stays `unfinished`; the leg's reconcile deadline makes that bounded, and
the deadline is an **absolute instant on the leg record**. **Time alone never promotes anything to settled**:
a passed deadline can reach the non-settlement terminal and can never write `witnessed-settled`. Only a
**cryptographic** answer — a preimage, or a receipt whose preimage validates — may settle a leg, and a
post-deadline cryptographic answer still settles a still-open leg because a fact observed is a fact. Every
other transition of the purchase machine is rule-reached; the one transition the machine needs a human for
is the seller opening a refund set, which lives in the refund direction, not here.

## `#92fc64` — The refund guard is the durable authority on "no refund exists for this order", keyed on the resolved purchase set's identity

The aggregator's durable store is the **sole authority** on whether a refund set exists for an order. Its
`openRefund` resolves the named purchase set and keys on **that resolved set's own identity** — the order
join key it carries — rather than on an identifier the caller supplies unchecked. Before writing any refund
record or calling any wrapper it refuses, fail-closed: a **duplicate** (the refund index already names a
refund set for the resolved order), an **unresolvable correlation** (the named purchase set does not exist),
and a refund whose frozen total **exceeds the purchase total** — the order-level conservation relation
stated and evaluated on the values the app feeds. The refund set record is written **before any refund leg
moves money**. The case that must never be reachable is a **second refund set for one order** — it is
unreachable by construction, because the guard refuses a duplicate on the resolved order's identity, and a
named test asserts it.

## `#35b51d` — A witness that disagrees with the set record's stored expectation is surfaced as a mismatch, never merged

The aggregator does not take a returned witness on a wrapper's word. It re-checks the **self-contained**
witness kinds — a `preimage`, a `zap_receipt` whose preimage validates — against the expectation the set
record already holds, through an injected pure check that exercises no authority and holds no reference. A
witness that does not meet the expectation is **surfaced as a mismatch** and the set stays `unfinished`:
the wrapper's leg is the leg's truth and the aggregator's expectation is the set's, and a disagreement is
never merged into either. A claimed settle the set cannot substantiate — a witness that fails the check, or
a **declared** kind — moves the leg no further than `attested` and settles nothing, and the mismatch marker
ride on the handle rather than being folded away. For every other kind the aggregator records the value as
the owning wrapper's attested report and never re-fetches an authority.

## `#72fd75` — The clock and the reconcile deadline are injected, and only a cryptographic post-deadline answer settles

The aggregator takes an **injected clock** (`now: () => number`), required so the module never reads a host
clock global, and it computes each remote leg's **absolute** `reconcileDeadlineAt` from that clock when the
set is opened. The deadline is a **wait bound** on the reconcile call and the trigger for the non-settlement
terminal, not a settleability bound: passing it neither settles a leg nor re-submits one. A post-deadline
**cryptographic** answer settles a still-open leg; a post-deadline **declared** answer moves it no further
than `attested`; and a leg already `abandoned` is terminal and write-once — a late artifact opens a
successor set, never a reversal of the abandoned one.

## `#d91675` — The aggregator cites only the contract and takes each wrapper as an injected port, so a new rail edits the app's registry and not this module

The aggregator obtains the port's types from its ancestor, the funds contract (`#de8ec0`), and declares the code
dependency, and it names **no rail** anywhere: its declaring lines cite only the contract, and each wrapper
is taken as an **injected port** — a registration plus a handle-keyed reconcile — supplied by the composing
app. So adding a fourth rail edits the app's registry and the new wrapper, and leaves this module and the
contract **byte-identical**; a declaring line that named a rail the aggregator does not inherit would be a
hard graph finding, and the module is built so that property holds. It opens no network of its own and
reads no host global: the clock, the witness check, the wrapper ports and the durable store are all
injected.

## What this module deliberately does not contain

No leg journal and no copy of any leg's reference; no per-rail vocabulary and no rail name anywhere — the
wrappers are injected ports; no authority code and no transport, so it opens no network and reads no host
clock, storage or window global; the refund's **product surface** (the aggregator holds and proves a refund
and exposes only opaque set handles, never a buyer-visible refund status or affordance); the app wiring
(the registry that composes the rail set lives in the app); and no re-derivation of the contract's port,
rungs or shapes — they are the contract's, cited and never restated.
