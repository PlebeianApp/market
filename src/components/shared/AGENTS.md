# AGENTS.md — src/components/shared

This directory follows `src/components/AGENTS.md` and the repository-level
`AGENTS.md`.

## Purpose

`shared/` contains general-purpose reusable components that are not
domain-specific. These are building blocks used across multiple feature areas:
badges, buttons with tooltips, state messages (empty/loading/error), grids,
and other cross-cutting UI primitives.

## Import rules

- **May import from:** `@/components/ui/*`, `@/components/ui-wrappers/*`,
  `@/lib/*`, `@/hooks/*`.
- **May NOT import from:** `nostr/`, `layout/`, `dialogs/`, or feature
  directories. Shared components are general-purpose — they must not depend
  on Nostr domain logic, layout structure, or dialog compositions.
- **Canonical alias:** `@/components/shared/{component}`.

## Standards

- **Ref exposure (React 19 ref-as-prop):** All components **must** expose
  `ref` to their root DOM element. **Prefer React 19 ref-as-prop** (accept
  `ref` as a regular prop). **Use `forwardRef` only where a dependency
  still requires it.** Existing components using `forwardRef` do not need
  to be rewritten.
- **`cn()` className merging:** Accept `className` prop, merge with internal
  styles via `cn()`. Never use string concatenation.
- **No business logic:** Shared components are purely presentational. No
  inline hooks for data fetching, store access, or business logic. Accept
  data and callbacks via props.
- **No hardcoded colors:** Use semantic tokens from the theme system. When
  inside a `.theme-new` scope, use the new scoped tokens (`info`, `warning`,
  `error`, `success`, `muted-foreground`, etc.).
- **Variants:** Use `cva` for variant systems where applicable.

## Review checklist

- [ ] Exposes `ref` to root DOM element (React 19 ref-as-prop)
- [ ] Uses `cn()` for className merging
- [ ] No inline data hooks or store calls
- [ ] No hardcoded colors — uses semantic tokens
- [ ] Only imports from `ui/`, `ui-wrappers/`, `lib/`, `hooks/`
