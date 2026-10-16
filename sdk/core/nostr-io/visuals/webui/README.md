# nostr-io — the webUI

A single, self-contained page that explains the nostr-io module to a reader who is not a programmer:
what it is, what it guarantees, what was measured, and what is not yet true.

## Status — what this page is, and when

The page is **art, not evidence**. It narrates the module as frozen at `b7e8562`, written from the module's own
documents: the spec (`nostr-io.md`), the inventory (`ts/ts.md`), the two executed captures in `evidence/`, and
the freeze record (`runs/2026-09-30-first-usable-version/freeze-nostr-io.md`). It adds no statement to the
module and must never be cited as proof of anything.

It is honest about what is not yet true (chapter 8): nothing in this assembly imports the module, every case
runs against hand-written fake relays, **no case opens a socket**, the two named second backends do not exist,
and the vendor survey's claims are `READ` rather than executed. Two open items ride with the freeze and are
named there too.

## Open it

Double-click `index.html`, or drag it into any browser, or:

```
xdg-open /home/admin_maxime/projects/market-retrofit/nostr-io/visuals/webui/index.html
```

**No server, no network, no build step.** Every graphic is inline SVG, the type is set in system fonts, and the
motion library is vendored in `vendor/` beside the page and referenced by a relative path. It works from a plain
`file://` path, on a plane, behind a proxy.

## What is in this folder

| file                          | what it is                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| `index.html`                  | the page. One file, everything inline except the two vendored scripts.      |
| `vendor/gsap.min.js`          | GSAP 3.12.5, vendored so scroll motion never depends on a CDN.              |
| `vendor/ScrollTrigger.min.js` | GSAP's ScrollTrigger plugin, same reasoning.                                |
| `SKILL.md`                    | the skill companion: how the page is served, what it shows, and its Status. |
| `README.md`                   | this file.                                                                  |

## What the page contains

- **A hero** and **nine numbered chapters**, one topic each, with a table of contents that links to each
  chapter's anchor: the job; the contract; the bounds; the six refusals; the rules and the mutations that
  attacked each; the block found and cleared; the measured evidence; what is not yet true; and the open
  questions with the assumptions this page invented.
- **Ten inline SVG diagrams** — one per chapter, plus the hero. Every one carries a `<title>` and a `<desc>`.
- **A sticky text spine** on the left: the same nine chapters condensed to a paragraph each. It collapses on
  narrow screens.
- **An explorable refusal vocabulary** in chapter 4: click any of the six reasons to see what produces it and
  where it lands.
- **Scroll motion** that is skipped entirely when the operating system asks for reduced motion. With reduced
  motion on, or with JavaScript off, or if the motion library were missing, the page is simply visible and
  still — no element is ever hidden by CSS waiting for a script.

## Where the facts in it come from

- `nostr-io/nostr-io.md` — the spec: the job, the contract, the statements and the body amendments.
- `nostr-io/ts/ts.md` — the inventory: what the implementation is and is not.
- `nostr-io/evidence/01-build-and-tests.txt` and `02-invariant-falsification.txt` — the executed evidence. Every
  number on the page is quoted from these two.
- `runs/2026-09-30-first-usable-version/freeze-nostr-io.md` and `runs/2026-09-29-reframing/review/` — the freeze
  and the reviews that blocked and cleared it.

## One thing this page is not allowed to fix

`nostr-io.md`'s front matter still declares the implementation and the tests as “none yet”, and its body still
says neither directory exists — both true when the spec was written, both stale now that `ts/` holds 24 green
cases. The page does not repeat those lines and does not edit the spec; it reports the gap instead. The same
discipline applies to the page itself: a wrong word in it is a one-line fix, not an argument.
