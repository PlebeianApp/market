# event-access webui — skill

A self-contained page that explains the `event-access` module to a reader who is not a programmer:
what it is, what it guarantees, what was measured, and what is not true yet. One file (`index.html`),
no server and no network required — it also opens directly from `file://`.

## Open it

The page is a **static file** — open `index.html` directly (`file://`), or let the launcher serve it (it is a
static surface; `plebctl surfaces` shows it). Its run program was dropped on 2026-10-02: the page calls no
backend, so a process was needless (order §1.7).

## What it shows

A hero and nine chapters: the job; the two tiers and the one answer they merge into; the seven named
paths and the operations; the one accept gate applied at three destinations (the store write, the consumer
delivery, the wire publish); the bounds the module refuses to
cross; how each rule was attacked on purpose — including the blind wave that blocked the module and the
repair that followed; the measured evidence; what is not true yet; and the open questions. Nine inline
SVG diagrams, two explorable panels (the gate's three destinations, and the P1/P2 path order), and scroll motion
that respects `prefers-reduced-motion`.

## Status (read this before quoting the page)

The page is **art, not evidence**. It adds no statement to the module, edits no declaring line, and is
never cited as proof of anything. Every number on it is read from the module's own captures —
`evidence/01-build-and-tests.txt` and `evidence/02-invariant-falsification.txt` — and can be re-derived by
running the two commands named in `ts/ts.md`.

Two things the page says plainly, because they are the honest gaps: **nothing imports this module** (no
module declares it under `needs:`, and no import specifier reaches it), and its two ports are exercised
only against **hand-written fakes** (`ts/harness.ts`). The accept gate's **validation** half is not wired
in either: the hook is optional and absent by default, so a caller who supplies no rules gets pass-through.

The spec (`event-access/event-access.md`) and the executed evidence (`event-access/evidence/`) are
authoritative.

## When to use it

Use it to orient a human reviewer quickly. Do **not** quote its numbers — regenerate the evidence
(`cd ts && bash ../evidence/run.sh > ../evidence/01-build-and-tests.txt`,
`python3 ../evidence/falsify.py > ../evidence/02-invariant-falsification.txt`) and read
`event-access.md` for anything load-bearing.
