# index — the prompt library

**A prompt is referenced by the hash of its content, never by its filename.** The filename is a convenience
for humans and may change; the hash is the reference. This is what makes a shared prompt library possible at
all: two people can improve the same prompt independently, a fork is a different hash rather than an argument,
and nothing has to be renamed to disambiguate a version.

**Never edit a prompt in place.** If a prompt's content changes, it is a **new prompt with a new hash**, and it
gets a **new row here**. The old row stays, because references point at it. To check a row, or to re-derive it:

```
sha256sum constitution.md how-to-use.md build.md review.md
```

A file whose hash does not match its row has been edited since the row was written. That is not a mistake to
correct silently — it is a new prompt, and the row is the record of the old one.

---

## How the pieces compose

**One base prompt, exactly one role overlay, one frozen task packet.** Never one agent acting as architect,
builder, adversarial reviewer and production operator at once.

- **The base** is `constitution.md`. Every agent gets it, in every doctrine.
- **The role overlay** decides what the agent may do. The roles come from the Constitution itself (A0
  Architect, A1 Builder, A2 Red Team A, A3 Red Team B, A4 Blind Final Reviewer, R0 Research, D0/D1 DevOps).
  Two of them have a working overlay in this directory, because those are the two that run in every change:
  - **`build.md`** — the A1 Builder overlay: the order of work, the gates, what a builder owes at handover,
    and how to run `../checks/`.
  - **`review.md`** — the A2/A3/A4 overlay: how to attack rather than admire, the finding contract, and how to
    use the same tools from the reviewer's side.
- **The task packet** is the frozen work order: goal, in-scope, out-of-scope, the doctrine, the pin, the stop
  condition.
- **The doctrine** — light or hardened — comes from the task packet and is decided by the human maintainer
  before the work starts. It is defined in `../method.md` (`#9854c6`) and applied by the two overlays above.

---

## The library

### `constitution.md` — the base prompt

- **sha256** `fd8e957a2b1e388646d01f0926e5bf056c12a51de90c2dc7055f10b0a6075048`
- **reference form** `constitution@sha256:fd8e957…75048` · short `constitution@fd8e957`
- **46,544 bytes, 693 lines**
- **status** in use — this is the base prompt for every agent in this repository
- **intended use** heavy-lifting modules: an agent that architects and implements a substantial module on its
  own. A one-line fix does not need it.
- **structure** the master prompt (runtime assignment, mission, authority, evidence language, the baseline and
  freshness protocol, default-deny, secrets, boundaries, validation before reduction, change discipline, the
  verification policy, the finding contract, the handoff packet, stop conditions) · the role overlays A0–A4,
  R0, D0, D1 · the domain overlays (Nostr and signer, Bitcoin/Lightning/Cashu/Coco, DevOps/SRE, AI/ML, FIPS,
  napplets/nsites/CMS and remotely defined UI, FOSS and supply chain, freedom-tech, Open Markets Protocol) ·
  the default response contract · the self-check.
- **⚠ this row is new, and the previous one is superseded — recorded rather than replaced.** The copy that
  arrived from the retrofit's `builder/` was **not** the artifact the source index recorded. The source row
  said `9eaaf1a4946eafb9bec05b8c89242565a7a474cdfb780821a9f90de1ef6c1766`, **43,404 bytes, 671 lines,
  "verbatim as received"**. The file copied here is **46,544 bytes, 693 lines** — **+3,140 bytes, +22 lines**
  — and hashes to `fd8e957a…`. So the artifact was **edited after it was received and recorded**, and under
  this library's own rule that makes it a new prompt.
  - **What that means:** any citation of `constitution@9eaaf1a4…` refers to text this repository **does not
    hold**. The old row is preserved here so that reference stays resolvable as a _reference_, and the
    honest state is: **the original is not in this repository; whoever holds it should supply it** if the
    digest form is going to be used for anything that matters.
  - **What was _not_ done:** the arriving copy was not reverted, and no attempt was made to reconstruct the
    original from the recorded digest. Both would be guesses dressed as corrections.

### `how-to-use.md` — the human operator's guide

- **sha256** `80f3480635192741809f37f52e45d766fb7667f92c5e9b03d81c468e93dbe9e3`
- **reference form** `how-to-use@sha256:80f3480…be9e3` · short `how-to-use@80f3480`
- **4,694 bytes, 141 lines** — **byte-identical to the recorded artifact**, digest for digest
- **what it is** the operator's guide, written for a person rather than an agent: three separate conversations
  for an ordinary change (Architect, Builder, Red Team), the extra roles for payment/keys/identity/migrations/
  production/cryptography, and the exact sentence to open each conversation with so the role is unambiguous.

### `build.md` — the builder's overlay (A1)

- **sha256** `6dbe7b4c9468e6a40cbe7198ae483223e72f677c1c9e0cd8e4ec7f343da86a5c` · short `build@6dbe7b4`
- **76 lines**
- **what it is** the order of work and the gates for both doctrines, what a builder owes at handover, and the
  tool-by-tool instructions for `../checks/`.
- **authored here**, not imported: the retrofit's equivalent (`builder/prompt.md`) was written around that
  assembly's paths and stages. This one is the same discipline stated for this repository.

### `review.md` — the reviewer's overlay (A2 / A3 / A4)

- **sha256** `18a9800fb35bfbb62c47bb6893516ea41cf163a4a7245249e7339ff86da1ff92` · short `review@18a9800`
- **65 lines**
- **what it is** how to attack rather than admire, the per-claim verdict discipline, what each reviewer role is
  forbidden to do, and how to use the same tools from the reviewing side.
- **authored here** for the same reason as `build.md`.

---

## The eventual home

The intended home for these files is a **store addressed by content hash**, so that a run can pull its prompt
by hash instead of shipping it inside a repository. Until then they live here, and **this index is the mapping
from hash to file** — because a library without an index is a directory of files with unexplained names.

## What this library does not yet carry

- **The role overlays other than A1 and the reviewers.** A0 (Architect), R0, and the two DevOps roles are
  described inside the Constitution and have no working overlay here yet. An agent given only the Constitution
  and the role name is following this library's intent, not this library's files.
- **The toolkit's own hashes are not indexed here.** `../../checks/` is a set of tools rather than a prompt
  library, and it is versioned with the code it checks. If a check is ever referenced by digest the way these
  prompts are, it needs its own index.
