# ADR: Store Layer Dependency Rules

## Status

Proposed

## Context

### The Systemic Problem

Five of the application's stores violate the intended dependency direction by
importing from `queries/` and `publish/` — layers that sit **above** stores in
the architecture. The dependency arrow should flow downward
(`components → hooks → queries/publish → stores`), but these imports reverse it,
creating fragile couplings, duplicate caches, and a type-level import cycle.

This is not an isolated cart.ts problem. It is a recurring pattern across the
store layer:

| Store | Lines | Upward Imports | Pattern |
|---|---|---|---|
| `cart.ts` | 1,892 | 5 query modules + 1 publish module | Private QueryClient + imperative calls |
| `nip60.ts` | 2,464 | 2 dynamic `await import()` from `@/publish/auctions` | Dynamic imports bypass static ESLint |
| `ndk.ts` | 1,118 | 2 query modules (`wallet`, `relay-list`) | Imperative calls in connection lifecycle |
| `product.ts` | 530 | 2 query modules (`products`, `queryKeyFactory`) + 1 publish module | Publish calls + queryKey access |
| `collection.ts` | 174 | 1 publish module + 1 query module | Publish + parse calls |
| `auth.ts` | 370 | 1 query module (`products`) | Imperative product fetch on login |

### Three Distinct Violation Types

**1. Private QueryClient instances** — `cart.ts` creates its own
`const cartQueryClient = new QueryClient(...)` (line 274) instead of using the
shared client from `src/lib/queryClient.ts`. Consequences:

- Duplicate cache: product/shipping/currency data fetched via `cartQueryClient`
  is cached separately from the app's React Query cache, so components watching
  the same data via `useQuery` will never see the cache hit.
- Invisible to React Query DevTools — developers cannot inspect or invalidate
  these queries during debugging.
- No cache invalidation coordination with the rest of the app.

**2. Imperative calls into query/publish functions** — stores call
`fetchLatestCartSnapshot()`, `v4VForUserQuery()`, `fetchProductsByPubkey()`,
`fetchNwcWallets()`, `publishProduct()`, `publishCollection()` etc. directly.
These are not query *options* (which are declarative and cache-compatible) but
imperative function calls that bypass React Query's lifecycle entirely.

**3. Type-level import cycle** — `queries/v4v.tsx` imports `V4VDTO` from
`@/lib/stores/cart` (line 1), while `cart.ts` imports `v4VForUserQuery` from
`@/queries/v4v` (line 14). This creates a circular module dependency:
`stores/cart → queries/v4v → stores/cart`. TypeScript resolves it today only
because the imports are in different positions and Bun's bundler tolerates it,
but it is architecturally invalid and will break under stricter module
resolution or when the cycle grows.

### Existing Mitigation: Partial DI Seam in cart.ts

`cart.ts` already has a `CartSyncDependencies` interface (line 287) and
`cartTestUtils.setSyncDependencies()` (line 1773) that inject
`fetchLatestCartSnapshot`, `publishCartSnapshot`, `getProductEvent`,
`getShippingEvent`, `getSigner`, `getNDK`, and `now`. This proves dependency
injection is viable in this codebase and is already used for testing.

However, the seam is **incomplete**:

- `v4VForUserQuery` (lines 1241, 1260) — called directly, not through the seam.
- `currencyConversionQueryOptions` / `btcExchangeRatesQueryOptions` (lines 1009,
  1494) — called via `cartQueryClient.fetchQuery()`, not through the seam.
- `productQueryOptions` / `productByATagQueryOptions` (lines 337, 343) — called
  via `cartQueryClient.fetchQuery()` in helper functions that *are* in the seam
  (`getProductEvent`), but the query options themselves are still imported from
  `@/queries/products`.

### Relationship to Existing Proposed ADR

[ADR-add-product-workflow-boundaries.md](./ADR-add-product-workflow-boundaries.md)
addresses **intra-workflow truth-domain separation** (product draft truth vs.
merchant setup truth vs. workflow/session truth). It is scoped to the Add Product
flow and focuses on *what state belongs where* within a single workflow.

