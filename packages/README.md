# `@plebeian/*` packages — the browsing prototype, restructured

Five packages, one contract, two implementations, two modules. Read `CONTRACT.md` first; it is the
overarching spec everything else is written against.

## The packages

- **`contract`** — `@plebeian/contract`. The interface a module is handed, the shared vocabulary, the
  injectable defaults, the fixture implementation used by every package's tests. Contains no I/O, no
  framework, no host, and **no dependency on any other `@plebeian` package**.
- **`web`** — `@plebeian/web`. The regular-web implementation, over `nostr-tools`. Boundary: `in-process`.
- **`napplet`** — `@plebeian/napplet`. The sandboxed implementation, over a NIP-5D host's capability object.
  Boundary: `napplet`. Shares **no code** with `web` — only the contract.
- **`product`** — `@plebeian/product`. The product module: NIP-99 validation (`src/event.ts`) and filter
  construction (`src/queries.ts`), merged into one package.
- **`browse`** — `@plebeian/browse`. The browse module: the surfaces (`src/components.ts`) and the viewer's
  filter state (`src/filter.ts`), merged into one package.

Every package has its own `SPEC.md` naming the feature-spec version it implements.

## The docs

- **`CONTRACT.md`** — the overarching spec. Interface, vocabulary, trust boundaries, versioning, conformance.
- **`MODULARIZATION.md`** — how a module is made: behaviour versus policy, the three kinds, how the contract
  reaches a package (bundled versus external), and what is verified.
- **`ALIGNMENT.md`** — the Chapter 04 review: where the implementation aligned, where it drifted, and what the
  restructure has fixed since.
- **`<package>/SPEC.md`** — per-package spec.

## Running it

```bash
# tests: all five packages, plus the explorer's projection tests
bun test packages/ apps/

# the explorer — three projections of the same components
bun run apps/explorer/serve.ts        # then http://localhost:3333/?view=live|cms|sandbox
```

The explorer imports **nothing from `src/`**. That is the point: if it runs, the packages are real.

## The dependency rule

```
components → core → contract          (modules)
bindings → contract                   (implementations)
contract → nothing @plebeian          (the shared vocabulary)
```

Modules never import an implementation, so **no module can tell which implementation it is running under**.
That is checked statically in `packages/__tests__/conformance.test.ts`, along with the rule that only
`contract` may contain colour values.
