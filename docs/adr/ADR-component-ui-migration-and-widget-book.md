## Context

The codebase has grown to span multiple domains, resulting in a fragmented UI layer where components are scattered, duplicated, and inconsistent. There are no fixed rules governing component location, styling, or API contracts, leading to hardcoded colors bypassing the CSS variable system, business logic embedded in presentational components, and component-specific styling mixed with global theme definitions. Dark mode lacks coherence with the light theme, and while Shadcn/UI primitives exist, there is no standardized wrapper layer, no shared directory for domain-specific UI, and no enforcement mechanism preventing new ad-hoc components from being created in arbitrary locations.

## Decision

### Part 1: Foundation (Target Specification)

**1a. Stylesheet: Single File, Layer-Based Deprecation**
The app should have a single `globals.css` file:
- Define a clean token system at the top (`:root`, `.dark`, `@theme inline`) modeled on standard Shadcn conventions (e.g., `primary`, `secondary`, `muted`, `accent`). See an example here: https://ui.shadcn.com/docs/theming
- Change the font specification from `font-serif` and `font-sans` to `font-body` and `font-header`. This is more semantic, usage-based definition that more widely applies to all websites and web-apps.
- Extend this with specific **UX state tokens** (`info`, `warning`, `error`, `success`) for cards (including foreground, background, border) for semantic/ux-based styling. This should more or less map onto the colours: **blue** for info, **orange** for warning, **red** for error and **green** for success.
- All existing component-specific utilities, global element overrides, `!important` rules, and custom selectors must be wrapped in `@layer legacy { ... }` with deprecation markers. 

The current app styles need to be refactored and redefined within the new stylesheet, and this is done in the migration guide section 2b.

**1b. Component Directory Structure**
```
src/components/
  ui/              ← Shadcn primitives (generated, unmodified)
  ui-wrappers/     ← Wrappers around ui/ primitives with custom styling/behavior
  shared/          ← General-purpose reusable components (non-domain-specific)
  nostr/           ← Nostr-domain components (users, products, auctions, profiles)
  layout/          ← Structural components (Header, Footer, Sidebar)
  dialogs/         ← Dialog compositions built on ui/dialog
...More component subdirectories can be added per-feature or per specification ruleset.
```
Components may only import from directories below them in the hierarchy (e.g., `ui` → `ui-wrappers` → `shared`). Any UI component currently living outside `src/components/` must be relocated. Some subdirectories might be allowed to perform a specific kind of business logic, such as the `nostr/` directory being permitted to use nostr queries through hooks, dialogs to perform actions through stores, etc., but this should be considered **an exception from the rule and must be permitted through the subdirectory AGENTS.md file**. AGENTS.md files in each subdirectory additionally serve as the authoritative source for import rules, dependency hierarchies, and specific standards unique to that directory.

**1c. Standardized Parameters**
For all **migrated** components in the standardized component set, they should accept and implement the following parameters: 
- **`forwardRef`:** Forward refs to root DOM element.
- **`cn()` className merging:** Accept `className` prop, merge with internal styles via `cn()`.
- **Callbacks** for actions instead of in-file hooks or otherwise.
- **Additional Standardized Parameters:** Variants (`variant`), density (`compact`), and other props are defined and enforced per-directory in AGENTS.md files, not globally in this ADR.
- Although not strictly a parameter in the react props sense, components are expected to surface the styles they are exposed to from their parent, following the standards of the `globals.css` file.

Standardized parameters should apply especially to reusable components. Purpose- or feature-specific components (such as ones found in `checkout/`) should be more relaxed on these rules.

**1d. Import Convention**
Canonical alias: `@/components/{directory}/{component}`. Barrel exports per directory allowed. Routes must import UI exclusively from `src/components/`.

**1e. Widget Book Test Harness**
A modular test harness (`widget-book/`) will be established to serve as a unified host for both manual browsing and automated testing.
- **Architecture:** A Bun-based server serving a single application that dynamically loads component "libraries" (mapping to `ui-wrappers`, `nostr`, `shared`, etc.).
- **Launch Modes:** The harness can be launched with `LIBRARY=*` for full manual review or scoped to a single library (e.g., `LIBRARY=nostr`) for focused automated testing of a specific slice.
- **Testing Strategy:** Automated tests are written in **Playwright** spec files. Mock data and behavioral assertions are defined directly within these spec files, avoiding the need for an intermediate JSON interpreter. Tests verify rendering, interactivity, and visual consistency across variants and states.

