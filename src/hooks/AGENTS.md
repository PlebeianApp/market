# AGENTS.md — src/hooks

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/hooks/` contains React hooks for UI behavior, permissions, synchronization,
streaming products, notifications, privacy monitoring, and domain workflows.

## Constraints

- Hooks must keep UI state, query/cache state, relay state, payment state, and
  storage state explicit. Do not hide cross-boundary state transitions in a hook
  without clear naming and tests.
- Hooks that consume relay data must treat it as untrusted and preserve loading,
  stale, missing, malformed, and conflicting states where the caller needs that
  distinction.
- Hooks that touch payment or wallet flows must not equate wallet responses,
  zap receipts, or local flags with settlement unless the verified code path
  defines that meaning.
- Avoid logging PII, identifiers, wallet data, or auth state from hooks.

## Instructions

- Prefer composing existing query, store, and publish APIs over duplicating
  protocol logic inside hooks.
- Keep effect cleanup explicit for subscriptions, timers, observers, and relay
  listeners.
- Preserve stable hook return shapes unless the caller updates are included in
  the same change.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
