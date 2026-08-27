# ADR-0020: Auctions Are Applesauce-Native From Day One (Kind 30408)

## Status

Proposed

## Date

2026-08-27

## Related

- Implementation detail: `docs/designs/applesauce-auctions-migration.md`
  (the design doc — this ADR captures the decision only)
- ADR-0002 — strangler-fig pattern; auctions are Wave A3
- ADR-0005 — test isolation; local relay and mocked mints
- Wallet rebuild research handover (2026-08-27), §7, decision D8
- V4V UI-agnostic audit and plan (`docs/adr/proposals/v4v-ui-agnostic-audit-and-plan.md`)

## Context

Auctions (kind 30408) do not exist on `master`. The only forward-looking
references are comments in `src/lib/v4v/splits.ts` and a non-implemented
sketch in the V4V proposal. This is a greenfield feature, not a migration
of existing NDK code.

ADR-0002 schedules auctions as Wave A3 of the NDK → applesauce
strangler-fig migration. For every other module, "migration" means routing
existing NDK calls through the `src/lib/nostr/io.ts` seam and flipping the
adapter under tests. Auctions have nothing to migrate. Building them on
NDK first would mean adding new NDK coupling that the migration exists to
remove — growing the NDK footprint the CI guard ratchets down.

Applesauce's reactive model (`EventStore` + `QueryStore`) matches the
auction problem shape directly: replaceable kind 30408 definitions are
"latest event per coordinate wins," bid streams are chronological
append-only queries, and the same bid event may arrive from several relays
near-simultaneously (dedup by event ID). The flat fire-and-forget seam
interface would force the auction module to hand-roll refetch-on-reconnect
state that `QueryStore` provides natively.

Relay liveness — the open risk that could have forced application-layer
subscription replay — was confirmed by hzrd149 (2026-08-27):
applesauce-relay provides `reconnect` (rebuild the websocket after
disconnect) and `resubscribe` (re-send REQ after CLOSE or a broken
websocket). The reactive model holds across relay drops; the per-relay
isolation pattern (one flaky relay degrades only its own stream) is
natively supported.

## Decision

Build the auctions module applesauce-native from the first commit. It
never imports `@nostr-dev-kit` and never routes reads through the
`io.ts` seam.

### Locked decisions

1. **Reads go directly to `EventStore` + `QueryStore`.** Auction
   discovery (kind 30408 by author / d-tag), state changes (replaceable
   events), and bid streams (append-only chronological queries, with
   timeline-style loaders for backfill and gap detection) are reactive
   queries over the shared `EventStore`. This is an intentional deviation
   from ADR-0002's "everything through the seam" pattern, justified by
   the greenfield nature of the module — there is no NDK code to migrate
   through the seam, and forcing reactive reads through the flat
   interface would discard the reason for going applesauce-native.
2. **Writes go through the `io.ts` seam (`publish`).** Creating auctions,
   placing bids, and updating state are fire-and-forget publishes the
   seam already handles; routing writes through the seam keeps relay
   targeting, signing, and auth boundaries shared with the rest of the
   app until Wave D deletes the NDK adapter.
3. **Per-relay isolation is a requirement, not a nice-to-have.** One
   flaky relay must degrade only its own stream. `reconnect` +
   `resubscribe` (confirmed by hzrd149, 2026-08-27) make this natively
   supported; application-layer sub-replay is a contingency only.
4. **Sequencing: Wave A3, after Wave A2 (listings).** The applesauce
   5.2 → 6.2 upgrade check happens first (design doc Phase 1) so the
   greenfield module is not written against an API we are about to
   leave.
5. **Implementation detail lives in the design doc**, not here: phases,
   event model, the 30408 schema open question, NDK-footprint-guard
   enhancement, and risk register are tracked in
   `docs/designs/applesauce-auctions-migration.md`.

## Consequences

Positive:

- The NDK footprint never grows from auctions; the greenfield module
  starts on the destination architecture instead of adding migration
  debt to be repaid later.
- Auction views stay live across relay drops with no hand-rolled
  refetch state; dedup by event ID handles multi-relay bid delivery.
- Publish paths remain consistent with the strangler-fig pattern, so
  Wave D deletes the NDK singleton without auctions being a blocker.

Negative / tradeoffs:

- The auctions module bypasses the seam for reads, so the seam is no
  longer a complete library-agnostic port for all relay I/O. If
  applesauce is ever replaced, auctions read paths migrate separately.
- The kind 30408 schema is not yet finalized (design doc §6); the
  reactive-query shape is decided, the tag structure is not.
- The 5.2 → 6.2 upgrade risk lands before auctions code, not after.

## References

- Design doc: `docs/designs/applesauce-auctions-migration.md`
- ADR-0002: `docs/adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md`
- hzrd149 relay-liveness confirmation (2026-08-27), recorded in design
  doc §3 and §7
- nostr_ex per-relay isolation reference:
  `https://github.com/jurraca/nostr_ex`
