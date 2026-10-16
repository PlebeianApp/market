---
module: checks
kind: core-module
level: checks
applies: core@0.1
inherits: [platform-web, packages, modularization, schema, ui, ux, schemas]
implements: ['#0a41a2', '#ab48fc', '#c9ece3', '#91cefc', '#b22838', '#11d72f', '#2526e3']
opt-out: []
---

# checks — verification as a routine

Verification is a distillation level, and it is also **core's own implementation** (`#a04103`). It tests the
method against itself.

**It is a routine task, not a gate.** It runs the way a person tidies a desk: partly by machine, partly by a
small model reading the tree, and it reports rather than blocks. What is hard-gated is only what this
repository actively supports and keeps working — today, the identity verification and the accounting of
files. Everything else is a report a human or an agent reads and decides on. Nothing here should ever stand
between a person and their own copy of the method (`#2526e3`).

---

## The parts of the routine

### `#d67dfe` — A check is a routine task, not a gate

It runs at the end of an increment, and on demand. It has no veto. Its output is a short report: what changed
since the last run, what no longer resolves, and what a reader should look at. A check that blocks work is a
check that gets switched off, and a switched-off check is worse than no check.

### `#a88452` — The machine part

Cheap, mechanical, and worth never doing by hand. This is the part worth running as an actual program:

1. **Identity verification.** For every declaring line, recompute the hash of its content and compare it with
   the ID written on the line. A mismatch means the line was edited without re-deriving the ID, or an ID was
   typed by hand — both are findings.
2. **Accounting** (`#ab48fc`). Walk each module directory: every file must be referenced by that module's MD,
   and every reference must resolve. Unaccounted file → _why is it here?_; missing target → failure.
3. **Dangling references.** Every `#xxxxxxxx` reference must exist as a declaring line somewhere in the tree.
   A reference that resolves to nothing is the signal that a statement was rewritten, and the report names
   the commit that changed it.
4. **Form and normalisation.** IDs are six lowercase hexadecimal characters; the normalisation rule
   (`#c9ece3`) is applied identically everywhere.
5. **Duplicate identity.** The same ID in two modules is reported as a _merge signal_, never as an error
   (`#b22838`) — identical content legitimately has one identity.
6. **The module graph.** The graph is declared in each module's front-matter and validated, never assumed:
   targets exist, there is exactly one root, there are no cycles, and a statement may cite only itself, an
   ancestor, or core. A citation reaching sideways to a sibling or down to a descendant is a finding.
7. **Assigning identities.** `--assign` fills in the identity for a statement written with a placeholder, so
   nobody ever types a hash by hand.

### `#175c0f` — The module graph is declared in the front-matter, never implied

Every module declares its parents (`inherits:`) and the graph is checked rather than described: targets must
exist, there must be exactly one root, there must be no cycles, and a statement may cite only itself, an
ancestor, or core. A citation that reaches sideways to a sibling or down to a descendant is a finding — that
is what _the graph is respected_ means, mechanically.

The declared order is **`ux` → `ui` → `schema` → `packages` → `platform-web` → `checks`**, with `core.md` at
the root. It is a layering, not a class hierarchy: a level may use everything above it, and nothing below it.
The graph exists so that a level's dependencies are a decision that is written down once, in the front-matter
of the module itself, rather than inferred from prose — and so that a level cannot quietly start depending on
something that is supposed to depend on _it_.

The machine part is implemented in `check.py` in this directory; that file is this module's implementation,
and it is named here because every file in a module directory must be accounted for (`#ab48fc`).

### `#d39adb` — The model part

A small model walks the file tree **from top to bottom** and reads it for the things a script cannot see:

- **Drift, upward.** A downstream statement that no longer reflects the rule above it, or that has quietly
  grown a behaviour the upstream level never granted.
- **Drift, downward.** A rule that changed while its descendants did not — or descendants that still carry a
  `pending` marker long after the change landed.
- **Contradiction across files**, including between a level statement and the same idea restated as prose
  somewhere else.
- **Rogue movement**: content that belongs at another level under the placement rule (`#91cefc`), and
  statements silently duplicated rather than declared (`#b22838`).
- **Provenance**: that a transcript being cited actually exists and says what it is claimed to say —
  established by reading the record itself, never inferred from a summary of it.

