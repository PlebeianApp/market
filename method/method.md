# method — rules

**Version `core@0.1`.** Normative. This repository **is** core (`#0d9077`): there is no project here yet, so
the method sits at the root and a project pulls it in.

Every rule below carries an **ID that is a hash of its own title line** (`#c9ece3`). The ID is not a label
someone assigned; it is derived from the content that follows it. Two rules with the same wording have the
same ID in every fork, and two rules with different wording can never quietly take each other's place.

The method has one purpose: make **design, architecture and spec agree before implementation**, and make the
_placement_ of every decision a consequence of written rules rather than of taste.

A rule changes only by a **confirmed increment** (`#85f5da`), and the change is visible as a diff plus a
transcript that backs it (`#f58404`).

---

## The two axes

A decision has two independent properties, and conflating them is the root of most spec drift:

- **Axis 1 — semantics.** _What kind of decision is this?_ The distillation levels: intention → UX → UI →
  data structures → platform/packages → verification. This is separation of concerns. The file a statement
  lives in _is_ its level, and that is the only place its level is recorded.
- **Axis 2 — scope.** _Who consumes it?_ The assembly graph of modules. This determines where it must live
  so that nothing is duplicated.

An item lives at an **instance of a level** (Axis 1) chosen by **scope** (Axis 2). The ladder never
overrides the level; the scope rule never overrides the level either — it only decides which copy.

---

## The rules

### `#e1cca9` — Everything is a module

A module is a directory plus a `<module>.md` file that accounts for it and declares what it implements.
Core is module 0. The distillation levels are core modules. A project is a module. A project's levels are
modules. Past core, everything is a module **implementing** core, not a tool core is using.

### `#ab48fc` — Accounting

Every file inside a module directory is referenced by that module's MD. A file that is not accounted for is
a finding: _why is it here?_ A reference to a file that does not exist is a failure. This is the anti-rot
mechanism, and it is deliberately cheap.

### `#a04103` — Spec and implementation exist at every level

Each module MD **is** the spec of that level; the module's directory **is** its implementation. Core's own
implementation is this rule set plus the check routine in `checks/` — and the filesystem itself.

### `#91cefc` — The ladder and the placement rule

A statement lives at the **lowest node that dominates all of its consumers** (the lowest common ancestor of
the consumer set).

- Consumers unknown yet (the normal spec-first case) → place by **content kind**, the level whose subject
  the statement is about.
- Neither rule speaks → mark the statement `unplaced` and leave it where it was written. Never guess
  silently; `unplaced` is an honest residue and a queue.

A statement is a single addressable line (`#c9ece3`), so a move between levels is **one line in a diff**,
not a rewritten document.

### `#4ebec2` — Exact cover

Hoist to the LCA; where that node has children that **do not consume** the statement, create the node that
covers the consumer set exactly.

Worked case (the case that produced this rule): a project holds 3 web packages and 11 modules; 8 modules
consume a statement, 3 do not. The plain LCA is the project — hoisting there makes the 3 non-consumers
carry it. Correct answer: create a module that exactly those 8 depend on. The other 3 stay clean.

### `#4275ab` — Termination at core

The exact-cover clause **stops at core**. Core has non-consuming children by definition — every project that
does not need the statement — so at that rung you either accept the widening or create a module that only
the consuming projects depend on. Without this rule the clause would try to invent a node above core and
never terminate.

### `#bd8628` — Policy bubbles by owner, not by consumer count

Code bubbles by consumer count (`#91cefc`, `#4ebec2`). **Policy** — a colour, a relay list, a default
filter, a licence — bubbles by the scope of whoever owns the outcome. 8 of 11 consumers needing a colour
does not put the colour in a shared module; it puts it in the owner's scope, once, declared.

### `#d3fd2d` — The rule of two

One consumer: keep it where it is. Hoisting on the first consumer creates exactly the coupling that trust
boundaries exist to prevent. Two consumers: hoist (`#91cefc`, `#4ebec2`). This is DRY applied at every
level, and it is the _timing_ half of the placement rule.

