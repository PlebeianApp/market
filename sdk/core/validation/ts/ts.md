# ts — the validation module's first implementation (TypeScript)

This directory holds the **TypeScript implementation** of the module whose spec is `../validation.md`. A
directory is a spec and a spec has many implementations (`#465561`); this is the first one, and it is one host's
realisation — the Rust, Angular and Flutter implementations the spec anticipates are the others, and none of
them exists yet.

**It is not a spec.** `../validation.md` is the spec; this file is an inventory, so that a reader can see what
the directory contains and the check routine can account for the module directory that holds it. This file
declares no statements, carries no identity of its own, and must not grow one.

**What this implementation is, and is not.** It is the module's whole first implementation: **presets in,
checks run, and nothing by default** (`#07b8c7`, `#485b96`). Its contract surface is exactly the spec's three
exports and eight types — `createValidator`, `PASS_THROUGH`, `ValidationError`, and `Event`,
`ValidationPreset`, `ValidationCheck`, `ValidationOutcome`, `ValidationRefusal`, `ValidationPort`,
`ValidatorOptions`, `Validator` — and its two operations are `validate(event)`, the module's own entry, and
`accept(event, context)`, which **is** the composition's `AcceptHook` with its `AcceptContext` (`#8393ac`,
D-O24). The rules are **data**, never a function (D-O25): a `format` names a shape, a `link` names a reference
and the named fields to compare, and the engine interprets no kind's semantics at all — not even an `e` tag's
fourth element. It keeps **no store, opens no socket and reads no host global** (`#8e6079`, `#40d21a` (provenance)): the
preset set, the reference port and the clock are injected, the only timer it holds is a bound's own
wall-clock wait (`#e80b77`; `#4b58be` (provenance)), and `nostr-tools` is its only dependency.

**A refusal is distinguishable in the value, however the host grouped its requirements.** A `format` is one
rule that may carry several requirements at once (required tags, cardinalities, value domains, content
constraints), so every format refusal carries the `requirement` that fired — `'missing-tag'`, `'cardinality'`,
`'domain'`, `'content'` — beside the check it came from. The four refusal **causes** stay four and the
requirement vocabulary is a different axis: a format refusal's cause is still `'differs'`, and the requirement
is what tells two failures of one check apart without a message being parsed.

