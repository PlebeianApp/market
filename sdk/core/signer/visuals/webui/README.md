# signer — the webUI

A single, self-contained page that explains the signer module to a reader who is not a programmer:
what it is, what it guarantees, what was measured, and what it does not do yet.

## Status — what this page describes, and when

The page is art, not evidence, and it narrates the module as it stood **before the red team's block was
cleared** (commit `b24c3f1`). Four kinds of number in it are superseded by the repair commit `3a723e5` and the
verification commit that followed, and are quoted here so nobody has to diff the page to find out:

- **79 tests / 222 expectations** → **90 tests / 268 expectations**, 5 files, still 0 failures.
- **seven deliberate mutations** → **16**, one per finding the repair fixed, including one that is a command
  rather than a case. The page's warning that _one of the seven rows does not hold up_ was true and is now
  closed: the row's command matched no test because `bun test -t` is a regex and the case name contained
  `(fail closed)`; `evidence/falsify.py` now escapes the name and counts a check that never ran as a failure.
- **record-format compatibility "judged, not measured"** → **measured**, both directions against the reference
  implementation's own vault code at 100 000 iterations, with the scope stated.
- the deviation is written in the page as `attachSigner(signer, settings)`; the spec's line is
  `attachSigner(capability, options)`, and the implementation takes `attachSigner(capability, { lane })`.

`signer/signer.md` (the spec) and `signer/evidence/` (the executed evidence, including `record.md`, which names
each finding and what measures it) are authoritative. Chapter 9 of the page already lists what the page itself
invented; this note is the same discipline applied to its numbers.

## Open it

Double-click `index.html`, or drag it into any browser, or:

```
xdg-open /home/admin_maxime/projects/market-retrofit/signer/visuals/webui/index.html
```

**No server, no network, no build step.** Every graphic is inline SVG, the type is set in system fonts, and the
motion library is vendored in `vendor/` beside the page and referenced by a relative path. It works from a plain
`file://` path, on a plane, behind a proxy.

## What is in this folder

| file                          | what it is                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `index.html`                  | the page. One file, ~121 KB, everything inline except the two vendored scripts. |
| `vendor/gsap.min.js`          | GSAP 3.12.5, vendored so scroll motion never depends on a CDN (72 KB).          |
| `vendor/ScrollTrigger.min.js` | GSAP's ScrollTrigger plugin, same reasoning (43 KB).                            |
| `README.md`                   | this file.                                                                      |

## What the page contains

- **A hero** and **nine numbered chapters**, one topic each, with a table of contents that links to each chapter's
  anchor: the job; the thirteen operations; the four ports; the session state machine; the five lanes; the five
  invariants and how each was attacked; the measured evidence; **what is not yet true**; open questions and the
  assumptions this page invented.
- **Ten inline SVG diagrams** — one per chapter, plus the hero. Nothing is a CSS gradient standing in for a picture.
- **A sticky text spine** on the left: the same nine chapters condensed to a paragraph each, for reading the content
  without the motion. It collapses on narrow screens.
- **An explorable state machine** in chapter 4: click a state to see what it means and which arrows leave it.
- **Scroll motion** that is skipped entirely when the operating system asks for reduced motion. With reduced motion
  on, or with JavaScript off, or if the motion library were missing, the page is simply visible and still — no
  element is ever hidden by CSS waiting for a script, and every claim in it is readable without a single animation.

## How it was verified (before it was handed over)

Run text-first through a real browser (Chrome DevTools Protocol), over the file itself:

| check          | result                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| structure      | 9 chapters, 9 table-of-contents links all resolving, 10 inline SVGs (all 10 with a `<title>`), 9 spine sections, 30 reveal elements, 0 dead anchors, 0 remote asset references                          |
| SVG fit        | 0 text elements running outside their own viewBox at any width                                                                                                                                          |
| motion         | page scrolled in 14 steps to the bottom; all **30 / 30** reveal elements at computed `opacity: 1` (min 1.0), 0 still hidden; the 4 looping dash connectors measured with a changing `stroke-dashoffset` |
| reduced motion | with `prefers-reduced-motion: reduce` emulated: all 30 reveals at `opacity: 1` **without scrolling**, and **0** scroll triggers created                                                                 |
| no-JS safety   | no CSS rule anywhere sets a reveal element below `opacity: 1`, so with scripts off the page renders fully visible                                                                                       |
| layout         | `document.documentElement.scrollWidth <= window.innerWidth` at **360, 390, 430, 1440** px (and 1024/1280)                                                                                               |

## Where the facts in it come from

- `signer/signer.md` — the spec: the job, the contract, the states, the capability model, the five invariants, the
  settings, what must never appear inside the module.
- `signer/ts/` — the first implementation: `index.ts` (what a consumer gets) and `harness.ts` (the ports a host must
  implement).
- `signer/evidence/record.md`, `01-build-and-tests.txt`, `02-invariant-falsification.txt` — the executed evidence.
  Every number on the page is quoted from these.
- `runs/2026-09-28-signer/proposal.md` — the reasoning behind the design, used for the “why” chapters.

## Two things the page is careful about

1. **Chapter 8 is not softened.** No host adapters ship, no relay was ever contacted, one signature deviates from
   the spec, portability is unproven, and compatibility with the app's existing stored records is judged rather than
   measured. It also records a defect in the evidence: **one of the seven falsification rows does not hold up** —
   the recorded run's test-name filter matched no test, so the row shows a non-zero exit rather than a failing
   assertion. That was true of the un-regenerated page at `b24c3f1`, which states “7 applied, 0 falsification
   failures”; the recorded output itself did not support the seventh row. Today's `signer/evidence/record.md`
   reports **16 mutations, 0 falsification failures** and records the row as found and fixed (see _Status_ above).
   The page says so in chapters 6 and 8.
2. **Chapter 9 lists what this page invented** — every plain-language gloss, the grouping of the thirteen
   operations, the drawing of the state machine, and the wording “0 reported failures”. It is there so a wrong word
   is a one-line fix rather than a hidden assumption.
