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

## High-Sensitivity Publish Actions

Some publish functions have irreversible financial consequences. These must be
self-verifying: they independently fetch, validate, and derive canonical data
before signing — they do not trust caller-supplied inputs.

Mark high-sensitivity functions with a `@high-sensitivity` block comment at the
top of the function:

```ts
/**
 * @high-sensitivity
 * This function publishes an event with irreversible financial consequences.
 * It must independently verify all inputs before signing.
 */
```

### Self-verification requirements for high-sensitivity functions

- Fetch the source event(s) from the relay — do not trust caller data.
- Derive canonical identifiers from tags, not from `event.id` (may be a
  replacement). Read `auction_root_event_id` from the tag.
- Verify time windows (e.g. auction has ended) before proceeding.
- Cross-check caller assertions against independently derived results; throw
  on mismatch.
- For multi-leg operations, pre-check all legs' state before any mutation
  (atomicity: all-or-nothing, no partial states).

## Instructions

- Prefer existing publish helpers and tests when adding event flows.
- Validate input before event creation and preserve NIP/Nostr tag semantics.
- For addressable events, use coordinates that include kind, pubkey, and `d`
  where applicable.
- Keep mutation success, relay acceptance, and canonical marketplace state
  separate in UI feedback and cache updates.
- Reuse shared pure validation functions (e.g. `computeValidatedBids`) across
  callers — do not duplicate validation logic in publishers.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
