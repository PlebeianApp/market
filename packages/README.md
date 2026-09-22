# `@plebeian/*` packages — browsing prototype

A first working realisation of the browsing, explore and search module as **pure packages plus three
projections**. It is additive: no file under `src/` is modified, and the explorer imports nothing from
the application.

**Read `docs/DECISIONS-packages-prototype.md` first** — it records every decision, the evidence behind
the data-driven ones, and the open questions.

## The packages

| Package                   | Layer       | What it is                                                                                                              |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@plebeian/product-event` | contract    | Validates an untrusted kind-30402 event into a typed view. No UI, no framework, no network. Zod is its only dependency. |
| `@plebeian/product-query` | query       | Builds filters **as data**. Never executes them.                                                                        |
| `@plebeian/browse-filter` | pure        | The viewer's filter and sort state. Gating deliberately excluded.                                                       |
| `@plebeian/nostr-access`  | environment | The only layer that touches the world. One interface, three bindings.                                                   |
| `@plebeian/browse-ui`     | UI          | Data in, markup out. No fetching, no validating, no store.                                                              |

The rule that separates them: **a contract package may not import a capability; a query package may not
import a framework; a surface package may not fetch.**

## The three projections

`apps/explorer` renders the same components under three different environments:

1. **Live** — `createNostrToolsEnvironment` reading public relays.
2. **CMS** — a page definition rendered through component **manifests**; nothing per component is
   hand-written.
3. **Sandbox (stub)** — `createNappletEnvironment` over a capability object instead of a network. The
   stub deliberately fails, to show that _"the read failed"_ and _"there is nothing to show"_ are
   different states. **It is a stub, not a real sandboxed frame.**

## Running it

```bash
bun run apps/explorer/serve.ts     # http://localhost:3333
bun test packages/ apps/           # 72 tests
bun run scripts/evidence-real-listings.ts   # the live-relay measurement (needs relay access)
```

Requires public relay access for the live view. `bun run apps/explorer/serve.ts` must be run from the
repository root, because the `@plebeian/*` aliases live in the root `tsconfig.json`.

## Layout

```
packages/product-event/   schemas, parser, typed view, 54 tests
packages/product-query/   filter construction, 14 tests
packages/browse-filter/   viewer filter/sort state, 13 tests
packages/nostr-access/    environment interface + three bindings, 11 tests
packages/browse-ui/       components + scoped CSS
apps/explorer/            the consumer; no imports from src/
scripts/evidence-real-listings.ts   the measurement that drove decisions D7 and D8
```

## What is deliberately missing

Gating (blacklist, test labels, deletions, NSFW) is **specified** in
`rebuild-research/modules/browsing-explore-search.md` §3.3 and only partly implemented here: the gate is
fail-closed by construction, but the inputs are application-side settings reads. That is the next slice,
along with migrating the application itself onto these packages. See `docs/DECISIONS-packages-prototype.md`
§Open questions.
