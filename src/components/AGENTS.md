# AGENTS.md — src/components

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/components/` contains reusable UI components, feature components, dialogs,
wallet UI, product/profile display components, and shadcn/Radix-style primitives
under `src/components/ui/`.

## Constraints

- Keep protocol parsing, payment state machines, signing decisions, and relay
  publishing out of presentational components.
- Components may display query, relay, auth, wallet, or payment state, but they
  should not turn those states into broader truth than the data layer provides.
- Do not render secrets, private keys, NWC URIs, Cashu seed material, or raw
  sensitive payment details.
- Preserve accessible labels, roles, focus behavior, and existing shadcn/ui
  conventions when changing controls.

## Directory structure (per ADR: Component UI Migration §1b)

```
src/components/
  ui/              ← Shadcn primitives (generated, unmodified)
  ui-wrappers/     ← Wrappers around ui/ primitives with custom styling/behavior
  shared/          ← General-purpose reusable components (non-domain-specific)
  nostr/           ← Nostr-domain components (users, products, auctions, profiles)
  layout/          ← Structural components (Header, Footer, Sidebar)
  dialogs/         ← Dialog compositions built on ui/dialog
  theme-migration/ ← ThemeMigrationWrapper + scoped theme infrastructure
```

### Import hierarchy

Components may only import from directories below them in the hierarchy:
`ui` → `ui-wrappers` → `shared` / `nostr` / `layout` / `dialogs`. Any UI
component currently living outside `src/components/` must be relocated. Each
subdirectory's `AGENTS.md` file is the authoritative source for its import
rules and exceptions.

### Canonical import alias

`@/components/{directory}/{component}`. Barrel exports per directory allowed.
Routes must import UI exclusively from `src/components/`.

## Instructions

- Prefer existing UI primitives and local component patterns before adding new
  abstractions.
- Keep loading, empty, error, and eventually-consistent relay states visible
  when a component depends on Nostr data.
- Use icons and controls consistently with the surrounding UI.
- **Ref convention (per ADR: Component UI Migration):**
  - `src/components/ui/` holds generated Shadcn primitives. Leave them **as-is,
    no diffs** — do not convert them to `forwardRef` or otherwise modify. They
    use the modern `React.ComponentProps` + `data-slot` style.
  - Components authored by us (in `ui-wrappers/`, `shared/`, `nostr/`,
    `layout/`, `dialogs/`, and feature directories) **must use `forwardRef`**
    to forward refs to their root DOM element, for consistency across the
    standardized component set.
  - **Forwarding refs through Shadcn primitives from a `forwardRef` wrapper:**
    most Shadcn primitives spread `{...props}` onto their root DOM element, so a
    `ref` passed into the primitive's props attaches to that node even though
    the primitive itself is not `forwardRef`-wrapped. Our `ui-wrappers/`
    components should rely on this: forward `ref` through to the primitive via
    its props. **Do not** wrap the primitive in an extra DOM element solely to
    attach a ref. This avoids React dev warnings about `ref` on function
    components while keeping the wrapper a single element. Per-subdirectory
    `AGENTS.md` files (e.g. `ui-wrappers/AGENTS.md`) restate this rule.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
