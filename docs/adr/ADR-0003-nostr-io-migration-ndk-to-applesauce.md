# ADR-003: Strangler-Fig Pattern for Nostr I/O Migration (NDK → Applesauce)

## Status

Accepted

## Date

2026-07-03

## Related

- Execution checklist: `docs/ndk-to-applesauce-migration-plan.md`
- Upstream epic: `PlebeianApp/market#1005`
- Supersedes no prior ADR

## Context

Runtime relay I/O coupling through @nostr-dev-kit (NDK) introduces behavioral
risks: background WebSocket connections preventing Node.js exits, outbox-driven
relay discovery leaking test data to public relays, and race-timeout
workarounds masking timing bugs in fetch paths. Unit and e2e test flakiness
correlates with NDK dependency depth.

Replacing NDK wholesale carries unacceptable regression risk across the
marketplace, payment, and order flows. We require incremental replacement
with atomic rollback capability and continuous test validation throughout
the migration.

## Decision

Adopt Martin Fowler's strangler-fig pattern: plant applesauce-backed I/O
next to existing NDK, hide both behind a library-agnostic port, and migrate
callers module-by-module with automated gates.

### Port contract

```
interface NostrIo {
  fetchEvents(filter, opts?): Promise<NostrEvent[]>
  subscribe(filter, onEvent, opts?): () => void
  publish(event, opts?): Promise<void>
  sign(template): Promise<NostrEvent>
  getUser(): Promise<NostrUser | null>
}
```

All events pass as raw `nostr-tools` objects. Adapters translate wrapper
classes internally so callers never depend on NDK or applesauce types
directly.

### Adapter stack

- `src/lib/nostr/io.ts` — the Port interface and pass-through exports.
  Active adapter is selected via `setNostrIo()` and defaults to the NDK
  bridge.
- `src/lib/nostr/io-ndk.ts` — temporary bridge over the existing NDK
  singleton. This is the default adapter during the migration and is
  deleted in Wave D.
- `src/lib/nostr/io-applesauce.ts` — destination adapter using
  `applesauce-relay`'s `RelayPool`.

### Two-step flip per module

1. **Route through the seam (zero behavior change).** A module stops
   calling `ndkActions` directly and calls `fetchEvents`, `subscribe`,
   `publish`, `sign`, or `getUser` from `io.ts` instead. The active adapter
   is still NDK. Tests stay green.
2. **Flip to applesauce.** Tests gate it. If something breaks, flip that
   one module back — one revert, no collateral.

### Wave strategy

Stacked PRs branching upward: `master ← wave0 ← waveA ← waveB ← waveC ←
waveD ← waveE`. Only the bottom of the stack is non-draft at a time. Merge
proceeds bottom-up with rebasing. CI is cumulative per PR.

Auth and signer paths are deferred: NIP-07 and nsec migrate in Wave A3;
the NIP-46 bunker inner rewrite is Wave A3b and gates Wave D.

### NDK footprint guard

A CI guard (`scripts/check-ndk-footprint.sh`, baseline
`scripts/ndk-baseline.txt`) fails if the number of source files importing
`@nostr-dev-kit` increases. When a wave reduces the footprint, the
baseline is lowered in the same PR so the guard ratchets downward.

## Consequences

Positive:

- Flaw isolation: a breaking change affects one wave or module while the
  rest of the app remains stable.
- Continuous CI gating detects regressions per wave.
- Nostr event types remain `nostr-tools` raw events throughout; no wrapper
  class migration is needed for event shapes.
- Final cleanup (Wave D) deletes the NDK singleton and drops
  `@nostr-dev-kit/ndk` from dependencies.

Negative / tradeoffs:

- The migration spans multiple PRs over an extended period. The NDK
  bridge and applesauce adapter coexist until Wave D.
- `io-applesauce.ts` mirrors relay configuration from the NDK store
  temporarily. This coupling goes away when the NDK singleton is deleted.
- `sign` on the applesauce adapter is intentionally not wired until Wave
  A3. Callers needing signing route through the NDK bridge until then.
- Publish does not implement per-call relay targeting in Wave 0; it uses
  the adapter's configured write policy until later publish waves define
  that contract.

## References

- Full execution checklist and progress tracking:
  `docs/ndk-to-applesauce-migration-plan.md`
- Upstream epic: `PlebeianApp/market#1005`
- Martin Fowler, "StranglerFig":
  https://martinfowler.com/bliki/StranglerFigApplication.html