**What throws, and what does not.** Every candidate verdict is a value; **a bound exceeded is an outcome**;
and a resolver that **rejects or throws** is a reference the host could not answer, so it is quarantine like an
`undefined` answer and no rejection escapes. The only throw is a **preset the engine cannot interpret**, in
three shapes: a comparator outside the closed vocabulary (refused at the link check, before any resolution), a
`maxChainDepth` above one hop (refused at the preset, before any candidate is judged — the engine takes exactly
one hop and must not invent what a _referenced_ event's own links are), and a third rule kind.

**The six bounds are declared values** (D-O25's bounded half, `#d4f95d`): ten references per event, one chain
hop, five seconds per reference, thirty seconds per event, one mebibyte of held unresolved references, and
three revisits five minutes apart — the suggested defaults of
`runs/2026-09-30-first-usable-version/research/11-event-to-event-link-protocol.md` §4, each overridable per
preset and each readable without driving a call. **A bound exceeded is an outcome, never an exception**: the
fan-out ceiling and a chain ceiling below one, and both budgets, resolve as _unresolved_, which is the
quarantine outcome. Bound 1 counts **resolutions attempted** — one per link check, from the occurrence each
link names — and bound 5's book is bounded on both sides: its held bytes by the ceiling, and its eviction
record by a count plus the last few names, so the loss log cannot become the leak it exists to prove absent.
A **specific preset wins over a wildcard**, whatever order the host declared them in.

## Inventory

Every file at this level, and nothing else, is listed below. The list is mechanical: `../evidence/run.sh`
extracts the first backticked name from each bullet and diffs it against `find . -maxdepth 1 -type f`, so the
two must be equal for the evidence to be green. `bun.lock` is named here **iff it exists** — the install is this
module's own, and a lockfile is a source artifact rather than a build output.

- `index.ts` — the contract entry: exactly the spec's three exports and eight types, and nothing else — the
  evidence diffs the three lists.
- `types.ts` — the vocabulary: raw `nostr-tools` events, the closed four-member cause vocabulary, the closed
  `requirement` vocabulary a format refusal carries (a different axis from the causes), the closed comparator
  vocabulary, the two rule kinds as a discriminated union of **data**, the preset, the typed refusal, the three
  outcomes, the port (the resolver and the clock) and its answers, the six bounds as declared values, the
  unresolved book (a bounded eviction record: a count plus the last few names), the options, the composition's
  `AcceptContext` adopted structurally, and the handle. The names beyond the spec's eight are the shapes the
  eight need and are **not** re-exported.
- `errors.ts` — the typed, refusal-cause-carrying rejection: `ValidationError`, the module's only error, raised
  only where an exception is the honest shape (a preset the engine cannot interpret: an unknown comparator, a
  chain depth above one hop, a third rule kind), never for a candidate's own verdict — and never for a resolver
  that rejects, which is quarantine.
- `presets.ts` — `PASS_THROUGH` as a declared value and the preset selection: which preset covers a candidate
  (by kind), that a **specific** match wins over a wildcard, and the answer when none does, which is the spec's
  own default (`#07b8c7`).
- `bounds.ts` — the six bounds as declared values with their per-preset override, the bounded wait
  (`withDeadline`: the deadline is a sentinel, and the work's own rejection is the link half's to read), the
  byte accounting, and the unresolved-reference book with **oldest-first eviction recorded as data loss**
  (bound 5) — the record itself bounded to a count plus the last few names — and the revisit gate (bound 6).
- `resolve.ts` — the link half: check the preset's comparator vocabulary when the link check is reached, before
  any resolution; read one reference (the occurrence the preset names); refuse a malformed one by this module's
  own reading; call the injected resolver; and map the answer to the outcome vocabulary — an unanswered, a
  rejected and a timed-out reference are all quarantined, and a held one is compared.
- `format.ts` — the format half: required tags, cardinalities, value domains and content constraints, all read
  from the preset's data, with the engine's kind blindness intact and every failure naming the `requirement`
  that fired beside its check.
- `validator.ts` — `createValidator`: the two operations, the session-scoped unresolved book, the refusal of a
  preset asking for chain following (at the preset, before any candidate), and the bound ceilings and budgets
  that make an over-bound reference an outcome rather than a rejection.
- `harness.ts` — **the host side** of the module's ports, test support only, never exported by `index.ts` and
  never imported by the implementation: signed events (keys generated at run time), a manual clock in
  milliseconds, a recording and a scripted resolver, a never-answering one for the per-reference budget, a slow
  one for the per-event budget, a rejecting one for the resolver-fault case, and the composition's
  `AcceptContext` builder.
- `validation.test.ts` — one case per evidence obligation: the pass-through floor, a refusal and an accept, the
  format rule both ways plus the spec's one-check-several-requirements shape, a link rule for each of matched ·
  mismatched · deleted · expired · malformed · unresolved, a resolving resolver that rejects, the pass-through
  re-asserted over an uncovered candidate, a specific preset against a wildcard, a bound exceeded as an outcome,
  each of the six bounds (bound 1 as resolutions attempted, bound 2 below and above one hop, bound 5's record
  bounded), quarantine never admitted and session-scoped, a revisit that turns unresolved into matched, the
  `accept` operation as the composition's hook, no repair, the closed comparator vocabulary on every candidate
  state, and the declared defaults.
- `package.json` — the module's own dependency store and its three commands (`test`, `typecheck`, `evidence`).
  `nostr-tools` is the range it declares; `applesauce-core` and `rxjs` appear in **neither** dependency list,
  because the module is data-driven and needs no store and no stream.
- `tsconfig.json` — the module's own compiler configuration, so a type error is the module's own finding. It is
  `event-store/ts/tsconfig.json` verbatim — strict, `noUnusedLocals`, `verbatimModuleSyntax`, `noEmit` — and it
  includes `**/*.ts`.
- `bun.lock` — the resolved dependency set, written by `bun install`; committed because a lockfile is a source
  artifact, not a build output.
- `ts.md` — this file.

## Running it

```
cd validation/ts
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
