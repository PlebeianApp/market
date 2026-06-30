# AGENTS.md — Plebeian Market

> This file is the **source of design truth** for this monorepo. It is not a
> description of what the code does — it is a prescription of what the code must
> be. If the code and this file disagree, both are wrong until reconciled.

---

## Context

### What This Project Is

Plebeian Market is a decentralized marketplace built on the Nostr protocol.
Buyers and sellers transact without a central authority: all marketplace data
(listings, profiles, reviews) is stored as Nostr events on relays. A small
centralized server handles non-marketplace concerns only — admin moderation,
featured listings, NIP-05 verification, and vanity URLs. Payments flow over the
Bitcoin Lightning Network.

### Projects in This Monorepo

| Directory | Project | Purpose |
|-----------|---------|---------|
| `src/` | **Marketplace Client** | React 19 SPA. The user-facing marketplace. Built with TanStack Router (file-based routing), TanStack Query (server state), NDK (Nostr protocol), Tailwind CSS v4 + shadcn/ui (UI layer). Runs on the Bun runtime. |
| `contextvm/` | **ContextVM Services** | Independently deployed backend nodes that serve specialized services over the Nostr protocol: BTC/fiat currency conversion, multi-source price aggregation with median calculation, and SQLite-backed caching with TTL. Deployed separately from the client. |
| `e2e/` | **E2E Test Suite** | Playwright-based end-to-end testing. Uses scenario-based cumulative data seeding, multi-method auth flow testing, and an isolated local relay (nak) for deterministic test environments. |
| `docs/` | **Documentation & Specs** | Nostr NIPs used, marketplace spec details, architecture references. Start here for protocol-level context. |
| `scripts/` | **Utility Scripts** | Seeding, startup, and miscellaneous tooling. |
| `deploy-simple/` | **Deployment** | Deployment files and scripts. |
| `.github/` | **CI/CD** | GitHub Actions workflows for staging and production environments. |
| `public/` | **Static Assets** | Published app assets, copied into build output. |

Each subdirectory listed above should have its own `AGENTS.md` with
project-specific design decisions, constraints, and instructions. Always read
the `AGENTS.md` in the directory you are working in **and** every parent
directory up to this root file.

### Technology Stack

- **Runtime**: Bun (package manager, dev server, bundler)
- **Language**: TypeScript (strict mode, ESM, bundler module resolution)
- **Client Framework**: React 19
- **Routing**: TanStack Router (file-based, with `watch-routes` for generation)
- **Server State**: TanStack Query
- **Client State**: TanStack Store with localStorage persistence
- **Nostr**: NDK + nostr-tools
- **Styling**: Tailwind CSS v4 + shadcn/ui (Radix UI primitives)
- **Testing**: Playwright (e2e), unit/integration runners via Bun
- **Formatting**: Prettier (`.prettierrc`)
- **Path Aliases**: `@/*` maps to `src/*`

For commands, scripts, and dependency versions, see `package.json`.
For TypeScript configuration, see `tsconfig.json`. For Bun configuration, see
`bunfig.toml`.

### Key Domain Concepts

- **Nostr Relay**: A WebSocket server that stores and forwards Nostr events. This project connects to multiple relays; one is self-hosted and deployed via CI/CD.
- **Nostr Event**: The atomic data unit — a signed JSON object published to relays. All marketplace data (listings, bids, profiles) is encoded as events.
- **NIP**: Nostr Implementation Possibility — a specification document defining a feature of the Nostr protocol. Relevant NIPs: NIP-07 (browser extension signing), NIP-46 (remote signing), NIP-99 (classified listings).
- **ContextVM**: A self-deployed node that provides backend services (price feeds, caching) over the Nostr protocol rather than a traditional HTTP API.
- **Outbox Pattern**: Domain events are written to a database table first, then published to relays by a separate process — never published directly in the request path.
- **LNURL / NWC / Zap**: Bitcoin Lightning Network payment protocols used for marketplace transactions.

### Known Design Inconsistencies (Current State)

These are **not bugs**. They are the current, acknowledged state of the
codebase. They are documented here so that every agent and human understands
them as the baseline. Improving any of these requires a deliberate change to
both the relevant `AGENTS.md` file and the code — simultaneously, in the same
PR.

1. **Environment script naming is inconsistent.** Development scripts (`dev`,
   `dev:seed`, `dev:local-only`) and start scripts (`start`, `start:local-only`,
   `start:production`, `start:staging`) follow different naming conventions and
   lack unified documentation of their purpose and differences.

2. **Testing strategy is undocumented.** Unit, integration, and e2e tests all
   exist but there is no documented testing pyramid, no coverage thresholds
   defined, and test organization is inconsistent across projects.

3. **Build process is partially custom.** `build.ts` uses custom CLI argument
   parsing and manual file copying logic while also relying on default Bun
   bundler behavior. The boundary between custom and default behavior is not
   clearly defined.