This ADR addresses **cross-layer dependency direction** — a different axis. It
governs *which layers may import which* across the entire store layer, not just
the product workflow. The two ADRs are complementary:

- The workflow boundaries ADR defines truth domains within the product flow.
- This ADR defines the dependency rules that keep stores from reaching upward
  into query/publish layers.

The product workflow ADR's "separate navigation from draft mutation" principle
implicitly depends on stores not calling publish functions directly; this ADR
makes that dependency rule explicit and enforceable.

## Decision

### Rule 1: Stores Must Not Import from `queries/` or `publish/`

The intended layer dependency direction is:

```
components/
    ↓
hooks/
    ↓
queries/    publish/
    ↓           ↓
stores/  ←  (stores are the lowest layer; nothing imports from queries/publish)
```

Stores may import from:
- `@/lib/stores/*` (other stores — horizontal peer imports)
- `@/lib/schemas/*` (Zod schemas and types)
- `@/lib/utils/*` (pure utility functions)
- `@/lib/constants` (constants)
- External packages (`@tanstack/store`, `@nostr-dev-kit/ndk`, etc.)

Stores **must not** import from:
- `@/queries/*` (any query module)
- `@/publish/*` (any publish module)

### Rule 2: DTO Types Must Live in `@/lib/types`, Not in Stores

Types like `V4VDTO` that are shared across layers must be extracted to a neutral
location (e.g., `@/lib/types/v4v.ts`). This breaks the type-level import cycle:
both `queries/v4v.tsx` and `stores/cart.ts` import from `@/lib/types`, and
neither imports the other.

The general principle: **a type defined in a store and imported by a query
module is a layering violation**, even if it is only a `import type` (erased at
runtime). The import graph still cycles.

### Rule 3: No Private QueryClient Instances in Stores

Stores must not create `new QueryClient(...)`. If a store needs to execute a
query imperatively (after refactor — see Solution Path), it must receive the
shared QueryClient via dependency injection or a service layer parameter.

### Allowed Remediation Patterns

The ADR permits two patterns to eliminate upward imports. The choice depends on
the store's complexity:

#### Pattern A: Dependency Injection (expand existing seam)

**When to use:** The store has a small number of upward calls (≤3 query/publish
functions) and already has or can easily add a DI seam.

**How:** Define a dependencies interface that includes the query/publish
functions the store needs. Wire defaults at module load. Allow test overrides
via a `setDependencies()` utility. The wiring code (which imports from
`queries/`) lives in a separate file (e.g., `stores/cart-wiring.ts`) or in the
app bootstrap (`boot.ts`), not in the store itself.

**Best fit:** `auth.ts` (1 call), `collection.ts` (2 calls), `ndk.ts` (3 calls).

#### Pattern B: Service/Orchestrator Layer Extraction

**When to use:** The store has many upward calls, complex orchestration logic
(multi-step fetch → transform → publish sequences), or a private QueryClient
that indicates the store is doing work that belongs in a separate service.

**How:** Extract the orchestration logic into a service module under
`@/lib/services/` (e.g., `services/cart-sync.ts`). The service imports from
`queries/` and `publish/`, receives the shared QueryClient, and exposes
high-level methods. The store calls the service's methods. The service may also
update the store via `store.setState()` or action functions passed as
parameters.

**Best fit:** `cart.ts` (5 query modules, 1 publish module, private
QueryClient, complex reconciliation logic).

### Decision Criteria

| Criterion | DI (Pattern A) | Service Layer (Pattern B) |
|---|---|---|
| Upward import count | ≤3 | >3 or likely to grow |
| Private QueryClient | No | Yes → mandatory |
| Orchestration complexity | Single calls | Multi-step sequences |
| Existing DI seam | Already exists or trivial to add | Not present or insufficient |
| File size | <400 lines | >400 lines and growing |
| Testability needs | Mock individual functions | Mock entire service |

## Invariants

1. No file under `src/lib/stores/` contains an import from `@/queries/` or
   `@/publish/`.
