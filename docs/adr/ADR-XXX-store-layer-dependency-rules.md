# ADR-XXX: Store Layer Dependency Rules

## Status

Proposed

## Date

2026-07-17

## Related

- AGENTS.md §37–38 (state-type separation)
- ADR-0002 (Strangler-fig I/O migration — stores benefit from clean layering
  during module-by-module migration)
- ADR: Phase Enums over Parallel Boolean Flags (same `cart.ts` file, different concern)

---

## 1. Context

Plebeian Market has two core layers in `src/` that are **bidirectionally
coupled**. Stores under `src/lib/stores/` import upward into `@/queries/*` and
`@/publish/*` — layers that sit above them in the intended architecture.

This was re-verified on upstream/master `8706d74a`.

### Verified Violations (5 stores — NOT 6)

> **CRITICAL CORRECTION:** `nip60.ts` was previously listed as a
> violating store. It has since been **refactored upstream** and is now **clean**:
> 933 lines, **zero** query imports, **zero** publish imports, **zero** dynamic
> imports. It is **excluded** from the violation table and all remediation
> scopes below.

| Store | Lines | Query Imports | Publish Imports | Private QueryClient | Violation Pattern |
|-------|------:|:------------:|:---------------:|:-------------------:|-------------------|
| **cart.ts** | 1,892 | 6 | 1 | ✅ L274 | Private QueryClient + imperative calls + type cycle |
| **product.ts** | 530 | 2 | 1 | — | Publish calls + queryKey access |
| **ndk.ts** | 804 | 2 | 0 | — | Imperative calls in connection lifecycle |
| **auth.ts** | 365 | 1 | 0 | — | Imperative product fetch on login |
| **collection.ts** | 174 | 1 | 1 | — | Publish + parse calls |

**Total upward import lines:** 15 across 5 store files.

For comparison, the **reverse** direction (queries → stores) is architecturally
correct and unrestricted: ~27 query files import from stores (~31 import lines).
Those are not violations.

### The `cart.ts` case (most severe)

`cart.ts` (1,892 lines) imports from **6 query modules** and **1 publish
module**:

```typescript
import { fetchLatestCartSnapshot } from '@/queries/cart'                                                // L3
import type { SupportedCurrency } from '@/queries/external'                                             // L4
import { btcExchangeRatesQueryOptions, currencyConversionQueryOptions } from '@/queries/external'       // L5
import { getProductId, getProductPrice, getProductSellerPubkey,
         productQueryOptions, productByATagQueryOptions } from '@/queries/products'                     // L6
import { shippingOptionQueryOptions,
         shippingOptionsByPubkeyQueryOptions,
         shippingOptionByCoordinatesQueryOptions } from '@/queries/shipping'                            // L7–13
import { v4VForUserQuery } from '@/queries/v4v'                                                          // L14
import { publishCartSnapshot } from '@/publish/cart'                                                     // L15
```

The store also creates a **private `QueryClient`** at L274, separate from the
application's React Query cache (see §2.1 below).

### Existing partial solution

The cart store already contains a dependency-injection seam:
`CartSyncDependencies` (a type wrapping external calls for testability) and
`defaultCartSyncDependencies` wiring. However, the wiring still lives **inside
the same module** and still imports query functions at the top of the file. The
compile-time coupling is not actually broken.

---

## 2. Three Violation Types

### 2.1 Private QueryClient instance (`cart.ts` L274)

```typescript
const cartQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5 } },
})
```

`cart.ts` creates its own `QueryClient` separate from the app's React Query
cache. Consequences:

- Product/shipping data is fetched **twice** — once by components (app cache),
  once by the store (private cache).
- Cache invalidation from anywhere else in the app does **not** reach the
  store's private cache.
- The private cache is **invisible** to React Query DevTools.
- The store hardcodes its own `staleTime` instead of respecting app-wide policy.

### 2.2 Imperative calls into query/publish functions

Stores call query and publish functions directly, bypassing the React Query
lifecycle entirely:

| Store | Imperative calls |
|-------|-----------------|
| cart.ts | `fetchLatestCartSnapshot()`, `v4VForUserQuery()`, `cartQueryClient.fetchQuery(productQueryOptions(...))`, `publishCartSnapshot()` |
| product.ts | `publishProduct()`, `updateProduct()`, `productKeys` access |
| ndk.ts | `fetchNwcWalletBalance()`, `fetchUserNwcWallets()`, `fetchUserRelayListWithPreferences()` |
| auth.ts | `fetchProductsByPubkey()` |
| collection.ts | `getCollectionShippingOptions()`, `getCollectionSummary()`, `publishCollection()`, `updateCollection()` |