The model's pass is a review, so it states what it read and what it concluded, and it marks its own
uncertainty. It does not edit the tree; it reports.

### `#84d6ac` — Scope of change

Each run records **what changed since the last run** — the commit range, the files touched, the statements
whose identities changed — and the model pass is bounded to that scope plus its neighbourhood. Without a
scope, a model pass over a growing tree either gets shallower every time or gets more expensive every time;
with one, the routine stays cheap enough to actually stay a routine.

### `#ad2328` — What is actively supported

Hard checks exist only where they are maintained. Today that is the identity verification and the accounting
of files — both cheap, both mechanical, both load-bearing for every other rule. Everything else is advisory.
A check nobody maintains is downgraded to a note in the report rather than left to fail loudly and be
ignored.

### `#17e5f0` — A mounted specimen is read, not checked

A top-level directory that is a submodule is a **mount**, and a mount is not a module of this project. So its
statements are not this project's statements: the routine reads them as evidence and does not verify them, and
`core` is the single exception, because it is the method, it roots the module graph, and statements here cite
its rules.

This is not tidiness, it is calibration, and it was measured twice. Vendored trees were skipped first, after a
vendor README's colour code was read as a statement identity. Then the same failure arrived through a specimen:
`PlebeianApp/market`'s own documentation contains six-digit colour literals — in prose, in tables and in a
relay-architecture diagram — and the routine reported **39 dangling references** for them. A specimen whose
diagrams are colourful is indistinguishable, to a pattern matcher, from a project whose statements do not
resolve. A specimen's prose is its own repository's business; what the routine owes that repository is to read
it, and to check the statements that cite it.

The rule also bounds what a statement may contain: a colour literal written as `#RRGGBB` in this very paragraph
would be reported the same way if it were hex, so colour codes belong in a specimen's documents and never in a
statement. That asymmetry is the argument for putting the rule in the routine rather than in the discipline of
whoever writes the next document.

### `#31115e` — An evidence script is checked before it is believed

A number is only as good as the script that printed it. Two runs have now published evidence that was **green
because it never ran**: a test filter whose pattern matched no case, so every row behind it was scored from an
exit code that meant _nothing matched_; and a script that wrote its own capture **in place**, so running it
dirtied the tree and overwrote the evidence it was supposed to regenerate. Neither was caught by the routine.
Both were caught by a reviewer who thought to check, which is the expensive way.

`evidence.py` in this directory is the machine part for that class. It reads every evidence script under the
root — mounts are skipped (`#17e5f0`) — and reports:

- **writes into the tree** — `exec >` to anything but `/dev/null`, or a redirect or `tee` whose target git
  tracks. An evidence script _prints_; the caller redirects. A script that writes cannot be run twice.
- **no `set -e`** — a failed read would be scored as a result. Two remedies, and the author picks: `set -e` with
  `|| true` only where a non-match is _intended_, or an explicit assertion on each read whose outcome matters.
- **a tool that is not on `PATH`, invoked bare** — `bun`, `node`, `bunx`, `npx`. Spell it absolutely, or set
  `PATH=` inside the script. It works in the author's shell and fails in the run's.
- **notes** — no existence guard for the subject it reads; a name-filtered test run that does not assert it
  matched at least one case.

**Its count is a ratchet, not a gate.** The scripts already written are the baseline; what the routine asks of
new work is that it adds nothing to that count, and retrofitting an older script is an improvement rather than a
condition of anything. That is the same shape as the identity and accounting parts above: _0 hard findings_ is
the invariant new work keeps, never a wall that a correct run cannot pass.

### `#b2f0a2` — What a check never does

- It never edits the tree, and it never "fixes" an identity by rewriting content.
- It never treats a raw transcript as spec: transcripts keep the wording they had when they were frozen
  (`#f58404`), so identifiers inside them that the method no longer uses are evidence, not errors.
- It never blocks a commit, a push, or a person's own copy (`#2526e3`).

---

## Open

`#89b5b0` Whether the model pass is one prompt over the whole tree or a pass per module with the root first.
Affects cost more than correctness; the top-to-bottom order is the part that matters.

`#e56fad` How a report is stored — a file per run under `checks/`, or only the routine's output inside the
increment's transcript. Current leaning: transcripts only, until the reports start needing to be diffed
against each other.
