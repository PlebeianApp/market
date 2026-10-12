# AGENTS.md — src/components/auctions

This directory follows `src/components/AGENTS.md`, `src/AGENTS.md`, and the
repository-level `AGENTS.md`.

## Purpose

`auctions/` holds the auctions-domain components: the bid form and its progress
dialog, the bid list, auction cards and countdowns, the display and filter
components, settlement and verdict panels, the timeline chart, the auction
section grid, and the winner ("you won") prompt.

It is a **feature directory** per ADR-0007 §1b ("More component subdirectories
can be added per-feature or per specification ruleset"). `nostr/` holds
**generalised** Nostr-domain components (users, profiles, generic event
rendering); a domain that has its own feature directory keeps its components
here rather than in `nostr/`.

## Import rules

- **May import from:** any `src/components/` subdirectory (including `ui/`,
  `ui-wrappers/`, `shared/`, `nostr/`, `dialogs/`, and other feature
  directories), `@/queries/*`, `@/lib/*`, `@/hooks/*`, `@/publish/*`, and
  `@/lib/stores/*`.
- **Canonical alias:** `@/components/auctions/{component}`. Barrel exports per
  directory are allowed (ADR-0007 §1d).
- **Dependency cycles are prohibited.** If another directory imports from
  `auctions/`, `auctions/` must not import from it.

A feature directory is allowed to host **containers**, which is why it is the
right home for components that mutate domain stores or reach the publish layer.
`nostr/` may not do either (`src/components/nostr/AGENTS.md`), and
`src/components/AGENTS.md` places feature directories outside the import
hierarchy.

## Data access

- Data arrives through **named adapters from `@/queries/*`** — either a
  `*QueryOptions` factory spread into `useQuery`, or a named read hook. A
  hand-written `queryFn` with inline relay filters inside a component is not
  permitted; add the adapter to `@/queries/*` and consume it here. The win
  prompt is the worked example: `auctionWinResolutionQueryOptions` owns the
  query key, the relay reads, and the resolution call, and the component only
  narrows `enabled` to its own gate.
- A component may read store state for display. **Mutating** a domain store or
  publishing directly is the container's job and stays explicit — do not hide
  it behind a presentational child.

## Standards

ADR-0007 §1c scopes the standardized parameters (ref exposure, variants,
density) to the **reusable** component set and explicitly relaxes them for
purpose- or feature-specific components such as this directory's. The
requirements that still apply to anything added here:

- **`cn()` className merging** — accept `className`, merge via `cn()`.
- **Semantic tokens, not hardcoded colors.**
- **Callbacks for user actions** where the action belongs to the parent.
- Keep loading, empty, error, and eventually-consistent relay states visible.

## Review checklist

- [ ] Data access goes through a named `@/queries/*` adapter — no inline `queryFn`
- [ ] Store mutations and publishing are visible in the component that performs them, not hidden in a child
- [ ] No hardcoded colors — uses semantic tokens
- [ ] Actions the parent owns are passed as callbacks
- [ ] No new dependency cycle with another `components/` subdirectory
- [ ] `scripts/check-auctions-ndk-surface.sh` passes (this directory is in its scanned set; relay I/O, signing, and identity go through `src/lib/nostr/io.ts`, never `@nostr-dev-kit` or the NDK store singleton)

## Safe Checks

- `git diff --check`
- `bun run format:check`
- `bash scripts/check-auctions-ndk-surface.sh`
- For behavior changes, run focused unit/integration checks when relevant and authorized.
