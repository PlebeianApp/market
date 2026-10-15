# validation webui — skill

A self-contained page that explains the validation module to a reader who is not a programmer: what it
is, what it guarantees, what was measured, and what it does not do yet. One file (`index.html`), no
server and no network required — it also opens directly from `file://`.

The module validates an event's **content** against presets a host supplies, at **one accept boundary**,
and does **nothing at all** with no presets. The page's material is the module's own documents:
`validation/validation.md` (the spec), `validation/ts/ts.md` (the inventory) and the two evidence
captures, plus the red-team review and its adjudication under
`runs/2026-09-30-first-usable-version/`.

## Open it

The page is a **static file** — open `index.html` directly (`file://`), or let the launcher serve it (it is a
static surface; `plebctl surfaces` shows it). Its run program was dropped on 2026-10-02: the page calls no
backend, so a process was needless (order §1.7).

## What it shows

A hero and nine chapters: what the module is; the contract (two operations, one gate); the two rule
kinds, both data; the three outcomes and what a caller reads — with an **explorable panel** to pick a
case and see the value; the six bounds and their mechanisms; how it was attacked, including the red
team's counterexample and the repair it caused; the measured evidence; **what is not yet true**; and the
open questions and the assumptions the page invented. Ten inline SVG diagrams, and scroll motion that
respects `prefers-reduced-motion`.

## Status (read this before quoting the page)

The page is **art, not evidence**. It adds no statement to the module, edits no declaring line, and is
never cited as proof of anything. Every number on it is quoted from the module's evidence captures
(`validation/evidence/01-build-and-tests.txt` and `02-invariant-falsification.txt`) or from the freeze
note's own summary of them, not recomputed. The spec (`validation/validation.md`) and the executed
evidence (`validation/evidence/`) are authoritative.

## When to use it

Use it to orient a human reviewer quickly. Do **not** quote its numbers — regenerate the evidence
(`bash validation/evidence/run.sh`, `python3 validation/evidence/falsify.py`) and read
`validation/validation.md` for anything load-bearing.
