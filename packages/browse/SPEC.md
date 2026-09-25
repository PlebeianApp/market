# `@plebeian/browse` — package spec

**Package version `0.1.0` · implements `browsing-explore-search/0.5.0-draft` §3 (surfaces) and §3.4 (the failure vocabulary).**

The browse module: the surfaces, and the viewer's own preferences about what to see.

## 1. Two responsibilities, deliberately one package

| Source                                                                                                   | Job                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/components.ts`, `Media.tsx`, `PriceDisplay.tsx`, `ProductCard.tsx`, `ProductGrid.tsx`, `states.tsx` | Render: a validated value plus the environment in, markup out. No fetching, no validating, no store read.          |
| `src/filter.ts`                                                                                          | The viewer's filter and sort state, applied purely: `applyFilterState`, `hasActiveFilters`, `describeFilterState`. |

Merged from `browse-ui` + `browse-filter` for the same reason as the product module (drift D-2).

## 2. The two rules the components obey

**Data in, markup out.** `ProductCard` takes `listing: ProductListing` and `env: ModuleEnvironment`. It
cannot fetch and cannot validate, because it is never given an event to validate. `ProductGrid` owns the
surface state (including the named unavailable states) and the fail-closed gate shape.

**No colour values.** Components consume `var(--pb-*)` only. The values live once, in
`@plebeian/contract/src/tokens.css`, verified by that package's `tokens.test.ts` and by
`packages/__tests__/conformance.test.ts`. The prototype had 10 hex literals _and_ its own token block
here; both are gone, because a value a host would otherwise duplicate by hand is policy, not behaviour.

## 3. Gating is deliberately absent

Hidden items, blacklists, test labels, deletions and NSFW are **withholding** rules, not viewer
preferences. `filter.ts` excludes them on purpose — that is exactly how the current application ended up
filtering NSFW in one place out of four (`InfiniteProductList.tsx:82`). Gating is a surface gate, and the
browsing spec makes it a **fail-closed** prerequisite: its inputs must load before anything renders, and a
timeout produces a named unavailable state, zero items, and never a spinner.

**Not yet implemented.** The gate's _shape_ is here; its inputs (blacklist and test-label stores) are
application settings reads and are the next slice.

## 4. What it must not contain

No fetching, no validation, no store, no import from `src/`, no import of an implementation, no token
values. `react` is a peer dependency; `@plebeian/product` supplies the validated types.
