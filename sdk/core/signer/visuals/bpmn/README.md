# bpmn — the signer session lifecycle, generated

This folder draws the signer module's session lifecycle as a **BPMN 2.0 collaboration**: five
participants (consumer, module, ports, relay, remote signer), eleven lanes, the eight session states,
and the amber legs that are _not_ exercised end to end. The subject is `signer/` — the spec is
`signer/signer.md`, the first implementation is `signer/ts/`, and the numbers it shows are read from
`signer/evidence/`.

## What is tracked here, and what is not

The five build artifacts are **not in git**: one command rebuilds them, and a tracked copy that stops matching
its own generator—or the evidence it is built from—is worse than no copy (this folder shipped one, and by the
time it was removed it no longer matched what a build produced; see below).

| tracked      | what it is                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build.py`   | the generator. Everything in the generated set comes from it.                                                                                                                                                                                                                                                                                    |
| `verify.cjs` | the render + headless-import harness `build.py` calls: it opens the viewer from a `file://` URL in headless chromium, imports the BPMN, and screenshots it at full resolution.                                                                                                                                                                   |
| `vendor/`    | the **bpmn-js 18.30.1** dist files the offline viewer needs — the navigated-viewer UMD build, `diagram-js.css`, `bpmn-js.css`, the icon class sheet and the icon font as a base64 `woff2`. Vendored because they are **not** regenerable from this repository: `ensure_vendor()` copies them from a local bpmn-js install when they are missing. |
| `.gitignore` | the five generated names below.                                                                                                                                                                                                                                                                                                                  |
| `README.md`  | this file.                                                                                                                                                                                                                                                                                                                                       |

| generated — not tracked | what it is                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `signer-session.bpmn`   | the BPMN 2.0 collaboration: semantic model + diagram interchange.                                      |
| `viewer.html`           | the self-contained offline viewer — the vendored bpmn-js inlined into one file, no CDN and no network. |
| `_render-canvas.html`   | the second page the PNG is rendered from.                                                              |
| `signer-session.png`    | the full-resolution render (4050 × 6210).                                                              |
| `checks.txt`            | the build's own report: three self-checks, the element histogram, and the headless import result.      |

## Regenerate

```
python3 signer/visuals/bpmn/build.py
```

One command, about 25 seconds, no network. It writes all five files into this directory. It needs
`python3`, and for the PNG and the headless import check also `node` plus Playwright and chromium:
`verify.cjs` resolves Playwright by absolute path first (`/home/admin_maxime/work/wt-consol/node_modules/playwright`,
then `/home/admin_maxime/work/node_modules/playwright`), then by the bare module name. With none of
them it prints `playwright: NOT FOUND`, skips the render and the build still succeeds — the model, the
viewer and the render canvas are produced either way, and `checks.txt` says what was skipped.

**Measured, when these files were removed from git (2026-09-29).** Deleting all five and running the
one command reproduced all five, and four of them were **byte-for-byte identical** to the copies that
had been shipped (`signer-session.bpmn` `e68c03b9…`, `_render-canvas.html` `ea7d756b…`,
`signer-session.png` `34c065b4…`, `checks.txt` `19d62357…`). `viewer.html` came back **different**
(`d3bcb6ee…`, 368 769 bytes, against the shipped `26688bee…`, 368 804 bytes) — and the reason is the
thing this folder's card is about: the viewer is built from `signer/evidence/` at build time, and the
evidence changed after that copy was made. Rebuilding against the **pre-repair** evidence
(`git show 29fce3d:signer/evidence/02-invariant-falsification.txt`, whose row 4 had a command that
matched no test) reproduced the shipped viewer _exactly_, `26688bee47791bee` — byte for byte. Two runs
in the same directory gave the same five hashes, and a build in a different directory gave the same
hashes too, so the output depends on the generator and the evidence and on nothing else.

That measurement is why the generated set is not tracked: it is reproducible in one command, and one of
the five depends on files that change whenever the evidence is re-run.

## Where its numbers come from

`build.py` reads `signer/evidence/` **at build time** — the suite counts from `record.md`, the
falsification counts from `02-invariant-falsification.txt` — so the viewer shows what the evidence
says now instead of a copy that goes stale when the module's suite grows. It also flags a
falsification row whose command matched no test case, because a row like that is a name mismatch
rather than a failing assertion.

## The self-checks

The build fails loudly rather than shipping a bad picture. Three checks, all reported in `checks.txt`,
all zero on every run so far: no annotation box overlaps a node box (14 annotations, 83 nodes); no
edge polyline crosses a box (106 edges — 79 sequence, 27 message); and no label is placed on a box
(25 element labels, 72 flow labels).
