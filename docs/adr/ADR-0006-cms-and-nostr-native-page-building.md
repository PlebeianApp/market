# ADR-0006: Nostr-Native Page Building System (Plebeian Market CMS)

## Status

Proposed

## Date

2026-07-30

## Related

- Issue: #900 (original CMS feature request — this ADR supersedes its scope)
- Issue: #1153 (UI Components Migration & Widget Book — original issue, now formalized as ADR-0007)
- ADR-0001 (AGENTS.md / ADR governance model)
- ADR-0007 (Component/UI Migration & Widget Book — component architecture foundation, token system, and test harness that this ADR depends on)
- ADR-013 / ADR-014 (NIP-17 order transport — pattern for multi-event, staged ADRs)
- NIP-5A (nsite — static website hosting from Blossom assets)
- NIP-B7 / BUDs (Blossom — media server protocol)
- NIP-01 (basic protocol — filter syntax for queries)
- NIP-51 (lists — kind 30000 pattern used by existing vanity registry)
- NIP-57 (Lightning zaps — payment proof mechanism)
- `src/server/ZapPurchaseManager.ts` (generalized zap-purchase base class)
- `src/server/VanityManager.ts` (existing vanity URL implementation)
- `src/lib/zapPurchase.ts` (client-side zap purchase helpers)
- `src/routes/$vanityName.tsx` (existing vanity URL catch-all route)
- `docs/vanity-urls.md` (existing vanity URL documentation)
- `gamma_spec.md` (marketplace protocol — event kinds 30402, 30405, etc.)

---

## Component Migration Coherence (Cross-ADR with ADR-0007)

This ADR defines the CMS design. ADR-0007 defines the component architecture, token system, and test harness the CMS is built on. The two are designed to be implemented in concert.

### Dependency: ADR-0007 Foundation Must Land First

ADR-0007 PR 1 (Foundation: Styles) and PR 2 (Foundation: Test Harness) must land before CMS component work resumes. The existing Puck components on `feat/plebeian-cms-puck` are a prototype — the production CMS re-integrates on top of the ADR-0007 foundation.

### The Component Contract

The CMS does not own presentational components. It owns **metadata** about them. Each CMS-eligible component has three layers:

```
src/components/nostr/ProductCard.tsx     ← migrated, standardized (ADR-0007)
src/components/cms/ProductCard.cms.tsx   ← CMS metadata: data contract + Puck fields (this ADR)
widget-book/nostr/ProductCard.spec.ts    ← test coverage (ADR-0007)
```

The base component is unaware of the CMS. The `.cms.tsx` sidecar declares:

- **Data contract**: what Nostr queries the component needs (declarative, not implementation)
- **Puck field schema**: what props the CMS editor exposes for this component
- **Render binding**: how query results map to component props

### Theme Integration

The CMS theme system **overrides the standard token names** (`--primary`, `--card`, `--background`, `--foreground`, etc.) on a wrapper element. This is the correct design — components are agnostic to whether they're in the main app or inside a custom-themed CMS page. They use the same token-based classes (`text-primary`, `bg-card`, `text-muted-foreground`) everywhere, and the browser resolves the CSS custom property cascade from whichever ancestor defines the values.

**Mechanism:** The CMS fetches a theme CSS file (e.g., `public/themes/caffeine.css`), which defines the same standard token names using `oklch` values, plus `.dark` variants. It parses the variables and sets them as inline styles on a wrapper element. Because CSS custom properties cascade through the DOM, all child components pick up the overridden values automatically — no component-level awareness required.

```
<div ref={themeRoot} style="--primary: oklch(...); --card: oklch(...); ...">
  <ProductCard ... />            ← reads --primary, --card from nearest scope (the wrapper)
  <ProductGrid ... />           ← same — agnostic to where tokens are defined
</div>
```

