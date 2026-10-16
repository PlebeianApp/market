# AGENTS.md — src/components

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/components/` contains app-coupled UI: feature components, dialogs, wallet
UI, and the hosts that wire queries, stores, and routing into presentational
views. Shadcn/Radix primitives live in `ui/primitives/` and reusable,
props-only views live in `ui/components/` (ADR-0021); `src/components/ui/`
now holds only the app-coupled `image-uploader/` and `relay-manager/`.

## Constraints

- Keep protocol parsing, payment state machines, signing decisions, and relay
  publishing out of presentational components.
- Components may display query, relay, auth, wallet, or payment state, but they
  should not turn those states into broader truth than the data layer provides.
- Do not render secrets, private keys, NWC URIs, Cashu seed material, or raw
  sensitive payment details.
- Preserve accessible labels, roles, focus behavior, and existing shadcn/ui
  conventions when changing controls.

## Directory structure (per ADR-0007: Component UI Migration §1b)

```
src/components/
  ui/              ← App-coupled leftovers only (image-uploader, relay-manager);
                     Shadcn primitives moved to `ui/primitives/` (import `@ui/primitives/*`)
  ui-wrappers/     ← Wrappers around ui/ primitives with custom styling/behavior
  shared/          ← General-purpose reusable components (non-domain-specific)
  nostr/           ← Nostr-domain components (users, products, auctions, profiles)
  layout/          ← Structural components (Header, Footer, Sidebar)
  dialogs/         ← Dialog compositions built on ui/dialog
  theme-migration/ ← ThemeMigrationWrapper + scoped theme infrastructure
```

New components must be placed in the appropriate subdirectory above. Legacy
components that currently live outside `src/components/` are tracked as
migration debt and will be relocated during their slice migration.

### Import hierarchy

The import hierarchy applies to **new and migrated code only**. Existing
legacy components that violate these rules are tracked as migration debt and
are not required to be fixed as part of this PR — they will be addressed
during their respective slice migrations (see ADR-0007 §2a Classification
System).

For new and migrated code, the following **dependency directions** are
permitted (importer → importee). All other directions are prohibited:

| Directory                        | May import from                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `ui/`                            | (leaf — no component imports)                                                        |
| `ui-wrappers/`                   | `ui/`, `lib/`, `hooks/`                                                              |
| `shared/`                        | `ui/`, `ui-wrappers/`, `lib/`, `hooks/`                                              |
| `nostr/`                         | `ui/`, `ui-wrappers/`, `shared/`, `lib/`, `hooks/`, `queries/` (read-only adapters)  |
| `layout/`                        | `ui/`, `ui-wrappers/`, `shared/`, `nostr/`, `lib/`, `hooks/`, `queries/` (read-only) |
| `dialogs/`                       | `ui/`, `ui-wrappers/`, `shared/`, `nostr/`, `lib/`, `hooks/`, `queries/`             |
| `theme-migration/`               | (infrastructure only — no component imports)                                         |
| Feature dirs (`checkout/`, etc.) | Any `components/` subdirectory                                                       |

**Dependency cycles are prohibited.** If directory A imports from B, B must
not import from A. Each subdirectory's `AGENTS.md` file is the authoritative
source for its import rules and narrowly-scoped exceptions.

### Canonical import alias

`@/components/{directory}/{component}` for app components; `@ui/primitives/*`
for Shadcn primitives and `@ui/components/*` for props-only views. Barrel
exports per directory allowed.

When a component needs no queries, stores, routing, or relay access, place it
in `ui/components/` instead (see `ui/boundary.test.ts`); keep the data-wiring
host here.

## Instructions

- Prefer existing UI primitives and local component patterns before adding new
  abstractions.
- Keep loading, empty, error, and eventually-consistent relay states visible
  when a component depends on Nostr data.
- Use icons and controls consistently with the surrounding UI.
- **Ref convention (React 19 ref-as-prop, per ADR-0007: Component UI Migration):**
  - `ui/primitives/` holds generated Shadcn primitives (pulled via
    `components.json`). Leave them **as-is, no diffs** — do not modify them.
    They use the modern `React.ComponentProps` + `data-slot` style.
  - Components authored by us (in `ui-wrappers/`, `shared/`, `nostr/`,
    `layout/`, `dialogs/`, and feature directories) **must expose `ref`** to
    their root DOM element. **Prefer React 19 ref-as-prop** (accept `ref` as a
    regular prop and pass it through to the root element or underlying Shadcn
    primitive). **Use `forwardRef` only where a dependency still requires it**
    (e.g., a library HOC that expects a `forwardRef`-wrapped component).
    Existing components using `forwardRef` do not need to be rewritten — the
    contract is about ref exposure, not the mechanism.
  - **Passing refs through Shadcn primitives:** most Shadcn primitives spread
    `{...props}` onto their root DOM element, so a `ref` passed into the
    primitive's props attaches to that node. Our `ui-wrappers/` components
    should rely on this: pass `ref` through to the primitive via its props.
    **Do not** wrap the primitive in an extra DOM element solely to attach a
    ref. This keeps the wrapper a single element. Per-subdirectory `AGENTS.md`
    files (e.g. `ui-wrappers/AGENTS.md`) restate this rule.
  - **Canonical example:** `ThemeMigrationWrapper` in `theme-migration/` uses
    React 19 ref-as-prop — it accepts `HTMLAttributes<HTMLDivElement>` and
    spreads `{...props}` (including `ref`) onto its root `<div>`. No
    `forwardRef` needed.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