### 2.3 Type-level circular dependency

```
queries/v4v.tsx L1:  import type { V4VDTO } from '@/lib/stores/cart'
stores/cart.ts   L14: import { v4VForUserQuery } from '@/queries/v4v'
```

This creates a circular module dependency: `cart` imports from `v4v`, and `v4v`
imports a type from `cart`. Confirmed still present on `8706d74a`.

---

## 3. Decision — Three Rules

Establish explicit dependency-layering rules for `src/lib/stores/`.

### Layering diagram

```
┌─────────────────────────────────────────┐
│          Components / Routes             │  (UI layer)
│           src/components, src/routes     │
├──────────────┬──────────────────────────┤
│   Queries    │        Stores            │  (domain layer)
│  src/queries │  src/lib/stores          │
│  src/publish │                          │
├──────────────┴──────────────────────────┤
│     Services (orchestration)             │  (service layer — new)
│     src/lib/services, src/lib/cart       │
├──────────────────────────────────────────┤
│          Core / Lib / Types              │  (infrastructure)
│     src/lib (non-stores), src/lib/types  │
└─────────────────────────────────────────┘
```

### Rule 1: Stores must not import upward

Stores **MUST NOT** import from `@/queries/*` or `@/publish/*`.

- Queries MAY import from Stores — this is the expected direction (queries read
  store state to configure fetches).
- Stores MAY import from Core/Lib (`src/lib/constants`, `src/lib/schemas`,
  `src/lib/types`).
- Components MAY import from both Stores and Queries — the UI layer wires them
  together.

If a store needs data from a query, it receives it via **dependency injection**,
a **callback**, or a **service layer** — never a direct import.

### Rule 2: Shared DTOs must live in `@/lib/types/`

Types shared between stores and queries (e.g., `V4VDTO`) must reside in
`@/lib/types/`, not inside a store module. This eliminates type-level circular
dependencies.

### Rule 3: No private QueryClient in stores

Stores **MUST NOT** instantiate `new QueryClient(...)`. If a store needs to
orchestrate queries, it must do so through a service layer that receives the
app's shared `QueryClient` via DI, or through hooks in the UI layer.

---

## 4. Two Remediation Patterns

### Pattern A — Dependency Injection (for ≤3 upward calls)

**Applies to:** `auth.ts`, `collection.ts`, `ndk.ts`

Expand the existing `CartSyncDependencies` seam pattern. The store defines a
dependency type and an init function; the wiring (which imports queries) lives
**outside** the store module.

```typescript
// src/lib/stores/auth.ts — NO query imports
type AuthDependencies = {
  fetchUserProducts: (pubkey: string) => Promise<Product[]>
}
let authDeps: AuthDependencies

export function initAuthDependencies(deps: AuthDependencies) {
  authDeps = deps
}
// ... store logic uses authDeps.fetchUserProducts()

// src/lib/stores/auth-init.ts or boot.ts — query imports live HERE
import { fetchProductsByPubkey } from '@/queries/products'
import { initAuthDependencies } from '@/lib/stores/auth'

initAuthDependencies({ fetchUserProducts: fetchProductsByPubkey })
```

### Pattern B — Service Layer (for >3 calls or private QueryClient)

**Applies to:** `cart.ts`, `product.ts`

Extract orchestration logic to `@/lib/services/` (or `@/lib/cart/`). The store
becomes a thin facade holding state + hooks; the service layer handles all
query/publish coordination.

```typescript
// src/lib/services/cart-service.ts — query/publish imports live HERE
import { productQueryOptions } from '@/queries/products'
import { publishCartSnapshot } from '@/publish/cart'

export class CartService {
  constructor(private queryClient: QueryClient) {}

  async fetchProduct(productId: string) {
    return this.queryClient.fetchQuery(productQueryOptions(productId))
  }

  async publish(cart: CartSnapshot) {
    return publishCartSnapshot(cart)
  }
}
```

The store receives the service via DI at boot; no query imports leak into the
store file.

---

## 5. Enforcement

### Current state: No ESLint exists

