# ADR-XXX: Query Layer Standardization — Single Data-Fetching Boundary

## Status

Proposed

## Date

2026-07-21

## Related

- `src/queries/products.tsx` — product query hooks
- `src/queries/orders.tsx` — order query hooks
- `src/queries/payment.tsx` — payment query hooks
- `src/queries/queryKeyFactory.ts` — query key definitions
- `src/components/CartItem.tsx`, `src/components/ProfileName.tsx`, `src/components/FeaturedSections.tsx` — components with ad-hoc loading/error handling
- `src/routes/_dashboard-layout/dashboard/account/your-purchases.tsx` (lines 29-76) — manual filtering/sorting in route component
- `AGENTS.md` §Constraints — "Preserve the distinction between UI/form state, query/cache state, relay state..."
- `ADR-XXX: Shared Status Variant Mapping` — query states (loading/error/success) map to the shared variant system

## Context

The codebase has a `src/queries/` directory with TanStack Query hooks for products, orders, and payments. However, the patterns used across these query files are inconsistent:

- **Filtering/sorting**: `products.tsx` (lines 132-163) implements filtering one way; `orders.tsx` does it differently; `your-purchases.tsx` (lines 29-76) reimplements filtering/sorting inline in the route component instead of in a query hook.
- **Pagination**: Different approaches across query files.
- **Error handling**: Each query hook exposes errors differently; consuming components handle them differently.
- **Loading states**: `CartItem.tsx` (lines 51, 183-202), `ProfileName.tsx` (lines 29-32), and `FeaturedSections.tsx` (lines 25-58) each implement their own loading skeleton and error fallback rather than consuming standardized query states.
- **Direct fetching**: Some components bypass query hooks entirely and fetch data directly, creating cache misses and inconsistent state management.

## Decision

**`src/queries/` is the single data-fetching boundary.** All data reads go through standardized TanStack Query hooks. Specifically:

1. **All data reads through query hooks.** Components consume `useXxxQuery()` / `useXxxInfiniteQuery()` hooks from `src/queries/`. No component calls relay I/O, fetch, or data-access functions directly.

2. **Standardized hook shape.** Every query hook returns TanStack Query's standard result (`{ data, isLoading, isError, error, ... }`). Components render based on these states using the shared `StatusVariant` system (loading → skeleton, error → error state, success → data).

3. **Standardized query key factory.** All keys go through `queryKeyFactory.ts` using a consistent pattern:
   ```typescript
   // Consistent structure: [domain, entity, ...params]
   queryKeyFactory.products.list({ filter, sort, page })
   queryKeyFactory.orders.detail(orderId)
   ```

4. **Filtering, sorting, and pagination live in query hooks**, not in components. Route components pass filter/sort params to the hook; the hook applies them via `select` or query function parameters.

5. **No `select`-based business logic in components.** Data transformation (mapping relay events to domain objects, computing derived fields) happens in the query layer or a dedicated `src/lib/` module, not in component render paths.

## Invariants

- `src/components/` contains zero direct data-fetch calls (relay reads, `fetch()`, `NDKEvent` subscriptions).
- Every query hook returns the standard TanStack Query result shape.
- Query keys are constructed exclusively through `queryKeyFactory.ts`.
- Filter/sort/pagination logic is not duplicated between query hooks and components.
- Loading and error states in components derive from query hook return values, not from local component state.

## Consequences

### Positive

- Consistent caching — all reads go through the same query key space, so cache invalidation and refetching work predictably.
- Consistent loading/error/success rendering — components consume standardized states that map to the `StatusVariant` system.
- Testable data layer — query hooks can be tested independently of UI components.
- Clear boundary — components are presentational; `src/queries/` is the data layer; `src/lib/` is domain logic.

### Costs

- Initial migration of components that currently fetch directly.
- Query hooks become a critical shared dependency — bugs here affect all consumers.
- Slightly more boilerplate for simple data reads (but offset by caching and consistency).

## Notes

### Migration Strategy

1. **Audit all direct data access in `src/components/`** — identify components calling relay I/O, NDK subscriptions, or fetch directly.
2. **Create missing query hooks** for any data access not yet covered by `src/queries/`.
3. **Standardize `queryKeyFactory.ts`** — ensure all existing hooks use it; migrate any inline key construction.
4. **Move filtering/sorting into hooks** — port inline logic from route components (e.g., `your-purchases.tsx` lines 29-76) into the corresponding query hook.
5. **Migrate components one-by-one** — replace direct data access with hook calls. Each migration is a separate commit.
6. **Add a lint check** — flag any `@nostr-dev-kit` or direct fetch imports in `src/components/` (extends the existing NDK footprint guard pattern).

### Alignment with AGENTS.md

The AGENTS.md constraint to "preserve the distinction between UI/form state, query/cache state, relay state" maps directly to this decision: query/cache state belongs in `src/queries/`, not smeared across component state. This ADR formalizes that boundary as an enforceable architecture rule.
