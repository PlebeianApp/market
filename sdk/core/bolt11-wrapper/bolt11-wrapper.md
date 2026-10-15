---
module: bolt11-wrapper
kind: module
schema: architecture
applies: core@0.1
inherits: [core, funds-contract]
implements: []
opt-out: []
test-support: ["ts/*.test.ts", "ts/memory.ts"]
levels:
  objective: present
  technical-spec: present — the invoice-and-preimage rail: four legs, the port over them, the durable reference written before the boundary, the injected clock, the witness handling and the non-settlement terminal
  implementation: present — dependency-free TypeScript in ts/, the contract's port implemented over the bolt11 rail with every library call injected
  tests: present — the module's conformance suite, run by `cd bolt11-wrapper/ts && bun test`
contract:
  entry: ts/index.ts
  operations: [obtain, submit, reconcile]
  exports: [Bolt11Wrapper, Bolt11Adapter, MemoryBolt11LegStore, Bolt11WrapperError]
  types: [Bolt11LegKind, Bolt11OperationsDeclaration, Bolt11LegCommand, Bolt11LegKey, Bolt11LegRecord, Bolt11LegStore, Bolt11InvoiceCodec, Bolt11Signer, Bolt11LnurlRequester, Bolt11LnurlVerifier, Bolt11WrapperOptions]
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
  group: m_bolt11-wrapper
  read: [self]
  write: [self]
  exec: [self]
consumers:
  - the aggregator, which inherits this wrapper, reads its registration and executes the acceptance gate
  - the app's checkout and orders, which compose it to obtain an invoice, submit it and reconcile the leg
naming:
  reserves: the bolt11 rail's own vocabulary — the four leg kinds, the invoice-and-preimage reference and a leg store keyed per wrapper and leg
  does_not: no other rail's vocabulary appears here (the NWC rail and the Coco local authority are other modules' increments); the reserved mount names (core, market) are untouched
  rename: a one-word answer substitutes the directory, the module key, the MD filename, the access group and every command or path that names the module, and nothing else — every declaring line, its identity and every citation of it stays byte-identical
source:
  repo: https://github.com/PlebeianApp/market
  commit: 56258b55e2805895c941eb879f7a3ea1308bc0c5 — the assembly's pinned specimen, where the rail's real surface is read
  paths: [src/lib/utils/payment.utils.ts, src/lib/utils/lightning.ts, src/lib/utils/invoiceStorage.ts, src/lib/types/invoice.ts]
evidence: evidence/ — regenerated, never hand-edited: run.sh (the gate this module passes) and hash-refs.py (the spec <-> implementation cross-reference)
---

# bolt11-wrapper — the invoice-and-preimage rail, under the funds contract

**The job, in one sentence** — implement the contract's port (`#de8ec0`) over the bolt11 rail: obtain an
invoice's durable reference and write it before any money moves, submit the one irreversible step, and
reconcile against a witness without ever re-submitting — so a leg of this rail settles on a preimage and on
nothing weaker.

**What it is.** The rail the market already runs on: an invoice and its preimage. It has four legs. The
**browser signer** path hands the invoice to a WebLN-style signer and reads the preimage it returns. The
**broadcast quote** path is passive — the invoice is exposed for the buyer to scan and the app submits
nothing. The **manual preimage** path takes a preimage the buyer hands over by hand. The **LNURL request**
path asks an LNURL-pay endpoint for the invoice and its verification URL. Each leg declares the subset of the
port's three operations it has, so the passive leg's absent `submit` is a **declared fact** rather than a
missing method.

