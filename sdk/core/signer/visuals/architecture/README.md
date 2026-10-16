# The signer module — a map of the picture

This folder holds three things and nothing else:

| File                       | What it is                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signer-architecture.html` | The diagram as a page you can open in any browser. One file, and it works with no internet at all: a webfont (JetBrains Mono) is requested if you happen to be online, and the system monospace fonts are named in the same stack for when you are not. |
| `signer-architecture.svg`  | The same diagram as a single picture file, so you can open it on its own or drop it into a document.                                                                                                                                                    |
| `README.md`                | This key to the picture.                                                                                                                                                                                                                                |

To open the page from a Linux machine: `xdg-open signer-architecture.html`.
Nothing in this folder is part of the module's code. It is a picture _of_ the module
(`signer/signer.md` and `signer/ts/`), not a piece of it.

---

## Status — what this picture describes, and when

The picture is art, not evidence, and it draws the module as it stood **before the red team's block was
cleared** (commit `b24c3f1`). Three of its claims are superseded by the repair commit `3a723e5`, and are
listed here so the key does not disagree with the drawing by silence:

- **79 test cases in 5 files, all green** → **90 cases, 268 expectations, 5 files, 0 failures**.
- **7 deliberate breakages, one per invariant** → **16 mutations**, one per finding the repair fixed. One of the
  original seven was not the proof it looked like: its command matched no test case, because `bun test -t` is a
  regex and the case name contained `(fail closed)`. `evidence/falsify.py` now escapes the name, and a check
  that never ran is counted as a failure instead of a falsified invariant.
- **record-format compatibility is "judged, not measured"** → **measured**, in both directions against the
  reference implementation's own vault code at 100 000 iterations, with the scope stated; and the one surface
  deviation is `attachSigner(capability, options)` in the spec, not `attachSigner(signer, settings)`.

`signer/signer.md` (the spec) and `signer/evidence/` (the executed evidence) are authoritative; this folder's
picture is a reading of them at one revision.

---

## The one idea the picture is built around

**The module owns no environment of its own.**

A normal piece of software quietly reaches for the things around it: the browser's little
storage cupboard, the clock, the random-number generator, the relay connection. The signer
module is not allowed to. It is written so that if you gave it a bare computer with nothing
installed on it, it could not sign anything — because everything it needs from outside arrives
through a **socket** that somebody else's code has to plug into.

Software people call those sockets _ports_, and the code that plugs into them an _adapter_
(a port is the socket on the wall; an adapter is the plug you bring). The module has four of
them:

| The port        | What it is for, plainly                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `StoragePort`   | Reading and writing saved text — the module never chooses _where_ it is saved              |
| `TransportPort` | Talking over the network to a remote signer — the module never opens the connection itself |
| `ClockPort`     | Timers and deadlines — the module owns no clock                                            |
| `CryptoPort`    | Randomness and the encryption mathematics — the module owns no cryptography                |

**And that is not a claim, it is a count.** In `signer/ts/*.ts` — all fifteen files — there are
**zero** occurrences of `localStorage`, `sessionStorage`, `indexedDB`, `window.`, `document.`,
`navigator.`, React, `@nostr-dev-kit` or the app's `@/` shorthand. In the nine files that are
the implementation itself there are also zero occurrences of `globalThis`, a direct browser
crypto call, `fetch`, `WebSocket`, `process.`, a file path escape, `Date.now` or `Math.random`.
Those counts are re-run by `signer/evidence/run.sh` and the output is stored in
`signer/evidence/01-build-and-tests.txt`. The only timer references in the whole module are the
clock port's two member declarations and the four calls that go through that injected clock (two in
`nip46.ts`, two in the `session.ts` port guard).

---

## How the picture is laid out, band by band

Five horizontal bands, read from the top down. Each one is a border you can see.

### Band 1 — the outside world

The relay, a remote signer or "bunker", the browser extension, the OS keychain or browser
store, and the host computer itself (its timers, its WebCrypto, its relay library).

**The module never touches any of this.** The band is drawn to say where the things the module
needs actually live, not where the module reaches.

### Band 2 — the consumer's side (drawn dashed: none of it exists yet)

The "consumer" is whoever buys the module and wires it up — in the first case, the market app.
Both the consumer and the four adapters it would have to write are drawn **dashed**, and the
title on the box says, in plain words, **DOES NOT EXIST YET**.

The note inside says the honest thing: _nothing imports this module, and the market's 90
existing `.sign(` call sites are the checklist waiting for whoever wires it up — and this build
does not wire it._ That number (45 files, 90 call sites) comes from the project's own research
note, `runs/2026-09-28-signer/research/03-consumers-and-contract.md`.

Look at the arrows from band 1: they enter band 2 and stop. **The outside world stops at the
consumer's territory.**

### Band 3 — the ports: the only door in

Four red-outlined boxes, inside a red dashed border labelled _the only door in_.
Everything crossing from the consumer's side into the module crosses here, and only here.

One honest detail the picture makes visible: the same seam also carries two more things that
are handed in as plain arguments rather than as ports — the NIP-07 browser-extension object and
the source of the passphrase. They come through the same door; they are just not one of the
four named ports.

### Band 4 — inside the module

What the module actually is, file by file: its public front door (`index.ts`), the session
lifecycle, the capability policy, the encrypted record, the typed refusals, the five ways in,
the NIP-46 lanes and the connect-URI handling.

Inside this band there are no reaching-out arrows at all — just the note that says the isolation
was measured, and the crossed-out dashed line on the far left that says
**the module never reaches the outside world**.

### Band 5 — what it guarantees, and what it does not ship

On the left, the five invariants: the five rules any implementation must keep (the connect
secret is checked before a remote is trusted; a remote signer is not the user; a signed event
must belong to the resolved identity; encryption is only ever what the signer and the caller
allow, never invented; a session secret is never silently stored in the clear).

On the right, in amber, the honest list of what is **not** there yet: no host adapters
shipped, no relay ever contacted, one implementation only, no consumer. See the section at the
bottom of this file.

### The legend

Every colour is named once, at the bottom, below every box. Nothing in the picture uses a
colour the legend does not explain.

---

## The three things to notice

**1. There is exactly one door.**
Follow the lines down the middle: the outside world enters only as far as the consumer's side;
the consumer's four adapters plug into the four ports; the four ports are the only thing the
module knows about. Four arrows in, and no fifth.

**2. Nothing above the port line exists yet.**
Everything drawn dashed — the consumer, all four adapters, the argument box — is unwritten. The
module is finished and tested; the part that would use it is a promise. The diagram says so on
the boxes rather than in a footnote.

**3. The bottom right corner is the honest part.**
No relay was ever contacted. No adapter written by a real host exists — the only implementations
of the four ports anywhere are the module's own test harness. No Rust, Flutter or Angular
version has ever met this specification. Nothing imports the module. Read that band before you
read any claim about this being "done".

---

## What is specified but not yet exercised

The module is specified at its final state, and its first implementation delivers the whole
written contract. But "written" and "tried against the real world" are different things, and the
picture keeps them apart:

| Written and executed                                                                                                                              | Written, never exercised                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| All thirteen session operations, the five lanes, the eight-state machine with its guards, the capability model, the settings, the five invariants | The NIP-46 lanes have never spoken to a real relay — they run against an in-process remote-signer emulator                              |
| 79 test cases in 5 files, all green; the module's own typecheck clean                                                                             | No consumer: nothing imports this module, and the market's own signer code is untouched                                                 |
| The isolation counts above, all at zero                                                                                                           | No host adapter: no storage, relay, clock or crypto implementation ships anywhere except the test harness                               |
| 7 deliberate breakages, one per invariant, each caught by its named test and then restored byte-for-byte                                          | No second implementation, so nothing proves the specification is portable to another language                                           |
| The record format (PBKDF2-SHA256, 600,000 iterations, AES-GCM-256) and its 100,000-iteration floor                                                | Whether the record format really matches the market's existing records is _judged_, not measured — no such record was available to read |

There is also one stated deviation from the specification: the spec writes
`attachSigner(signer, settings)`, the implementation takes `attachSigner(capability, { lane })`.
The settings belong to the composer and are set once when the session is created, so a
per-attachment settings override is not implemented.

---

## What this picture does not claim

- It does not claim the module is in use. Nothing imports it.
- It does not claim any network was ever involved. None was.
- It does not claim the four ports have been implemented by anyone real. Only the test harness
  has implemented them.
- It does not claim the specification is portable. One implementation exists; the specification
  is what would let a second one be written.

## A note on the colours

The colour scheme is a fixed, meaning-carrying set: **cyan** = the consumer's side,
**emerald** = the module's own code, **violet** = the encrypted record at rest, **rose** =
everything fail-closed (the door, the typed refusals, the guarantees), **grey** = the outside
world, **amber dashed** = declared but not yet exercised or not yet existing. Amber normally
means "a cloud region" in this drawing style; here it has been given the one meaning the picture
needs — _not there yet_ — and the legend says so.

---

_Source of truth: `signer/signer.md` (the specification) and `signer/ts/` (the first
implementation, TypeScript, harvested from `PlebeianApp/market@4bc7f8c0`). Regenerate the
evidence with `bash signer/evidence/run.sh` from the project root._
