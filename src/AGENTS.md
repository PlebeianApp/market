# AGENTS.md — src

This directory follows the repository-level AGENTS.md.

## Context

`src/` contains the React 19 marketplace application, TanStack Router routes,
TanStack Query data access, publish/mutation helpers, shared library code,
components, hooks, and the current Bun server entry area.

## Constraints

- Keep client UI/form state, query/cache state, relay connection state,
  signed-event state, payment state, local storage state, and backend/service
  state separate.
- Do not hide Nostr protocol rules inside UI components. Event kind, tags,
  author, signature assumptions, relay behavior, and addressable coordinates
  belong in explicit data/publish/query layers.
- Do not collapse payment state into a single `paid` boolean when the flow
  distinguishes wallet acknowledgement, settlement/proof, receipt publication,
  merchant confirmation, refund/failure, or fulfillment.
- Treat persisted identifiers, contact fields, wallet/payment details, and auth
  state as sensitive. Do not log them.
- Preserve TanStack Router file-based route conventions and current Bun runtime
  assumptions.

## Instructions

- For route work, also read `src/routes/AGENTS.md`.
- For data fetching, also read `src/queries/AGENTS.md`.
- For publishing or mutations, also read `src/publish/AGENTS.md`.
- For shared utilities, stores, Nostr helpers, wallets, or payments, also read
  `src/lib/AGENTS.md`.
- For UI components and hooks, also read the matching child AGENTS file.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run `bun run test:unit` and `bun run test:integration`
  when relevant and authorized.