This works regardless of whether the app's default tokens come from `:root` (pre-migration) or `.theme-new` (post-ADR-0007 migration), because the CMS override takes precedence at a closer DOM scope. `ThemeMigrationWrapper` (ADR-0007 §1a) is the app's migration mechanism — it is **not** part of the CMS theme system. CMS theming is independent: it overrides the same token names at a wrapper element, and components resolve the cascade.

The existing Puck branch's `src/lib/utils/theme.ts` and `public/themes/*.css` already implement this pattern correctly. The theme files use `oklch` (matching ADR-0007's color standard) and define the same token names. The `applyLocalTheme` function is the right mechanism — it may be simplified during integration, but the core approach (override standard tokens on a wrapper element) stays. See ADR-0007 §3c for the full specification.

### Migration Slices Are CMS Registry Growth

ADR-0007's migration slices (PR 3: Home Page, PR 4: Layout, etc.) each add CMS sidecars for the components they migrate. The CMS component registry grows as the migration progresses — there is no separate "CMS components" PR sequence.

### Widget Book as CMS Gallery

ADR-0007's Widget Book test harness doubles as the CMS component gallery. `LIBRARY=cms` mode renders CMS-wrapped components with mock Nostr data, serving as both regression tests and a live preview of what the CMS editor can compose with.

---

## Vision

Plebeian Market shopkeepers should be able to compete with what Shopify, WordPress, and other platforms offer — custom storefronts, landing pages, product showcases — without compromising on data sovereignty. Their pages are powered by live Nostr data (their own kind 30402 listings, kind 0 profiles, kind 30405 collections) and published as Nostr events they fully own. The same events that power their Plebeian Market presence can be rendered by any compatible Nostr client, or compiled and deployed as standalone nsite-hosted sites.

The system serves two user cases with one engine:

1. **Shopkeeper storefronts.** A merchant builds a custom page from pre-defined blocks, binds live Nostr queries to those blocks, and publishes the page to their vanity URL. They own the sub-path space underneath their assigned URL. Data sovereignty is the differentiator against centralized platforms.

2. **Admin-curated marketplace pages.** Plebeian Market admins build pages for the marketplace itself — home, products listing, category pages, feature pages — and attach them to vanity URLs under the app's authority.

Both cases use the same editor, the same component registry, the same page-definition format, and the same publishing pipeline. The difference is routing authority and data scope.

### Standardization ambition

The page-definition format, component registry format, and routing layer are designed to be **spec-able and interoperable** from the start — not app-internal artifacts. They don't have to be NIPs on day one, but they should be designed as if they could become NIPs. Other Nostr clients encountering these events should be able to render the pages without implementing Plebeian's specific interpreter. The long-term ambition is to define site page building on Nostr; how much of that lands in V1 depends on time constraints, but the design must be compatible with future plans.

### nsite / napplet deployment

The same page definition can be consumed in two modes:

- **Dynamic (V1):** The client fetches the page-definition event, resolves component references, executes Nostr queries, and renders at runtime. No compilation step.
- **Static / compiled (V2+):** A compiler transforms the page definition into deployable assets (HTML/JS with Nostr queries pre-rendered or hydrated client-side), uploads them to Blossom servers, and publishes an NIP-5A nsite manifest (kind 15128 / 35128). The site is now hostable by any NIP-5A-compatible host server. The nsite manifest's optional `app` tag links the site back to the CMS app descriptor.

The compilation and deployment protocol is a **separate module** that comes after V1. The page-definition format does not need to change to support it.

---

## Architecture: Five Independent Modules

The system decomposes into five modules that can be developed and shipped independently. V1 implements modules 1–4 with constrained scope; module 5 is designed for but deferred.

### Module 1: Component Registry

A registry of available UI components, their prop schemas, and their data contracts.

