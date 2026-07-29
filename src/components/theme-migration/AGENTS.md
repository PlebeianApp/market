# AGENTS.md — src/components/theme-migration

This directory holds the infrastructure that enables slice-by-slice theme
migration per the ADR: Component UI Migration & Widget Book.

## Contents

- `ThemeMigrationWrapper.tsx` — A `forwardRef` component that renders a
  `<div className="theme-new">` wrapper. Applying this class to a subtree opts
  it into the new scoped token system defined in `styles/globals-new.css`.

## Constraints

- This directory holds **infrastructure only**, not feature components.
- Do not add business logic, nostr queries, or UI primitives here.
- The wrapper is a plain `<div>` — be aware that wrapping the app root in a
  `<div>` can affect flex/grid layout. When wrapping the entire app, consider
  applying the `theme-new` class to an existing root layout container rather
  than introducing an extra DOM node.
- `ThemeMigrationWrapper` uses `forwardRef` and `cn()` per the standardized
  component conventions in `src/components/AGENTS.md`.

## Migration tracker

The placement of `ThemeMigrationWrapper` in the component tree serves as the
migration progress indicator. Migration is complete when:

1. `ThemeMigrationWrapper` covers the entire app (or the `theme-new` class is
   applied to the root layout element), AND
2. The legacy `:root` token block and all legacy utilities are removed from
   `globals.css`.
