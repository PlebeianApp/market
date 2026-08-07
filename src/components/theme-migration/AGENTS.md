# AGENTS.md — src/components/theme-migration

This directory holds the infrastructure that enables slice-by-slice theme
migration per ADR-0007: Component UI Migration & Widget Book.

## Contents

- `ThemeMigrationWrapper.tsx` — A React 19 ref-as-prop component that renders
  a `<div className="theme-new">` wrapper and mounts a portal container.
  Applying the `theme-new` class to a subtree opts it into the new scoped
  token system defined in `styles/globals-new.css`.

## Constraints

- This directory holds **infrastructure only**, not feature components.
- Do not add business logic, nostr queries, or UI primitives here.
- The wrapper is a plain `<div>` — be aware that wrapping the app root in a
  `<div>` can affect flex/grid layout. When wrapping the entire app, consider
  applying the `theme-new` class to an existing root layout container rather
  than introducing an extra DOM node.
- `ThemeMigrationWrapper` uses React 19 ref-as-prop (accepts `ref` via
  `...props` spread, no `forwardRef`) and `cn()` per the standardized
  component conventions in `src/components/AGENTS.md`. It serves as the
  **canonical example** of the ref-as-prop pattern.

## Portal handling

Radix UI portals (used by Shadcn dialogs, popovers, tooltips) render their
content to `document.body` by default, which is **outside** the `.theme-new`
DOM scope. Portalled content therefore does not inherit the scoped CSS custom
properties and falls back to the legacy `:root` tokens.

`ThemeMigrationWrapper` addresses this by mounting a hidden container
element (carrying the `theme-new` class) appended to `document.body`.
Portalled components should use `useThemePortal()` to obtain this container
and pass it to their Radix `Portal`'s `container` prop:

```tsx
const portalContainer = useThemePortal()
<DialogPortal container={portalContainer}>
```

This automatically scopes portalled content to the new token system — no
manual class application needed on each portalled component. The
`useThemeMigration()` hook is also available for awareness/testing and
returns the full context value (class name + portal container).

When the entire app is eventually wrapped, the portal container becomes
redundant because all content — portalled or not — will be inside the
global `.theme-new` scope.

## Migration tracker

The placement of `ThemeMigrationWrapper` in the component tree serves as the
migration progress indicator. Migration is complete when:

1. `ThemeMigrationWrapper` covers the entire app (or the `theme-new` class is
   applied to the root layout element), AND
2. The legacy `:root` token block and all legacy utilities are removed from
   `globals.css`.