### `#b22838` — Duplication, precisely defined

- **Duplication** is the same language used twice: the same file defined twice, the same function defined
  twice, the same literal maintained by hand in two places. Duplication hoists to the LCA and the extraction
  is itself a statement with an ID.
- **Two implementations of one spec is not duplication.** It is one intention realised twice — the web
  implementation and a sandboxed implementation sharing one contract is the canonical case. They are not the
  same language used twice; they are the same _spec_ used twice.
- A duplicate that must exist across a spec or trust boundary is allowed **only when the shared parent spec
  declares it with its reason**. Declared → a known exception any reviewer can verify in seconds. Undeclared
  → a failure.
- Precedence when the two definitions collide (same language, across a trust boundary): **the trust boundary
  wins** — duplicate deliberately and declare it, rather than couple the two sides.

### `#85f5da` — The loop

1. **Deliver** the increment decided in the previous conversation.
2. **Conversation, transcript and feedback** — an in-depth review session about how to continue.
3. **Final confirmation of the increment** — human-approved. Wording matters: the increment is confirmed,
   not the transcript, and this confirmation is the last step of the conversation stage.
4. **Distillation** into spec files, against the frozen transcript.
5. **Commit**, then **implement**. Then back to step 2.

A commit closes each stage, so every stage boundary is a git object and a decision can always be traced to
the conversation that produced it. An increment may touch one level or every level; there is no size rule,
and no level is exempt.

### `#f58404` — Transcripts

- As **raw as possible**. Not required to be an exact replication (tooling may not permit it), but the
  distillation must have a real, accurate raw image of what was conveyed, including what was retracted.
- Stored in the sessions repository, mounted here as a submodule at `sessions/`, **frozen by commit** before
  distillation begins.
- Transcripts are **never rewritten** when the method changes. They are the record of what was said,
  including the wording of identifiers that have since changed — so old-style identifiers survive inside
  them on purpose, and any check must read them as evidence, not as spec.
- Distillation is performed **after** the freeze, from the transcript alone, by a distiller that did not take
  part in the conversation. This is the point of the two-step split: humans and agents both self-correct when
  challenged, and a distiller that is still in the conversation inherits the drift.
- A **design-tool artifact is a second kind of transcript** (an export, a diagram, a prototype file). It has
  the same status as a conversation: stored, then distilled. It is not itself authoritative (`#ff5e71`).

### `#ff5e71` — The spec is authoritative; tools render it

An edit made only inside a UI/UX tool is not real until it is re-distilled into the module MD. The MD is
what another agent, an implementation, or a reviewer reads.

### `#65714f` — Tooling placement

Tooling lives inside the module that uses it, as an **install script plus config** that points the tool at
that directory — not as vendored software. A tool with two consumers bubbles up by `#91cefc`/`#4ebec2` into
a core module. **No tooling is declared in this phase**: the starting format is markdown and text.

### `#0a41a2` — Conformance is standard, and it is a routine task

Verification is a distillation level of its own (`checks/`), and it runs as a **routine** rather than as a
gate. Part of it is machine work — the parts that are cheap, mechanical and worth never doing by hand — and
part of it is a small model reading the tree top to bottom for consistency and drift. What is written down
as a hard check is only the part this repository **actively supports**; nothing else is gated, so the routine
never becomes an obstacle to the work. The detail lives in `checks/checks.md`.

### `#11d72f` — The pin, and declared opt-outs

Every module declares `applies: core@<version>` and any level it opts out of. Opt-outs are **declared, never
silent**. A core change fans out to every project that applies it; the lag is **reported**, never
discovered.

### `#b5db20` — Refusals and unknowns are statements

Things this method refuses to do, and things that are not yet known, are statements with IDs at the level
that owns the decision — not prose in a chat, and not silence. See §"Refusals" and §"Open items".

