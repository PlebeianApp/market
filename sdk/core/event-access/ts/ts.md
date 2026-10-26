# ts — the event-access module's first implementation (TypeScript)

This directory holds the **TypeScript implementation** of the module whose spec is `../event-access.md`. A
directory is a spec and a spec has many implementations; this is the first one, and it is one host's
realisation — the same contract is satisfiable by a host on another stack adapting the two ports without
inheriting this implementation's idiom (`#fadb8a`).

**It is not a spec.** `../event-access.md` is the spec; this file is an inventory, so that a reader can see what
the directory contains and the check routine can account for the module directory that holds it. This file
declares no statements, carries no identity of its own, and must not grow one — a statement here would be a
statement of the `event-access` module, which already has a document.

**What this implementation is, and is not.** It is the **composition**: five caller-facing verbs (`query`,
`subscribe`, `publish`, `count`, `delete`) and the `{events, complete}` envelope, over **two ports** — the
store's local endpoint and the upstream seam — merging them local-first with **one declared, inspectable
write-back policy**, passing every candidate through **one accept gate** (D-O21, `#496306`), and reporting,
honestly, whether the answer is complete. The gate is one decision applied at three destinations and nowhere
else — the store write, the consumer delivery and the wire publish — bounded by the destination's own wall-clock budget, told the tier the
endpoint declares, and given the link half through an injected resolver rather than a second read path. It keeps
**no store, no cache and no socket** (`#f775fb`, `#e6aa61`): both ports are hand-written fakes in the tests,
`applesauce-core` appears in **neither** dependency list and no specifier leaves this directory (`#0c7fe3`,
D-O19). The fail-closed filter boundary is here and the **predicate is not** — it is reached by calling the
endpoint's `read` (D-O5), never copied.

**Increment 3 — fetch → the library, live → us.** The **bounded fill** (the `network()` step of `query`, and
only it) is no longer a read this module builds itself: it is an **injected loader-backed function**
(`FillRequest`), composed over the one pool by `createLoaderBackedFill`, whose engine is the loader family's own
`createEventLoader(pool, { cacheRequest, extraRelays })` — **cache → relay hints → extra relays**, the sequence
the spec's LF-7 already names. The pool is this module's declared shape, which the seam's `PoolPort` satisfies
structurally: no adapter, no cast, and no vendor type in any signature this module presents. The **live** fill
stays the seam's own subscription, `publish` stays the seam's, and everything the composition owns stays here —
the merge order (LF-1), the write-back policy (LF-2), the one gate, the wall-clock deadline (which bounds the
fill from outside, so the loader carries no budget of its own) and the failure channel (a loader that cannot
answer returns its refusal as a value, so the local answer is never unseated and completeness stays honest).

**The vendor's write-back operators, settled by this module's own install.** E6 labels them `UNVERIFIED` and the
spec adopts them as _implementations_ of the policy. The install inside this directory (`applesauce-loaders`
**6.2.0** exactly) is what settles the label, and it settles it **against** the spec's attribution: the package
exports none of the three names — `mapEventsToStore` and `filterDuplicateEvents` are **imported from
`applesauce-core`** by its loaders, and `storeEvents` is `applesauce-relay`'s and is absent from this tree.
Neither can be adopted here, because both take a store object this module has none of and `applesauce-core` may
not be a dependency of it. The mismatch is **reported** — `policy.ts`'s header states it in full and the builder
hand-off carries it; the spec is the frozen side and the correction is the orchestrator's.

## Inventory

Every file at this level, and nothing else, is listed below. The list is mechanical: `../evidence/run.sh`
extracts the first backticked name from each bullet and diffs it against `find . -maxdepth 1 -type f`, so the
two must be equal for the evidence to be green. `bun.lock` is named here **iff it exists** — the install is this
module's own, and a lockfile is a source artifact rather than a build output.

- `index.ts` — the contract entry: exactly the symbols the module MD's `contract.exports` and `contract.types`
  name (`createEventAccess`, `DEFAULT_WRITE_BACK`, `EventAccessError`, `originOf`, and the twenty-four type
  names), and nothing else — the evidence diffs the three lists.