**V1:** Closed set of Plebeian-defined components. These map directly to the component architecture established by ADR-0007 (Component/UI Migration): `src/components/nostr/` data components (product cards, author bios, feed displays — the sanctioned exception that allows Nostr data hooks), `src/components/shared/` reusable composites, and `src/components/layout/` structural containers. See the [Component Migration Coherence](#component-migration-coherence-cross-adr-with-adr-0007) section for the full contract between this ADR and ADR-0007.

Components declare their data contract as metadata — "this component needs a kind 30402 feed with optional `#t` tag filter and renders a grid of product cards" — not as implementation. The CMS editor uses that metadata to configure queries and bindings. This metadata lives in a `.cms.tsx` sidecar file alongside the base component (see ADR-0007 §3a).

**V1 example components (non-exhaustive, one set within a dynamic ecosystem):**

| Component                | Type   | Data contract                                      |
| ------------------------ | ------ | -------------------------------------------------- |
| `@plebeian/header`       | Layout | None (static props: title, subtitle, bgColor)      |
| `@plebeian/product-grid` | Data   | kind 30402 feed, optional `#t` / `#status` filters |
| `@plebeian/product-card` | Data   | Single kind 30402 event                            |
| `@plebeian/author-bio`   | Data   | kind 0 profile for a given pubkey                  |
| `@plebeian/feed`         | Data   | kind 30402 or kind 1 feed with filter config       |
| `@plebeian/grid`         | Layout | Slots for child blocks (V1: no children)           |

These are **examples, not a fixed specification.** The team retains full autonomy to define new components. In V2+, anyone can make a component — the registry opens to third-party discovery via Nostr events and Blossom-hosted component assets.

**V2+:** Open registry where components are published as Nostr events and their source/assets are fetched from Blossom servers. The closed V1 registry is the seed set.

### Module 2: Page Definition (Content Layer)

A Nostr event containing a JSON page definition — the block tree, Nostr query definitions, and data bindings.

**Dedicated Nostr kind.** Page definitions use a new dedicated Nostr kind (not NIP-78 / kind 30078). The specific kind number is a sub-ADR decision, but the principle is: a dedicated kind gives us a clean namespace for standardization and interoperability, without the semantic baggage of application-specific data events. The event is signed by the page author (shopkeeper or admin), replaceable via a `d` tag, and references components by their registry identifier.

**Block tree structure.** The block tree is **recursive from the start** — each block may contain a `children` array. V1 only supports flat pages (depth-1: a list of blocks, no children). V2 adds nesting by populating the `children` array. No schema migration is needed between V1 and V2.

**Query definitions.** Pages contain Nostr query definitions using NIP-01 filter syntax (kinds, tags, authors, relays, limit, sort). These are the same filters the app already uses throughout (`src/queries/`).

**Data bindings.** Query results map to component props. V1 uses simple direct binding: a query produces `$.events`, and props reference `{{events}}`. The binding syntax and scope model are a **sub-ADR decision** to be defined collaboratively (humans + agents), not inherited as-is from the Gutenberg-inspired DSL in issue #900. V1 keeps it minimal; V2 adds pipe operators and scoped inheritance for nested blocks.

**Example (illustrative, not normative):**

```json
{
  "kind": <TBD>,
  "content": "",
  "tags": [
    ["d", "electronics-landing"],
    ["title", "Electronics Market Landing Page"],
    ["component", "@plebeian/header"],
    ["component", "@plebeian/product-grid"]
  ],
  "content_field": {
    "blocks": [
      {
        "id": "block-header-01",
        "component": "@plebeian/header",
        "queryRef": null,
        "props": {
          "title": "Plebeian Electronics",
          "subtitle": "Best gadgets from the underground"
        },
        "children": []
      },
      {
        "id": "block-grid-01",
        "component": "@plebeian/product-grid",
        "queryRef": "electronics-feed",
        "bind": { "items": "$.events" },
        "props": { "columns": 3 },
        "children": []
      }
    ],
    "queries": {
      "electronics-feed": {
        "kinds": [30402],
        "tags": { "#t": ["electronics"] },
        "limit": 20
      }
    }
  }
}
```

> The exact field names, the question of whether the page body lives in the event `content` field or in a separate referenced blob, and the full binding syntax are sub-ADR decisions.

### Module 3: Routing / Vanity URL Layer

Maps URL paths to page-definition events. Extends the existing vanity URL system.

**Existing infrastructure.** The app already has a vanity URL system (`VanityManager`, `ZapPurchaseManager`, `$vanityName.tsx` catch-all route, kind 30000 registry with `d=vanity-urls`). Currently, vanity URLs resolve to user profiles. The CMS extends this: vanity URLs can now also resolve to **page-definition events**.

**Three tiers of routing authority:**

| Tier           | Who controls                  | Example                                 | Signed by                 |
| -------------- | ----------------------------- | --------------------------------------- | ------------------------- |
| App-reserved   | Hardcoded app routes          | `/setup`, `/checkout`, `/admin`         | N/A (code)                |
| Admin-assigned | Admins via dashboard          | `/`, `/products`, `/summer-sale`        | App pubkey                |
| Seller-owned   | Merchants via vanity purchase | `/alice-store`, `/alice-store/featured` | Seller pubkey + app proof |

**Seller-owned routes.** Sellers purchase a vanity URL (e.g., `alice-store`) via the existing Lightning zap mechanism. They own the entire sub-path space underneath it (`/alice-store/`, `/alice-store/featured`, `/alice-store/clearance`). Sub-pages are page-definition events published by the seller, referencing their vanity URL as a namespace.

**App-signed proof for interoperability.** The existing vanity registry (kind 30000, `d=vanity-urls`) is currently server-side only. For interoperability and data resilience, the app should sign a proof event that a vanity URL has been assigned to a specific pubkey for a specific purpose. This proof event lives on relays and can be verified by any client — not just the Plebeian Market server. This means:

- The registry event (kind 30000) is already app-signed and published to relays. This is the existing behavior.
- The extension: the registry event should be extended (or a companion event introduced) to record the **routing target type** — i.e., "this vanity URL resolves to a page-definition event (kind `<TBD>`) with `d` tag `electronics-landing`" rather than only "resolves to pubkey X's profile."
- This keeps the vanity URL system as the single source of truth for routing, with the app's signature as the authority proof.

**Resolution flow.** When a user visits a URL:

1. App-reserved routes take precedence (handled by TanStack Router file routes).
2. The `$vanityName.tsx` catch-all route (or a new CMS catch-all) checks the vanity registry for a match.
3. If the vanity entry points to a page-definition event, fetch and render that page.
4. If it points to a profile (existing behavior), render the profile.
5. If not found, show 404.

**Implementation note.** The `$vanityName.tsx` route already exists and renders profiles. The CMS extends it to also handle page-definition destinations. Sub-path resolution (e.g., `/alice-store/featured`) needs a new catch-all mechanism — likely a route like `$vanityName.$pagePath.tsx` or a single catch-all that parses the full path and resolves against the seller's published page events.

### Module 4: Publishing Gate

An anti-spam / authorization mechanism that must be satisfied before a page can be published.

**Reuses existing architecture.** The `ZapPurchaseManager` base class (`src/server/ZapPurchaseManager.ts`) is already a generalized zap-purchase framework. `VanityManagerImpl` is one concrete implementation; `purchaseNip05ForPubkey` shows it's already being reused for NIP-05 registrations. The CMS publishing gate rests on this same architecture — it may require generalizing the base class further to handle different use cases for vanity URLs (e.g., purchasing a vanity URL _and_ publishing pages under it).

**Decomposed into smallest components.** The gate is not one thing — it's a pluggable policy with independent parts:

| Gate     | What it controls       | Mechanism                                   | Existing infra                          |
| -------- | ---------------------- | ------------------------------------------- | --------------------------------------- |
| Identity | Who can publish        | Role check (admin / merchant / whitelisted) | kind 30000 role lists                   |
| Rate     | How often              | Per-pubkey cooldown                         | None yet (sub-ADR)                      |
| Cost     | What proof is required | Lightning payment (NIP-57 zap receipt)      | `ZapPurchaseManager` + `zapPurchase.ts` |

**Alternatives to payment.** The cost gate can be satisfied by:

- Lightning payment (default — reuses existing zap infrastructure)
- Proof-of-work (NIP-13) — for environments without Lightning
- Whitelisting — admins bypass the cost gate entirely via the existing role system

**Payment proof flow.** Reuses the existing pattern: user signs a kind 9734 zap request with a label tag (e.g., `["L", "page-publish"]`), pays the Lightning invoice, the LNSP publishes a kind 9735 zap receipt, the server verifies the receipt and grants publish permission. The `ZapPurchaseManager` already handles deduplication, age filtering, amount validation, and registry publishing.

### Module 5: Compilation & nsite Deployment (V2+, designed for in V1)

Transforms a page definition into deployable static assets and publishes them via NIP-5A + Blossom.

**Not in V1.** V1 renders page definitions dynamically in the Plebeian Market client. Module 5 is designed for but not implemented — the page-definition format is structured to support both dynamic rendering and static compilation without changes.

**V2 pipeline:**

1. **Compile:** Read the page-definition event, render the block tree to HTML/CSS/JS (Nostr queries pre-rendered as SSG or hydrated as CSR).
2. **Upload:** Upload compiled assets to Blossom servers (BUD-02 upload, BUD-04 mirror).
3. **Publish nsite manifest:** Publish a kind 15128 (root) or 35128 (named) event with `path` tags mapping URLs to Blossom blob hashes. The `app` tag references the CMS app descriptor (NIP-89 kind 31990) so the nsite is discoverable as "built with Plebeian CMS."

**NIP-5A alignment.** NIP-5A defines root sites (kind 15128, one per pubkey) and named sites (kind 35128, with `d` tag). Named sites map naturally to vanity URLs: a seller with vanity `alice-store` could deploy a named nsite with `d=alice-store`. The nsite host serves the compiled static assets; the dynamic CMS rendering is the fallback for clients that understand the page-definition format directly.

---

## Investigation: Pages as Components (Nesting)

### Question

Can pages themselves be components — i.e., can a built page be embedded as a block within another page? This requires nesting: blocks within blocks with data flowing from parent to children.

### Assessment: Realistic — design for it in V1, implement in V2

**Why it works:** If pages and blocks share the same definition schema — where a "page" is just a root block that happens to be the entry point — then "pages as components" is a natural consequence. A composite component is a block whose `component` reference points to another page-definition event instead of a primitive component. The rendering engine fetches the referenced page, renders its block tree, and injects the result.

**How V1 designs for it without implementing it:**

| Aspect             | V1 (flat)                     | V2 (nested)                                              |
| ------------------ | ----------------------------- | -------------------------------------------------------- |
| Block schema       | `children: []` (always empty) | `children: [block, ...]`                                 |
| Rendering          | Iterates flat block list      | Recursive: render block, then render children in slots   |
| Data scope         | Root scope only               | Scoped inheritance: children inherit parent's data scope |
| Component registry | Primitives only               | Primitives + composites (page-as-block)                  |
| Editor             | Add blocks to page            | Add blocks to page, drag blocks into other blocks        |

**Cost of designing for it now:** One optional field (`children: []`), one recursive code path that's a no-op in V1. Minimal.

**Cost of not designing for it:** Painful V2 schema migration, renderer rewrite, and potential breakage of existing page definitions.

**The ADR-0007 architecture already supports this.** The component hierarchy from the Component/UI Migration ADR (UI-only components, data-isolated `nostr/` components, layout components that decide how data is presented) is exactly the composability model needed. A "composite component" is just a layout component that renders a child block tree — which is what layout components already do in React.

**Recommendation:** V1 ships with flat pages (technically depth-1 trees). The schema permits nesting. The renderer is recursive-ready. V2 unlocks nesting via editor UI and scoped data inheritance, with zero schema changes.

---

## V1 Scope Boundaries

### What V1 delivers

- Visual block-based page editor for assembling pages from a closed component registry
- Nostr query configuration with NIP-01 filter syntax (kinds, tags, authors, relays)
- Simple direct data binding from query results to component props
- Page definitions published as a dedicated Nostr kind (signed by author, replaceable)
- Vanity URL routing extended to resolve page-definition events (not just profiles)
- App-signed proof of vanity URL assignment for interoperability
- Publishing gate via Lightning payment (reusing `ZapPurchaseManager`), with whitelist bypass for admins
- Live preview with real Nostr data fetched from relays
- Admin pages for marketplace routes (home, products, categories)
- Seller pages for storefront routes (under their vanity URL prefix)

### What V1 explicitly does not deliver

- Nested blocks / composability (schema permits it, editor doesn't expose it)
- Pages-as-components (composite components)
- Open component registry / third-party components
- Static compilation / nsite deployment
- Pipe operators in the binding DSL
- Scoped data inheritance for nested blocks

---

## Sub-ADR Roadmap

This ADR is the design anchor. The following sub-ADRs fill in the detail, each addressing one module or cross-cutting decision:

| Sub-ADR                        | Scope                                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page Definition Format         | JSON schema, block tree, query definitions, binding syntax, content-vs-blob field decision, dedicated Nostr kind number                                                                       |
| Component Registry Protocol    | Component metadata format (`.cms.tsx` sidecar), data contract declaration, slot model, V1 seed set, V2 open registry via Nostr + Blossom. Coordinates with ADR-0007 §3a (Component Contract). |
| Routing & Vanity URL Extension | Extension of existing kind 30000 registry, sub-path resolution, app-signed proof event format, catch-all route implementation                                                                 |
| Publishing Gate Policy         | `ZapPurchaseManager` generalization, gate decomposition (identity / rate / cost), PoW alternative, whitelist bypass                                                                           |
| Compilation & nsite Deployment | (V2) Page-to-static-asset compiler, Blossom upload, NIP-5A manifest publishing, `app` tag linkage                                                                                             |
| Data Binding & Scope Model     | Binding syntax definition (collaborative), root scope (V1), scoped inheritance (V2)                                                                                                           |

---

## Consequences

### Positive

- Shopkeepers get a no-code storefront builder that competes with centralized platforms while keeping full data sovereignty
- Admins can publish and manage marketplace pages without code changes or deployments
- The page-definition format is designed for interoperability from day one — other Nostr clients can render these pages
- The system is modular: each module can be developed and shipped independently
- The existing vanity URL and zap-purchase infrastructure is reused, not reinvented
- Nesting / pages-as-components is designed for, not bolted on — zero schema migration for V2
- nsite deployment is a natural extension, not a redesign

### Costs

- A new dedicated Nostr kind requires careful design and may need community coordination for standardization
- The vanity URL system needs extension (routing target types, sub-path resolution) — backward-compatible but non-trivial
- The `ZapPurchaseManager` may need further generalization to handle page-publish as a distinct purchase type
- V1's closed component registry limits what users can build — the value depends on the seed set being sufficient
- Two rendering modes (dynamic now, static later) means the page-definition format must serve both without compromise
- Short-term increase in architectural surface area while the CMS coexists with hardcoded routes

---

## Implementation Principles

1. **Reuse before reinvent.** The vanity URL system, zap-purchase framework, Nostr query infrastructure, and component architecture from ADR-0007 all exist. The CMS builds on them, not around them.

2. **Design for V2 in V1.** The block tree is recursive, the schema permits nesting, the registry is structured for openness. V1 constrains the _editor_ and _renderer_, not the _format_.

3. **Standardize the format, not the implementation.** The page-definition format, component registry format, and routing proof event should be spec-able. Plebeian Market is the first implementation, not the only one.

4. **Modules are independent.** The component registry, page definition, routing, publishing gate, and compilation pipeline can each be developed, reviewed, and shipped on their own timelines.

5. **Sub-ADRs for detail.** This ADR captures the vision and architecture. Every concrete format, kind number, binding syntax, and protocol detail is a sub-ADR decision, defined collaboratively.
