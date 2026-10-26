# relay-config webui — skill

A self-contained page that explains the `relay-config` module to a reader who is not a programmer: the one
question it answers, the three groups of members, the flow, and the two rules a reader can press. One file
(`index.html`), no server, no network, no build step — it also opens directly from `file://`.

## Open it

The page is a **static file** — open `index.html` directly (`file://`). It calls no backend, so no process is
needed.

## What it shows

- The port, split three ways: the library's members, ours, and the injected default layer.
- The flow: a seeded event, the library's model / validator / `getRelaysFromList`, the port's answer — and the
  step that does not exist, a pool.
- Two pressable rules: _ZAP_RELAYS is never dropped_ (the additive union) and _the DM target is the recipient's
  `10050`, or nothing_ (`dmRelays → undefined`, no `10002` substitution).
- The port's TypeScript surface, verbatim from `ts/types.ts`.

## Status (read this before quoting the page)

The page is **art, not evidence**. It is written from the module's own documents — the spec
(`relay-config.md`), the inventory (`ts/ts.md`) and the evidence capture (`evidence/01-build-and-tests.txt`).
It must not be quoted for:

- **any number as proof** — regenerate with `bash evidence/run.sh` and read the capture;
- **the vendor's behaviour** — that comes from `applesauce-common` 6.2.0 and `applesauce-core` 6.2.0 and from
  the tests, not from this page;
- **anything about the app** — `src/` is out of scope and the page says nothing about it.
