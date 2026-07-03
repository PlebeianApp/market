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

## Instructions

- Prefer existing UI primitives and local component patterns before adding new
  abstractions.
- Keep loading, empty, error, and eventually-consistent relay states visible
  when a component depends on Nostr data.
- Use icons and controls consistently with the surrounding UI.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