**No ESLint configuration exists in the project at all.** There is no
`.eslintrc`, `.eslintrc.json`, `.eslintrc.js`, or `eslint.config.*` on
upstream/master. Enforcement requires adopting ESLint first.

### Target enforcement: Three-layer guard

Once ESLint is set up, enforce the rules with a combination of:

**a) `no-restricted-imports`** — block upward imports in store files:

```javascript
{
  files: ['src/lib/stores/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['@/queries/*'],
          message: 'Stores must not import from queries. Use DI or a service layer. See ADR: Store Layer Dependency Rules.',
          allowTypeImports: false,
        },
        {
          group: ['@/publish/*'],
          message: 'Stores must not import from publish. Use a service layer. See ADR: Store Layer Dependency Rules.',
          allowTypeImports: false,
        },
      ],
    }],
  },
}
```

**b) `no-restricted-syntax`** — block `new QueryClient(...)` in stores:

```javascript
{
  files: ['src/lib/stores/**/*.ts'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'NewExpression[callee.name="QueryClient"]',
      message: 'Stores must not instantiate QueryClient. Use a service layer with the shared app QueryClient.',
    }],
  },
}
```

**c) `dependency-cruiser`** — validate the full dependency graph is acyclic:

```json
{
  "forbidden": [
    {
      "name": "stores-must-not-import-queries",
      "from": { "path": "^src/lib/stores/" },
      "to": { "path": "^src/queries/|^src/publish/" }
    }
  ]
}
```

### Interim enforcement: CI grep

Until ESLint is adopted, a CI grep check serves as interim enforcement:

```bash
if grep -rl "from '@/queries\|from '@/publish" src/lib/stores/; then
  echo "ERROR: Store files must not import from queries or publish."
  echo "See ADR: Store Layer Dependency Rules."
  exit 1
fi
```

---

## 6. Migration Path

### Phase 0 — Set up ESLint + interim grep check

- Add `.eslintrc` with `no-restricted-imports` and `no-restricted-syntax` rules.
- Add `eslint-disable-next-line` suppressions on all existing violations (so
  the rule is active but does not break the build).
- Add the CI grep check as a belt-and-suspenders guard.
- Document the three rules in AGENTS.md.
- **No code behavior changes.**

### Phase 1 — Break the type cycle

- Move `V4VDTO` from `src/lib/stores/cart.ts` to `src/lib/types/v4v.ts`.
- Update `queries/v4v.tsx` to import from `@/lib/types/v4v`.
- Remove the type import cycle.

### Phase 2 — Kill the private QueryClient

- Replace `cartQueryClient` (L274) with the app's shared `QueryClient` injected
  via DI.
- This eliminates double-fetching and the invisible cache.

### Phase 3 — Migrate stores

Order: highest complexity first (forces the service-layer pattern early).

1. **cart.ts → Service Layer** (Pattern B): extract to `src/lib/cart/` package.
2. **product.ts → Service Layer** (Pattern B): extract to `src/lib/services/product-service.ts`.
3. **ndk.ts → DI** (Pattern A).
4. **auth.ts → DI** (Pattern A).
5. **collection.ts → DI** (Pattern A).

After each store is migrated, remove its `eslint-disable` suppression.

### Phase 4 — Remove all suppressions

- Remove every `eslint-disable-next-line` added in Phase 0.
- Add `dependency-cruiser` to CI for graph-level validation.
- The lint rules now fail the build on any new violation.

---

## 7. Cart Service Layer Structure

Proposed file layout for extracting `cart.ts` (1,892 lines) into a modular
service package:

```
src/lib/cart/
  types.ts         ~110 lines  (DTOs — includes V4VDTO moved from stores/cart)
  persistence.ts   ~120 lines  (localStorage + Nostr snapshot)
  pricing.ts       ~280 lines  (convertToSats, calculateTotals)
  shipping.ts      ~220 lines  (fetchShippingOptions — de-duplicates triplication)
  v4v.ts           ~80 lines   (updateV4VShares)
  sync.ts          ~200 lines  (reconcileRemoteCart, publishSnapshot)
  mutations.ts     ~280 lines  (addProduct, removeProduct)
  index.ts         ~40 lines   (re-export public API)

src/lib/stores/cart.ts  ~150 lines  (Store instance + facade + hooks)
```

**Total:** ~1,330 lines across 9 files vs. 1,892 in one file.
**Net reduction:** ~560 lines from de-duplication (especially shipping logic).