2. No file under `src/lib/stores/` creates a `new QueryClient(...)`.
3. No type defined in `src/lib/stores/` is imported by any file under
   `src/queries/` or `src/publish/`.
4. Stores may depend on other stores (`@/lib/stores/*`) — horizontal peer
   imports are allowed.
5. Query and publish modules may import from stores (reading state or calling
   actions) — the dependency direction is `queries → stores`, not
   `stores → queries`.
6. Shared DTO types live in `@/lib/types/` and are imported by all layers.

## Enforcement

### ESLint: `no-restricted-imports` Rule

The project currently has **no ESLint configuration** (only Prettier for
formating). This ADR mandates adding ESLint with the following rule for the
stores directory. Note: `no-restricted-imports` catches **static** imports
only. Dynamic `await import()` calls (used by `nip60.ts`) require a separate
`no-restricted-syntax` rule targeting `ImportExpression` — or use
`dependency-cruiser` which resolves both static and dynamic imports.

```js
// eslint.config.js (flat config)
{
  files: ['src/lib/stores/**/*.ts', 'src/lib/stores/**/*.tsx'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['@/queries/*', '@/publish/*'],
          message: 'Stores must not import from queries/ or publish/. See ADR-store-layer-dependency-rules.md. Use dependency injection or a service layer.',
        },
      ],
    }],
    'no-restricted-syntax': ['error', {
      // Block `new QueryClient(...)` in stores
      selector: 'NewExpression[callee.name="QueryClient"]',
      message: 'Stores must not create private QueryClient instances. Use the shared QueryClient via DI or a service layer. See ADR-store-layer-dependency-rules.md.',
    }],
  },
}
```

This rule is **composable and incremental** — it can be added immediately and
will flag all current violations. Existing violations can be suppressed
temporarily with targeted `// eslint-disable-next-line` comments with a
reference to a migration issue, preventing new violations from accumulating
while the refactor proceeds.

### Dependency-Cruiser (Optional, Stronger Enforcement)

For comprehensive architectural boundary enforcement, `dependency-cruiser` can
validate the full import graph:

```json
// .dependency-cruiser.json
{
  "forbidden": [
    {
      "name": "stores-to-queries",
      "comment": "Stores must not import from queries/",
      "from": { "path": "^src/lib/stores/" },
      "to": { "path": "^src/queries/" }
    },
    {
      "name": "stores-to-publish",
      "comment": "Stores must not import from publish/",
      "from": { "path": "^src/lib/stores/" },
      "to": { "path": "^src/publish/" }
    },
    {
      "name": "queries-to-store-types",
      "comment": "Queries must not import types from stores (extract to @/lib/types)",
      "from": { "path": "^src/queries/" },
      "to": { "path": "^src/lib/stores/" }
    }
  ]
}
```

This catches both runtime and type-only imports and can run in CI.

### Type Cycle Enforcement

The `V4VDTO` type cycle can be detected by:

1. **`tsc --traceResolution`** or a circular-dependency check (`madge --circular`)
2. **ESLint `import/no-cycle`** rule (requires `eslint-plugin-import`)
3. **dependency-cruiser** `circular` rule

The fix is mechanical: move `V4VDTO` (and any similar shared types) to
`@/lib/types/v4v.ts`.

### Code Review Checklist

Before merging any PR that touches `src/lib/stores/`:

- [ ] No new imports from `@/queries/*` or `@/publish/*`
- [ ] No new `new QueryClient(...)` instantiation
- [ ] No new type exported from a store that is imported by `queries/` or
      `publish/`
- [ ] If a query/publish dependency was needed, it was added via DI or service
      layer
- [ ] If this is a new store file, it contains zero upward imports

## How This ADR Prevents Future Issues

### New Stores

Before this ADR, creating a new store typically meant copying the pattern from
an existing store — which often already had upward imports. The ESLint rule
makes this impossible: a new store file that imports from `@/queries/` will fail
the lint check immediately.

### Existing Stores Accumulating More Upward Imports

