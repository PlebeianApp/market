# AGENTS.md — src/publish

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/publish/` contains publish and mutation helpers for marketplace events such
as products, collections, orders, payments, profiles, reactions, relay
preferences, app settings, and wallet-related events.

## Constraints

- Publishing code must make event kind, tags, author, signer, relay target, and
  validation assumptions explicit.
- Do not publish malformed, unsigned, incorrectly authored, or semantically
  ambiguous events as a side effect of UI rendering or query reads.
- Keep payment lifecycle transitions explicit. Publishing a receipt or order
  event is not automatically settlement, merchant confirmation, refund, or
  fulfillment.
- Do not log or expose private keys, signer material, NWC URIs, Cashu seed
  material, payment proofs, or sensitive order/contact data.
- Cache invalidation must not be used as proof that relays accepted or retained
  an event.

## Instructions

- Prefer existing publish helpers and tests when adding event flows.
- Validate input before event creation and preserve NIP/Nostr tag semantics.
- For addressable events, use coordinates that include kind, pubkey, and `d`
  where applicable.
- Keep mutation success, relay acceptance, and canonical marketplace state
  separate in UI feedback and cache updates.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