**What it is not.** It holds no connection secret (that is the NWC rail's), it does not evaluate a set's
verdict (that is the aggregator's), it writes no other wrapper's leg, and it opens no network of its own:
the invoice codec, the signer, the LNURL requester and the LNURL verifier are all injected ports, and the
tests drive them with fakes. It carries no authority code: the bolt11 authority is **remote-and-observable**,
so a leg's binding carries a verification expectation, never a reconciliation handle.

**The files this module owns.** `bolt11-wrapper/bolt11-wrapper.md` (this document); `bolt11-wrapper/ts/index.ts`
(the entry), `bolt11-wrapper/ts/types.ts` (the rail's types and its injected ports),
`bolt11-wrapper/ts/wrapper.ts` (the port implementation), `bolt11-wrapper/ts/errors.ts` (the closed error
surface), `bolt11-wrapper/ts/memory.ts` (the test-only in-memory leg store) and
`bolt11-wrapper/ts/wrapper.test.ts` (the rail's conformance suite); `bolt11-wrapper/ts/adapter.ts` (the
rail's adapter — its composition surface: the contract's port beside the aggregator's two-member seam, the
registration and a leg-id-keyed `reconcileLeg`) and `bolt11-wrapper/ts/adapter.test.ts` (the adapter's
conformance suite); and `bolt11-wrapper/evidence/run.sh` and
`bolt11-wrapper/evidence/hash-refs.py`. The toolchain files (`ts/package.json`, `ts/tsconfig.json`,
`ts/bun.lock`) are the toolchain's, not this document's. The in-memory store and the test file are **test
support**, declared in the front-matter's `test-support:` and out of contract: a statement must not be
fulfilled by tooling, so the store cites the leg-store statement as its provenance, never as a behaviour.

## The statements

One statement per behaviour, each a line of its own with its content-hash identity assigned by
`python3 -B core/checks/check.py --root . --assign` — never typed. The port's types are the contract's, cited
(`#de8ec0`) and never restated: this module adds the rail and its legs, not a second vocabulary.

## `#e168d7` — The wrapper implements the contract's port over the bolt11 rail, and reconcile never submits

The wrapper implements the contract's port (`#de8ec0`) over the bolt11 rail: `obtain` returns the leg's
durable reference **before** money moves, `submit` is the one irreversible step, and `reconcile` is the
idempotent step that re-reads an authority and **never** re-submits. A reconcile that already holds a
cryptographic settle returns it unchanged (the settlement is write-once); a reconcile that cannot conclude
leaves the leg where it was and submits nothing.

## `#c912d5` — Each of the rail's four legs declares the subset of the port's operations it has

The rail has four legs — the browser signer, the broadcast quote, the manual preimage and the LNURL request —
and each declares the subset of the port's three operations it has, as the ordered projection in the port's
canonical order. The browser-signer and manual-preimage legs declare `obtain`, `submit` and `reconcile`; the
broadcast-quote leg is **passive** and declares `obtain` and `reconcile` only, so its absent `submit` is a
declared fact rather than a missing method; and the LNURL-request leg is likewise passive, the buyer paying
the requested invoice from their own wallet.

## `#0dc3ca` — The leg record, with its durable reference, is written before the irreversible step

A leg's record is written through the injected leg store **before** the irreversible step of its kind — at
exposure for a passive leg, and before the signer is asked to pay for a money-moving one. The record binds
the leg's durable reference: the bolt11, its `payment_hash`, and the LNURL verification URL when the request
supplied one. The store is keyed **per wrapper and leg** and its writes use a revision compare-and-set, so a
stale writer cannot overwrite a newer leg revision.

## `#4709ce` — The clock is injected, and the reconcile deadline is absolute on the leg record

The wrapper's clock is injected and is never a host clock global, and the reconcile deadline it computes is
written as an **absolute** instant on the leg record (from that injected clock), where the remote authority
requires one. The deadline is a wait bound on the reconcile call, not a settleability bound: passing it
neither settles a leg nor re-submits one.

## `#745885` — A validated preimage settles; a declared verification reaches only `attested`; a failed look-up does not submit

The witness handling follows the contract's one ladder. A preimage validated against the leg's own payment
hash is the **cryptographic** witness that settles the leg (`witnessed-settled`), and a settlement is written
once. A **declared** verification — a bare signer acknowledgement, or an LNURL verification that answers
`settled` without a validating preimage — moves the leg only to the weaker named rung `attested`, and never
settles it. A look-up that cannot conclude (no answer, or an answer that is not settled) leaves the leg
blocked at `unresolved` **and does not submit**.

## `#dc6ab1` — A leg whose invoice has expired with no witness reaches the non-settlement terminal `abandoned`, and it is reached only where no witness exists

The rail's window is the **bolt11 invoice's own expiry**, read by the injected invoice codec against the
injected clock — never the reconcile wait bound the leg record carries, which is a wait bound on the
reconcile call and not a settleability bound (`#4709ce`). At `reconcile`, having re-asked the leg's
verification reference, a leg that holds **no witness** and whose **invoice has expired** reaches the
non-settlement terminal `abandoned` (`#939eef`) — reached by this rule alone, on a read that never submits,
and never a settled rung. It is reached **only where no witness exists and none can still arrive**: a leg
whose invoice is unexpired, and a leg whose look-up **failed** (the artifact it could still report has not
been ruled out), each stay `unresolved`, so a leg whose witness might still arrive can never be closed by the
terminal; a look-up that answers `settled` settles or attests as `#745885` provides, whatever the expiry. A
leg at `abandoned` carries no witness and stays unwitnessed, and the terminal is write-once and not
reversible.

## `#388e47` — The wrapper declares its registration and takes the contract's types from its ancestor

The wrapper declares the registration the aggregator's gate validates — its stable identity, method, port,
method-derived authority kind, the operations it exposes with their ordered plan, its declared store and the
store's kind, the witness kinds it can produce, its reconcile deadline, the shape and boundary of its journal
reference, its ceiling and the contract version. It obtains the port's types from its ancestor, the funds
contract, and declares the code dependency, rather than minting its own copy.

## `#885295` — The wrapper's transport is injected, and the module opens no network of its own

Every library call is an injected port: the invoice codec (decode a payment hash, validate a preimage), the
browser signer, the LNURL requester and the LNURL verifier are supplied by the composing app, and the module
imports no network client and reads no host clock, storage or window global. The tests drive the port through
fakes, so the module is provable with no live node, mint or network.

## What this module deliberately does not contain

No NWC session or connection secret; no Coco/Cashu authority code; no set record or aggregate verdict; no
refund path; no host clock, storage or window global; no network client of its own; and no second copy of the
port's vocabulary — the operations, the rungs and the exchange shapes are the contract's, cited and never
restated.