### `#c9ece3` — Statement identity is a hash of the content, never a name and a number

**The rule.** The identity of a statement is `#` followed by the first six hexadecimal characters of the
SHA-256 of the statement's **declaring line** — the line on which the statement begins, with the ID itself
removed. Normalisation before hashing: trim the ends, collapse any run of whitespace to a single space, and
replace every ID citation inside the line with a single placeholder. Nothing else is normalised.

**Why not a name and a number.** A sequence like `UX-014` is allocated by whoever writes it, so two forks
both reach for `UX-014` and mean different things by it. The merge then **overrides** one of them, and
someone has to undo exactly the thing this method exists to prevent. A hash cannot be claimed: identical
content yields an identical ID in every fork, so a merge deduplicates instead of colliding, and different
content yields a different ID, so nothing can silently take another statement's place.

**Consequences, stated plainly.**

- Editing the **declaring line** changes the statement's identity. That is intended: identity means _this
  exact content_. Body text below the declaring line may be edited freely — the declaring line is the
  statement, its continuation is its explanation.
- A reference to an ID that no longer exists is a **dangling reference**, and that is exactly what a reader
  should see after a statement was rewritten. The retired hash belongs in the commit message, not in a
  tombstone line: there is nothing to tombstone, because the old text is in git.
- There is **no lock file and no registry of IDs**. The hash is computed from the text, so it needs no
  storage, cannot drift out of date, and cannot be edited by accident.
- One statement may legitimately carry the same ID in two modules — that is a merge signal, not an error
  (`#b22838`).
- Comparability across machines requires everyone to normalise the same way. The normalisation is stated
  here and nowhere else; if it changes, every ID changes with it, which is a visible and deliberate event.
- **A citation never renames anything.** Every `#xxxxxx` citation inside a declaring line is neutralised
  before hashing, so pointing a statement at another one cannot change its identity — only the prose can.
  This also removes a recursion that would otherwise make the tree unstable: without the neutralisation,
  changing rule A renames every rule that cites A, and each of those renames the statements that cite them.

### `#2526e3` — The scope of enforcement

None of this is enforced on someone else's machine. For an individual it is a discipline; for a team it is
tooling — checks, CI, reviews and approvals. This is stated as a limitation, not as an aspiration.

### `#0d9077` — Core is its own repository

Core is not installed inside a project. It **is** a repository, and a project pulls it in — mounted as a
submodule at `.core/`, or copied, per that project's own decision. `demo/` here is the scaffold a project
starts from: the files a project needs, with core mounted underneath them.

The earlier arrangement — core nested inside a project as `core/` — was a consequence of starting from an
example rather than from core. It is superseded: a project has no business owning the method.

### `#f0a4c3` — Deferred, deliberately

Out of scope until Maxime reopens them: **module ownership and erasure** (a different implementation of
core, not a filesystem concern) and the **collaboration transport** (Nostr/NGIT as the record of record,
where Continuum and WEAVE live). Also deferred: importing existing projects (Plebeian market, the signer,
the scheduler) and the **tooling list** (UI/UX/diagram tools).

Retired by decision: the **symlink/worktree "modification" concept** — plain git, branch and pull request;
and a **lock file for statement identities**, which content addressing makes unnecessary (`#c9ece3`).

---

## Refusals

- No tooling before the text form has proven itself (`#65714f`).
- No silent duplicates (`#b22838`), no silent opt-outs (`#11d72f`), no silent guesses about placement
  (`#91cefc`).
- No policy values inside a module that does not own them (`#bd8628`).
- No protocol locks, and no enforcement of any of this on someone else's machine (`#2526e3`).
- No named-and-numbered identities, ever (`#c9ece3`).
- No second truth: the spec is authoritative over tool artifacts (`#ff5e71`), and a generated view that
  duplicates the spec is not kept at all.

## Decisions and divergences, recorded honestly