- `types.ts` — the vocabulary: raw `nostr-tools` events and NIP-01 filters, the reason vocabulary, **both
  ports declared by the consumer** — `StoreEndpoint` with its `tier`, `read`, `write`, `count`, `remove` and
  `changes` members and its own `EndpointReadOptions` (D-O12), and the members of the seam's `NostrIo` this
  module consumes (`query`, `subscribe`, `publish`), which the seam satisfies **structurally** (D-O13, D-O19) —
  the gate's four shapes as the spec prints them (`AcceptDecision`, `AcceptContext` carrying the endpoint's declared tier and
  `resolve`, the widened `AcceptHook`, and the injected `ReferenceResolver`) — and, from increment 3, the
  bounded fill's own three shapes declared structurally rather than imported: `NostrRequest`/`UpstreamPool`
  (the pool the loader family drives, as the seam declares it), `CacheRequest` (the loader's first step, which
  is what the store endpoint's `read` already is), `FillRequest` (the fill, supplied as a function) and their
  `LoaderFillOptions`.
- `errors.ts` — the typed, reason-carrying refusal (`EventAccessError`). Every refusal path raises it, and the
  fail-closed filter boundary surfaces it unchanged — one implementation of the predicate, reached by a call.
- `filters.ts` — one-or-many normalisation, and **nothing else**. Deliberately the smallest file beside the
  filter boundary: identity validation and the match-nothing rule are the store's single implementation, and a
  predicate written here would be the second implementation the module's own stop conditions refuse.
- `merge.ts` — the id-unique union (M2) and the per-id provenance it records, with **local-first precedence**
  (D-O14(c)): the tier that produced an id is recorded as it enters the union, never as a flag mutated on a
  shared event instance (`#5015f4`).
- `policy.ts` — `DEFAULT_WRITE_BACK` as a declared, inspectable value with its five answers, the exclusion
  predicate, and the write-back application against the endpoint port. **The accept decision is no longer taken
  here** (D-O21): it is the composition's one gate, so this file keeps `onReject`'s meaning and no second
  place where an event can be accepted or rejected. Its header carries the E6 settlement: the vendor's three
  operator names, their real homes, and why neither can be adopted here.
- `composition.ts` — the composition itself: the five verbs, the local-first sequence with its wall-clock
  deadline, the merge, **the one gate** (D-O21) with its bound and the link half's resolver, the write-back
  application, the live subscription and the provenance companion read `originOf`. Split from `merge.ts`,
  `policy.ts` and `filters.ts` so each file names one job. It is also, from increment 3, **the one place the
  fetch is the library's**: `createLoaderBackedFill` composes the loader family's own engine over the injected
  pool (cache → relay hints → extra relays) and the fill site takes that function, while the live fill and the
  publish path stay the seam's.
- `composition-root.ts` — **the composition root**, and the one file in `ts/` that names a sibling
  (`../../validation/ts/index`): it builds the validator from the host's declared `ValidatorOptions`
  and passes `validator.accept` as `WriteBackPolicy.accept` on the policy handed to the existing
  `createEventAccess` construction site — the design's composition rung
  (`runs/2026-10-13-validation-layer/proposal/FINAL-composed.md` §1.4). It is **outside** this
  module's contract surface on purpose (not exported by `index.ts`): the socket it fills already
  exists, so nothing in `index.ts`, `composition.ts` or `types.ts` changes. Its specifier is the
  reason this directory's stated allow-list is widened by one entry; the widening is reported, not
  hidden.
- `harness.ts` — **the host side** of both ports, test support only, never exported by `index.ts` and never
  imported by the implementation: a **model** of the store's two predicate branches (a malformed identity value
  rejected with the typed refusal; a present-but-empty `#`-key list answered as nothing, traced to
  `event-store/ts/filters.ts:51` and `:92`, named as a model here and in the spec, D-O18) that records every
  call and never echoes the caller's filter or its order; a second, independently written endpoint fake; an
  **echoing** endpoint that exists **only** so the filter-boundary case can be proved to fail over it; a
  **foreign** endpoint whose every member throws a locally declared error class — the only kind a real
  implementer of the port can throw, since this module's own error class may not be imported by a sibling;
  a recording, throwing endpoint and a recording, throwing seam that throw from every method; a scripted
  seam, a bare one, a never-answering one and a failing one; **two change feeds** (a deliberately
  single-consumer queue and a broadcast one) so the composition's fan-out is proved not to depend on the
  port's consumer semantics; a **pool** fake — a hand-written `UpstreamPool` that records every request and the
  relay set it was dialled with, so the loader-backed fill can be proved to go through the loader and the live
  path to leave it silent (increment 3); and a bounded collector whose timeout fails a case rather than hanging it.
  Keys are generated at run time.
