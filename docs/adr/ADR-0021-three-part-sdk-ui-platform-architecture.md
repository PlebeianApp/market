# ADR-0021: Three-Part SDK, UI, and Platform Architecture

## Status

Proposed — branch `auctions`

> **Amendment (2026-10-15):** the third top-level folder is now **`apps/`**. The
> `platform/` folder was renamed into it (`git mv platform apps`) and the import
> alias was renamed `@platform/*` → `@apps/*`. The *part* described below is still
> called Platform (application composition and instance runtime); `apps/` is where
> it lives. This document keeps its number, title, and filename so that existing
> citations of ADR-0021 stay valid — see "Revision — 2026-10-15" below.

## Date

2026-10-07

## Related

- ADR-018: Instance Configuration and Self-Hosting Boundary
- ADR-0002: Nostr I/O migration (NDK → Applesauce)
- `src/server/http/config.ts` and `src/queries/config.tsx` — current runtime public configuration path
- `src/lib/instance-config.ts` — runtime instance configuration resolver

## Context

The project currently combines marketplace workflows, reusable UI, instance-specific application behavior, and operational deployment concerns in one repository and application. A sustainable architecture should make the boundaries explicit so marketplace behavior can be reused across clients while operators configure and host independent market instances.

The application currently has a runtime public configuration path at `/api/config`. ADR-018 describes the instance-configuration and self-hosting boundary. These are current foundations; the three-part architecture proposed here does not yet exist as an extracted implementation.

## Decision

Organize the product into three top-level folders in the existing repository: `sdk/`, `ui/`, and `apps/`. Start with folders and internal TypeScript imports in the existing Bun project. Do not create separately published packages or a package workspace in this initial step. The dependency direction is:

```text
Platform (application composition and instance runtime)
  ├── uses UI
  └── uses SDK
UI
  └── uses SDK
SDK
  └── defines runtime-independent contracts and marketplace capabilities
```

The folders remain in one repository and build/runtime environment. `sdk/` and `ui/` contain reusable TypeScript modules; `apps/` contains the Bun/TypeScript host application and instance runtime that composes them. This does not imply three separately deployed services or repositories. Preserve existing project boundaries: `contextvm/` remains a separate service area, while `deploy-simple/` and `.github/workflows/` remain deployment assets and CI configuration.

Migrate existing code from `src/` into the three folders incrementally. This ADR does not require a one-shot move or a change from Bun and TypeScript.

### 1. SDK — marketplace capabilities and extension system

The SDK is the UI-independent API for marketplace protocols and workflows. It is divided into:

- **Core:** shared types, event schemas and validation, Nostr protocol/I/O ports, errors/results, market configuration parsing, and signer/relay/storage/wallet interfaces. Relay I/O stays behind the existing library-agnostic Nostr I/O seam.
- **Commerce Workflows:** reusable buyer and seller operations, including discovery, listing data, cart/order preparation, checkout coordination, purchase/order status, messaging, payments, and auctions. Payment and settlement states remain explicit.
- **Extensions:** the extension contract and reusable extension modules/adapters. Extensions declare identity, capabilities, configuration schemas, and lifecycle requirements. Examples include BTC Maps, analytics, Etsy catalog import, Cashu mint adapters, Telegram notifications, bot-protection providers, and auction-validator integration/service modules.

The SDK owns extension interfaces and configuration schemas. It does not own an instance's configured values or secrets. Extensions may include client adapters, server-side modules, or separately runnable services; their runtime-specific implementation is packaged with the extension, while Platform supplies the runtime that configures and hosts it. SDK Core does not depend on UI or Platform. Concrete runtime adapters implement SDK ports at the browser or server boundary.

The SDK remains TypeScript and must not depend on React or UI modules. Runtime-specific behavior stays behind explicit interfaces where needed. Native/mobile adapters and mobile buyer workflows are out of scope for this ADR. Publishing packages is deferred until the internal folder boundaries and APIs are proven stable.

### 2. UI — presentation libraries and client experiences

UI contains reusable, themeable presentation components that consume SDK APIs rather than directly owning protocol logic or depending on application routes and global stores.

- The initial extracted UI is the existing React web UI. Future clients may have separate component implementations while sharing stable SDK workflows, but mobile UI design is out of scope here.
- The web UI can include buyer, seller, and operator-facing experiences.
- UI may render extension capabilities, such as maps, product-import review, bot challenges, wallet flows, auction status, or notification settings. It does not make server-authoritative trust, authorization, payment-settlement, or bot-verification decisions.
- Theme tokens, component variants, slots, and replacement points allow a host to customize visual appearance and composition without forking workflow logic.

### 3. Platform — host applications, instance runtime, and operations

Platform contains the Bun/TypeScript host application, composes SDK and UI, and implements instance-specific and privileged runtime responsibilities:

- Web application composition, routing, and the Bun server entry points.
- Instance configuration endpoints and admin experience; enabling extensions; validating and storing instance settings; and securely supplying only the needed configuration to each extension.
- Server-side authorization and verification, private credential storage, optional extension-service lifecycle, and integration with relays, wallets, or external providers.
- Self-hosting and deployment, including Docker/Compose if adopted, VPS setup, DNS/domain routing, Caddy/Nginx ingress, TLS, service isolation, backups, upgrades, logging, monitoring, and release/CI workflows.

The platform's existing `/api/config` endpoint is a starting point for public per-instance configuration. A future market-connection contract must be versioned and validated; private keys, wallet seeds, bot tokens, OAuth secrets, and other server credentials must never be exposed in public config or client bundles. Platform is the authoritative enforcement boundary for server-dependent controls.

## Cross-Part Architecture Rules