**The layout question was answered three times, and the third answer is the one that stands.** On
2026-09-23 Maxime first answered _"let's go with the parent one"_ (core containing its projects), then _"I'd
agree with siblings"_ (core beside its projects), and finally _"there is no project yet, only core … we
should actually just move all the files in there up by one"_ — which is neither: core is its own repository
and a project pulls it in (`#0d9077`).

**A collision that never happened — recorded because it was written down as if it had.** For a period this
project's own files claimed that two parallel sessions had produced contradictory decisions, and that claim
reached four documents. It was wrong: the transcript in question was written by this same session, and the
two answers were one person changing his mind seventeen minutes apart. The lesson is now a standing rule of
the check routine — **the provenance of a transcript is established by reading the record, never inferred
from its content.**

**A false statement can be manufactured by tooling, and it was.** During the identity migration a wrapped
prose line that happened to _begin_ with a citation was read as a statement, given a derived identity, and the
resulting rename was then propagated to every citation of the real rule — so a rule silently lost its name and
the tree pointed at a statement that never existed. The check routine found it, and the rule now carries its
own guard: a declaring line is a heading, a bullet, or a paragraph of its own, never a wrapped continuation of
the sentence above it. This is the same failure class as the "two parallel sessions" claim above — an
inference written down as fact — and it is the reason the check is a routine rather than a matter of care.

**The session-splitting symptom is real, but it is not a forked conversation.** Signal and the desktop app
can both serve one conversation, and the desktop shows more than one row for a chat whose lane was reset.
That is product behaviour, diagnosed separately, and it belongs to collaboration rather than to the method.

**The symlink architecture** was retracted by its author: _"I might have pushed a little bit hard on the
sim-linking architecture … we don't need to rebuild an entire alternative to git just yet."_

**The two determinism rules.** _Content-kind_ ("deterministically, based on what kind of content it has")
and _scope_ ("the lowest possible level that captures the full underlying scope") were both stated. The
placement rule (`#91cefc`) makes them one rule with an explicit precedence order rather than two competing
ones.

## Open items

| #   | Item                                                                                                   | Where it belongs          |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------- |
| O1  | What an **approval** physically is while the collaboration transport is deferred (`#85f5da` step 3)    | collaboration, deferred   |
| O2  | Does the machine-readable shape **generate** types, or do types generate the shape                     | the data-structures level |
| O3  | How many concurrent increment proposals may exist before the human confirmation gate is the bottleneck | the loop                  |
| O4  | Whether module ownership belongs in the filesystem at all                                              | deferred (`#f0a4c3`)      |
| O5  | Whether the git commit or a Nostr event is the record of record for an increment                       | deferred (`#f0a4c3`)      |
| O6  | Whether the check routine's model pass is one prompt over the whole tree or a pass per module          | `checks/`                 |

The `O` labels are the one place a name-and-number survives, and they are deliberately not identities: they
are rows in one table in one file, they are never referenced from another level, and their wording is
expected to keep changing. If one ever needs to be referenced across files, it becomes a statement with an
ID like everything else.

---

## The doctrine — how much assurance a change gets

### `#9854c6` — The two doctrines — light and hardened

One method, run at one of two assurance levels. The level is chosen **before** the work starts, by the human
maintainer, and recorded in the task packet. It is never chosen by the agent doing the work, and it is never
lowered mid-run.

- **Light** — for a change that cannot move money, identity, keys, persistence or production infrastructure.
  The flow is **Architect → Builder → one Red Team → human**: one adversarial pass, and the Builder's diff is
  what gets reviewed.
- **Hardened** — for payment, signer, identity, persistence, migration, production infrastructure, or
  cryptographic work. The flow adds **Red Team B** (an invariant falsifier, which must produce an _executed_
  counterexample, not a suspicion) and a **blind Final Reviewer** (which must not read the earlier reviews).
  Here the evidence is not the diff; it is the reproduction.

What does **not** change between them: the Constitution is the base prompt in both, the authority model is the
same, and the stop conditions are the same. The doctrine decides **how many independent attempts to break the
work happen before a human sees it** — never whether the rules apply.

