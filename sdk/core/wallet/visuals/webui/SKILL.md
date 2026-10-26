# wallet webui — skill

The payment state machine, laid out so a human can drive it. One self-contained page
(`index.html`) with no remote asset and no network, served by a small run program
(`run.ts`) on the reserved payment-surface port.

## Run it

```
bun run visuals/webui/run.ts                       # serves on the default host and port (4329)
bun run visuals/webui/run.ts --port 4409           # another port
bun run visuals/webui/run.ts --help                # the args, and where this file is
```

The page is at the root path. It is served from this directory only; a path that leaves it
answers `404`. There is no `/api` route: the run program holds no state and reads nothing, and
the page reaches no relay, a mint or a wallet. Opening `index.html` directly from a file path
works just as well — the page needs no server to run.

## What it shows

Ten sections and a console:

- **The port** — the three operations (`obtain`, `submit`, `reconcile`) and which a rail may
  omit: a passive leg declares `obtain` and `reconcile` and omits `submit`; a rail that declares
  `submit` must also declare `reconcile`.
- **The rung vocabulary** — the progress markers and the four proof rungs, with the _cryptographic_
  witness kinds (which may settle) distinguished from the _declared_ kinds (which reach only
  `attested`).
- **The set record** — how a leg's witness becomes a rung and a set of rungs becomes a state,
  including the exclusion that stops an untrusted leg counting.
- **The purchase machine** and the **refund machine** — every transition, each marked reached by a
  rule or by a human.
- **The conservation band** — the per-leg band summed for the aggregate, and the two directions a
  beyond-band settled set can take (`short-settled`, `over-settled`).
- **The acceptance gate** — its refusal vocabulary (field and reason, from two closed enums) and its
  honest limit.
- **Drive it** — a console: pick each leg's method and witness, withhold a witness, mark a leg
  untrusted, let the reconcile window elapse, and watch the derived set state change. Ten scenarios
  set specific configurations; the derivation underneath is the aggregator's own `deriveSetState`.
- **What can never happen** — the cases that must never be reachable, shown as unreachable rather
  than asserted.

With JavaScript off, every section is still visible and still; only the console in "Drive it"
does not appear.

## Status (read this before quoting the page)

The page is **a model, not evidence**. It narrates the machine the modules implement; the specs
(`wallet.md`, `funds-contract/funds-contract.md`) and the executed evidence under
`evidence/` are authoritative.

What is **VERIFIED_RUNTIME** here: `run.ts --help` prints the port, and the run program serves
`index.html` on that port. The page pulls no remote asset, and its console was driven in a real
browser: the scenarios reach the derived set states they name.

What the page **must not be quoted for**:

- **It is a model, not a running payment system.** No live node, a mint or a wallet is involved, and
  nothing on the page depends on a relay, a mint or a wallet. Every rule is transcribed from the
  modules' semantics; the console re-implements the aggregator's `deriveSetState` in the browser and
  holds no record.
- **The gate's honest limit is shown, not hidden.** The acceptance gate enforces the _shape_ of a
  registration, never its _conduct_: a well-formed declaration that lies is accepted, and the
  behavioural enforcement is the conformance suite, not the gate.
- **A declared witness reaches only a weaker rung.** A declared kind — even the payee's own word —
  moves a leg no further than `attested`. And **a passive leg cannot be witnessed by the app**: a
  leg that omits `submit` broadcasts its artifact and never submits it, so it can only reach a
  settlement if an artifact arrives (the buyer's own preimage).

## When to use it

Use it to see the payment machine work and to drive the set state by hand. Do **not** treat its
numbers or its console as evidence of a settlement: read `wallet.md`, the module's
`ts/aggregator.test.ts` suite and `evidence/` for anything load-bearing.