The `no-restricted-imports` ESLint rule prevents adding *new* upward imports
even in stores that already have violations. Each existing violation must carry
an explicit `eslint-disable` comment with a migration issue reference, making
technical debt visible and tracked.

### Private QueryClient Instances

The `no-restricted-syntax` rule for `new QueryClient` blocks this pattern at the
lint level. Any store that needs to execute queries must receive the shared
QueryClient as a parameter, ensuring cache visibility and DevTools integration.

## Consequences

### Positive

- Stores become pure state containers with testable seams
- Single React Query cache (no duplicate data fetching)
- React Query DevTools show all queries
- Import graph is acyclic and follows the intended layer direction
- New developers cannot accidentally introduce the anti-pattern
- The existing `CartSyncDependencies` pattern is validated and generalized
- Clear decision criteria for DI vs. Service Layer prevent bikeshedding

### Costs

- ESLint must be added to the project (currently zero lint config)
- 5 stores need refactoring (cart.ts is the largest, ~1,892 lines)
- V4VDTO and similar shared types must be extracted to `@/lib/types/`
- During the migration period, `eslint-disable` comments create visual noise
- Service layer extraction for cart.ts adds ~1 file and increases surface area
- Some test contracts may change as dependencies move behind seams

### Neutral

- The DI pattern already exists in cart.ts — this ADR formalizes and extends it
- The shared QueryClient factory already exists in `src/lib/queryClient.ts`

## Migration Path

### Phase 0: Add Enforcement (Blocks New Violations)

1. Add ESLint with `no-restricted-imports` for `@/queries/*` and `@/publish/*`
   in `src/lib/stores/**`.
2. Add `no-restricted-syntax` for `new QueryClient` in `src/lib/stores/**`.
3. Suppress all existing violations with `eslint-disable-next-line` + issue refs.
4. Add ESLint to CI (`bunx eslint src/lib/stores/`).

### Phase 1: Break the Type Cycle

1. Move `V4VDTO` to `@/lib/types/v4v.ts`.
2. Update all importers (cart.ts, v4v.tsx, V4VManager.tsx, RecipientItem.tsx,
   useV4VManager.ts, useOrderInvoices.ts).
3. Remove `eslint-disable` for the type import violation.

### Phase 2: Eliminate Private QueryClient (cart.ts)

1. Remove `cartQueryClient` from cart.ts.
2. Either: (a) inject the shared QueryClient via `CartSyncDependencies`, or
   (b) move the query-execution logic to a `services/cart-sync.ts` service that
   receives the shared QueryClient.

### Phase 3: Migrate Each Store

Priority order (by violation severity):

1. **cart.ts** — Service Layer extraction (Pattern B). Highest complexity.
2. **nip60.ts** — Service Layer extraction (Pattern B). 2,464 lines, dynamic
   imports from `@/publish/auctions`. Requires dependency-cruiser (not just
   ESLint) for enforcement.
3. **ndk.ts** — DI (Pattern A). 3 calls, all in connection lifecycle.
4. **product.ts** — DI (Pattern A). Publish calls + queryKey access. Already
   receives QueryClient as parameter (good partial pattern).
5. **auth.ts** — DI (Pattern A). 1 call, trivial.
6. **collection.ts** — DI (Pattern A). 2 calls, trivial.

### Phase 4: Remove All eslint-disable Suppressions

Once all stores are migrated, remove the temporary suppressions. The rule
becomes a hard gate.

## Notes

- This ADR generalizes the principle implicit in
  ADR-add-product-workflow-boundaries.md: stores are the bottom of the
  dependency stack and must not reach upward.
- The `CartSyncDependencies` seam in cart.ts (line 287) is the reference
  implementation for Pattern A. It is already tested via
  `cartTestUtils.setSyncDependencies()`.
- product.ts already demonstrates a partial Pattern B: its `publishProduct`
  method receives `queryClient?: QueryClient` as a parameter (lines 424, 517)
  rather than creating its own. This is the correct direction.
- The `@/lib/types/` directory may not exist yet and should be created in
  Phase 1.
