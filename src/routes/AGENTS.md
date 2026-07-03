# AGENTS.md — src/routes

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/routes/` contains TanStack Router file-based routes for public marketplace
pages, product/profile/community views, checkout, setup, vanity URLs, and
dashboard areas.

## Constraints

- Preserve TanStack Router file-based routing conventions and route parameter
  handling.
- Keep route/UI state separate from query/cache state, relay state, signed-event
  state, payment state, auth state, and storage state.
- Route guards and conditional UI are client-side workflow controls unless
  current code proves stronger authorization. Do not describe them as canonical
  server enforcement.
- Checkout and order routes must not treat wallet acknowledgement, relay
  presence, receipt publication, or local UI flags as settlement or fulfillment
  unless verified code and maintainer direction define that behavior.
- Do not expose secrets, private keys, NWC URIs, Cashu seed material, or
  sensitive contact/payment data in route params, logs, or errors.

## Instructions

- Use route params and loaders consistently with surrounding routes.
- Keep data fetching in query hooks or route loaders and publishing in
  `src/publish/`; avoid embedding protocol construction in route components.
- Preserve loading, empty, error, and stale states for relay-backed pages.
- Update route docs only when routes are added, removed, or behavior changes.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
