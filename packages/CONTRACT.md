# The module contract — overarching spec

**Version `contract/0.1.0-draft` · 2026-09-22.** The top-level spec every module and every implementation
is written against. It is the **only thing shared** between implementations: they do not share code with
each other, only this contract.

Maintainer direction, 2026-09-22: _"the different implementations I feel could logically fit in as
different modules. One for napplets and one for regular web, and only the contract is shared between them
(as an overarching, top-level spec)."_

---

## 1. The shape

```
                    ┌────────────────────────────┐
                    │        THE CONTRACT        │  interface · vocabulary · injectable defaults
                    │    @plebeian/contract      │  no I/O, no framework, no host
                    └─────────────┬──────────────┘
               consumed by ───────┼─────── provided by
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      │                           │                           │
 ┌────▼─────┐             ┌───────▼────────┐          ┌───────▼────────┐
 │ MODULES  │             │ IMPLEMENTATIONS │          │     HOSTS      │
 │ product  │             │ web             │          │ app · CMS      │
 │ browse   │             │ napplet         │          │ explorer       │
 └──────────┘             └─────────────────┘          └────────────────┘
 consume the contract     each satisfies it            choose one
```

**The dependency rule, and the whole point of the picture:** modules depend on the **contract** and never
on an implementation. Implementations provide the contract and never depend on a module. A module therefore
cannot tell which implementation it is running under — and that is not a convention, it is a static check
(`packages/__tests__/conformance.test.ts`).

**Because the contract is the only shared artifact, the implementations do not share code.** `web` and
`napplet` are two modules that happen to satisfy the same interface. If they need the same helper, it either
belongs in the contract or it is duplicated **and the duplication is a finding** — factoring it out between
them would create the coupling the split exists to prevent.

## 2. The contract: what a module is handed

One interface, in our vocabulary, with the NAP domain it maps to.

**Read — available in every implementation:**

- `nostr.read(filters, options)` → events. Maps to `outbox.query`. Returns a **result value**, never an
  exception and never an empty list in place of a failure (§3).
- `nostr.stream(filters, onEvent)` → unsubscribe. Maps to `outbox.subscribe` / `outbox.close`.
- `resource(url)` → something renderable. Maps to `resource.bytes`. The only way an image can load in a
  sandbox.
- `theme` — token values plus a change notification. Maps to `theme.get` / `theme.changed`.
- `config.get(key)` — the viewer's own preferences. Maps to `config.get`.
- `link.open(target)`. Maps to `link.open`.

**Write — reserved, granted per module, never by default:**

- `sign(template)` → a signed event. **Never available in a sandbox**, and never to a read-only module.
- `publish(intent)` → an outcome value. **Kind-scoped**: a module declares which kinds it may publish and
  the host grants exactly those. A module that publishes comments gets `1111`, `7`, `5` — not a general
  publish capability.
- Value transfer — **not in this contract**. It arrives, if ever, as a separate capability with its own spec
  and its own trust review.

**Never, to any module:** a raw private key, an arbitrary fetch, durable storage in a sandbox, and any
payment capability inside a read-only module.

## 3. The shape of a result

Two rules that exist because the current application breaks them. Both are contract rather than convention.

**A read failure is a value.** `ReadResult` is `{ok: true, events, empty}` or `{ok: false, reason}` with
`reason ∈ timeout | transport | no-relays`. A module cannot report "nothing found" for a network failure
without deliberately discarding the reason.

**A validation failure is a value too.** A module's parser returns `{ok: true, value, problems}` or
`{ok: false, problems}` where `problems` carry **codes** — not messages. A code is a fact; a message is
presentation, and presentation belongs to a surface.

## 4. The two trust boundaries

Every implementation states its boundary — and now does, through its descriptor. A reader must never have
to infer it (alignment review drift D-7).

**`in-process` — the higher-trust boundary.** The web app and CMS components. Runs with the platform's own
capabilities. Chapter 04 of the ideas document requires _declared, hashed, reviewed_ for components: a
component carries a **manifest** (dependencies, renderers, arguments, data requirements), a **hash** over
that manifest and its built artifact, and a **review** recorded in the manifest. **The hash and the review
gate do not exist yet** (drift D-5) — today the manifest is declaration only.

**`napplet` — the lower-trust boundary.** Sandboxed, opaque origin. No keys, no network, no durable storage.
Identity is `(dTag, aggregateHash)`, computed by the runtime; the grant is kind-scoped. What enforces this is
**the browser, not a linter**: no `'unsafe-eval'`, no permitted script origin, `connect-src 'none'`,
`frame-src 'none'`.

**Both use the same manifest.** A component does not have one contract for the CMS and another for a napplet
— that is the point of declaring it once.

## 5. Versioning

Three tracks, never conflated:

- **the contract** — `contract/x.y.z`, this document. Changes when the interface changes.
- **a module's feature spec** — e.g. `browsing-explore-search/0.5.0-draft`. Changes when behaviour changes.
- **an implementation** — identified by its descriptor at runtime and a package version at build time.

Every package's `SPEC.md` declares which feature-spec version it implements. A package that cannot name the
contract revision it satisfies is not conformant, because "versioned" is what makes a behaviour change
reviewable.

## 6. Conformance

A conforming module or implementation:

1. imports the contract and nothing else shared;
2. imports no host, no application and no sibling implementation;
3. contains no policy literals — no colours, no relay URLs, no duplicated token values (they live in the
   contract's defaults, and are injectable per build);
4. returns failures as values, with reason codes;
5. states its trust boundary in its descriptor;
6. declares the feature-spec version it implements.

Checks 1–3 are static and fail the build (`packages/__tests__/conformance.test.ts`). Checks 5–6 are
asserted by tests and by the package's own spec.

## 7. How the contract reaches a package

Two build modes, both ordinary bundler semantics — the source is identical in each:

- **bundled** — the contract is inlined, producing a stand-alone artifact. Required for a napplet, where
  there is no shared runtime, no import map and no external script source.
- **external** — the contract stays a separate module, resolved once by the host. Required for the web app
  and the CMS, where inlining it per package would duplicate it N times in one bundle.

Detail and rationale: `MODULARIZATION.md` §3.

## 8. Open

- **The contract's name.** `@plebeian/contract` rather than `@plebeian/shared` (the suggestion) because its
  role is the contract, not a bag of helpers — and because splitting "names" from "values" across two
  packages would add a second resolution mode per build for no gain. Reversible.
- **Whether `sign`/`publish` belong in this contract** or in a separate write contract only some modules
  import.
- **The hash's coverage** for a CMS component — manifest only, or manifest plus built bytes.
- **O1**: `config.get` is synchronous in the contract, asynchronous in a sandbox.
