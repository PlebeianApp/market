# Modularization spec — how a module is made

**Version `modularization/0.1.0-draft` · 2026-09-22.** The contract for _how_ a module is packaged,
resolved and assembled. It governs every module; the per-module specs say what each module does, and this
one says how any of them becomes an artifact.

It exists because Chapter 04 of the ideas document names the three steps (**spec → packages →
implementations**) and the three package kinds (**core · bindings · components**) but does not say how a
package gets the values it must not own. That gap produced the drift in `ALIGNMENT.md` §D-3: themes, relay
lists and default filters baked into packages, duplicated in every host.

---

## 1. The rule this spec exists to enforce

**A module package owns behaviour, never policy.**

Behaviour is what the spec defines: which tags a listing must carry, what a valid price is, how a thread is
assembled, what a reason code means. Policy is what a host chooses: which colours, which relays, which
filters are on by default, which NIP-50 relays to prefer, whether NSFW is shown.

Duplication is the test. **If a value would exist in two places and must be kept identical by hand, it is
policy and it belongs in `@plebeian/contract`.** The prototype failed this test in four places, all
enumerated in `ALIGNMENT.md` §D-3 and all now fixed:

| Value                           | Was                                      | Now                                                                        |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| 8 token colours                 | `nostr-access/src/index.ts` (a package)  | `contract/src/index.ts` (`TOKEN_FLOOR`)                                    |
| 10 hex literals + a token block | `browse-ui/src/styles.css`               | gone; components consume `var(--pb-*)` only                                |
| `SEARCH_RELAYS`                 | `nostrToolsEnvironment.ts` (the binding) | `DEFAULT_SEARCH_RELAYS`, an injectable default in the contract             |
| `defaultProductFilters`         | `browse-filter/src/index.ts`             | kept in `browse`, but stated as a module default a host overrides (see §7) |

## 2. The three kinds, and what each may contain

| Kind           | May contain                                                                 | May **not** contain                                      |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| **core**       | schemas, validation, parsing, arithmetic, protocol shapes, pure derivations | I/O, framework imports, host policy, colours, relay URLs |
| **bindings**   | one implementation of the contract per runtime                              | domain logic, UI, spec constants, policy values          |
| **components** | markup, props, token _references_, event handlers                           | fetching, validating, store reads, token _values_        |

The dependency direction is fixed: **components → core → contract**, and **bindings → contract**.
Components never import bindings. Core never imports a binding. Enforced by
`packages/__tests__/conformance.test.ts`.

## 3. The contract as the shared vocabulary, and how it reaches a package

`@plebeian/contract` owns the interface, the shared vocabulary, and the injectable defaults (`CONTRACT.md`
§2, and its own `SPEC.md` for the detail). A package **imports** from it in exactly one way, and the _build_
decides how that import resolves:

### Mode A — bundled (stand-alone artifact)

The contract is **inlined into the artifact at build time**. The result depends on nothing.

Required by the **napplet** target: a napplet is one self-contained `index.html`, there is no shared runtime,
no import map and no module registry between napplets, and the CSP permits no external script source. A
stand-alone artifact is not a preference there; it is the only thing that can exist.

### Mode B — external (co-resident host)

The contract stays a **separate module**, resolved once by the host's bundler. One copy in the bundle.

Required by the **web app** and the **CMS**: they already ship the contract, and inlining it per package
would duplicate it N times in one bundle — reintroducing exactly the duplication this spec removes.

### Why this is not a new mechanism

Mode A and Mode B are **`bundle` versus `external`** — the ordinary semantics of every bundler. The
module's _source_ is byte-identical in both; only the resolution config differs. So the contract is one line
of build configuration per target, not an indirection layer, and there is nothing to invent.

The mechanism is already proven in this repository in miniature: **`tsconfig` path aliases** resolve
`@plebeian/*` with no publish step at all.

### What must never happen

- **A package importing a host.** No package may import from `src/`, from an app, or from a shell.
- **A policy value written twice.** If the CMS and the app both need an accent colour, it lives in the
  contract, once.
- **A build-time injection the source cannot see.** The source always imports `@plebeian/contract`
  normally; injection is a resolution choice, never a source rewrite. A module whose source differs between
  targets cannot be reviewed once.

## 4. Implementations are modules too

The maintainer's correction (2026-09-22): implementations are not modes of one package, they are **separate
modules**, and **only the contract is shared between them**.

So `@plebeian/web` and `@plebeian/napplet` are peers, not branches of a single binding layer. They contain
no shared code. The environment contract they both satisfy is a third, lower-level artifact.

This is why an earlier design had one `nostr-access` package with three bindings inside it: that made the
contract and the implementations the same package, so a module depending on the contract also depended on
`nostr-tools`. The split removes that.

## 5. The two trust boundaries

Every implementation states which boundary it sits on, in its descriptor. See `CONTRACT.md` §4.

**`in-process` — the higher-trust boundary.** The web app and CMS components; runs with the platform's
capabilities. Chapter 04 requires _declared, hashed, reviewed_; today only **declared** exists (drift D-5).

**`napplet` — the lower-trust boundary.** Sandboxed, opaque origin, no keys, no network, no durable storage.
Identity is `(dTag, aggregateHash)`; the grant is kind-scoped. Enforced by the browser, not by a linter.

## 6. Verification

The spec is only a contract if it is checkable. Four checks, cheapest first:

1. **Import direction** — no module imports an implementation; the contract imports no other `@plebeian`
   package; no package imports the application. _Implemented and passing._
2. **No policy literals** — no colour values outside the contract; no component module defines token values.
   _Implemented and passing._ Deliberately crude, and it exists to make the rule visible rather than to be a
   boundary.
3. **Token coherence** — `TOKEN_FLOOR` and `tokens.css` are two encodings of one fact, and a test fails the
   pair when they disagree, in both directions. _Implemented and passing._
4. **Stand-alone build** — build each module in Mode A and assert the artifact resolves with no external
   module. _Not implemented_ — the only check of the four that does not exist yet, and the one that keeps
   Mode A honest.

A module is conformant when the checks pass and it carries a `SPEC.md` declaring the feature-spec version it
implements.

## 7. Where a module-level default is acceptable

The rule in §1 is about values a _host_ would duplicate. A default the **module itself** owns — the initial
state of the viewer's own filter, for instance — is not the same thing, and moving it into the contract would
invert the dependency (the contract would need the module's type).

The test, and the rule: **can a host express a different choice without copying the value?** `browse`'s
defaults are exported as a named constant and applied through a factory, so a host overrides them instead of
redefining them. A module-level default is acceptable when it is overridable and named; it is not acceptable
when it is inlined at a call site where a host cannot reach it.

## 8. Open

- **Where the vocabulary ends and modules begin.** Spec constants used by exactly one module stay with that
  module (`PRODUCT_KIND = 30402` lives in `product`, because only `product` reads it); a constant with a
  second consumer moves to the contract. Stated as a rule, applied case by case.
- **Whether Mode A applies per-package or per-artifact.** Inlining the contract into each package and then
  bundling those packages together duplicates it in the final artifact; inlining once at the artifact
  boundary does not. The rule belongs at the artifact, not the package.
- **What a hash covers** for a CMS component — manifest alone, or manifest plus built bytes.
- **Whether the contract and the platform tooling are one package or two.** They are one today; a second
  would mean two resolution modes to configure per build.
