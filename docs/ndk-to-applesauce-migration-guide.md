# NDK → Applesauce Port Migration Guide

Operational companion to
[ADR-0002: Strangler-Fig Pattern for Nostr I/O Migration (NDK → Applesauce)](./adr/ADR-0002-nostr-io-migration-ndk-to-applesauce.md).

ADR-0002 records _why_ the migration exists and the wave strategy. This guide
records _what to check_ when flipping a module from the NDK adapter to the
applesauce adapter, and the port invariants that a flip must preserve. It exists
because the two adapters are not observationally identical, and a flip can
silently change downstream semantics several layers away from the `fetchEvents`
call.

Add to this guide whenever a flip reveals a new adapter divergence.

## The port

```
src/lib/nostr/io.ts           — the Port interface (the seam)
src/lib/nostr/io-ndk.ts       — temporary NDK bridge (default during migration)
src/lib/nostr/io-applesauce.ts — destination adapter (applesauce-relay RelayPool)
```

Callers must only use `io.ts`. A flip is two steps (ADR-0002 §"Two-step flip"):

1. Route the module through the seam with the active adapter still NDK. Zero
   behavior change; tests stay green.
2. Flip the module to applesauce. Tests gate it. Revert one module if it breaks.

## Port invariants (both adapters MUST honour these)

These are part of the contract, not implementation details. A caller may rely
on them without re-checking, so both adapters must be verified against them.

1. **Raw events only.** Events cross the seam as plain `nostr-tools`-shaped
   objects. Callers must never call `rawEvent()`; use `toRawEvent()`
   (`src/lib/nostr/eventLike.ts`) at schema-parse boundaries.

2. **`fetchEvents` results are unique by event `id`.** An event matching more
   than one of the supplied filters is returned **exactly once**.
   - `io-ndk` gets this for free: `ndkActions.fetchEventsWithTimeout` returns a
     `Set` built from a `Map` keyed by `deduplicationKey()`.
   - `io-applesauce` must deduplicate explicitly. `RelayPool.request(urls,
filters)` emits an event once **per matching filter**, so an OR query over
     `#e` + `#a` (e.g. `fetchAuctionBids`) returns a bid tagged with both
     **twice** without deduplication.
   - This is load-bearing, not cosmetic. Downstream layers treat a repeated
     event as two distinct inputs. A concrete failure: `computeValidatedBids`
     (M5 screen, `src/lib/auction/bidValidation.ts`) flags a duplicated bid as
     proof reuse, marks a legitimate bid invalid, and `publishAuctionSettlement`
     aborts with _"No validated winner — all bids are pending or invalid."_

3. **`fetchEvents` must not reject on partial relay failure.** During migration
   the NDK adapter resolves with whatever it collected when the timeout fires;
   it never rejects. If the applesauce adapter rejects on pool error, any caller
   doing a bare `Promise.all` of several fetches turns a transient relay hiccup
   into a hard failure where NDK degraded gracefully. Verify this before
   flipping a module whose callers use `Promise.all`.

4. **`subscribe` has no EOSE signal in the port.** Adapters emulate
   `closeOnEose` themselves, and callers use a grace timer to end loading
   states. Do not assume relay EOSE reached the caller.

## Division of responsibility

Uniqueness and raw-shape normalization are **seam responsibilities**. Do not
paper over a divergence at the call site: a per-call `dedupeEventsById` leaves
the next multi-filter fetcher as a fresh landmine. When a flip exposes a
divergence, fix the adapter (or the port contract) and note it here.

## Checklist when flipping a module

- [ ] Does the module pass an **array** of filters, or a single filter with
      several tag keys? If yes, check the duplicate-delivery case explicitly.
- [ ] Does any caller do `Promise.all([...])` over several fetches? If yes,
      confirm the reject-on-error behavior of both adapters.
- [ ] Does the module call `.rawEvent()` anywhere? Replace with `toRawEvent()`.
- [ ] Does the module or its tests mock `@/lib/stores/nip60`,
      `@/lib/stores/ndk`, or `applesauce-relay` with a **partial** surface? See
      the test-isolation pitfall below.
- [ ] Run the module's unit tests **and** the auctions e2e families
      (`Auction Settlement Descriptor`, `publish events to relay`,
      `Cross-client`, `Auction Bidding`).

## Pitfalls

### `mock.module()` is process-wide under bun

`bun` applies `mock.module()` for the whole test run unless test files are
isolated. A partial mock therefore leaks into unrelated files. Concrete case:
`src/lib/__tests__/auctionBidPublishRetry.test.ts` registers a top-level
`mock.module('@/lib/stores/nip60', () => ({ nip60Actions: { /* 2 methods */ } }))`.
`src/lib/__tests__/nip60DepositIdentity.test.ts` then imports the stub and fails
with `nip60Actions.startDeposit is not a function`.

This is why the repo's root `AGENTS.md` forbids mocking third-party packages
wholesale. Two things to know:

- It is **environment-dependent**. `bun test --isolate` (or `--parallel`, which
  implies `--isolate`) gives each test file a fresh global and module registry,
  so the leak disappears; without isolation it reproduces. CI has isolation
  enabled, a local run may not — so "passes in CI, fails locally" is expected
  here and is **not** evidence of a real regression.
- Any test file that registers a module mock at top level should restore it
  (`afterAll(() => mock.restore())`) so the suite does not depend on the
  runner's isolation mode.

### Local reproduction of e2e

The auctions e2e suites need three local services (see `e2e/AGENTS.md` and
ADR-0005): `nak serve` on `10547`, a nutshell Cashu mint on `3338`
(`e2e/start-local-mint.sh`), and the dev server on `34567` with
`LOCAL_RELAY_ONLY=true`. `bun run test:e2e` starts them itself when not
already running.

## Verification commands

```bash
# Unit suite, isolated (matches CI behavior)
bun test --isolate $(find contextvm src/queries/__tests__ src/lib/__tests__ \
  -type f -name '*.test.ts' ! -name '*.integration.test.ts' | sort)

# Prove a suspected cross-file mock leak
bun test src/lib/__tests__/auctionBidPublishRetry.test.ts \
         src/lib/__tests__/nip60DepositIdentity.test.ts   # fails: mock leaks
bun test src/lib/__tests__/nip60DepositIdentity.test.ts   # passes: no leak

# Auctions e2e families most exposed to the query seam
bun run test:e2e -- --grep "Auction Bidding|Auction Settlement Descriptor|publish events to relay|Cross-client"
```

## Known divergences found so far

- **Duplicate events across multiple filters** — found while flipping
  `src/queries/auctions.tsx`. Fixed in the seam: `applesauceIo.fetchEvents` now
  deduplicates by `id`.
- **Reject-on-relay-error** — `applesauceIo.fetchEvents` rejects where the NDK
  adapter never did. Not yet reconciled; verify before flipping any module whose
  callers use `Promise.all`.
