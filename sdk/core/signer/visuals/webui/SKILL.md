# signer webui — skill

A self-contained page that explains the signer module to a reader who is not a programmer: what it is,
what it guarantees, what was measured, and what it does not do yet. One file (`index.html`), no server
and no network required — it also opens directly from `file://`.

## Open it

The page is a **static file** — open `index.html` directly (`file://`), or let the launcher serve it (it is a
static surface; `plebctl surfaces` shows it). Its run program was dropped on 2026-10-02: the page calls no
backend, so a process was needless (order §1.7).

## What it shows

A hero and nine chapters: the job; the thirteen operations; the four ports; the session state machine;
the five lanes; the five invariants and how each was attacked; the measured evidence; what is not yet
true; and the open questions. Ten inline SVG diagrams, an explorable state machine, and scroll motion
that respects `prefers-reduced-motion`.

## Status (read this before quoting the page)

The page is **art, not evidence**, and it narrates the module as it stood **before the red team's block
was cleared** (`b24c3f1`). Four kinds of number in it are superseded by the repair (`3a723e5` and after);
`README.md` beside this file names them. The spec (`signer/signer.md`) and the executed evidence
(`signer/evidence/`) are authoritative.

## When to use it

Use it to orient a human reviewer quickly. Do **not** quote its numbers — regenerate the evidence
(`bash evidence/run.sh`, `python3 evidence/falsify.py`) and read `signer.md` for anything load-bearing.
