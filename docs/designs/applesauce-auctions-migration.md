# Design Doc: Applesauce-Native Auctions (Kind 30408)

## Status

Proposed — design doc (not an ADR). Tracks the greenfield implementation plan
for auctions on the `adr/wallet-rebuild` branch. Pending expert replies on
open questions (§6) before implementation begins.

## Date

2026-08-27

## Related

- ADR-0002 — Strangler-fig pattern for NDK → applesauce I/O migration
- ADR-0005 — No external service dependencies in tests
- ADR-0017 — Cashu wallet dependency stack (`@cashu/coco-core` 2.0 family)
- ADR-0019 — Wallet state synchronization (hybrid WAL + checkpoint)
- Wallet rebuild research handover (2026-08-27), decision D8
- V4V UI-agnostic audit and plan (`docs/adr/proposals/v4v-ui-agnostic-audit-and-plan.md`)

---

## 1. Current State

The auctions module does **not exist** on `main`. The only forward-looking
references are comments in `src/lib/v4v/splits.ts` at lines 6, 11, and 125:

- Line 6: `* today, auctions (kind 30408) tomorrow — without the UI knowing which.`
- Line 11–12: `* an auction adapter would instead keep the pool at a fixed total (e.g. 10000 bps) with the owner as the remainder.`
- Line 125–126: `* before publishing to kind 30078. (Auction adapter does not need this — its pool is already expressed in the publish unit.)`

The V4V UI-agnostic proposal (`docs/adr/proposals/v4v-ui-agnostic-audit-and-plan.md`)
includes a **non-implemented sketch** of an auction consumer (`useAuctionV4VSplits`
reading kind 30408 + 30409 validators) to prove the `V4VManager` component is
kind-agnostic. That sketch is explicitly out of scope for its PR and flagged as
"the next effort; this PR unblocks it."

**This is a greenfield feature, not a migration of existing code.** The
opportunity is to start applesauce-native from day one — never touch NDK
for auctions relay I/O at all.

---

## 2. Migration Context

### Strangler-fig seam

ADR-0002 established the strangler-fig pattern with a library-agnostic I/O
port at `src/lib/nostr/io.ts` (74 lines). The port defines a `NostrIo`
interface (`fetchEvents`, `subscribe`, `publish`, `sign`, `getUser`) and
all events pass as raw `nostr-tools` objects — no NDK or applesauce wrapper
classes at the call site.

Two adapters implement the port:

- `src/lib/nostr/io-ndk.ts` — temporary bridge over the existing NDK
  singleton (default during migration, deleted in Wave D).
- `src/lib/nostr/io-applesauce.ts` — destination adapter using
  `applesauce-relay`'s `RelayPool`.

The active adapter is swapped via `setNostrIo()`. Each module flips
independently: route through the seam (still NDK-backed), then flip to
applesauce with tests gating the flip.

### Wave roadmap

| Wave    | Scope                                                     | Status                 |
| ------- | --------------------------------------------------------- | ---------------------- |
| Wave 0  | Foundation: seam, adapters, CI guard, AGENTS guidance     | Done                   |
| Wave A1 | NIP-17/59 private order messaging pilot                   | Done                   |
| Wave A2 | Listings read paths through the seam                      | Pending (`t_353544bd`) |
| Wave A3 | Auth (NIP-07 / nsec) + **auctions** (greenfield)          | Not started            |
| Wave B  | Type-only cleanup (NDKEvent → nostr-tools types)          | Not started            |
| Wave C  | Conflict-zone publish files                               | Not started            |
| Wave D  | Capstone: delete NDK singleton, drop `@nostr-dev-kit/ndk` | Gated on A3b           |
| Wave E  | Server runtime migration                                  | Not started            |

Auctions are **Wave A3** in the roadmap but are greenfield — there is no
existing NDK code to migrate. The auction module will be written
applesauce-native from the first commit.

### NDK footprint guard

