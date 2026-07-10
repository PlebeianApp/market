# AGENTS.md — src/lib

This directory follows the repository-level AGENTS.md and `src/AGENTS.md`.

## Context

`src/lib/` contains shared application utilities, stores, Nostr helpers, wallet
helpers, payment helpers, schemas, workflow logic, query client setup, and
shared types.

## Constraints

- Keep storage, relay, signed-event, payment, wallet, and service-assisted state
  boundaries explicit in types and function names.
- Treat localStorage and other browser persistence as sensitive when storing
  identifiers, auth state, wallet data, payment data, or contact fields.
- Validate untrusted Nostr event data before turning it into application state.
- Do not introduce new payment semantics or custody assumptions without tests
  and maintainer direction.
- Do not log private keys, NWC URIs, Cashu seed material, tokens, payment
  proofs, or user contact data.

## Instructions

- Prefer existing store, schema, wallet, and Nostr helper patterns before adding
  new shared abstractions.
- Keep low-level helpers side-effect-light unless their name and tests make the
  side effect obvious.
- `src/lib/orders/nip17OrderMessageMerge.ts` is a read-side migration helper for
  building combined order timelines from legacy raw order events and
  already-unwrapped NIP-17 order messages. Do not treat it as a publish,
  signing, unwrap, relay I/O, or required order-read boundary.
- For payment changes, preserve lifecycle distinctions such as attempted,
  acknowledged, settled/proven, receipt published, merchant confirmed, failed,
  refunded, and fulfilled.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- For behavior changes, run focused unit/integration checks when relevant and
  authorized.
