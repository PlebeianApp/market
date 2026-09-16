# ADR-002: Strangler-Fig Pattern for Nostr I/O Migration (NDK → Applesauce)

## Status

Accepted

## Date

2026-07-03

## Related

- Migration wave roadmap: contained in this ADR
- Upstream epic: `PlebeianApp/market#1005`
- Supersedes no prior ADR

## Context

Runtime relay I/O coupling through @nostr-dev-kit (NDK) introduces behavioral
and privacy risks:

- NDK keeps background WebSocket connections alive, which can prevent Node.js
  from exiting cleanly in local and CI test runs.
- NDK's outbox model can discover and connect to additional public relays,
  leaking test or development traffic outside the intended relay set.
- The current runtime carries fetch-timeout workarounds for hanging fetch
  paths. Those workarounds mask timing bugs instead of removing the root
  cause.
- The e2e harness already avoids NDK in several helper paths. The remaining
  reliability risk is the application's runtime subscribe, fetch, publish,
  auth, and signer paths.

Applesauce uses raw `nostr-tools` events natively rather than an `NDKEvent`
wrapper class. That means the migration should not require a broad event-shape
rewrite. The main task is redirecting where relay I/O lands while keeping Nostr
event validation, authorship, signing, relay targeting, and payment/order
workflow boundaries explicit.

Replacing NDK wholesale carries unacceptable regression risk across marketplace,
payment, and order flows. We require incremental replacement with atomic
rollback capability and continuous test validation throughout the migration.

## Decision

Adopt Martin Fowler's strangler-fig pattern: plant applesauce-backed I/O
next to existing NDK, hide both behind a library-agnostic port, and migrate
callers module-by-module with automated gates.

### Locked decisions

- Scope is app-first. Server runtime migration is separate Wave E work.
- Unit tests and relevant e2e tests are the reliability gates. Root-cause waves
  must preserve test assertions while reducing NDK-backed runtime I/O.
- PRs are stacked by wave, reviewed and merged bottom-up.
- Non-overlapping modules migrate before known auctions conflict-zone files.
- NIP-07 and nsec auth migration is deferred to Wave A3.
- NIP-46 bunker inner rewrite is deferred to Wave A3b. Wave D is gated on A3b
  because deleting the NDK singleton before the signer path is ready would
  collapse auth and signer boundaries.

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

#### Wave roadmap

**Wave 0: Foundation**

- Promote applesauce packages to direct dependencies for explicit runtime
  ownership.
- Add the `src/lib/nostr/io.ts` seam.
- Add `src/lib/nostr/io-ndk.ts` as the temporary NDK bridge and default
  adapter.
- Add `src/lib/nostr/io-applesauce.ts` as the destination adapter.
- Add the CI NDK-footprint guard and baseline.
- Add this ADR and matching AGENTS guidance so future relay I/O routes through
  the seam. NDK remains the default adapter.

**Wave A: Root-cause, no auctions overlap**

- A1: NIP-17/59 pilot for private order messaging. This excludes
  `src/publish/orders.tsx`.
- A2: Read paths for products, collections, shipping, profile, comments,
  reactions, value-for-value, blacklist, relay-list, orders, and wallet.
- A3: Auth for NIP-07 and nsec.
- A3b: NIP-46 bunker inner rewrite. This gates Wave D.
- A4: Non-conflicting publish modules, excluding the Wave C conflict-zone
  files.

**Wave B: Type-only cleanup**

- Replace type-only `NDKEvent` imports with raw `nostr-tools` event types.
- Keep this wave behavior-neutral; it is cleanup, not a reliability claim.

**Wave C: Conflict-zone files**

- `src/publish/orders.tsx`.
- `src/publish/featured.tsx`.
- `src/routes/_dashboard-layout/dashboard/index.tsx`.
- `src/lib/stores/nip60.ts` is handed to the auctions team instead of being
  migrated in this stack.

**Wave D: Capstone**

- After A3b lands, flip the remaining singleton path to applesauce.
- Delete the NDK singleton and `src/lib/nostr/io-ndk.ts`.
- Remove `@nostr-dev-kit/ndk` when unused.
- Ratchet the NDK-footprint baseline to zero or retire the guard once the
  footprint is actually gone.

**Wave E: Server runtime**

- Migrate `src/server/*` separately.
- Gate this work with integration tests. It is not expected to change
  marketplace e2e flakiness directly.

Root-cause flakiness work is concentrated in Wave A, Wave C publish files,
and Wave D. Wave 0, Wave B, the dashboard type-only work, and Wave E are
enablers or cleanup unless later code review shows otherwise.

#### Auctions coordination

The known overlap files between this migration and auctions work are:

- `src/lib/stores/nip60.ts`
- `src/publish/featured.tsx`
- `src/publish/orders.tsx`
- `src/routes/_dashboard-layout/dashboard/index.tsx`

`src/lib/stores/nip60.ts` belongs to the auctions team for migration planning.
Wave C stays at the top of the stack and merges later so auctions-related work
can land first without forcing broad rebases through the lower waves.

#### Stacking and merge mechanics

```
master ← wave0 ← waveA ← waveB ← waveC ← waveD ← waveE
```

- Each wave branch targets its predecessor.
- Only the bottom unmerged wave should be non-draft.
- Merge proceeds bottom-up.
- After a lower wave merges, rebase the higher waves onto the new base before
  promoting the next wave for review.
- CI is cumulative per PR because each higher wave includes the lower waves
  beneath it.

#### Verification gates

Every wave must pass:

- `bun run test:unit`
- `bun run format:check`
- NDK-footprint guard (`scripts/check-ndk-footprint.sh`)

Root-cause waves must also repeatedly run the relevant e2e spec locally and in
CI, with assertions unchanged. When a wave lowers the NDK footprint, lower
`scripts/ndk-baseline.txt` in the same PR so the guard ratchets downward.

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
- Publish modules still need per-module migration review even when the seam
  can carry relay-targeting options; Wave A4 and Wave C define the publish
  rollout boundaries.

## References

- Upstream epic: `PlebeianApp/market#1005`
- Martin Fowler, "StranglerFig":
  https://martinfowler.com/bliki/StranglerFigApplication.html