The CI guard (`.github/workflows/ci-ndk-guard.yml`, `scripts/check-ndk-footprint.sh`)
fails if the number of source files importing `@nostr-dev-kit` increases
beyond the committed baseline (`scripts/ndk-baseline.txt`, currently 127).

**Known weakness:** the guard counts files, not import statements. A file
that already imports `@nostr-dev-kit` could gain additional NDK imports
without triggering the guard. This matters for auctions because the
greenfield module must not introduce any NDK coupling — but the guard
alone does not enforce import-level isolation for new files (it only
ensures new files don't appear). Phase 4 of the implementation plan
addresses this.

---

## 3. Applesauce Streams Architecture for Auctions

The architecture leverages applesauce's reactive event-store model rather
than the fire-and-forget subscribe/fetch pattern the current seam provides.
Auctions need three distinct stream types (discovery, state changes, bids),
each with different liveness requirements.

### EventStore as the central event store

Applesauce's `EventStore` is an append-only, normalized, deduplicated event
store. All relay-sourced auction events (kind 30408 auction definitions,
bids, state transitions) flow into the `EventStore` once, regardless of how
many active queries consume them.

**Key property:** deduplication is by event ID. The same event arriving
from multiple relays is stored once. This is critical for auctions where
the same bid event may arrive from several relays nearly simultaneously.

### QueryStore / queries as the reactive layer

The `QueryStore` sits above the `EventStore` and provides reactive queries.
When new events land in the `EventStore` (from relay updates), every active
query that matches those events is automatically re-evaluated. There is no
manual refetch — relay updates materialize into every active query
automatically.

This is the core advantage over NDK's subscribe-then-collect pattern:
instead of each component managing its own subscription and re-fetching
on focus/reconnect, the `QueryStore` keeps all derived views live.

**For auctions, this means:**

- A "live auction discovery" query (all 30408 events by author or
  parameterized d-tag) updates automatically when a new auction is
  published to any connected relay.
- A "current auction state" query (latest replaceable 30408 for a given
  d-tag) updates automatically when the seller modifies auction parameters.
- A "bid stream" query (append-only bid events for a given auction
  coordinate) updates automatically when new bids arrive.

### TimelineQuery / TimelineLoader-style loaders

For paginated or chronological auction event streams (e.g., bid history),
applesauce provides `TimelineQuery` / `TimelineLoader`-style primitives
that handle:

- Backfill: load older events on demand (scroll-up, infinite scroll).
- EOSE handling: know when the initial backlog is exhausted and only
  new events remain.
- Gap detection: identify missing events in the timeline and request
  them from relays.

For auctions, the bid stream is the primary candidate for a
timeline-style loader — bids arrive chronologically and the UI needs
to show both recent activity and historical bids.

### Per-relay isolation

One flaky relay should degrade only its own stream, not poison the
entire auction view. The `nostr_ex` project (jurraca, Elixir) is the
reference implementation for this pattern:

- **Actor model:** each relay connection is an isolated process. A
  crash or timeout in one relay's connection does not propagate to
  others.
- **Self-healing backoff:** full-jitter exponential backoff
  (500ms–30s) before reconnect attempts. The relay is not hammered
  while down.
- **Sub-replay after reconnect:** subscriptions are recorded and
  replayed after every successful reconnect. The relay catches up on
  missed events automatically.

Applesauce's `RelayPool` already provides per-relay isolation at the
connection level (each relay is a separate `Relay` instance with its
own WebSocket). The question is whether applesauce-relay auto-replays
REQs after reconnect and exposes up/down transitions — this is an
**confirmed by hzrd149** (2026-08-27): applesauce-relay provides `reconnect` (rebuild websocket after disconnect) and `resubscribe` (resend REQ after CLOSE or broken websocket).

### Relay liveness

Applesauce-relay's failover behavior is assumed to include:

- **REQ replay after reconnect:** when a relay reconnects, its
  active subscriptions are re-issued. The relay serves events from
  its local store, and the client receives any events it missed.
- **Up/down transitions:** the relay pool exposes connection state
  changes (relay went down, relay came back up) so the UI can show
  liveness indicators per relay.

**Confirmed by hzrd149** (2026-08-27): `reconnect` + `resubscribe` are available in applesauce-relay.
If applesauce-relay does not auto-replay REQs, the auctions module
will need to implement sub-replay at the application layer (record
active subscriptions, replay on reconnect signal). This is a
contingency, not the preferred path.

---

## 4. Auction Event Model

### Kind 30408 (auctions)

Kind 30408 is referenced in `src/lib/v4v/splits.ts` comments and the V4V
proposal as the auction event kind. The V4V proposal's hypothetical sketch
reads kind 30408 for auction definitions and kind 30409 for V4V validator
seeds.

**Status of the kind:** it is not yet finalized in the v4v layer. The
splits.ts comments are forward-looking ("auctions (kind 30408) tomorrow"),
not a committed schema. The V4V proposal explicitly defers "the auction
adapter / kind 30408 / 30409 / validator queries" as a separate, future
effort. This design doc treats 30408 as the working assumption but flags
the schema as an open question (§6).

### Related event kinds

| Kind  | Purpose             | Role in auctions                                                                                      |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| 30402 | Product listings    | Auctions reference a listed product by coordinate (`30402:<pubkey>:<d-tag>`)                          |
| 30403 | Orders              | Winning bid creates an order (kind 30403) for the auctioned product                                   |
| 30408 | Auction definitions | Replaceable events — seller publishes auction parameters (start price, reserve, duration, V4V splits) |
| 30409 | V4V validators      | Validator seeds for auction V4V splits (per the V4V proposal sketch)                                  |
| 7375  | Cashu tokens        | Bid bonds or settlement tokens (append-only heap, per ADR-0019)                                       |
| 7376  | Cashu redemptions   | Tombstones marking spent tokens (per ADR-0019)                                                        |

### Query patterns

**1. Auction discovery — subscribe to 30408 by author / parameterized d-tag**

```ts
// All auctions by a specific seller
{ kinds: [30408], authors: [sellerPubkey] }

// A specific auction by coordinate
{ kinds: [30408], '#d': [auctionDTag], authors: [sellerPubkey] }
```

This is a replaceable-event query — the latest 30408 for a given
d-tag is the current auction state. The `QueryStore` keeps this
live: when the seller updates auction parameters, the new event
replaces the old one in the `EventStore` and the query re-evaluates
automatically.

**2. Auction state changes — replaceable events**

Kind 30408 is assumed to be a parameterized replaceable event (d-tag
makes it addressable). State changes (price update, extension, early
close) are published as new events with the same d-tag and a higher
`created_at`. The `EventStore` / `QueryStore` model handles this
naturally — the latest event for a given coordinate is the current
state.

**3. Bid stream — append-only events**

Bids are append-only (each bid is a new event, not a replacement).
The bid stream is a chronological query:

```ts
// All bids for a specific auction
{ kinds: [bidKind], '#a': [`30408:${sellerPubkey}:${auctionDTag}`] }
```

(The exact bid event kind is not yet defined in the codebase — this
is an open question. It may be a custom kind or reuse an existing
kind.) The `TimelineQuery` / `TimelineLoader` pattern applies here:
backfill older bids, stream new bids live, detect gaps.

### How auction events flow through the seam (io.ts) vs direct applesauce API

The seam (`io.ts`) provides a flat interface: `fetchEvents`,
`subscribe`, `publish`, `sign`, `getUser`. It is sufficient for
fire-and-forget patterns but does not expose the `EventStore` /
`QueryStore` reactive model.

**Two options for the auctions module:**

**Option A — Through the seam (io.ts):** The auction module calls
`fetchEvents` and `subscribe` from `io.ts`, managing its own state
and re-fetching on reconnect. This is the pattern used by orders
(Wave A1) and planned for listings (Wave A2). It is simpler and
consistent with existing migrated modules, but loses the reactive
`QueryStore` advantage — the module must manually refetch when
relays reconnect or when it suspects state has changed.

**Option B — Direct applesauce API (EventStore + QueryStore):** The
auction module instantiates an `EventStore`, creates `QueryStore`
queries for auction discovery, state changes, and bid streams, and
lets the reactive layer keep views live automatically. This bypasses
the seam for read paths but is the architecture this design doc
proposes — it is the applesauce-native approach that makes the
greenfield opportunity worthwhile.

**Recommended: Option B for read paths, Option A for publish.**

- **Read paths (discovery, state, bids):** use `EventStore` +
  `QueryStore` directly. The reactive model is the entire point of
  going applesauce-native. Forcing these through the flat `io.ts`
  interface would discard the advantage.
- **Publish paths (create auction, place bid, update state):**
  continue through `io.ts` (`publish`). Publishing is a simple
  fire-and-forget operation that the seam already handles well.
  Keeping publish through the seam maintains consistency with the
  strangler-fig pattern and ensures relay targeting logic is shared.

This split means the seam's `subscribe` / `fetchEvents` are not used
by the auctions module — the `EventStore` / `QueryStore` layer
handles relay I/O for reads. The seam's `publish` is used for
writes. This is an intentional deviation from the "everything through
the seam" pattern, justified by the greenfield nature of the module
(no existing NDK code to migrate through the seam) and the reactive
architecture's requirements.

---

## 5. Implementation Plan (Phased)

### Phase 1: applesauce-core 5.2 → 6.2 upgrade

**Before any auctions work**, verify whether the applesauce upgrade
from `^5.2.0` (current pin) to `6.2.0` (upstream latest) introduces
breaking changes that affect the `EventStore` / `QueryStore` API
surface.

Steps:

1. Review the applesauce-core changelog / release notes for
   5.2 → 6.0 → 6.2 breaking changes.
2. Check whether `EventStore`, `QueryStore`, `TimelineQuery`, and
   `RelayPool` APIs changed between 5.2 and 6.2.
3. If breaking changes exist, document the migration delta and
   decide whether to upgrade first or pin at 5.2 for the initial
   auctions implementation.
4. If no breaking changes or the delta is small, upgrade to 6.2
   as a prerequisite PR (separate from the auctions module).

**Dependency:** this phase may run in parallel with Phase 2 (Wave
A2 listings) if the upgrade is confirmed safe. If the upgrade has
breaking changes, it should land first.

### Phase 2: Wave A2 — listings through the io.ts seam

**Prerequisite for auctions.** Listings (kind 30402) must be
migrated through the seam before auctions work begins. This proves
the seam works for marketplace event kinds and establishes the
patterns the auctions module will build on.

Tracked as kanban `t_353544bd`.

Steps (high-level, not this design doc's scope):

1. Route listing read paths (`src/queries/products.tsx`,
   `src/lib/stores/product.ts`) through `io.ts`.
2. Flip listing read paths from NDK to applesauce adapter.
3. Route listing publish paths (`src/publish/products.tsx`) through
   `io.ts`.
4. Flip listing publish paths from NDK to applesauce adapter.
5. Lower the NDK footprint baseline.

**Why auctions depend on Wave A2:** the seam must be proven on an
existing marketplace kind (listings) before greenfield work builds
on the applesauce-native patterns. If Wave A2 reveals seam
limitations, the auctions design must account for them before
implementation, not after.

### Phase 3: Wave A3 — auctions module, applesauce-native from day one

**The core deliverable of this design doc.**

Steps:

1. **Define the auction event schema.** Finalize the kind 30408
   tag structure (d-tag, product reference, price fields, duration,
   V4V splits). Resolve the open question on whether 30408 is
   finalized or still proposed (§6).

2. **Implement the `EventStore`-backed auction read layer.**
   - Create `src/lib/auctions/store.ts` — instantiates an
     `EventStore` (or reuses the app-wide one), registers
     `QueryStore` queries for auction discovery, state changes,
     and bid streams.
   - Relay I/O for reads goes through the `EventStore` directly
     (Option B, §4), not through `io.ts` `subscribe` / `fetchEvents`.
   - Publish paths go through `io.ts` `publish` (Option A).

3. **Implement the auction query hooks.**
   - `useAuctionDiscovery(sellerPubkey?)` — reactive query for
     all auctions by a seller (or all auctions globally).
   - `useAuctionState(coordinate)` — reactive query for the
     latest replaceable 30408 event for a given coordinate.
   - `useAuctionBids(coordinate)` — `TimelineQuery`-style loader
     for the bid stream (backfill + live updates + gap detection).

4. **Implement the V4V auction adapter.**
   - `useAuctionV4VSplits({ auctionEventId, sellerNpub })` — the
     hook sketched in the V4V proposal. Reads kind 30408 for
     split configuration, seeds validators from kind 30409.
   - Renders the existing `V4VManager` component unchanged (the
     proposal proved agnosticism).

5. **Implement auction publish flows.**
   - `createAuction` — publish a new 30408 event.
   - `updateAuction` — publish a replacement 30408 event (same
     d-tag, higher `created_at`).
   - `placeBid` — publish a bid event referencing the auction
     coordinate.
   - All publish calls go through `io.ts` `publish`.

6. **Implement the auction UI routes.**
   - Auction discovery page (list of active auctions).
   - Auction detail page (current state + live bid stream +
     V4V splits editor).
   - Create-auction flow (seller dashboard).

7. **Tests (per ADR-0005).**
   - Unit tests for auction event parsing, V4V split math (reuse
     `src/lib/v4v/splits.ts` — already framework-agnostic).
   - Integration tests using `nak serve` as the local relay
     (seeded auction events, bid events, state transitions).
   - No external relay or mint calls. Mock mints for any
     Cashu token interactions (bid bonds, settlement).

### Phase 4: NDK footprint guard enhancement

The current guard counts files that import `@nostr-dev-kit`. It does
not count the number of import statements within those files. A file
that already imports NDK could gain additional NDK imports without
triggering the guard.

Steps:

1. Enhance `scripts/check-ndk-footprint.sh` to count import
   statements (lines matching `from '@nostr-dev-kit` or
   `require('@nostr-dev-kit`), not just files containing them.
2. Update the baseline format to track import counts per file or a
   total import count.
3. Ratchet the baseline downward as the migration progresses.

This is not strictly required for the auctions module (which introduces
zero NDK imports), but it closes the guard weakness that could allow
NDK creep in other modules during the same window.

### Dependencies

```
Phase 1 (applesauce upgrade) ─┐
                               ├─→ Phase 3 (auctions module)
Phase 2 (Wave A2 listings) ───┘                     │
                                                     ▼
                                             Phase 4 (guard enhancement)
```

- Phase 2 must land before Phase 3 (seam proven on listings first).
- Phase 1 may run in parallel with Phase 2 if the upgrade is safe.
- Phase 4 is independent and can land at any point.

### Test isolation

Per ADR-0005, all tests must run without external network calls:

- **Relays:** `nak serve` on `ws://localhost:10547` (already used
  in CI). Auction events are seeded to the local relay before tests.
- **Mints:** mocked — no real Cashu mint calls. Token encoding
  uses `getEncodedToken` (pure function). Bid bonds and settlement
  tokens are inert strings in test fixtures.
- **No external relay connections:** `LOCAL_RELAY_ONLY=true` in
  test environment, same as existing e2e patterns.

---

## 6. Open Questions

### Hazard Q2: Which applesauce primitives for auction event streams?

Awaiting reply from hzrd149 (message sent 2026-08-27). The design
assumes `EventStore` + `QueryStore` + `TimelineQuery` / `TimelineLoader`
are the correct primitives for auction discovery, state changes, and
bid streams. If applesauce provides higher-level abstractions better
suited to these patterns, the implementation should use those instead.

### Hazard Q3: Relay liveness behavior — REQ replay, up/down transitions

Awaiting reply from hzrd149 (message sent 2026-08-27). The design
assumes applesauce-relay auto-replays REQs after reconnect and exposes
up/down relay state transitions. If this is not the case, the auctions
module will need to implement sub-replay at the application layer
(record active subscriptions, replay on reconnect signal). This is a
contingency, not the preferred path.

### Applesauce 5.2 → 6.2 upgrade: breaking changes?

The repo pins `applesauce-core` and `applesauce-relay` at `^5.2.0`.
Upstream is at 6.2.0. Phase 1 of the implementation plan checks for
breaking changes before proceeding. Open question #9 in the handover
doc asks whether the upgrade should happen with Wave A2 or separately.

### Auction event kind 30408: finalized or still proposed?

Kind 30408 is referenced in `splits.ts` comments and the V4V proposal
as the auction event kind, but the V4V proposal explicitly defers the
auction adapter and kind 30408 / 30409 schema as "a separate, future
effort." The exact tag structure, replaceable-event semantics, and bid
event kind are not yet defined in the codebase. This design doc treats
30408 as the working assumption but the schema must be finalized before
Phase 3 implementation begins.

---

## 7. Risks & Mitigations

| Risk                                                                | Impact                                                                                                                                                                                                                                                                                                           | Mitigation                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Applesauce API changes between 5.2 and 6.2**                      | `EventStore`, `QueryStore`, or `RelayPool` APIs may change, breaking the auctions module or requiring rework.                                                                                                                                                                                                    | Phase 1 checks breaking changes before implementation. If the delta is large, pin at 5.2 for the initial implementation and upgrade separately.                                                     |
| **NDK footprint guard doesn't catch new imports in existing files** | A file that already imports `@nostr-dev-kit` could gain additional NDK imports (e.g., in shared utility code the auctions module depends on) without triggering the guard.                                                                                                                                       | Phase 4 enhances the guard to count import statements, not just files. In the interim, code review must verify no new NDK imports are added to existing files touched by auctions work.             |
| **Auction event model not yet finalized**                           | The kind 30408 schema (tags, replaceable semantics, bid kind) is forward-looking, not committed. Implementing against an unstable schema means rework if the schema changes.                                                                                                                                     | Do not start Phase 3 implementation until the kind 30408 schema is finalized. The design doc and V4V proposal establish the shape; the schema must be confirmed by the team before code is written. |
| **Relay liveness confirmed**                                        | hzrd149 confirmed (2026-08-27): applesauce-relay provides `reconnect` (rebuild websocket after disconnect) and `resubscribe` (resend REQ after CLOSE or broken websocket). The reactive model holds — queries stay live across relay drops. The `nostr_ex` pattern (per-relay sub-replay) is natively supported. |

---

## References

- ADR-0002: `docs/adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md`
- ADR-0005: `docs/adr/ADR-0005-no-external-service-dependencies-in-tests.md`
- ADR-0017: `docs/adr/ADR-0017-cashu-wallet-dependency-stack.md`
- ADR-0019: `docs/adr/ADR-0019-wallet-state-synchronization-hybrid-wal-checkpoint.md`
- V4V UI-agnostic audit and plan: `docs/adr/proposals/v4v-ui-agnostic-audit-and-plan.md`
- Wallet rebuild research handover (2026-08-27), §7, decision D8
- NDK footprint guard: `.github/workflows/ci-ndk-guard.yml`, `scripts/check-ndk-footprint.sh`
- Applesauce MCP (agent context): `https://mcp.applesauce.build/mcp`
- nostr_ex (per-relay isolation reference): `https://github.com/jurraca/nostr_ex`
- Martin Fowler, StranglerFig: `https://martinfowler.com/bliki/StranglerFigApplication.html`