A change that starts light and turns out to touch money is **re-opened as hardened**. The level may be raised
mid-run and never lowered; lowering it is the one move this rule refuses.

### `#3c9212` — The levels that survive here, and the ones deferred

Core declares eight levels. This repository carries **two**: **`modularization`** — whose rules _are_ this
file, and whose tool is `checks/audit.py`; **its own procedure document has not been imported yet** — and
**`checks`** (the routine and its tools). The other six — `schemas`,
`schema`, `ux`, `ui`, `packages`, `platform-web` — are **not imported here**, and that is a trimming decision
rather than an omission: **a level survives only if some module demonstrates it and the tooling can check
it.** Those six were declared at the start and never demonstrated, so carrying them would be carrying names
for empty shelves.

The deferral is **declared, not silent** (`#11d72f`). When a module arrives that demonstrates one of them, the
level is re-imported with its statement and with the check that proves it — never before it.

### `#97e60d` — A prompt and a check are two implementations of one rule

The rules in this file are the **spec**. `prompts/` and `checks/` are its **two implementations**, and they
are not alternatives to one another:

- a **prompt** is a rule expressed as instruction, for an agent that has to act on it;
- a **check** is a rule expressed as an executable test, for a machine that has to catch its violation.

One spec with two implementations is **not** duplication (`#b22838`) — it is one intention realised twice,
which is the canonical case that rule names. They keep each other honest: a check that nothing instructs
anyone to pass is noise, and an instruction that nothing can check is a preference. Where the two disagree,
**this file wins**, and the disagreement is a finding to report rather than a thing to reconcile quietly.

### `#722d26` — The tools in checks/, and what each one answers

Four tools, one question each. The prompts in `prompts/` say when to reach for which.

- **`checks/check.py` — does the tree obey the rules?** Module discovery and accounting, the `inherits` and
  `implements` citations, dangling references, and the build/coverage wells and vendored-tree hygiene. This is
  the routine (`#0a41a2`) and it exits non-zero on a finding.
  - **What it does _not_ do, stated plainly because a list of what a tool answers is a promise.** It does not
    detect a **second definition** of a thing, and it does not read `opt-out:`. Both are rules of this file
    (`#b22838`, `#11d72f`) that currently have **no tool**, as most of the statements here do. That is a gap in
    the toolkit and not a licence to skip them: until a check exists, **the reviewer is the check**. A gap
    named here is a queue; a gap discovered later is a surprise.
- **`checks/evidence.py` — is the evidence real?** A claim written in a module's MD must be backed by an
  artifact that exists and says what the claim says it says.
- **`checks/audit.py` — what does the tree measure?** Size, fan-in, fan-out, consumers per symbol. This one
  measures rather than judges: it is how a placement decision gets argued from numbers instead of taste.
- **`checks/checks.md` — the routine's own spec.** What is gated, what is deliberately not, and the ledger of
  what the routine has found.

None of these is a gate that blocks someone's commit on their own machine (`#2526e3`). They are a routine:
run them, read what they found, and either fix it or declare it.

### `#51692c` — The method lives in this repository, declared against `#0d9077`

Core's own rule (`#0d9077`) says a project has no business owning the method: core is a repository, and a
project **pulls it in**, mounted or copied per that project's decision. This repository holds the method
**in-tree**, under `method/`, and that is a **declared divergence** rather than an accident.

Why, and why now: the method has to be visible to the agents working in this repository without a second
checkout and without a network the work does not otherwise need. A mount is the intended end state, and the
move to it is a mechanical one — the contents of `method/` are exactly what a mount would carry.

What keeps this honest: the divergence is written here rather than resolved by editing `#0d9077`. That rule's
declaring line is untouched, so its identity is intact and every citation of it still resolves. When the
method moves to a mount, **this statement is the one that changes**, and `#0d9077` needs no edit at all.
