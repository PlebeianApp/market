# event-store webui — skill

A self-contained page that explains the event-store module to a reader who is not a programmer: what it
is, what it guarantees, what was measured, and what it does not do yet. One file (`index.html`), no server
and no network required — it also opens directly from `file://`.

## Open it

The page is a **static file** — open `index.html` directly (`file://`), or let the launcher serve it (it is a
static surface; `plebctl surfaces` shows it). Its run program was dropped on 2026-10-02: the page calls no
backend, so a process was needless (order §1.7).

## What it shows

A hero and nine chapters: the job and what left with the shrink; the local read/write endpoint and its
members; the boundary the module refuses to cross; the three kinds of deletion, told apart; the invariants
and how each was attacked; the measured evidence; what is not yet true; the findings it reports rather than
repairs; and the open questions. Ten inline SVG diagrams, two explorable panels (the three deletions, and the
filter guard), an aside spine, and scroll motion that respects `prefers-reduced-motion`.

## Status (read this before quoting the page)

The page is **art, not evidence**. It adds no statement to the module, edits no declaring line, cites no new
identity, and proves nothing. Every number on it was read in the module's own captures
(`event-store/evidence/01-build-and-tests.txt`, `02-invariant-falsification.txt`) and the module's own
documents; where a number is superseded it is left out rather than invented. The module is **built, not
extracted**, and its live use is a later increment's decision.

## When to use it

Use it to orient a human reviewer quickly. Do **not** quote its numbers as proof of anything, and do not
treat it as a fourth source: the spec (`event-store/event-store.md`), the implementation (`event-store/ts/`)
and the executed evidence (`event-store/evidence/`) are authoritative, and where this page disagrees with
them, they are right. To re-measure, run the commands in chapter 9 of the page.
