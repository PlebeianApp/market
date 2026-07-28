# AGENTS.md — src/components/ui-wrappers

This directory follows `src/components/AGENTS.md` and the repository-level
`AGENTS.md`.

## Purpose

`ui-wrappers/` contains wrapper components built on top of Shadcn primitives
from `src/components/ui/`. Wrappers add custom styling, behavior, and variant
systems while keeping the import hierarchy clean: `ui` → `ui-wrappers` →
`shared` / `nostr` / `layout` / `dialogs`.

## Import rules

- **May import from:** `@/components/ui/*` (Shadcn primitives), `@/lib/utils`,
  `@/lib/*` (utility hooks/helpers), `@/hooks/*`.
- **May NOT import from:** `shared/`, `nostr/`, `layout/`, `dialogs/`, or any
  feature directory. Wrappers are low-level — they must not depend on
  higher-level components.
- **Canonical alias:** `@/components/ui-wrappers/{component}`.

## Standards

- **`forwardRef`:** All wrapper components **must** use `forwardRef` to forward
  refs to their root DOM element.
- **`cn()` className merging:** Accept a `className` prop and merge with
  internal styles via `cn()`. Never use string concatenation.
- **Callbacks:** No inline hooks for data fetching, store access, or business
  logic. Wrappers are purely presentational with optional behavioral
  extensions (e.g., managing open/close state for a dropdown wrapper).
- **Forwarding refs through Shadcn primitives:** Most Shadcn primitives spread
  `{...props}` onto their root DOM element, so a `ref` passed into the
  primitive's props attaches to that node. Rely on this — do **not** wrap the
  primitive in an extra DOM element solely to attach a ref. This keeps the
  wrapper a single element.
- **Variants:** Use `class-variance-authority` (`cva`) for variant systems.
  Define variants that map to the scoped `.theme-new` tokens (e.g.,
  `info`/`warning`/`error`/`success` for status-based variants).
- **Props typing:** Extend `React.ComponentProps<typeof Primitive>` or
  `React.HTMLAttributes<HTMLElement>` as appropriate.

## Review checklist

- [ ] Uses `forwardRef` with `displayName` set
- [ ] Uses `cn()` for className merging
- [ ] No inline store/query/business-logic calls
- [ ] Only imports from `ui/`, `lib/`, `hooks/`
- [ ] Variants use semantic tokens, not hardcoded colors
