# ADR-XXX: Shared Status Variant Mapping for All Status Displays

## Status

Proposed

## Date

2026-07-21

## Related

- `src/components/ui/badge.tsx` — existing shadcn Badge component with variant system
- `src/components/orders/OrderCard.tsx` (lines 17-30) — local `getBadgeVariant` implementation
- `src/components/orders/PrivateOrderDetailsCard.tsx` — separate status display logic
- `src/components/ProductCard.tsx` — product availability status logic
- `AGENTS.md` §Constraints — "Do not collapse payment lifecycles into booleans. Keep requested, attempted, wallet acknowledged, settled/proven, receipt published, merchant confirmed, expired, failed, refunded, and fulfilled states distinct."
- `ADR-XXX: Design Token Enforcement` — semantic status colors require dedicated tokens

## Context

The codebase has N independent implementations of the same concept: mapping a domain status (order status, payment status, product availability) to a visual variant (color, badge style). Each component rolls its own logic:

- `OrderCard.tsx` (lines 17-30): local `getBadgeVariant()` function mapping order statuses to Badge variant strings.
- `PrivateOrderDetailsCard.tsx`: separate status rendering with different color mappings.
- `OrderActions.tsx`: yet another status check for action visibility.
- `ProductCard.tsx`: product availability displayed with its own styling logic.
- Payment components: their own status-to-color mapping.

The result: the same semantic status (e.g., "completed", "pending", "failed") renders with different colors and badge styles depending on which component renders it.

Beyond status badges, loading/error/success states are also handled inconsistently:
- `CartItem.tsx` (lines 51, 183-202): custom loading skeleton.
- `ProfileName.tsx` (lines 29-32): different loading fallback.
- `FeaturedSections.tsx` (lines 25-58): yet another loading pattern.

## Decision

**All status displays derive from a single shared status-to-variant mapping.** Specifically:

1. **Canonical variant types** are defined in a single module (e.g., `src/lib/ui/statusVariants.ts`):
   ```typescript
   type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'loading';
   ```

2. **Domain-specific mappers** translate domain enums to `StatusVariant`:
   ```typescript
   // src/lib/ui/orderStatusVariant.ts
   function orderStatusVariant(status: OrderStatus): StatusVariant { ... }

   // src/lib/ui/paymentStatusVariant.ts
   function paymentStatusVariant(status: PaymentStatus): StatusVariant { ... }
   ```

3. **The `Badge` component** is extended with `StatusVariant`-mapped variants (`badge-success`, `badge-warning`, `badge-error`, `badge-info`, `badge-neutral`). These map to the semantic CSS tokens from the Design Token ADR.

4. **No component implements its own `getBadgeVariant`** or status-to-color logic. Components call the shared mapper and pass the result to `Badge`.

5. **Loading/error/success states** are a special case of `StatusVariant`. A component in a loading state uses `StatusVariant.loading`; an error uses `StatusVariant.error`. Shared loading skeleton components are used for consistent rendering.

## Invariants

- There is exactly one mapping from each domain status to a `StatusVariant`.
- `StatusVariant` values map 1:1 to Badge variants and CSS color tokens.
- Adding a new status type requires adding it to the mapper, not inventing a new color.
- A grep for `getBadgeVariant` or `BadgeVariant` in `src/components/` returns zero results (logic lives in `src/lib/ui/`).

## Consequences

### Positive

- A status means the same thing visually everywhere it appears.
- Changing how "error" looks is a single token edit, not a find-and-replace across components.
- New status types are trivial to add — one mapper entry.
- Aligns with AGENTS.md: domain states stay distinct and map to clear visual semantics.

### Costs

- Initial migration touches every component with status display logic.
- Teams must agree on variant semantics (what counts as "warning" vs "error").
- Mapper functions become a shared dependency — changes ripple.

## Notes

### Migration Strategy

1. **Define `StatusVariant` type** and the `Badge` variant extensions in `src/lib/ui/`.
2. **Write domain mappers** for order status, payment status, and product availability. Start with the most-used domain (orders).
3. **Add shared `LoadingState` and `ErrorState` components** that use `StatusVariant.loading` and `StatusVariant.error`.
4. **Migrate components one-by-one**: replace local `getBadgeVariant` with shared mapper import. Each migration is a separate commit.
5. **Remove local status logic** once all consumers use the shared mappers.

### Alignment with AGENTS.md

The AGENTS.md constraint "do not collapse payment lifecycles into booleans" applies equally to display: a payment status must not be collapsed into an arbitrary color choice. It must flow through a defined variant that carries semantic meaning. This ADR extends that principle from state management to visual presentation.