4. **Centralized server location is ambiguous.** The centralized admin server
   is referenced in deployment descriptions but does not have a clearly defined
   directory boundary — it may share code with the client in `src/` but is
   deployed as a separate component. Server logic exists in `src/index.tsx` 
   alongside client code without clear separation.

5. **Monorepo has no formal workspace tool.** Multiple independent projects
   coexist in the same repository without a monorepo manager (e.g., Turborepo,
   Nx). Dependency sharing, build ordering, and cross-project tooling are
   handled ad hoc.

6. **Progressive enhancement claims are aspirational.** The architecture states
   graceful degradation when JavaScript is disabled or relays are unavailable,
   but this is not systematically tested or enforced. The application is
   heavily React-based with client-side routing.

7. **Architecture boundary violations occur in practice.** While the architecture 
   prohibits direct cross-project imports, the codebase shows instances where 
   `src/index.tsx` imports from `contextvm` utilities and client-side code 
   references server-side logic patterns.

8. **Nostr event publishing bypasses NDK abstraction.** Despite the requirement 
   that all Nostr event publishing must go through the NDK abstraction layer, 
   the codebase includes direct WebSocket event handling in `src/index.tsx` 
   and mixed use of NDK and direct nostr-tools usage.

9. **Data privacy practices are inconsistent.** User identifiers and authentication 
   state are persisted in localStorage without encryption, despite the requirement 
   to treat all user identifiers as PII. Test credentials are stored in source code.

10. **Error handling patterns are inconsistent.** Error handling varies across 
    modules with mixed approaches to try/catch vs query error states, and ContextVM 
    services lack the required correlation ID tracking for traceability.

---

## Instructions

### AGENTS.md Protocol — Read This First

1. **AGENTS.md is the source of design truth.** Every design decision lives in
   an `AGENTS.md` file. If a decision is not in an `AGENTS.md` file, it does not
   exist as far as agents are concerned.

2. **Read recursively.** Before working in any directory, read the `AGENTS.md`
   in that directory **and** every `AGENTS.md` in every parent directory up to
   this root file. Parent rules inform child directory analysis. Child
   `AGENTS.md` files may add stricter constraints but **never relax** parent
   constraints.

3. **Code and AGENTS.md must stay in sync.** If a PR changes code without
   updating the relevant `AGENTS.md`, or changes `AGENTS.md` without updating
   the code, the PR is incomplete and **must not be merged**. Design truth and
   implementation truth are the same truth.

4. **Inconsistencies are acknowledged, not hidden.** The known inconsistencies
   listed above are the current design. They exist intentionally in this file
   as documented debt. Do not silently "fix" them by changing code alone — a
   change to resolve an inconsistency must update `AGENTS.md` to reflect the new
   intended design and must be called out explicitly in the PR description.

5. **AGENTS.md changes are architecture changes.** Modifying an `AGENTS.md`
   file is equivalent to modifying the architecture. Treat it with the same
   scrutiny as a database schema migration.

### Universal Constraints

These apply across **all** projects in this monorepo unless a subdirectory
`AGENTS.md` explicitly tightens them.

#### Architecture Boundaries

- No direct cross-project imports. The client (`src/`) must not import from
  `contextvm/` or `e2e/`. Shared types and utilities should be extracted
  explicitly, not imported sideways.
- The centralized admin server (wherever its code currently resides) must not
  contain marketplace business logic. Its scope is limited to: admin/moderation
  actions, featured listing management, NIP-05 verification, and vanity URL
  routing.
- ContextVM nodes communicate over the Nostr protocol only. They do not expose
  HTTP endpoints for client consumption.
- All Nostr event publishing must go through the NDK abstraction layer — never
  construct raw events bypassing validation and signing.

#### Data Handling and Privacy

- Treat all user identifiers, contact fields, and payment data as PII. Never
  log them.
- No customer or seller data in logs, metrics, or error messages.
- All marketplace data must be stored as Nostr events on relays — do not
  persist marketplace data in a traditional database without an explicit
  documented reason in the relevant `AGENTS.md`.

#### Nostr Protocol Rules

- Respect NIP-07 (browser extension signing), NIP-46 (remote signing), and
  NIP-99 (classified listings) conventions. Do not invent custom event kinds
  without documenting them in `docs/`.
- Relay connections must handle disconnection and reconnection gracefully.
  Never assume a relay is permanently available.
- Event validation (schema, signature) must happen before publishing and after
  receiving. Use Zod schemas in the data layer (`src/queries/`).

#### Error Handling

- Never swallow errors silently. Return typed failures or propagate them.
- Retry logic for relay operations must be bounded with exponential backoff.
- Error responses from ContextVM services must include a correlation ID for
  traceability.

#### Testing

- Every behavior change must include corresponding tests.
- E2E tests use cumulative scenario seeding — do not create isolated test data
  that breaks the cumulative sequence without updating the seed scripts.
- Run `make lint && make test && make integration-test` (or the equivalent
  npm/bun scripts from `package.json`) before considering work complete.

#### Security

- Secrets must be passed via vault or environment variables — never committed
  in files.
