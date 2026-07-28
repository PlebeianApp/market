# AGENTS.md — src/components/layout

This directory follows `src/components/AGENTS.md` and the repository-level
`AGENTS.md`.

## Purpose

`layout/` contains structural components that define the app's layout
skeleton: `Header`, `Footer`, `MobileMenu`, sidebar components, and other
structural wrappers. These components are used at the route/layout level and
compose other components into a page structure.

## Import rules

- **May import from:** `@/components/ui/*`, `@/components/ui-wrappers/*`,
  `@/components/shared/*`, `@/components/nostr/*` (for header user avatars,
  profile names, etc.), `@/lib/*`, `@/hooks/*`, `@/queries/*`,
  `@/stores/*` (read-only for display state).
- **May NOT import from:** `dialogs/` or feature directories (`checkout/`,
  `orders/`, `wallet/`, etc.). Layout components compose UI, they don't
  own feature logic.
- **Canonical alias:** `@/components/layout/{component}`.

## Standards

- **`forwardRef`:** All components **must** use `forwardRef`.
- **`cn()` className merging:** Accept `className` prop, merge via `cn()`.
- **Callbacks for actions:** Navigation, auth, and UI actions should be
  delegated via callbacks where practical. Read-only store access for display
  state (e.g., checking if user is authenticated) is permitted, but mutating
  actions should use callbacks.
- **No hardcoded colors:** Use semantic tokens. The header/footer "dark hero"
  color scheme (black background, pink accent) should eventually be tokenized;
  until then, hardcoded colors in unmigrated layout components are tracked as
  migration debt.

## Review checklist

- [ ] Uses `forwardRef` with `displayName` set
- [ ] Uses `cn()` for className merging
- [ ] No mutating store actions called inline (use callbacks)
- [ ] Hardcoded colors documented as migration debt or replaced with tokens