### Part 2: Migration (Execution Strategy)

**2a. Migration Model: Foundation + Opportunistic Slices**

Slice defines a set of UI components (as individual files and defined in-line) which migrate according to the **Classification System**:
- **Keep:** Components already compliant or trivially fixable. Migrate styles to tokens, enforce API contracts.
- **Modify:** Valuable but non-compliant. Refactor to implement contracts, migrate styles, and fix structure.
- **Extract:** Components containing trapped sub-components. Decompose into individual files in appropriate directories, then apply Keep/Modify rules to each piece.
- **Replace:** Redundant or superseded components. Swap all consumers to the compliant replacement, then delete the original.

For example, an inline component used in `routes/` such as `renderHomepageHero()` might be marked as **Extract** while a card redefinition in another might be marked as **Replace** (with `components/ui/card.tsx`). Each migration PR should include the extent of UI created or modified and how the updated UI fits into the classification system.

**2b. Component styles migration**

The foundation creates a new stylesheet pattern, but for backwards compatibility the old styles need to be kept accessible by unmigrated components. When performing a migration, the UI in the target slice should:
- Replace the now-deprecated patterns with the new stylesheet definition
- Not define any custom styles that may conflict with the new stylesheet definition, such as colours, fonts, border radiuses, and so on.
- When a legacy utility has zero remaining references, it is deleted.
The migration is complete when `@layer legacy` is empty.

The expected outcome is a clean stylesheet containing only tokens and generic utilities, with all component-specific styling moved into component files. The `@layer legacy` block serves as the migration tracker: as components migrate, their corresponding legacy utilities are extracted into component files using `cn()` + semantic tokens. 


**2c. Compliance and Maintanance**
In order to keep the work of each PR over time, every migrated or created component must satisfy the following conditions before being considered complete:
1. **Standardization:** It must adhere to the API contracts and prop standards defined in its parent subdirectory's AGENTS.md and the root `src/components/AGENTS.md`.
2. **Test Coverage:** It must have corresponding test coverage in the automated widget book harness, verifying its different behaviors, variants, and appearances.


## Consequences

- The stylesheet evolves from a mixed token/override file to a clean token-only definition, with component-specific styling isolated in component files.
- AGENTS.md files define variant standards, import rules, and review checklists per directory, providing context for creating and reviewing agents.
- The widget book harness provides visual regression testing and a browsable component gallery, ensuring migrated components are verified.
- The `nostr/` directory resolves the tension between "no business logic" and necessary data access patterns via standardized hooks.
- Enforcement is lean: CI catches structural violations, while AGENTS.md handles nuanced judgment calls.
- The `@layer legacy` block creates a self-documenting migration progress indicator.

## PR Strategy

A suggested PR strategy is as follows:

- **PR 1 - Foundation - Styles:** Defines new styles and marks previous as deprecated. Creates new directories and AGENTS.md files where appropriate, such as `ui-wrapper`, `shared`, `nostr`, `layout` and `dialog`. Pulls remaining ad-hoc UI components into the `components/` directory. Include a few components that are under the *"Modify"* strategy of 2a for 1+ compliant example component(s) in each subdirectory.
- **PR 2 - Foundation - Test Harness:** Implement the test harness app that can run on modular widget libraries. Include the ability to run on all libs (LIBRARY=*) or on specific ones only. Include the Playwright configuration to define and run tests on specific components, and provide test coverage for the existing components in the newly migrated subdirectories.
- **PR 3 - Migration: Home Page & User Profile Components:** - Create a migration for components found in the home page. This coincides with the CMS work which will use many of the same components.
- **PR 4 - Migration: Layout Components:** - Create a migration for the commonly used app layout components (header, footer, sidebar) to ensure they are compliant with the new styling.
- **PR 5 - Migration: UX Components:** - Ensure UX components such as forms, dialogs, and other interactive pieces of the app UX are compliant with the new guidelines.
- **PR 5 - Migration: Dashboard Components:** - Move remaining dashboard components to the new guidelines.
...A few more migrations will be needed for specific features, such as: Wallet, Checkout, etc., which can be taken on at this point.
