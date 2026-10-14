# nostr-io webui — skill

A self-contained page that explains the nostr-io module to a reader who is not a programmer: what it is,
what it guarantees, what was measured, and what is not yet true. One file (`index.html`), no server and no
network required — it also opens directly from `file://`.

## Open it

The page is a **static file** — open `index.html` directly (`file://`), or let the launcher serve it (it is a
static surface; `plebctl surfaces` shows it). Its run program was dropped on 2026-10-02: the page calls no
backend, so a process was needless (order §1.7).

## What it shows

A hero and nine chapters: the job and the boundary it refuses to cross; the contract (six operations, four
exported values, nineteen types, two injected ports); the bounds it owns (the 10 000-event ceiling and the
wall-clock deadline); the six-name refusal vocabulary, as an explorable panel; the rules and the **21**
deliberate mutations that attacked each one; the block that was found and cleared; the measured evidence; what
is not yet true; and the open questions with the page's own assumptions. Ten inline SVG diagrams, each with a
`<title>` and a `<desc>`, plus scroll motion that respects `prefers-reduced-motion`.

## Status (read this before quoting the page)

The page is **art, not evidence**. It narrates the module as frozen at `b7e8562` and is written from the
module's own documents — the spec (`nostr-io/nostr-io.md`), the inventory (`nostr-io/ts/ts.md`), the two
evidence captures (`nostr-io/evidence/01-…`, `02-…`), and the freeze record
(`runs/2026-09-30-first-usable-version/freeze-nostr-io.md`). It must not be quoted for:

- **any number as proof** — every figure is quoted from the captures; regenerate with
  `bash nostr-io/evidence/run.sh` and `python3 nostr-io/evidence/falsify.py` and read the spec for anything
  load-bearing;
- **the module working against a real relay** — no socket is opened by any case, and every relay in the suite is
  a hand-written fake (chapter 8 says so);
- **the module's own stale paperwork** — `nostr-io.md`'s front-matter `levels` still read “none yet” for the
  implementation and the tests, and the body says “neither directory exists yet”, both written before `ts/`
  landed. The page does not repeat those; it is reported to the maintainer instead.

## When to use it

Use it to orient a human reviewer quickly. For anything load-bearing, read `nostr-io.md` (the spec),
`nostr-io/ts/` (the first implementation) and `nostr-io/evidence/` (what was actually run).