- **Dependency direction:** UI depends on SDK; Platform composes both. SDK has no dependency on UI or Platform. Extension modules implement SDK contracts; Platform supplies their configuration and runtime.
- **Configuration ownership:** SDK extension schemas and types describe required options. Platform owns actual per-instance values, enablement, secret storage, and delivery. UI provides configuration screens/components but does not become the source of authority.
- **Security:** SDK validates protocol data and offers safe APIs; UI presents trust, consent, and state clearly; Platform enforces authorization and server-side checks. Client-side checks are bypassable and cannot replace authoritative server verification.
- **Nostr trust:** Market configuration, relay events, extension responses, and validator verdicts are untrusted until parsed and verified. Configured relay targets are explicit; clients do not silently expand I/O to arbitrary relay hints.
- **Payment correctness:** Wallet acknowledgement, receipt publication, settlement/proof, merchant confirmation, refund/failure, and fulfillment remain distinct states across the SDK, UI, and Platform.
- **Instance isolation:** Instance-specific configuration, caches, and publishing targets must remain scoped to their configured instance; one instance must not accidentally reuse another instance's settings or relay policy.

## Alternatives Considered

- **Move the whole application in one change:** Rejected. Incremental folder extraction makes dependency and behavior regressions easier to isolate.
- **Make the SDK include React components:** Rejected. It would couple reusable protocol/workflow logic to one UI framework.
- **Put everything reusable, including actual instance settings, in the SDK:** Rejected. Instance values, secrets, hosting, and privileged verification belong to Platform; SDK owns contracts and reusable behavior.
- **Treat Extensions as a fourth top-level part:** Rejected. In this architecture, extension contracts and reusable integration modules are part of the SDK; UI may render them, while Platform configures and runs them.
- **Treat each relay as a market or support every Nostr marketplace implicitly:** Rejected. Relay transport and marketplace workflow compatibility are distinct.
- **Create separately published packages immediately:** Deferred. First establish and test internal folder/API boundaries; package publication adds versioning and release concerns before consumers and contracts are proven.

## Consequences

- Existing code can be extracted incrementally into `sdk/`, `ui/`, and `apps/` without requiring a one-shot rewrite or three separate deployment units.
- The current web application becomes the Platform host consuming the extracted SDK and UI.
- The runtime remains Bun and TypeScript. This decision introduces no mobile adapters or mobile buyer workflows.
- The folders are internal to the repository initially; publication and independent package versioning are deferred.
- SDK APIs need explicit instance context and injected runtime adapters where required; process-wide singleton assumptions must be removed from reusable workflows.
- Extension config schemas belong to SDK; instance config screens, stored values, credentials, and service hosting belong to Platform; extension-facing components belong to UI.
- Other client targets, including mobile, require a separate decision and compatibility review; this ADR does not design their adapters or workflows.
- Self-hosting remains a Platform capability. A self-hosted validator is an Auction Validator extension service whose implementation belongs to the extension; Platform provides its configuration, process/container runtime, networking, monitoring, and updates.
- This decision is proposed architecture, not a statement that the SDK/UI folders, extension manager, or extracted modules have already been implemented.

## Implementation Sequence

1. Inventory current routes, components, query/publish modules, stores, server responsibilities, and extension-like integrations; map dependencies to SDK, UI, and Platform before moving files.
2. Create the three top-level folders in the existing Bun/TypeScript repository. Keep `contextvm/`, `deploy-simple/`, and `.github/workflows/` in their current project/tooling boundaries.
3. Define stable internal TypeScript APIs and dependency rules, beginning with SDK Core/Nostr I/O. Preserve existing protocol behavior and tests.
4. Extract one complete commerce workflow into `sdk/` and migrate the existing web app to consume it from `apps/` as the first integration/characterization test.
5. Extract reusable React components into `ui/`; keep route composition and app-specific wiring in `apps/` and provide theme/override APIs.
6. Move extension interfaces and adapters into SDK modules; add extension config schemas there and make Platform own actual instance configuration, secrets, and service lifecycle.
7. Re-compose the current web host app from Platform + UI + SDK without changing user-visible behavior. Add self-hosting and operational support as separately reviewable Platform work.
8. Consider package publication or mobile clients only after the internal boundaries and APIs are stable, through a follow-up decision.

## Open Questions

- Should the internal folders later become separately versioned/published packages, and what consumers or evidence should trigger that step?
- Which extensions run in-process, as separate services, or through third-party APIs, and what isolation/permission model is required for each?

## Revision — 2026-10-15

The maintainer decided that `apps/` is the canonical directory for the third
top-level part and that everything in `platform/` moves over to it. This is a
naming/structural change only; the part's name, responsibility, and the
dependency rules above are unchanged.

- The folder `platform/` was renamed to `apps/` (`git mv platform apps`). It held
  two files, `index.ts` and `web/boot.ts`; both moved unchanged.
- The import alias `@platform/*` was renamed to `@apps/*` in `tsconfig.json`, and
  the two live importers (`src/frontend.tsx`, `src/lib/boot.ts`) were repointed.
- The SDK boundary wall (`sdk/boundary.test.ts`) now forbids `@apps/` in place of
  `@platform/`, as does the mirroring pattern in
  `sdk/core/composition/ts/siblings.test.ts`. A forbidden-module pattern that
  cannot match returns zero violations and reads as a clean tree, so renaming the
  folder without renaming the pattern would have let the SDK silently import the
  app. The prose naming that list was updated to match.
- Dependency direction is unchanged: `apps/` (Platform) uses `ui/` and `sdk/`;
  `sdk/` depends on neither. The wall is what keeps that true.
- The document keeps its number, title, and filename so existing citations of
  ADR-0021 remain valid. `platform/` now survives in this document only where it
  names the part, or records this rename.

Building the app instance in `apps/` is the next step; it is not part of this
revision.
