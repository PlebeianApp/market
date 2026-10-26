# ts — the event-store module's first implementation (TypeScript)

This directory holds the **TypeScript implementation** of the module whose spec is `../event-store.md`. A
directory is a spec and a spec has many implementations; this is the first one, and it is one host's
realisation — the Rust, Angular and Flutter implementations the maintainer named are the others, and none of
them exists yet.

**It is not a spec.** `../event-store.md` is the spec; this file is an inventory, so that a reader can see what
the directory contains and the check routine can account for the module directory that holds it. This file
declares no statements, carries no identity of its own, and must not grow one — a statement here would be a
statement of the `event-store` module, which already has a document.

**What this implementation is, and is not.** It is the module's **local half**, and its contract surface is the
**endpoint** (`#e472d3`, `#5dcce6`): a declared tier, a local read, a local write, a count from its own index, a
local removal, the local change notification, the event view, the dedupe and head rules, the deletion and expiry
predicates, and the persistence seam's _types_. The five caller-facing verbs and the `{events, complete}` envelope
**left on 2026-09-29** (`#f54c68`) and moved to `event-access`; with them went the relay port, the deadline, the
completeness fact and the write-back policy, and none of them is a name of this module any more (`#9f5778`). It
opens no socket, holds no timer and reads no host global: the clock is injected and defaults to seconds and the
database is optional. What it never claims is completeness — with no network phase there is nothing that could be
incomplete (`#4f4cc6` as amended).

## Inventory

Every file at this level, and nothing else, is listed below. The list is mechanical: `../evidence/run.sh`
extracts the first backticked name from each bullet and diffs it against `find . -maxdepth 1 -type f`, so the
two must be equal for the evidence to be green. `bun.lock` is named here **iff it exists** — the install is this
module's own, and a lockfile is a source artifact rather than a build output.

- `index.ts` — the contract entry: the factory, the declared support value, the typed error, **the two predicate
  names** (`assertIdentityFilters` and `matchesNothing`, exported by D-O18 so a consumer's fake can be a
  differential against the single implementation), the head rule, the view's functions and the spec's types.
  Exactly the module MD's `contract.exports` and `contract.types`, and nothing else — the evidence diffs the
  three lists.
- `types.ts` — the vocabulary: events, filters, reasons, the clock and the declared support, **the endpoint's
  four shapes** (`EndpointTier`, `EndpointReadOptions`, `EndpointWriteOutcome` and `StoreEndpoint`, the shape the
  composition declares adopted verbatim), the count and the deletion reference, the declared eviction policy, and
  the persistence seam declared **as the library's own two interfaces**. It declares **no** relay port, no
  subscribe or publish options and no envelope: those left with the operations.
- `errors.ts` — the typed rejection: one class carrying the contract's `Reason`. Every fail-closed path raises
  it, and the module throws nothing else.
- `filters.ts` — the fail-closed identity guard and the filter normaliser, plus `FILTER_SUPPORT`, which is E3's
  required declaration rather than a capability this implementation has.
- `heads.ts` — the module's single head rule: one winner per address, ties by the lexicographically lower id,
  arrival order never. The same comparator is the read's order, so the two cannot disagree.
- `view.ts` — the pure view over one event: the library's identity, coordinate and provenance helpers
  re-exported verbatim, the tag accessors, and the two classification predicates the library conflates.
- `deletions.ts` — the module's only kind-5 predicate: author-scoped, time-bounded, and deliberately not the
  library's delete manager.
- `store.ts` — the **endpoint**, over the store of record: the local read and the local write, the count, the
  local removal and the local change notification, with the store of record opened retaining everything so that
  the three `keep*` policies are the contract's and are applied on read.
- `harness.ts` — the **host** side of what is left, for the tests: signed events (with keys generated at run
  time), a manual clock, the names that must never appear on the handle, and a bounded `take()`. Not exported by
  the contract; nothing in the implementation imports it. The fake relay is **gone** with the edge it plugged
  into — M5 is structural now, and a handle with no relay member is a stronger fact than a fake that was never
  called.
- `invariants.test.ts` — the invariants as named cases, one where the module can prove one on its own, plus the
  structural conformance of the endpoint (a compile-time assignment, so a drift breaks the build).
- `store.test.ts` — the endpoint through the contract: the read order and its per-filter limit, the
  anti-collapse-first window, the versions, the count, the kind-5 write, the removals and the change
  notification's laziness and exactly-once delivery.
- `filters.test.ts` — the identity guard, the kept empty list, and E3's declaration.
- `view.test.ts` — the view's exact strings and classes.
- `package.json` — the module's own dependency store and its three commands (`test`, `typecheck`, `evidence`).
  `applesauce-core` is pinned exactly; `nostr-tools` is the range that package itself declares, so exactly one
  copy resolves and one event type crosses the seam.
- `tsconfig.json` — the module's own compiler configuration, so a type error is the module's own finding. It is
  the signer module's, verbatim, and it includes `**/*.ts`.
- `bun.lock` — the resolved dependency set, written by `bun install`; committed because a lockfile is a source
  artifact, not a build output.
- `ts.md` — this file.

## Running it

```
cd event-store/ts
bun install                     # the module's own dependency store
bun test                        # the module's own suite (4 files)
bun run typecheck               # tsc --noEmit, the module's own compiler configuration
bash ../evidence/run.sh          > ../evidence/01-build-and-tests.txt
python3 ../evidence/falsify.py   > ../evidence/02-invariant-falsification.txt
```

Nothing above needs the market, and nothing above writes to it. The two evidence commands **redirect** because
the scripts print: a script that writes its own capture cannot be run twice, and the second run would overwrite
what the first one proved. Run `falsify.py` on its own — for the length of each mutation the tree is
deliberately broken.

## Non-commentable files

Three files at this level are JSON or a lockfile, so they cannot carry a doc comment the way the `ts/` sources
do. The convention accounts for them by naming them here, in the spec that governs this directory, and saying
what each serves. None carries a statement identity and none sits under a token — this sentence is the
accounting:

- `package.json` — the module's own dependency store, its pinned `applesauce-core`, and the three commands
  (`test`, `typecheck`, `evidence`) the runner and the typechecker are driven by.
- `tsconfig.json` — the module's own compiler configuration, so a type error is the module's own finding
  rather than its host's.
- `bun.lock` — the resolved dependency set `bun install` wrote, committed because a lockfile is a source
  artifact and not a build output.

Every other file in `ts/` is TypeScript and declares itself in its own doc comments; `ts.md` itself is this
inventory.