- `composition.test.ts` — the named paths P1…P7 and the invariants LF-1…LF-7, plus provenance on P1 **and on
  P2**, `persist:false` with its positive companion, the envelope, the declared policy and **the gate's six
  obligations** (the answer really is filtered, on both paths; `publish` writes nothing it dropped and the
  relay attempt sees the same set; the gate is told the tier; a link rule resolves through the
  injected resolver; an over-budget gate drops and the answer still resolves), the tier-driven marking,
  `onReject`'s report channel, the two-subscription fan-out over both change feeds, and the filters as each
  tier receives them — and increment 3's three: the fill goes through the loader with LF-1/LF-2 intact, the
  live subscription is not routed through a loader, and the loader takes our pool by construction with no
  adapter and no cast.
- `composition-root.test.ts` — **the boundary semantics of the wiring**, four cases over the **real**
  validator through the **real** gate: absent hook ⇒ accept-all (and the same event refused once a
  rule is declared); a refusing validator drops the event at **all three** destinations — not
  written, not delivered, not published — with its positive companion; the quarantine outcome holds
  the event and never admits it, naming the reference nobody could answer; and a link rule makes the
  composition **fetch the referenced event** through its own existing read path (the extra fetch the
  maintainer described), with no second read path grown for it. Each case names the careless
  implementation that turns it red.
- `ports.test.ts` — the fail-closed filter boundary in both branches (and the echoing fake's counter-case), the
  two structural no-socket shapes with their recorded call counts stated, the **foreign** refusal surfaced on
  all four verbs, and a signal already aborted opening nothing.
- `package.json` — the module's own dependency store and its three commands (`test`, `typecheck`, `evidence`).
  `applesauce-loaders` is pinned exactly at 6.2.0, `nostr-tools` is the range that package itself declares,
  `rxjs` is 7.8.2, and `applesauce-core` appears in **neither** dependency list: the store belongs to another
  module and this one never learns what implements its endpoint.
- `tsconfig.json` — the module's own compiler configuration, so a type error is the module's own finding. It is
  `event-store/ts/tsconfig.json` verbatim — strict, `noUnusedLocals`, `verbatimModuleSyntax`, `noEmit` — and it
  includes `**/*.ts`.
- `bun.lock` — the resolved dependency set, written by `bun install`; committed because a lockfile is a source
  artifact, not a build output.
- `ts.md` — this file.

## Running it

```
cd event-access/ts
bun install                      # the module's own dependency store
bun test                         # the module's own suite
bun run typecheck                # tsc --noEmit, the module's own compiler configuration
bash ../evidence/run.sh          > ../evidence/01-build-and-tests.txt
python3 ../evidence/falsify.py   > ../evidence/02-invariant-falsification.txt
```

Nothing above needs the market, and nothing above writes to it. `bun` is not on this environment's `PATH`; from
elsewhere in the assembly, spell it `$HOME/.bun/bin/bun`. The two evidence commands **redirect** because the
scripts print: a script that writes its own capture cannot be run twice, and the second run would overwrite what
the first one proved. Run `falsify.py` on its own — for the length of each mutation the tree is deliberately
broken, so it takes a lock and must not be run beside the suite.