The store file becomes a thin facade: it holds the Zustand store instance and
exports hooks (`useCart`, `useCartActions`). All query/publish imports live in
the service package.

---

## 8. Additional Findings

### 8.1 `useCartTotals` — dead code (`cart.ts` L1844)

```typescript
export function useCartTotals() {  // L1844
```

This hook has **zero callers** anywhere in the codebase. It is dead code and
should be removed during the cart service-layer migration.

### 8.2 `getBuyerPubkey` — stub returning null (`cart.ts` L1383)

```typescript
getBuyerPubkey: () => {
  // TODO: This should get the pubkey from the auth system
  // For now, return null as a placeholder
  return null
},
```

This stub returns `null`, which makes the V4V (value-for-value) branch
**unreachable** in cart logic. Note: a **separate** `getBuyerPubkey` function
exists in `src/queries/orders.tsx` (L1117) and is used by order components —
that one is not a stub. The cart store's version is the dead stub.

### 8.3 Shipping-option fetch logic triplicated

The same shipping-option fetch pattern is copy-pasted across multiple methods
in `cart.ts` (visible at L1617–1650 and L1703–1741, among others). The service
layer extraction (`shipping.ts`) consolidates this into a single implementation.

### 8.4 `product.ts` has 2 query imports (not 1)

```typescript
import { ... } from '@/queries/products'       // L21
import { productKeys } from '@/queries/queryKeyFactory'  // L22
```

Both must be removed during migration.

---

## Invariants

- **No `import ... from '@/queries/...'` in any file under `src/lib/stores/`**
- **No `import ... from '@/publish/...'` in any file under `src/lib/stores/`**
- **No `new QueryClient(...)` in any file under `src/lib/stores/`**
- Shared DTO types live in `@/lib/types/`, not in store modules
- Stores receive query-derived data via DI (injected at boot), via callbacks
  from the UI layer, or via a service layer
- The DI/service wiring code (which imports queries) lives outside the store
  module — in an init module, `boot.ts`, a provider, or `src/lib/services/`
- Query modules may freely import from stores; this direction is not restricted
- When a store needs a value from a query (e.g., exchange rates), it either:
  (a) receives it as a parameter from the caller, (b) uses an injected fetch
  function, or (c) subscribes to a store that the UI layer populates from query
  results

---

## Consequences

### Positive

- **No circular dependencies**: build times improve, hot-module-reload becomes
  predictable.
- **Testable stores in isolation**: store unit tests inject mock dependencies
  without importing the real query layer.
- **Clear layering**: the dependency graph becomes a DAG — queries depend on
  stores and core; stores depend only on core; components depend on both.
- **Single cache**: removing the private `QueryClient` eliminates double-fetching
  and cache-desync bugs.
- **Migration-friendly**: when ADR-0002 changes how queries fetch data (NDK →
  Applesauce), stores are unaffected because they don't import queries directly.
- **Smaller files**: the cart service-layer extraction reduces 1,892 lines to
  ~1,330 across 9 focused files.

### Costs

- **Migration effort for 5 store files**: each must be refactored to extract
  query/publish imports.
- **`cart.ts` is substantial**: 1,892 lines with 6 query imports, 1 publish
  import, and a private QueryClient. The service-layer extraction is
  non-trivial.
- **Boilerplate**: every store that needs query data gains a DI type, an init
  function, and a wiring site (Pattern A) or a service module (Pattern B).
- **Runtime initialization order**: the DI wiring must execute before the store
  is used. This introduces a boot-order dependency (similar to how `boot.ts`
  already initializes NDK before stores use it).
- **ESLint adoption required**: the project has no ESLint config at all. Phase 0
  requires initial ESLint setup before the lint rules can enforce mechanically.

---

## Notes

- The ~27 query files that import from stores are **not** a problem — that
  direction is architecturally correct. The issue is solely the 5 store files
  that import back into queries/publish, creating cycles.
- `nip60.ts` (933 lines) was previously listed as a 6th violator.
  It has been refactored upstream and is now clean. It requires **no action**.
- The root `AGENTS.md` §37–38 covers state-type separation (payment lifecycle,
  sensitive data) but does **not** mention import-direction layering. This ADR
  introduces the import-direction constraint as a new rule; AGENTS.md should be
  updated to cross-reference it during Phase 0.
