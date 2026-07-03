# AGENTS.md — src/queries

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/queries/` contains TanStack Query data access for Nostr relay data and
related application reads. Query code transforms untrusted events into typed
application data for components, hooks, and routes.

## Constraints

- Relay data is untrusted. Validate event kind, tags, author, shape/schema, and
  signature assumptions before treating an event as application state.
- Relay presence is not verified truth. Handle missing, stale, duplicated,
  malformed, deleted, replaced, and conflicting events.
- Prefer pubkeys, event IDs, coordinates, and tags over display text for
  identity and references. Addressable identity is `kind:pubkey:d`, not bare
  `d`.
- Do not collapse payment state into booleans. Queries that read orders,
  receipts, zaps, invoices, proofs, or external payment markers must preserve
  lifecycle distinctions needed by callers.
- Query functions should avoid hidden publishing side effects unless current
  code proves the pattern and the PR explicitly addresses it.
- Do not put PII, private wallet data, payment secrets, NWC URIs, or Cashu seed
  material in query keys, logs, or error messages.

## Instructions

- Keep query keys stable and specific enough for safe cache invalidation.
- Surface loading, empty, stale, and error states rather than silently converting
  them into successful empty data when the distinction matters.
- When adding or changing event parsing, include focused tests for malformed and
  conflicting relay data where practical.
- Keep relay read behavior separate from publish/mutation behavior in
  `src/publish/`.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