- Private keys are managed client-side only. The centralized server must never
  hold user private keys.
- No new network egress paths without updating the allowlist and documenting in
  the relevant `AGENTS.md`.

### Role-Specific Instructions

#### For Product Managers

- Before writing or refining an issue spec, read the `AGENTS.md` in the
  target directory and all parent directories. The spec must conform to the
  stated design. If it doesn't, you have two options: adjust the spec to fit
  the current design, or propose an `AGENTS.md` change as part of the issue.
- Issue specs that require architectural changes must explicitly call out which
  `AGENTS.md` files need to be modified and why.
- Reference known inconsistencies (by number) if your issue touches one. State
  whether the issue intends to resolve the inconsistency or work around it.

#### For Designers (UI/UX)

- The design system is shadcn/ui + Tailwind CSS v4. New components must follow
  existing component patterns in `src/components/`. See
  `src/components/AGENTS.md` for specifics.
- Feature designs must map to the TanStack Router file-based routing structure
  in `src/routes/`. If a design implies a new route, that route must be
  documented in `src/routes/AGENTS.md`.
- Designs involving data display must account for Nostr's eventual-consistency
  model — data may arrive late or not at all. Design loading, empty, and error
  states for all data-driven views.
- Authentication flows involve multiple methods (NIP-07 extension, NIP-46
  remote signing). Designs must account for all supported auth methods, not
  just one.

#### For Developers (Coders)

- **Read before you write.** Read the `AGENTS.md` in the directory you're
  working in and every parent directory. Understand the constraints before
  touching code.
- **Update as you go.** If your change introduces a new pattern, modifies an
  existing pattern, or shifts an architectural boundary, update the relevant
  `AGENTS.md` in the same PR.
- **Follow existing patterns.** If a directory has an established
  implementation pattern (e.g., how queries are structured in `src/queries/`,
  how events are published in `src/publish/`), follow it. Deviation requires an
  `AGENTS.md` update documenting why and what the new pattern is.
- **No silent inconsistency resolution.** If you discover code that violates
  an `AGENTS.md` rule, flag it — do not quietly fix it without updating the
  documentation. Conversely, if `AGENTS.md` describes behavior the code doesn't
  implement, flag that too.
- **Respect the Bun runtime.** Use Bun-compatible APIs. Do not introduce Node.js
  built-ins that Bun doesn't support without verifying compatibility.

#### For Reviewers / Maintainers (PR Reviewers)

- **Verify AGENTS.md sync.** The first check on every PR: does the code match
  the `AGENTS.md` files, and do the `AGENTS.md` files match the code? If one
  changed without the other, request changes.
- **Verify constraint adherence.** Check that submitted code respects all
  applicable universal constraints and subdirectory-specific constraints.
- **Flag pattern deviations explicitly.** If the PR introduces a pattern that
  differs from what the directory's `AGENTS.md` describes, the PR must either
  update the `AGENTS.md` or revert to the documented pattern. There is no third
  option.
- **Inconsistency awareness.** If the PR touches a known inconsistency area,
  verify the PR description addresses it — either working within the current
  state or deliberately resolving it with matching `AGENTS.md` changes.
- **Reject PRs that bypass the protocol.** A PR that changes code behavior
  without touching `AGENTS.md`, or changes `AGENTS.md` without touching code, is
  incomplete.

#### For Auditors

- **Periodic reconciliation.** Audit each `AGENTS.md` against the actual code
  in its directory. Report mismatches as issues — either the code has drifted
  from the design or the design was never implemented.
- **Constraint compliance review.** Systematically verify that the universal
  constraints (architecture boundaries, data handling, Nostr rules, error
  handling, testing, security) are being followed across all projects.
- **Inconsistency tracking.** Track the known inconsistencies over time. Each
  should eventually be resolved or explicitly accepted as permanent design.
  Report any new inconsistencies discovered during audit.

### Definition of Done

A task is complete when **all** of the following are true:

1. Code changes follow all applicable `AGENTS.md` constraints.
2. All affected `AGENTS.md` files are updated to reflect the changes.
3. Code and `AGENTS.md` are in sync — no divergence.
4. Tests are written or updated for behavior changes.
5. `package.json` scripts for linting and testing pass locally.
6. The PR description references any known inconsistencies touched.
7. A reviewer has confirmed items 1–6.

### Subdirectory AGENTS.md Template

When creating a new `AGENTS.md` in a subdirectory, follow this structure:

```markdown
# AGENTS.md — [Directory Name]

> Brief one-line purpose of what this directory contains and achieves.

## Context
- What this module/project does and why it exists.
- Key design decisions specific to this scope.
- Pointer to relevant specs, configs, or parent AGENTS.md for deeper context.

## Constraints (specific to this directory, tightening parent rules)
- [Architecture rules specific to this module]
- [Patterns that must be followed]
- [Anti-patterns that must be avoided]

## Instructions
- [How to read, modify, and review code in this directory]
- [Role-specific notes if the directory has unique workflow requirements]